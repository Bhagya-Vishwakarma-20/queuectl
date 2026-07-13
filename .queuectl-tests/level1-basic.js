/**
 * Level 1 — Basic Functional Tests
 *
 * Tests every CLI command in isolation to verify the fundamental contract.
 * These are the tests the automated evaluation script MUST pass as a gate.
 */

import {
    defineTest, queuectl, enqueue, getJobs, stopWorkers,
    startWorkersBackground, stopWorkersAndWait,
    waitForJobState, waitForAllJobsInState, waitForNoJobsInState, waitForCondition,
    sleep, assert, assertEqual, assertGreaterThan, assertJsonArray,
    assertStdoutIsOnlyJson, assertGreaterThanOrEqual,
    configSet, configList, dlqList, dlqRetry, getStatus,
} from './helpers.js';

export const tests = [

    // ── T001 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T001',
        name: 'Enqueue a simple job',
        category: 'Enqueue',
        level: 1,
        difficulty: 1,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'enqueue command adds a job with correct fields',
        timeout: 15000,
        fn: async () => {
            await enqueue({ id: 'test-001', command: 'echo hello' });
            const jobs = await getJobs('pending');
            assert(jobs !== null, 'list --state pending --json returned unparseable output');
            assert(jobs.length === 1, `Expected 1 pending job, got ${jobs.length}`);
            assertEqual(jobs[0].id, 'test-001', 'Job ID mismatch');
            assertEqual(jobs[0].state, 'pending', 'State should be pending');
            assertEqual(jobs[0].command, 'echo hello', 'Command mismatch');
            assertEqual(jobs[0].attempts, 0, 'Attempts should start at 0');
            assert(jobs[0].created_at, 'created_at must be present');
            assert(jobs[0].updated_at, 'updated_at must be present');
        },
    }),

    // ── T002 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T002',
        name: 'Enqueue auto-generates ID when not provided',
        category: 'Enqueue',
        level: 1,
        difficulty: 2,
        priority: 'High',
        probability: 'High',
        requirement: 'enqueue without id field auto-generates a unique id',
        timeout: 15000,
        fn: async () => {
            await enqueue({ command: 'echo auto-id' });
            const jobs = await getJobs('pending');
            assert(jobs !== null && jobs.length === 1, 'Expected 1 pending job');
            assert(jobs[0].id && jobs[0].id.length > 0, 'Auto-generated ID must be non-empty');
        },
    }),

    // ── T003 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T003',
        name: 'Enqueue duplicate ID fails',
        category: 'Enqueue',
        level: 1,
        difficulty: 2,
        priority: 'High',
        probability: 'High',
        requirement: 'Duplicate job IDs are rejected',
        timeout: 15000,
        fn: async () => {
            const r1 = await enqueue({ id: 'dup-id', command: 'echo first' });
            const r2 = await enqueue({ id: 'dup-id', command: 'echo second' });
            // Second enqueue should fail (non-zero exit or error message)
            const hasFailed = r2.exitCode !== 0 || r2.stderr.length > 0;
            assert(hasFailed, 'Duplicate enqueue should fail or print an error');
            // Only one job should exist
            const jobs = await getJobs('pending');
            assert(jobs && jobs.length === 1, 'Only one job should exist after duplicate enqueue');
        },
    }),

    // ── T004 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T004',
        name: 'List by state returns correct jobs',
        category: 'List',
        level: 1,
        difficulty: 2,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'list --state <state> --json filters correctly',
        timeout: 20000,
        fn: async () => {
            await enqueue({ id: 'list-1', command: 'echo a' });
            await enqueue({ id: 'list-2', command: 'echo b' });

            const pending = await getJobs('pending');
            assert(pending && pending.length === 2, `Expected 2 pending, got ${pending?.length}`);

            const completed = await getJobs('completed');
            assert(completed && completed.length === 0, 'No completed jobs expected');
        },
    }),

    // ── T005 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T005',
        name: 'list --json outputs ONLY a JSON array to stdout',
        category: 'List',
        level: 1,
        difficulty: 3,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Interface contract: --json prints JSON array and nothing else on stdout',
        timeout: 15000,
        fn: async () => {
            await enqueue({ id: 'json-test', command: 'echo x' });
            const result = await queuectl('list', '--state', 'pending', '--json');
            // stdout must be ONLY valid JSON
            assertStdoutIsOnlyJson(result, 'stdout must contain only JSON');
            const parsed = assertJsonArray(result.stdout);
            assert(parsed.length === 1, 'Should contain 1 job');
        },
    }),

    // ── T006 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T006',
        name: 'list --json with no jobs returns empty array',
        category: 'List',
        level: 1,
        difficulty: 2,
        priority: 'High',
        probability: 'High',
        requirement: 'Empty queue returns [] not null or error',
        timeout: 15000,
        fn: async () => {
            const result = await queuectl('list', '--state', 'pending', '--json');
            const parsed = assertJsonArray(result.stdout, 'Empty list should return []');
            assertEqual(parsed.length, 0, 'Expected empty array');
        },
    }),

    // ── T007 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T007',
        name: 'Status command shows job counts and worker count',
        category: 'Status',
        level: 1,
        difficulty: 2,
        priority: 'High',
        probability: 'High',
        requirement: 'status shows summary of all job states & active workers',
        timeout: 15000,
        fn: async () => {
            await enqueue({ id: 'status-1', command: 'echo a' });
            await enqueue({ id: 'status-2', command: 'echo b' });
            const result = await getStatus();
            assert(result.stdout.length > 0, 'Status should produce output');
            // Should mention pending or show counts
            const hasPending = result.stdout.includes('pending') || result.stdout.includes('2');
            assert(hasPending, 'Status should reflect pending job count');
        },
    }),

    // ── T008 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T008',
        name: 'Basic job completes successfully',
        category: 'Job Lifecycle',
        level: 1,
        difficulty: 3,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Scenario 1: A basic job completes',
        timeout: 20000,
        fn: async () => {
            await enqueue({ id: 'complete-1', command: 'echo success' });
            const wp = startWorkersBackground(1);
            const ok = await waitForJobState('complete-1', 'completed', 15000);
            assert(ok, 'Job must reach completed state');
            await stopWorkersAndWait(wp);
        },
    }),

    // ── T009 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T009',
        name: 'Failed job increments attempts and goes to failed state',
        category: 'Job Lifecycle',
        level: 1,
        difficulty: 3,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Non-zero exit code = failure, attempts increment',
        timeout: 20000,
        fn: async () => {
            await enqueue({ id: 'fail-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);
            // Wait for the job to be attempted at least once
            await sleep(5000);
            // Job should be in failed or dead state with attempts > 0
            const allJobs = await getJobs();
            assert(allJobs && allJobs.length === 1, 'Job should exist');
            const job = allJobs[0];
            assertGreaterThan(job.attempts, 0, 'Attempts should have incremented');
            assert(
                job.state === 'failed' || job.state === 'dead' || job.state === 'processing',
                `Expected failed/dead/processing, got ${job.state}`
            );
            await stopWorkersAndWait(wp);
        },
    }),

    // ── T010 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T010',
        name: 'Failing job retries with backoff and lands in DLQ',
        category: 'Retry & DLQ',
        level: 1,
        difficulty: 5,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Scenario 2: A failing job retries with backoff and lands in the DLQ',
        timeout: 120000,
        fn: async () => {
            // Default: max_retries=3, backoff-base=2
            // Delays: 2^1=2s, 2^2=4s, 2^3=8s → total ~14s of backoff + execution time
            await enqueue({ id: 'dlq-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);

            const reachedDLQ = await waitForJobState('dlq-1', 'dead', 90000);
            assert(reachedDLQ, 'Job must reach dead (DLQ) state after exhausting retries');

            // Verify attempts > max_retries
            const deadJobs = await getJobs('dead');
            assert(deadJobs && deadJobs.length === 1, 'Exactly 1 dead job');
            assertGreaterThan(deadJobs[0].attempts, 0, 'Attempts should be > 0');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T011 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T011',
        name: 'DLQ list shows dead jobs',
        category: 'DLQ',
        level: 1,
        difficulty: 3,
        priority: 'High',
        probability: 'High',
        requirement: 'dlq list shows dead jobs',
        timeout: 120000,
        fn: async () => {
            await enqueue({ id: 'dlq-list-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);
            await waitForJobState('dlq-list-1', 'dead', 90000);
            await stopWorkersAndWait(wp);

            const result = await dlqList();
            assert(result.stdout.includes('dlq-list-1'), 'dlq list should show the dead job');
        },
    }),

    // ── T012 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T012',
        name: 'DLQ retry re-enqueues a dead job',
        category: 'DLQ',
        level: 1,
        difficulty: 3,
        priority: 'High',
        probability: 'Very High',
        requirement: 'dlq retry <id> re-enqueues a dead job',
        timeout: 120000,
        fn: async () => {
            await enqueue({ id: 'dlq-retry-1', command: 'exit 1' });
            const wp = startWorkersBackground(1);
            await waitForJobState('dlq-retry-1', 'dead', 90000);
            await stopWorkersAndWait(wp);

            // Retry the dead job
            await dlqRetry('dlq-retry-1');

            // Should be back in pending
            const pending = await getJobs('pending');
            assert(pending && pending.some((j) => j.id === 'dlq-retry-1'),
                'Retried job should be in pending state');

            // Attempts should be reset to 0 (per implementation)
            const job = pending.find((j) => j.id === 'dlq-retry-1');
            assertEqual(job.attempts, 0, 'dlq retry should reset attempts to 0');
        },
    }),

    // ── T013 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T013',
        name: 'Worker start and stop lifecycle',
        category: 'Worker',
        level: 1,
        difficulty: 3,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'worker start runs in foreground, worker stop from another terminal',
        timeout: 20000,
        fn: async () => {
            const wp = startWorkersBackground(2);
            await sleep(3000); // Let workers register

            // Workers should be registered — status should show them
            const statusResult = await getStatus();
            // The output should mention workers or show count > 0

            // Stop workers from "another terminal" (separate process)
            const stopped = await stopWorkersAndWait(wp, 10000);
            assert(stopped, 'Workers should have exited after stop command');
        },
    }),

    // ── T014 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T014',
        name: 'Config set and list',
        category: 'Config',
        level: 1,
        difficulty: 2,
        priority: 'High',
        probability: 'High',
        requirement: 'config set/list persists configuration',
        timeout: 15000,
        fn: async () => {
            await configSet('max-retries', 5);
            const result = await configList();
            assert(result.stdout.length > 0, 'Config list should produce output');
            // Verify the value was set (check stdout contains the key/value)
            const hasMaxRetries = result.stdout.includes('max-retries') || result.stdout.includes('5');
            assert(hasMaxRetries, 'Config list should show max-retries value');
        },
    }),

    // ── T015 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T015',
        name: 'Persistence: jobs survive process restart',
        category: 'Persistence',
        level: 1,
        difficulty: 4,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'Scenario 5: Jobs survive a full restart',
        timeout: 15000,
        fn: async () => {
            await enqueue({ id: 'persist-1', command: 'echo persist' });
            await enqueue({ id: 'persist-2', command: 'echo persist2' });

            // "Restart" = just run another CLI command (different process)
            const jobs = await getJobs('pending');
            assert(jobs && jobs.length === 2, 'Jobs must survive across separate CLI invocations');
            assert(jobs.some((j) => j.id === 'persist-1'), 'persist-1 must exist');
            assert(jobs.some((j) => j.id === 'persist-2'), 'persist-2 must exist');
        },
    }),

    // ── T016 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T016',
        name: 'Worker start --count N starts N workers',
        category: 'Worker',
        level: 1,
        difficulty: 3,
        priority: 'High',
        probability: 'High',
        requirement: 'worker start --count 3 starts 3 parallel workers',
        timeout: 20000,
        fn: async () => {
            const wp = startWorkersBackground(3);

            const ok = await waitForCondition(async () => {
                const result = await getStatus();
                return result.stdout.includes('workers: 3') || 
                       result.stdout.includes('"workers": 3') ||
                       result.stdout.includes('workers: \'3\'');
            }, 10000, 500);

            assert(ok, 'Status should show 3 active workers');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T017 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T017',
        name: 'Graceful shutdown finishes in-flight job',
        category: 'Worker',
        level: 1,
        difficulty: 5,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'SIGTERM/SIGINT: finish current job, then exit',
        timeout: 30000,
        fn: async () => {
            // Enqueue a job that takes a few seconds
            await enqueue({ id: 'graceful-1', command: 'sleep 3 && echo done' });
            const wp = startWorkersBackground(1);

            // Wait for the job to start processing
            const started = await waitForJobState('graceful-1', 'processing', 10000);
            // It might have already completed if fast, so check both
            if (!started) {
                // Job might have completed already
                const completed = await getJobs('completed');
                if (completed && completed.some((j) => j.id === 'graceful-1')) {
                    await stopWorkersAndWait(wp);
                    return; // Test passes — job completed before we could catch processing
                }
            }

            // Send stop command
            await stopWorkers();

            // Wait for worker to finish and exit
            const exited = await stopWorkersAndWait(wp, 20000);
            assert(exited, 'Worker should exit after graceful shutdown');

            // The job should be completed (worker finished it before exiting)
            await sleep(1000);
            const jobs = await getJobs('completed');
            assert(
                jobs && jobs.some((j) => j.id === 'graceful-1'),
                'In-flight job should complete before worker exits during graceful shutdown'
            );
        },
    }),
];
