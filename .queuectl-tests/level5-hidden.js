/**
 * Level 5 — Hidden Interview Tests
 *
 * Tests NOT explicitly mentioned in the assignment but highly likely to
 * appear in an interviewer's automated evaluation script.
 * Designed to expose weak or fragile implementations.
 */

import {
    defineTest, queuectl, enqueue, getJobs,
    startWorkersBackground, stopWorkersAndWait, stopWorkers,
    waitForJobState, waitForAllJobsInState,
    waitForCondition,
    sleep, assert, assertEqual,
    assertJsonArray, assertStdoutIsOnlyJson,
    configSet, dlqRetry, dlqList,
} from './helpers.js';

export const tests = [

    // ── T401 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T401',
        name: 'Malformed JSON enqueue fails gracefully',
        category: 'Input Validation',
        level: 5,
        difficulty: 3,
        priority: 'High',
        probability: 'Very High',
        requirement: 'Invalid JSON input should not crash the system',
        timeout: 10000,
        fn: async () => {
            const result = await enqueue('{invalid json}');
            // Should fail but not crash
            const failed = result.exitCode !== 0 || result.stderr.length > 0;
            assert(failed, 'Malformed JSON should produce an error');

            // No job should be created
            const jobs = await getJobs('pending');
            assertEqual(jobs?.length ?? 0, 0, 'No job should exist after malformed enqueue');
        },
    }),

    // ── T402 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T402',
        name: 'Missing command field in enqueue fails gracefully',
        category: 'Input Validation',
        level: 5,
        difficulty: 3,
        priority: 'High',
        probability: 'Very High',
        requirement: 'Jobs without a command field are rejected',
        timeout: 10000,
        fn: async () => {
            const result = await enqueue({ id: 'no-cmd' });
            const failed = result.exitCode !== 0 || result.stderr.length > 0;
            assert(failed, 'Enqueue without command should fail');

            const jobs = await getJobs('pending');
            assertEqual(jobs?.length ?? 0, 0, 'No job should be created without command');
        },
    }),

    // ── T403 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T403',
        name: 'Invalid CLI command does not crash',
        category: 'CLI Robustness',
        level: 5,
        difficulty: 2,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Unknown commands handled gracefully',
        timeout: 10000,
        fn: async () => {
            const result = await queuectl('nonexistent-command');
            // Should show help or error, not crash with unhandled exception
            assert(result.exitCode !== null, 'Should return an exit code');
        },
    }),

    // ── T404 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T404',
        name: 'Invalid state filter returns error or empty array',
        category: 'Input Validation',
        level: 5,
        difficulty: 3,
        priority: 'High',
        probability: 'High',
        requirement: 'Invalid state parameter handled gracefully',
        timeout: 10000,
        fn: async () => {
            const result = await queuectl('list', '--state', 'nonexistent', '--json');
            // Should either return empty array or error — not crash
            if (result.exitCode === 0) {
                // If it returns successfully, stdout should be a JSON array (possibly empty)
                const parsed = JSON.parse(result.stdout);
                assert(Array.isArray(parsed), 'Should return an array for invalid state');
            }
            // If it errors, that's also acceptable
        },
    }),

    // ── T405 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T405',
        name: 'DLQ retry on non-existent job fails gracefully',
        category: 'DLQ Robustness',
        level: 5,
        difficulty: 3,
        priority: 'High',
        probability: 'High',
        requirement: 'dlq retry with invalid ID should not crash',
        timeout: 10000,
        fn: async () => {
            const result = await dlqRetry('nonexistent-id-12345');
            // Should error or produce an error message, not crash
            assert(result.exitCode !== null, 'Should return an exit code');
        },
    }),

    // ── T406 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T406',
        name: 'DLQ retry on a non-dead job (pending) fails gracefully',
        category: 'DLQ Robustness',
        level: 5,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'dlq retry should only work on dead jobs',
        timeout: 15000,
        fn: async () => {
            await enqueue({ id: 'not-dead', command: 'echo alive' });
            const result = await dlqRetry('not-dead');
            // This job is pending, not dead — retry should fail or have no effect
            const jobs = await getJobs('pending');
            assert(
                jobs?.some((j) => j.id === 'not-dead' && j.state === 'pending'),
                'Job should remain pending (dlq retry should not affect non-dead jobs)'
            );
        },
    }),

    // ── T407 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T407',
        name: 'Worker stop when no workers are running does not crash',
        category: 'CLI Robustness',
        level: 5,
        difficulty: 2,
        priority: 'High',
        probability: 'Very High',
        requirement: 'Idempotent stop operation',
        timeout: 10000,
        fn: async () => {
            // No workers are running
            const r1 = await stopWorkers();
            const r2 = await stopWorkers();
            const r3 = await stopWorkers();
            // None should crash
            assert(r1.exitCode !== null, 'First stop should not crash');
            assert(r2.exitCode !== null, 'Second stop should not crash');
            assert(r3.exitCode !== null, 'Third stop should not crash');
        },
    }),

    // ── T408 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T408',
        name: 'Config set with invalid key fails gracefully',
        category: 'Config Robustness',
        level: 5,
        difficulty: 2,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Invalid config keys are rejected',
        timeout: 10000,
        fn: async () => {
            const result = await configSet('totally-invalid-key', '42');
            const hasError = result.exitCode !== 0 || result.stderr.length > 0;
            assert(hasError, 'Setting invalid config key should produce an error');
        },
    }),

    // ── T409 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T409',
        name: 'Unicode characters in job command',
        category: 'Edge Case',
        level: 5,
        difficulty: 4,
        priority: 'Low',
        probability: 'Low',
        requirement: 'Unicode in commands should not corrupt data',
        timeout: 20000,
        fn: async () => {
            await enqueue({ id: 'unicode-1', command: 'echo "héllo wörld 🚀"' });
            const jobs = await getJobs('pending');
            assert(jobs && jobs.length === 1, 'Unicode job should be enqueued');
            assert(jobs[0].command.includes('héllo'), 'Unicode command should be preserved');
        },
    }),

    // ── T410 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T410',
        name: 'Very long command string',
        category: 'Edge Case',
        level: 5,
        difficulty: 4,
        priority: 'Low',
        probability: 'Low',
        requirement: 'Long commands should not truncate or crash',
        timeout: 15000,
        fn: async () => {
            const longCmd = 'echo ' + 'a'.repeat(5000);
            await enqueue({ id: 'long-cmd', command: longCmd });
            const jobs = await getJobs('pending');
            assert(jobs && jobs.length === 1, 'Long command job should be enqueued');
            assertEqual(jobs[0].command, longCmd, 'Long command should not be truncated');
        },
    }),

    // ── T411 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T411',
        name: 'Stdout purity: list --json has no debug output pollution',
        category: 'Interface Contract',
        level: 5,
        difficulty: 6,
        priority: 'Critical',
        probability: 'Very High',
        requirement: 'list --json prints ONLY JSON to stdout — nothing else',
        timeout: 30000,
        fn: async () => {
            // Enqueue a job, let it complete, then check all list variants
            await enqueue({ id: 'pure-1', command: 'echo pure' });

            // Test each state filter
            for (const state of ['pending', 'completed', 'failed', 'dead', 'processing']) {
                const result = await queuectl('list', '--state', state, '--json');
                if (result.exitCode === 0) {
                    // stdout must be ONLY a JSON array
                    try {
                        const parsed = JSON.parse(result.stdout);
                        assert(Array.isArray(parsed),
                            `list --state ${state} --json must return an array, got ${typeof parsed}`
                        );
                    } catch (e) {
                        throw new Error(
                            `STDOUT POLLUTION: list --state ${state} --json returned non-JSON:\n` +
                            `"${result.stdout.substring(0, 200)}"`
                        );
                    }
                }
            }
        },
    }),

    // ── T412 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T412',
        name: 'Worker start with count 0 or negative',
        category: 'Edge Case',
        level: 5,
        difficulty: 3,
        priority: 'Low',
        probability: 'Low',
        requirement: 'Edge case worker count handled gracefully',
        timeout: 15000,
        fn: async () => {
            // Start with 0 workers
            const result = await queuectl('worker', 'start', '--count', '0');
            // Should either error or start 0 workers (no crash)
            assert(result.exitCode !== null, 'Should handle count=0 without crashing');
        },
    }),

    // ── T413 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T413',
        name: 'Command-not-found treated as failure',
        category: 'Job Execution',
        level: 5,
        difficulty: 4,
        priority: 'High',
        probability: 'High',
        requirement: 'command-not-found exit code = failure',
        timeout: 30000,
        fn: async () => {
            await enqueue({ id: 'notfound-1', command: 'totally_nonexistent_command_xyz123' });
            const wp = startWorkersBackground(1);

            // Should fail (command not found = non-zero exit)
            const failed = await waitForCondition(async () => {
                const all = await getJobs();
                const job = all?.find((j) => j.id === 'notfound-1');
                return job && (job.state === 'failed' || job.state === 'dead') && job.attempts > 0;
            }, 15000);
            assert(failed, 'Command-not-found should be treated as job failure');

            await stopWorkersAndWait(wp);
        },
    }),

    // ── T414 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T414',
        name: 'Enqueue with only command field (no id) works',
        category: 'Minimal Input',
        level: 5,
        difficulty: 2,
        priority: 'High',
        probability: 'High',
        requirement: 'Minimal valid enqueue payload',
        timeout: 10000,
        fn: async () => {
            const result = await enqueue({ command: 'echo minimal' });
            assertEqual(result.exitCode, 0, 'Minimal enqueue should succeed');
            const jobs = await getJobs('pending');
            assert(jobs && jobs.length === 1, 'One job should be created');
            assert(jobs[0].id && jobs[0].id.length > 0, 'ID should be auto-generated');
        },
    }),

    // ── T415 ─────────────────────────────────────────────────────────────────
    defineTest({
        id: 'T415',
        name: 'Special characters in job ID',
        category: 'Edge Case',
        level: 5,
        difficulty: 4,
        priority: 'Medium',
        probability: 'Medium',
        requirement: 'Job IDs with special characters handled correctly',
        timeout: 15000,
        fn: async () => {
            // Test with dashes, underscores, dots (common in real IDs)
            await enqueue({ id: 'job-with-dashes', command: 'echo a' });
            await enqueue({ id: 'job_with_underscores', command: 'echo b' });
            await enqueue({ id: 'job.with.dots', command: 'echo c' });

            const jobs = await getJobs('pending');
            assert(jobs && jobs.length === 3, 'All 3 special-char ID jobs should be created');

            const ids = jobs.map((j) => j.id);
            assert(ids.includes('job-with-dashes'), 'Dashed ID preserved');
            assert(ids.includes('job_with_underscores'), 'Underscored ID preserved');
            assert(ids.includes('job.with.dots'), 'Dotted ID preserved');
        },
    }),
];
