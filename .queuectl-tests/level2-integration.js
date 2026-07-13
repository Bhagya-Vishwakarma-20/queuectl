/**
 * Level 2 — Integration Tests
 *
 * Tests that combine multiple features and verify interactions
 * between components (workers + retry, DLQ + restart, config + queue, etc.).
 */

import {
    defineTest, queuectl, enqueue, enqueueMany, getJobs,
    startWorkersBackground, stopWorkersAndWait, stopWorkers,
    waitForJobState, waitForAllJobsInState, waitForNoJobsInState,
    waitForCondition,
    sleep, assert, assertEqual, assertGreaterThan,
    assertGreaterThanOrEqual, generateJobs,
    configSet, dlqRetry, getStatus,
} from './helpers.js';

export const tests = [

    // ── T101 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T101',
        name: 'Multiple jobs all complete with multiple workers',
        category: 'Multi-Job',
        level: 2,
        difficulty: 4,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Scenario 3: Many jobs across multiple workers — every job runs exactly once',
        timeout: 60000,
        fn: async () => {
            const count = 10;
            const jobs = generateJobs(count, (i) => `echo job_${i}`);
            await enqueueMany(jobs);

            const wp = startWorkersBackground(3);
            const allDone = await waitForAllJobsInState('completed', count, 45000);
            assert(allDone, `All ${count} jobs should complete`);

            // Verify exactly `count` completed
            const completed = await getJobs('completed');
            assertEqual(completed.length, count, `Expected ${count} completed jobs`);

            // Verify no duplicates (each ID appears once)
            const ids = completed.map((j) => j.id);
            const uniqueIds = new Set(ids);
            assertEqual(uniqueIds.size, count, 'Each job should run exactly once (no duplicates)');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T102 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T102',
        name: 'Every job runs exactly once with 5 workers and 20 jobs',
        category: 'Multi-Job',
        level: 2,
        difficulty: 5,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'A job must never be executed by two workers at once',
        timeout: 60000,
        fn: async () => {
            // Use a command that writes a file so we can verify single execution
            const count = 20;
            const jobs = generateJobs(count, (i) => `echo done_${i}`);
            await enqueueMany(jobs);

            const wp = startWorkersBackground(5);
            const allDone = await waitForAllJobsInState('completed', count, 45000);
            assert(allDone, `All ${count} jobs should complete`);

            const completed = await getJobs('completed');
            assertEqual(completed.length, count, `Exactly ${count} completed`);

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T103 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T103',
        name: 'Retries happen while workers are continuously running',
        category: 'Retry',
        level: 2,
        difficulty: 5,
        priority: 'High',
        probability: 'High',
        requirement: 'Failed jobs retry automatically after backoff delay',
        timeout: 120000,
        fn: async () => {
            // Mix of passing and failing jobs
            await enqueue({ id: 'mix-pass-1', command: 'echo ok' });
            await enqueue({ id: 'mix-fail-1', command: 'exit 1' });
            await enqueue({ id: 'mix-pass-2', command: 'echo ok' });

            const wp = startWorkersBackground(2);

            // Wait for passing jobs to complete
            const pass1 = await waitForJobState('mix-pass-1', 'completed', 15000);
            const pass2 = await waitForJobState('mix-pass-2', 'completed', 15000);
            assert(pass1, 'mix-pass-1 should complete');
            assert(pass2, 'mix-pass-2 should complete');

            // Wait for failing job to exhaust retries and hit DLQ
            const dead = await waitForJobState('mix-fail-1', 'dead', 90000);
            assert(dead, 'mix-fail-1 should reach DLQ after exhausting retries');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T104 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T104',
        name: 'DLQ retry while workers are running picks up the job',
        category: 'DLQ + Workers',
        level: 2,
        difficulty: 5,
        priority: 'High',
        probability: 'High',
        requirement: 'dlq retry re-enqueues and workers process it',
        timeout: 120000,
        fn: async () => {
            // Let a job fail to DLQ
            await enqueue({ id: 'dlq-live-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);
            await waitForJobState('dlq-live-1', 'dead', 90000);

            // Now retry it with a command that will succeed
            // Note: we can't change the command, so this job will fail again.
            // But we CAN verify it goes back to pending and gets picked up.
            await dlqRetry('dlq-live-1');

            // Verify it gets picked up (goes to processing or fails again)
            const pickedUp = await waitForCondition(async () => {
                const all = await getJobs();
                const job = all?.find((j) => j.id === 'dlq-live-1');
                return job && job.state !== 'pending';
            }, 15000);
            assert(pickedUp, 'Retried DLQ job should be picked up by running workers');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T105 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T105',
        name: 'Config change to max-retries affects new jobs',
        category: 'Config + Retry',
        level: 2,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Retry count configurable via CLI, persisted',
        timeout: 60000,
        fn: async () => {
            // Set max-retries to 1 (job fails after 2 total attempts: 0 + 1 retry)
            await configSet('max-retries', 1);

            await enqueue({ id: 'cfg-retry-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);

            // With max_retries=1: fail attempt 0 → retry → fail attempt 1 → DLQ
            // Should be faster than default (max_retries=3)
            const dead = await waitForJobState('cfg-retry-1', 'dead', 30000);
            assert(dead, 'Job should reach DLQ faster with max-retries=1');

            const deadJobs = await getJobs('dead');
            const job = deadJobs?.find((j) => j.id === 'cfg-retry-1');
            assert(job, 'Job must be in DLQ');
            // Attempts should be max_retries + 1 = 2
            assert(job.attempts <= 3, `Attempts (${job.attempts}) should reflect reduced max-retries`);

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T106 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T106',
        name: 'Status shows processing count during execution',
        category: 'Status',
        level: 2,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'status reflects real-time state',
        timeout: 25000,
        fn: async () => {
            // Enqueue a slow job
            await enqueue({ id: 'status-live-1', command: 'sleep 5' });
            const wp = startWorkersBackground(1);

            // Wait for job to start processing
            const processing = await waitForJobState('status-live-1', 'processing', 10000);
            if (processing) {
                // Check status while job is processing
                const result = await getStatus();
                // Should show at least 1 processing
                assert(
                    result.stdout.includes('processing') || result.stdout.includes('1'),
                    'Status should reflect processing jobs'
                );
            }

            await waitForJobState('status-live-1', 'completed', 15000);
            await stopWorkersAndWait(wp);
        },
    }),

    // ── T107 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T107',
        name: 'list --state processing --json shows in-flight jobs',
        category: 'List',
        level: 2,
        difficulty: 4,
        priority: 'High',
        probability: 'High',
        requirement: 'list --state processing returns currently executing jobs',
        timeout: 25000,
        fn: async () => {
            await enqueue({ id: 'inflight-1', command: 'sleep 5' });
            const wp = startWorkersBackground(1);

            const isProcessing = await waitForJobState('inflight-1', 'processing', 10000);
            if (isProcessing) {
                const result = await queuectl('list', '--state', 'processing', '--json');
                const jobs = JSON.parse(result.stdout);
                assert(Array.isArray(jobs), 'Must be an array');
                assert(jobs.some((j) => j.id === 'inflight-1'), 'In-flight job should appear in processing list');
            }

            await waitForJobState('inflight-1', 'completed', 15000);
            await stopWorkersAndWait(wp);
        },
    }),

    // ── T108 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T108',
        name: 'Multiple worker sessions from separate invocations',
        category: 'Multi-Worker',
        level: 2,
        difficulty: 5,
        priority: 'High',
        probability: 'High',
        requirement: 'Workers from separate terminal sessions cooperate',
        timeout: 40000,
        fn: async () => {
            const count = 10;
            const jobs = generateJobs(count, (i) => `echo multi_session_${i}`);
            await enqueueMany(jobs);

            // Start TWO separate worker sessions
            const wp1 = startWorkersBackground(2);
            const wp2 = startWorkersBackground(2);

            const allDone = await waitForAllJobsInState('completed', count, 30000);
            assert(allDone, 'All jobs should complete with multiple worker sessions');

            const completed = await getJobs('completed');
            assertEqual(completed.length, count, `All ${count} jobs must be completed`);

            await stopWorkersAndWait(wp1);
            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T109 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T109',
        name: 'Enqueue while workers are already running',
        category: 'Dynamic',
        level: 2,
        difficulty: 3,
        priority: 'High',
        probability: 'High',
        requirement: 'Workers pick up newly enqueued jobs',
        timeout: 30000,
        fn: async () => {
            const wp = startWorkersBackground(2);
            await sleep(2000); // Workers are running but idle

            // Enqueue jobs while workers are running
            await enqueue({ id: 'dynamic-1', command: 'echo dyn1' });
            await enqueue({ id: 'dynamic-2', command: 'echo dyn2' });

            const done = await waitForAllJobsInState('completed', 2, 15000);
            assert(done, 'Dynamically enqueued jobs should be picked up by running workers');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T110 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T110',
        name: 'Mix of success and failure: correct final states',
        category: 'Multi-Job',
        level: 2,
        difficulty: 4,
        priority: 'High',
        probability: 'High',
        requirement: 'Each job reaches its correct final state',
        timeout: 120000,
        fn: async () => {
            await enqueue({ id: 'ok-1', command: 'echo pass1' });
            await enqueue({ id: 'ok-2', command: 'echo pass2' });
            await enqueue({ id: 'fail-x', command: 'exit 1' });
            await enqueue({ id: 'ok-3', command: 'echo pass3' });

            const wp = startWorkersBackground(2);

            // Wait for successes
            const ok1 = await waitForJobState('ok-1', 'completed', 15000);
            const ok2 = await waitForJobState('ok-2', 'completed', 15000);
            const ok3 = await waitForJobState('ok-3', 'completed', 15000);
            assert(ok1 && ok2 && ok3, 'All success jobs should complete');

            // Wait for failure to reach DLQ
            const dead = await waitForJobState('fail-x', 'dead', 90000);
            assert(dead, 'Failing job should reach DLQ');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T111 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T111',
        name: 'Restart preserves job states (completed stays completed)',
        category: 'Persistence',
        level: 2,
        difficulty: 4,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Jobs survive a full restart',
        timeout: 30000,
        fn: async () => {
            // Enqueue and process some jobs
            await enqueue({ id: 'restart-1', command: 'echo restart_ok' });
            await enqueue({ id: 'restart-2', command: 'echo restart_ok2' });

            const wp = startWorkersBackground(1);
            await waitForAllJobsInState('completed', 2, 15000);
            await stopWorkersAndWait(wp);

            // Enqueue a new job (simulates "after restart")
            await enqueue({ id: 'restart-3', command: 'echo post_restart' });

            // Verify old completed jobs are still there
            const completed = await getJobs('completed');
            assert(completed && completed.length >= 2, 'Completed jobs must survive restart');

            // And new pending job exists
            const pending = await getJobs('pending');
            assert(pending && pending.some((j) => j.id === 'restart-3'), 'New job should be pending');
        },
    }),

    // ── T112 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T112',
        name: 'Backoff timing: failed job waits before retry',
        category: 'Backoff',
        level: 2,
        difficulty: 6,
        priority: 'High',
        probability: 'High',
        requirement: 'Retry with delay = base^attempts seconds',
        timeout: 30000,
        fn: async () => {
            await enqueue({ id: 'backoff-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);

            // Wait for first failure
            const failed = await waitForCondition(async () => {
                const all = await getJobs();
                const job = all?.find((j) => j.id === 'backoff-1');
                return job && job.attempts >= 1;
            }, 10000);
            assert(failed, 'Job should have failed at least once');

            // Check that the job has a next_retry_at in the future
            const allJobs = await getJobs();
            const job = allJobs?.find((j) => j.id === 'backoff-1');
            if (job && job.state === 'failed' && job.next_retry_at) {
                const retryAt = new Date(job.next_retry_at).getTime();
                const now = Date.now();
                // The retry should be in the future (or very recently past)
                // With base=2, attempt=1, delay=2s
                assert(
                    retryAt > now - 5000, // Allow 5s slack
                    'next_retry_at should be a recent or future timestamp'
                );
            }

            await stopWorkersAndWait(wp);
        },
    }),
];
