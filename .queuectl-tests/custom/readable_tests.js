import {
    fullCleanup, sleep, enqueue, getJobs, startWorkersBackground,
    stopWorkersAndWait, killProcessTree, configSet, waitForJobState,
    getStatus, dlqList, dlqRetry, configList, waitForAllJobsInState
} from '../helpers.js';
import fs from 'fs';

async function runTests() {
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        console.log(`\n--- Running Test: ${name} ---`);
        await fullCleanup(); // Clean DB and stale processes before each test
        try {
            await fn();
            console.log(`✓ ${name} Passed`);
            passed++;
        } catch (err) {
            console.error(`✗ ${name} Failed:`, err);
            failed++;
        }
    }

    await test("Basic success", async () => {
        // Enqueue a simple job
        await enqueue({ id: 'basic-1', command: 'node -e "console.log(1)"' });
        const job = { id: 'basic-1' };
        
        // Start a worker
        const worker = startWorkersBackground(1);
        
        // Wait for the job to complete
        const completed = await waitForJobState(job.id, 'completed', 5000);
        if (!completed) throw new Error("Job did not complete in time");
        
        // Clean up
        await stopWorkersAndWait(worker);
    });

    await test("Retry", async () => {
        await configSet('max-retries', 2);
        
        // Enqueue a job that always fails
        await enqueue({ id: 'retry-1', command: 'node -e "process.exit(1)"' });
        const job = { id: 'retry-1' };

        const worker = startWorkersBackground(1);
        
        // Wait until it reaches the dead state (DLQ) after retries
        const isDead = await waitForJobState(job.id, 'dead', 15000);
        if (!isDead) throw new Error("Job did not reach dead state (DLQ)");
        
        // Fetch job details to verify attempts
        const deadJobs = await getJobs('dead');
        const deadJob = deadJobs.find(j => j.id === job.id);
        
        if (!deadJob || deadJob.attempts <= 1) {
            throw new Error(`Expected multiple retries, but job ended with ${deadJob?.attempts || 0} attempts.`);
        }
        
        await stopWorkersAndWait(worker);
    });

    await test("DLQ", async () => {
        await configSet('max-retries', 0); // Disable retries for quick DLQ
        
        await enqueue({ id: 'dlq-1', command: 'node -e "process.exit(1)"' });
        const job = { id: 'dlq-1' };

        const worker = startWorkersBackground(1);
        
        // Wait for it to immediately go to DLQ
        const isDead = await waitForJobState(job.id, 'dead', 5000);
        if (!isDead) throw new Error("Failed job did not go to DLQ");
        
        await stopWorkersAndWait(worker);
    });

    await test("Crash recovery", async () => {
        await configSet('recovery-interval', 2000); // 2 second recovery check
        await configSet('worker-timeout', 2000);    // 2 second worker timeout
        
        // Enqueue a job that runs for a long time
        await enqueue({ id: 'crash-1', command: 'node -e "setTimeout(() => {}, 10000)"' });
        const job = { id: 'crash-1' };

        const worker = startWorkersBackground(1);
        
        // Wait for it to start processing
        const processing = await waitForJobState(job.id, 'processing', 5000);
        if (!processing) throw new Error("Job didn't start processing");

        // Forcefully kill the worker process to simulate a crash
        killProcessTree(worker.pid);
        
        // Start a new supervisor/worker which should detect the dead worker's jobs and recover them
        const newWorker = startWorkersBackground(1);
        
        // Wait for the job to be recovered (returns to processing or finishes)
        const recovered = (await waitForJobState(job.id, 'processing', 15000)) || 
                          (await waitForJobState(job.id, 'completed', 15000));
        
        if (!recovered) {
            const allJobs = await getJobs();
            throw new Error(`Job was not recovered. Current state in DB: ${JSON.stringify(allJobs)}`);
        }
        
        await stopWorkersAndWait(newWorker);
    });

    await test("Persistence", async () => {
        await enqueue({ id: 'persist-1', command: 'echo "persistence test"' });
        const job = { id: 'persist-1' };
        
        // We do not start a worker. We just fetch the pending jobs to verify SQLite persistence across CLI processes
        const pendingJobs = await getJobs('pending');
        const found = pendingJobs.find(j => j.id === job.id);
        if (!found) throw new Error("Job was not persisted to the database");
    });

    await test("Worker stop", async () => {
        const worker = startWorkersBackground(1);
        await sleep(1000); // Let it initialize
        // Issue the `queuectl worker stop` command using the helper
        await stopWorkersAndWait(worker, 5000);
        if (worker.exitCode === null) {
            killProcessTree(worker.pid);
            throw new Error("Worker process did not exit cleanly after stop command");
        }
    });

    await test("Status", async () => {
        // Enqueue a job to ensure queue has some data
        await enqueue({ id: 'status-1', command: 'echo "status test"' });
        
        // Use queuectl status command
        const res = await getStatus();
        if (res.exitCode !== 0) throw new Error(`Status command failed: ${res.stderr}`);
        
        // Simple verification that it outputs something
        if (!res.stdout.includes('pending')) {
            throw new Error(`Unexpected status output: ${res.stdout}`);
        }
    });

    await test("Config List", async () => {
        const res = await configList();
        if (res.exitCode !== 0) throw new Error(`Config list command failed: ${res.stderr}`);
        if (!res.stdout.includes('max-retries')) {
            throw new Error(`Expected max-retries in config list, got: ${res.stdout}`);
        }
    });

    await test("DLQ List & Retry", async () => {
        await configSet('max-retries', 0); // No retries so it goes straight to DLQ
        await enqueue({ id: 'dlq-list-1', command: 'node -e "process.exit(1)"' });
        
        const worker = startWorkersBackground(1);
        await waitForJobState('dlq-list-1', 'dead', 5000);
        await stopWorkersAndWait(worker);
        
        // Test `dlq list`
        const listRes = await dlqList();
        if (listRes.exitCode !== 0) throw new Error(`DLQ list failed: ${listRes.stderr}`);
        
        // `dlq list` usually prints the javascript object literal or array 
        if (!listRes.stdout.includes('dlq-list-1')) {
            throw new Error(`Expected DLQ list to contain dlq-list-1, got: ${listRes.stdout}`);
        }
        
        // Test `dlq retry`
        const retryRes = await dlqRetry('dlq-list-1');
        if (retryRes.exitCode !== 0) throw new Error(`DLQ retry failed: ${retryRes.stderr}`);
        
        // Verify it moved from dead to pending
        const pendingJobs = await getJobs('pending');
        const found = pendingJobs.find(j => j.id === 'dlq-list-1');
        if (!found) throw new Error("Job was not moved to pending after dlq retry");
    });

    await test("Priority Order", async () => {
        const logPath = './priority_order.log';
        if (fs.existsSync(logPath)) {
            try { fs.unlinkSync(logPath); } catch {}
        }

        // Enqueue jobs in a mixed order of priorities and creation times
        // Job C: Priority 5 (Lowest)
        await enqueue({ id: 'job-c', command: `node -e "require('fs').appendFileSync('${logPath.replace(/\\/g, '/')}', 'C\\n')"` }, 5);
        await sleep(100); // ensure different creation times
        
        // Job B: Priority 10
        await enqueue({ id: 'job-b', command: `node -e "require('fs').appendFileSync('${logPath.replace(/\\/g, '/')}', 'B\\n')"` }, 10);
        await sleep(100);
        
        // Job A: Priority 10 (Same priority as B, but created later, so should run AFTER B)
        await enqueue({ id: 'job-a', command: `node -e "require('fs').appendFileSync('${logPath.replace(/\\/g, '/')}', 'A\\n')"` }, 10);
        await sleep(100);
        
        // Job D: Priority 20 (Highest)
        await enqueue({ id: 'job-d', command: `node -e "require('fs').appendFileSync('${logPath.replace(/\\/g, '/')}', 'D\\n')"` }, 20);

        // Start worker
        const worker = startWorkersBackground(1);

        // Wait for all four jobs to be completed
        const completed = await waitForAllJobsInState('completed', 4, 15000);
        if (!completed) throw new Error("Not all priority jobs completed in time");

        // Clean up worker
        await stopWorkersAndWait(worker);

        // Read the logged order
        const logContent = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => line.trim());
        
        // Expected order: D (priority 20) -> B (priority 10, FIFO first) -> A (priority 10, FIFO second) -> C (priority 5)
        const expectedOrder = ['D', 'B', 'A', 'C'];
        
        if (JSON.stringify(logContent) !== JSON.stringify(expectedOrder)) {
            throw new Error(`Priority order mismatch! Expected: ${expectedOrder.join(', ')}. Got: ${logContent.join(', ')}`);
        }

        // Clean up the log file
        try { fs.unlinkSync(logPath); } catch {}
    });

    console.log(`\nTests completed. ${passed} passed, ${failed} failed.`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error("Test suite crashed:", err);
    process.exit(1);
});
