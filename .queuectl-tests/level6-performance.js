/**
 * Level 6 — Performance & Stress Tests
 *
 * Scalability, throughput, and resource usage under load.
 */

import {
    defineTest, queuectl, enqueue, enqueueMany, getJobs,
    startWorkersBackground, stopWorkersAndWait,
    waitForAllJobsInState, waitForCondition,
    sleep, assert, assertEqual, assertGreaterThan,
    generateJobs,
} from './helpers.js';

export const tests = [

    // ── T501 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T501',
        name: 'Process 100 jobs with 5 workers',
        category: 'Scalability',
        level: 6,
        difficulty: 5,
        priority: 'High',
        probability: 'High',
        requirement: 'System handles 100 jobs without errors',
        timeout: 120000,
        fn: async () => {
            const count = 100;
            const jobs = generateJobs(count, (i) => `echo scale_${i}`);
            await enqueueMany(jobs);

            const pending = await getJobs('pending');
            assertEqual(pending?.length, count, `All ${count} jobs should be enqueued`);

            const wp = startWorkersBackground(5);
            const start = Date.now();

            const allDone = await waitForAllJobsInState('completed', count, 90000);
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);

            assert(allDone, `All ${count} jobs should complete`);
            console.log(`    ℹ 100 jobs completed in ${elapsed}s`);

            const completed = await getJobs('completed');
            assertEqual(completed.length, count, 'No jobs lost');

            const ids = new Set(completed.map((j) => j.id));
            assertEqual(ids.size, count, 'No duplicate executions');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T502 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T502',
        name: 'Rapid enqueue: 50 jobs as fast as possible',
        category: 'Throughput',
        level: 6,
        difficulty: 5,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Rapid enqueue does not crash or lose jobs',
        timeout: 60000,
        fn: async () => {
            const count = 50;
            const start = Date.now();

            // Enqueue sequentially (parallel might hit SQLite BUSY)
            for (let i = 0; i < count; i++) {
                await enqueue({ id: `rapid-seq-${i}`, command: `echo r${i}` });
            }

            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            console.log(`    ℹ 50 sequential enqueues in ${elapsed}s`);

            const jobs = await getJobs('pending');
            assertEqual(jobs?.length, count, `All ${count} jobs should be enqueued`);
        },
    }),

    // ── T503 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T503',
        name: 'Many workers (10) with few jobs (3)',
        category: 'Resource',
        level: 6,
        difficulty: 5,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Excess workers do not cause issues',
        timeout: 30000,
        fn: async () => {
            await enqueue({ id: 'few-1', command: 'echo few1' });
            await enqueue({ id: 'few-2', command: 'echo few2' });
            await enqueue({ id: 'few-3', command: 'echo few3' });

            const wp = startWorkersBackground(10);

            const allDone = await waitForAllJobsInState('completed', 3, 15000);
            assert(allDone, 'All 3 jobs should complete with 10 workers');

            // No job should be duplicated
            const completed = await getJobs('completed');
            assertEqual(completed.length, 3, 'Exactly 3 completed (no duplicates)');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T504 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T504',
        name: 'CLI startup time under 3 seconds',
        category: 'Performance',
        level: 6,
        difficulty: 3,
        priority: 'Medium',
        probability: 'Low',
        requirement: 'CLI commands should be responsive',
        timeout: 10000,
        fn: async () => {
            const start = Date.now();
            await queuectl('status');
            const elapsed = Date.now() - start;

            assert(elapsed < 3000, `CLI startup took ${elapsed}ms — should be under 3000ms`);
            console.log(`    ℹ CLI startup: ${elapsed}ms`);
        },
    }),

    // ── T505 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T505',
        name: 'Shutdown time: workers exit within 15 seconds after stop',
        category: 'Performance',
        level: 6,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Graceful shutdown is timely',
        timeout: 30000,
        fn: async () => {
            const wp = startWorkersBackground(3);
            await sleep(3000);

            const start = Date.now();
            const stopped = await stopWorkersAndWait(wp, 15000);
            const elapsed = Date.now() - start;

            assert(stopped, 'Workers should exit within 15s of stop command');
            console.log(`    ℹ Shutdown time: ${(elapsed / 1000).toFixed(1)}s`);
        },
    }),

    // ── T506 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T506',
        name: 'Concurrent reads during heavy writes',
        category: 'Contention',
        level: 6,
        difficulty: 6,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Read operations succeed while workers are writing',
        timeout: 60000,
        fn: async () => {
            const count = 30;
            const jobs = generateJobs(count, (i) => `echo contend_${i}`);
            await enqueueMany(jobs);

            const wp = startWorkersBackground(5);

            // Issue 20 list queries while workers are busy
            let successCount = 0;
            for (let i = 0; i < 20; i++) {
                const result = await queuectl('list', '--json');
                if (result.exitCode === 0) {
                    try {
                        JSON.parse(result.stdout);
                        successCount++;
                    } catch { }
                }
                await sleep(200);
            }

            assert(successCount >= 15,
                `At least 15/20 list queries should succeed, got ${successCount}`
            );

            await waitForAllJobsInState('completed', count, 45000);
            await stopWorkersAndWait(wp);
        },
    }),
];
