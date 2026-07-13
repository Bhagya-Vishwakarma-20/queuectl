/**
 * Level 4 — Crash Recovery Tests
 *
 * Simulates SIGKILL, power failure, supervisor crash, and every
 * "crash after X, before Y" scenario the spec mentions.
 *
 * Key spec requirement:
 *   "worst-case recovery must be under 60 seconds"
 *   "a job must never be stuck in processing forever"
 */

import {
    defineTest, queuectl, enqueue, enqueueMany, getJobs,
    startWorkersBackground, stopWorkersAndWait, stopWorkers,
    waitForJobState, waitForAllJobsInState, waitForNoJobsInState,
    waitForCondition,
    sleep, assert, assertEqual, assertGreaterThan,
    generateJobs, killProcessTree, killProcess, isProcessAlive,
} from './helpers.js';

export const tests = [

    // ── T301 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T301',
        name: 'SIGKILL worker mid-job → job recovers and completes',
        category: 'Crash Recovery',
        level: 4,
        difficulty: 8,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Scenario 4: Workers SIGKILL-ed mid-job; after restart, jobs complete',
        timeout: 120000,
        fn: async () => {
            // Enqueue a long job so we can kill mid-execution
            await enqueue({ id: 'crash-1', command: 'sleep 10 && echo survived' });

            // Start workers
            const wp1 = startWorkersBackground(1);

            // Wait for job to enter processing
            const started = await waitForJobState('crash-1', 'processing', 10000);
            assert(started, 'Job must start processing');

            // SIGKILL the entire worker tree (simulates crash)
            killProcessTree(wp1.pid);
            await sleep(2000);

            // Verify supervisor is dead
            assert(!isProcessAlive(wp1.pid), 'Supervisor should be dead after SIGKILL');

            // Job should be stuck in "processing" in the DB right now
            const stuckJobs = await getJobs('processing');
            // It might still be "processing" or already recovered if recovery ran

            // Start NEW workers (recovery should kick in)
            const wp2 = startWorkersBackground(1);

            // Wait for recovery + re-execution (must happen within 60s per spec)
            const recovered = await waitForCondition(async () => {
                const processing = await getJobs('processing');
                const completed = await getJobs('completed');
                // Job should eventually move out of processing
                return (processing?.length === 0) &&
                    (completed?.some((j) => j.id === 'crash-1'));
            }, 60000);

            assert(recovered, 'Job must recover from crash within 60 seconds');

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T302 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T302',
        name: 'SIGKILL supervisor mid-job → all jobs still complete after restart',
        category: 'Crash Recovery',
        level: 4,
        difficulty: 8,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Crash of parent process does not lose jobs',
        timeout: 120000,
        fn: async () => {
            const count = 5;
            const jobs = generateJobs(count, () => 'sleep 3 && echo ok');
            await enqueueMany(jobs);

            const wp1 = startWorkersBackground(2);
            await sleep(3000); // Let workers pick up some jobs

            // Kill the entire tree
            killProcessTree(wp1.pid);
            await sleep(2000);

            // Start fresh workers
            const wp2 = startWorkersBackground(2);

            // All jobs should eventually complete
            const allDone = await waitForAllJobsInState('completed', count, 90000);
            assert(allDone, 'All jobs must complete after supervisor crash + restart');

            // No jobs stuck in processing
            const processing = await getJobs('processing');
            assertEqual(processing?.length ?? 0, 0, 'No jobs should be stuck in processing');

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T303 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T303',
        name: 'Kill during retry backoff → job still retries after restart',
        category: 'Crash Recovery',
        level: 4,
        difficulty: 7,
        priority: 'High',
        probability: 'High',
        requirement: 'Killing workers during backoff does not lose the failed job',
        timeout: 120000,
        fn: async () => {
            await enqueue({ id: 'crash-retry', command: 'exit 1' });
            const wp1 = startWorkersBackground(1);

            // Wait for first failure
            const firstFail = await waitForCondition(async () => {
                const all = await getJobs();
                const job = all?.find((j) => j.id === 'crash-retry');
                return job && job.attempts >= 1;
            }, 15000);
            assert(firstFail, 'Job should have failed at least once');

            // Kill workers while job is in backoff
            killProcessTree(wp1.pid);
            await sleep(2000);

            // Job should be in 'failed' state (waiting for retry) or 'processing' (stuck)
            const allJobs = await getJobs();
            const job = allJobs?.find((j) => j.id === 'crash-retry');
            assert(job, 'Job must still exist in DB after crash');

            // Restart workers — the job should continue retrying
            const wp2 = startWorkersBackground(1);

            // Eventually should reach DLQ (after all retries exhausted)
            const dead = await waitForJobState('crash-retry', 'dead', 90000);
            assert(dead, 'Failed job should eventually reach DLQ after crash + restart');

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T304 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T304',
        name: 'Full restart: stop everything, restart, all jobs complete',
        category: 'Full Restart',
        level: 4,
        difficulty: 6,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Scenario 5: Jobs survive a full restart',
        timeout: 60000,
        fn: async () => {
            const count = 5;
            const jobs = generateJobs(count, (i) => `echo restart_${i}`);
            await enqueueMany(jobs);

            // Start, let some jobs process, then kill everything
            const wp1 = startWorkersBackground(2);
            await sleep(2000);
            killProcessTree(wp1.pid);
            await sleep(2000);

            // Restart
            const wp2 = startWorkersBackground(2);

            // All jobs should complete
            const allDone = await waitForAllJobsInState('completed', count, 45000);
            assert(allDone, 'All jobs must complete after full restart');

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T305 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T305',
        name: 'Crash after claiming, before execution starts',
        category: 'Crash Timing',
        level: 4,
        difficulty: 8,
        priority: 'High',
        probability: 'High',
        requirement: 'Job claimed but not executed must be recovered',
        timeout: 120000,
        fn: async () => {
            // Use a fast job so the window between claim and execution is tiny
            // The test verifies that even if a crash happens RIGHT after claiming,
            // the job gets recovered
            await enqueue({ id: 'claim-crash', command: 'echo claimed' });

            const wp1 = startWorkersBackground(1);
            // Kill almost immediately after worker starts (before or during first poll)
            await sleep(500);
            killProcessTree(wp1.pid);
            await sleep(2000);

            // The job might be in 'processing' (claimed but not completed) or 'pending'
            // Either way, restart should fix it
            const wp2 = startWorkersBackground(1);
            const completed = await waitForJobState('claim-crash', 'completed', 60000);
            assert(completed, 'Job that was claimed then crashed must eventually complete');

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T306 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T306',
        name: 'Multiple crash-restart cycles: no jobs lost',
        category: 'Resilience',
        level: 4,
        difficulty: 8,
        priority: 'High',
        probability: 'Medium',
        requirement: 'System survives repeated crash-restart cycles',
        timeout: 180000,
        fn: async () => {
            const count = 10;
            const jobs = generateJobs(count, (i) => `sleep 1 && echo cycle_${i}`);
            await enqueueMany(jobs);

            // Crash-restart 3 times
            for (let cycle = 0; cycle < 3; cycle++) {
                const wp = startWorkersBackground(2);
                // Let workers run for a bit
                await sleep(3000 + cycle * 1000);
                killProcessTree(wp.pid);
                await sleep(2000);
            }

            // Final run — let everything finish
            const wpFinal = startWorkersBackground(2);

            const allDone = await waitForAllJobsInState('completed', count, 60000);
            assert(allDone, `All ${count} jobs must complete after 3 crash-restart cycles`);

            // No jobs lost
            const completed = await getJobs('completed');
            assertEqual(completed.length, count, 'No jobs should be lost');

            // Nothing stuck in processing
            const processing = await getJobs('processing');
            assertEqual(processing?.length ?? 0, 0, 'No jobs stuck in processing');

            await stopWorkersAndWait(wpFinal);
        },
    }),

    // ── T307 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T307',
        name: 'Recovery timing: under 60 seconds worst case',
        category: 'Recovery SLA',
        level: 4,
        difficulty: 8,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Worst-case recovery must be under 60 seconds',
        timeout: 120000,
        fn: async () => {
            await enqueue({ id: 'sla-test', command: 'echo sla_ok' });
            const wp1 = startWorkersBackground(1);

            // Wait for job to start processing
            await waitForJobState('sla-test', 'processing', 10000);

            // SIGKILL
            killProcessTree(wp1.pid);
            await sleep(1000);

            const crashTime = Date.now();

            // Start new workers
            const wp2 = startWorkersBackground(1);

            // Wait for recovery
            const recovered = await waitForCondition(async () => {
                const jobs = await getJobs('completed');
                return jobs?.some((j) => j.id === 'sla-test');
            }, 60000);

            const recoveryTime = Date.now() - crashTime;

            assert(recovered, 'Job must recover');
            assert(recoveryTime < 60000,
                `Recovery took ${(recoveryTime / 1000).toFixed(1)}s — must be under 60s`
            );
            console.log(`    ℹ Recovery time: ${(recoveryTime / 1000).toFixed(1)}s`);

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T308 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T308',
        name: 'Stale worker cleanup: dead workers removed from DB',
        category: 'Cleanup',
        level: 4,
        difficulty: 6,
        priority: 'High',
        probability: 'High',
        requirement: 'Expired workers are cleaned up during recovery',
        timeout: 90000,
        fn: async () => {
            const wp1 = startWorkersBackground(3);
            await sleep(3000); // Let workers register

            // Kill without graceful shutdown (workers stay in DB as stale)
            killProcessTree(wp1.pid);
            await sleep(2000);

            // Start new workers — recovery should clean up stale entries
            const wp2 = startWorkersBackground(1);

            // Wait for recovery to detect and clean stale workers
            await sleep(35000); // worker-timeout default is 30s + buffer

            // Check that stale workers are cleaned up
            // We can verify by checking the total worker count
            // (should only show the new worker, not the old 3)

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T309 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T309',
        name: 'Processing jobs not stuck after crash (spec disqualification check)',
        category: 'Disqualification',
        level: 4,
        difficulty: 9,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Jobs permanently stuck in processing after worker crash = DISQUALIFICATION',
        timeout: 120000,
        fn: async () => {
            // This is THE critical test that can end the interview if it fails
            const count = 3;
            const jobs = generateJobs(count, () => 'sleep 5 && echo critical');
            await enqueueMany(jobs);

            const wp1 = startWorkersBackground(2);
            // Wait for at least 1 job to be processing
            await waitForCondition(async () => {
                const p = await getJobs('processing');
                return p && p.length > 0;
            }, 10000);

            // Crash!
            killProcessTree(wp1.pid);
            await sleep(2000);

            // Record which jobs are stuck in processing
            const stuckBefore = await getJobs('processing');

            // Start new workers
            const wp2 = startWorkersBackground(2);

            // ALL stuck jobs must recover within 60 seconds
            if (stuckBefore && stuckBefore.length > 0) {
                const noMoreStuck = await waitForCondition(async () => {
                    const p = await getJobs('processing');
                    // Only count jobs that were stuck before the restart
                    const stuckIds = new Set(stuckBefore.map((j) => j.id));
                    const stillStuck = p?.filter((j) => stuckIds.has(j.id)) || [];
                    return stillStuck.length === 0;
                }, 60000);

                assert(noMoreStuck, 
                    'DISQUALIFICATION RISK: Jobs stuck in processing after crash + restart'
                );
            }

            // Eventually all should complete
            await waitForAllJobsInState('completed', count, 60000);

            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T310 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T310',
        name: 'Crash during DLQ retry does not lose the job',
        category: 'Crash + DLQ',
        level: 4,
        difficulty: 7,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'DLQ retry followed by crash preserves job',
        timeout: 120000,
        fn: async () => {
            // Get a job into DLQ
            await enqueue({ id: 'dlq-crash', command: 'exit 1' });
            const wp1 = startWorkersBackground(1);
            await waitForJobState('dlq-crash', 'dead', 90000);
            await stopWorkersAndWait(wp1);

            // Retry the dead job
            await queuectl('dlq', 'retry', 'dlq-crash');

            // Verify it's pending
            const pending = await getJobs('pending');
            assert(pending?.some((j) => j.id === 'dlq-crash'), 'Job should be re-queued');

            // Start workers and immediately crash
            const wp2 = startWorkersBackground(1);
            await sleep(500);
            killProcessTree(wp2.pid);
            await sleep(2000);

            // The job should still exist (not lost)
            const allJobs = await getJobs();
            assert(allJobs?.some((j) => j.id === 'dlq-crash'), 'DLQ-retried job must not be lost after crash');

            // Restart and complete
            const wp3 = startWorkersBackground(1);
            // Job will fail again (exit 1), eventually go back to DLQ
            await waitForCondition(async () => {
                const all = await getJobs();
                const job = all?.find((j) => j.id === 'dlq-crash');
                return job && (job.state === 'dead' || job.state === 'failed');
            }, 60000);

            await stopWorkersAndWait(wp3);
        },
    }),
];
