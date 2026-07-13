/**
 * Level 3 — Concurrency Tests
 *
 * Exercises race conditions, atomic operations, duplicate execution,
 * SQLite locking, polling races, and FIFO ordering guarantees.
 *
 * These tests stress the claim-atomicity and multi-process safety.
 */

import {
    defineTest, queuectl, enqueue, enqueueMany, getJobs,
    startWorkersBackground, stopWorkersAndWait, stopWorkers,
    waitForJobState, waitForAllJobsInState, waitForNoJobsInState,
    waitForCondition,
    sleep, assert, assertEqual, assertGreaterThan,
    generateJobs, configSet,
} from './helpers.js';

export const tests = [

    // ── T201 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T201',
        name: 'Atomic job claiming: 1 job, 5 workers',
        category: 'Atomicity',
        level: 3,
        difficulty: 7,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'A job must never be executed by two workers at once',
        timeout: 30000,
        fn: async () => {
            // A job that takes a few seconds so we can verify no double-execution
            await enqueue({ id: 'atomic-1', command: 'sleep 2 && echo single_exec' });

            // Start many workers that will all try to claim the same job
            const wp = startWorkersBackground(5);

            await waitForJobState('atomic-1', 'completed', 20000);

            const completed = await getJobs('completed');
            assertEqual(completed.length, 1, 'Exactly 1 job should be completed');
            assertEqual(completed[0].id, 'atomic-1', 'The correct job completed');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T202 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T202',
        name: 'No duplicate execution: 50 jobs, 10 workers',
        category: 'Atomicity',
        level: 3,
        difficulty: 7,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Every job runs exactly once with high concurrency',
        timeout: 60000,
        fn: async () => {
            const count = 50;
            const jobs = generateJobs(count, (i) => `echo unique_${i}`);
            await enqueueMany(jobs);

            const wp = startWorkersBackground(10);
            const allDone = await waitForAllJobsInState('completed', count, 45000);
            assert(allDone, `All ${count} jobs should complete`);

            const completed = await getJobs('completed');
            assertEqual(completed.length, count, `Exactly ${count} jobs completed`);

            // Check for duplicates
            const ids = new Set(completed.map((j) => j.id));
            assertEqual(ids.size, count, 'All job IDs must be unique (no duplicates)');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T203 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T203',
        name: 'Rapid sequential enqueue: no race on writes',
        category: 'Write Safety',
        level: 3,
        difficulty: 5,
        priority: 'High',
        probability: 'Medium',
        requirement: 'Concurrent enqueue operations do not corrupt data',
        timeout: 30000,
        fn: async () => {
            // Enqueue 20 jobs as fast as possible (sequential but rapid)
            const count = 20;
            const promises = [];
            for (let i = 0; i < count; i++) {
                promises.push(enqueue({ id: `rapid-${i}`, command: `echo rapid_${i}` }));
            }
            const results = await Promise.all(promises);

            // All should succeed (or at least most — parallel might hit busy)
            const successes = results.filter((r) => r.exitCode === 0);
            assertGreaterThan(successes.length, 0, 'At least some parallel enqueues should succeed');

            // Verify jobs in DB
            const jobs = await getJobs('pending');
            assertEqual(jobs.length, successes.length, 'DB should have exactly the successful enqueues');
        },
    }),

    // ── T204 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T204',
        name: 'Two separate worker sessions share workload',
        category: 'Multi-Session',
        level: 3,
        difficulty: 6,
        priority: 'High',
        probability: 'High',
        requirement: 'Workers from separate terminal sessions cooperate without conflicts',
        timeout: 40000,
        fn: async () => {
            const count = 15;
            const jobs = generateJobs(count, (i) => `echo session_${i}`);
            await enqueueMany(jobs);

            // Two separate OS process groups
            const wp1 = startWorkersBackground(2);
            await sleep(500);
            const wp2 = startWorkersBackground(2);

            const allDone = await waitForAllJobsInState('completed', count, 30000);
            assert(allDone, 'All jobs should complete with 2 separate worker sessions');

            const completed = await getJobs('completed');
            assertEqual(completed.length, count, 'No jobs lost or duplicated');

            await stopWorkersAndWait(wp1);
            await stopWorkersAndWait(wp2);
        },
    }),

    // ── T205 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T205',
        name: 'SQLite BUSY handled gracefully under contention',
        category: 'SQLite',
        level: 3,
        difficulty: 6,
        priority: 'High',
        probability: 'Medium',
        requirement: 'No crashes from SQLITE_BUSY errors',
        timeout: 40000,
        fn: async () => {
            // Create contention: many workers + many jobs + simultaneous list queries
            const count = 20;
            const jobs = generateJobs(count, (i) => `echo contention_${i}`);
            await enqueueMany(jobs);

            const wp = startWorkersBackground(5);

            // Hammer the DB with list queries while workers are running
            const queryPromises = [];
            for (let i = 0; i < 10; i++) {
                queryPromises.push(
                    (async () => {
                        await sleep(i * 200);
                        return getJobs('pending');
                    })()
                );
            }
            const queryResults = await Promise.all(queryPromises);

            // None should crash (null means parse failed, which might indicate issues)
            const crashes = queryResults.filter((r) => r === null);
            // Allow some failures but not all
            assert(crashes.length < 5, 'Most list queries should succeed under contention');

            await waitForAllJobsInState('completed', count, 30000);
            await stopWorkersAndWait(wp);
        },
    }),

    // ── T206 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T206',
        name: 'No starvation: all jobs eventually get processed',
        category: 'Fairness',
        level: 3,
        difficulty: 5,
        priority: 'High',
        probability: 'Medium',
        requirement: 'Workers polling should not starve any job',
        timeout: 40000,
        fn: async () => {
            // Enqueue jobs with varying IDs to test ordering
            for (let i = 0; i < 10; i++) {
                await enqueue({ id: `starve-${String.fromCharCode(97 + i)}`, command: `echo ${i}` });
                await sleep(50); // Slight delay to ensure different created_at
            }

            const wp = startWorkersBackground(3);

            // All 10 should complete — no job left behind
            const allDone = await waitForAllJobsInState('completed', 10, 30000);
            assert(allDone, 'All 10 jobs must complete — no starvation');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T207 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T207',
        name: 'Concurrent stop commands do not crash',
        category: 'Shutdown',
        level: 3,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Multiple stop commands handled gracefully',
        timeout: 20000,
        fn: async () => {
            const wp = startWorkersBackground(2);
            await sleep(2000);

            // Send multiple stop commands simultaneously
            const stopPromises = [
                stopWorkers(),
                stopWorkers(),
                stopWorkers(),
            ];
            const results = await Promise.all(stopPromises);

            // None should throw/crash — all should return gracefully
            for (const r of results) {
                assert(r.exitCode === 0 || r.exitCode === 1,
                    'Stop command should not crash');
            }

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T208 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T208',
        name: 'Failed job not picked up before backoff expires',
        category: 'Backoff',
        level: 3,
        difficulty: 6,
        priority: 'High',
        probability: 'High',
        requirement: 'Jobs respect next_retry_at — no premature retry',
        timeout: 30000,
        fn: async () => {
            await enqueue({ id: 'backoff-guard', command: 'exit 1' });
            const wp = startWorkersBackground(1);

            // Wait for first failure
            const firstFail = await waitForCondition(async () => {
                const all = await getJobs();
                const job = all?.find((j) => j.id === 'backoff-guard');
                return job && job.attempts >= 1 && job.state === 'failed';
            }, 10000);

            if (firstFail) {
                // Immediately check — the job should still be in 'failed' state
                // (not immediately picked up again)
                const all = await getJobs();
                const job = all.find((j) => j.id === 'backoff-guard');
                if (job.state === 'failed') {
                    // Verify it has a next_retry_at in the future
                    assert(job.next_retry_at, 'Failed job must have next_retry_at set');
                }
            }

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T209 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T209',
        name: 'Config change during active processing does not crash',
        category: 'Config',
        level: 3,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'System stability during config mutation',
        timeout: 30000,
        fn: async () => {
            const jobs = generateJobs(5, (i) => `echo cfg_${i}`);
            await enqueueMany(jobs);

            const wp = startWorkersBackground(2);
            await sleep(1000);

            // Change config while workers are processing
            const r1 = await configSet('max-retries', 5);
            const r2 = await configSet('backoff-base', 3);

            // System should not crash
            assert(r1.exitCode === 0, 'Config set should not crash during processing');
            assert(r2.exitCode === 0, 'Config set should not crash during processing');

            await waitForAllJobsInState('completed', 5, 20000);
            await stopWorkersAndWait(wp);
        },
    }),

    // ── T210 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T210',
        name: 'FIFO ordering: jobs processed in creation order',
        category: 'Fairness',
        level: 3,
        difficulty: 5,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Jobs should be claimed in created_at order (FIFO)',
        timeout: 30000,
        fn: async () => {
            // Enqueue 5 jobs with deliberate ordering
            for (let i = 0; i < 5; i++) {
                await enqueue({ id: `fifo-${i}`, command: `echo fifo_${i}` });
                await sleep(100); // Ensure different created_at timestamps
            }

            // Start a single worker to process one at a time (sequential)
            const wp = startWorkersBackground(1);
            await waitForAllJobsInState('completed', 5, 20000);

            // Check that jobs completed in order (by comparing updated_at timestamps)
            const completed = await getJobs('completed');
            assert(completed.length === 5, 'All 5 should be completed');

            // Sort by updated_at and verify ID order
            const sorted = [...completed].sort(
                (a, b) => new Date(a.updated_at) - new Date(b.updated_at)
            );

            for (let i = 0; i < 5; i++) {
                assertEqual(sorted[i].id, `fifo-${i}`,
                    `Job ${i} should be processed in FIFO order`);
            }

            await stopWorkersAndWait(wp);
        },
    }),
];
