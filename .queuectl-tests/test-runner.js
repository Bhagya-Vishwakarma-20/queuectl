#!/usr/bin/env node
/**
 * QueueCTL Test Runner
 * 
 * Usage:
 *   node .queuectl-tests/test-runner.js                    # Run all tests
 *   node .queuectl-tests/test-runner.js --level 1          # Run only Level 1
 *   node .queuectl-tests/test-runner.js --level 1,2,3      # Run levels 1, 2, 3
 *   node .queuectl-tests/test-runner.js --test T001        # Run specific test
 *   node .queuectl-tests/test-runner.js --test T001,T002   # Run specific tests
 *   node .queuectl-tests/test-runner.js --verbose          # Show detailed output
 */

import { fullCleanup, sleep } from './helpers.js';

// ─── ANSI Colors ─────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
};

// ─── Parse CLI Arguments ─────────────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { levels: null, tests: null, verbose: false };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--level' && args[i + 1]) {
            opts.levels = args[++i].split(',').map(Number);
        } else if (args[i] === '--test' && args[i + 1]) {
            opts.tests = args[++i].split(',').map((s) => s.trim().toUpperCase());
        } else if (args[i] === '--verbose' || args[i] === '-v') {
            opts.verbose = true;
        }
    }
    return opts;
}

// ─── Load Test Modules ───────────────────────────────────────────────────────
async function loadTests(opts) {
    const modules = [
        { level: 1, label: 'Level 1 — Basic Functional Tests', path: './level1-basic.js' },
        { level: 2, label: 'Level 2 — Integration Tests', path: './level2-integration.js' },
        { level: 3, label: 'Level 3 — Concurrency Tests', path: './level3-concurrency.js' },
        { level: 4, label: 'Level 4 — Crash Recovery Tests', path: './level4-crash-recovery.js' },
        { level: 5, label: 'Level 5 — Hidden Interview Tests', path: './level5-hidden.js' },
        { level: 6, label: 'Level 6 — Performance & Stress Tests', path: './level6-performance.js' },
    ];

    const loadedLevels = [];

    for (const mod of modules) {
        if (opts.levels && !opts.levels.includes(mod.level)) continue;
        try {
            const imported = await import(mod.path);
            let tests = imported.tests || [];
            if (opts.tests) {
                tests = tests.filter((t) => opts.tests.includes(t.id.toUpperCase()));
            }
            if (tests.length > 0) {
                loadedLevels.push({ ...mod, tests });
            }
        } catch (err) {
            console.error(`${C.red}✗ Failed to load ${mod.path}: ${err.message}${C.reset}`);
        }
    }
    return loadedLevels;
}

// ─── Run a Single Test ───────────────────────────────────────────────────────
async function runTest(test, verbose) {
    const start = Date.now();
    try {
        // Clean state before each test
        await fullCleanup();
        await sleep(500);

        // Run with timeout
        const result = await Promise.race([
            test.fn(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`TIMEOUT after ${test.timeout}ms`)), test.timeout)
            ),
        ]);

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        return { status: 'PASS', elapsed, error: null };
    } catch (err) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        return { status: 'FAIL', elapsed, error: err.message || String(err) };
    }
}

// ─── Print Banner ────────────────────────────────────────────────────────────
function printBanner() {
    console.log('');
    console.log(`${C.cyan}${C.bold}╔══════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.cyan}${C.bold}║         QueueCTL — Exhaustive Test Suite v1.0        ║${C.reset}`);
    console.log(`${C.cyan}${C.bold}╚══════════════════════════════════════════════════════╝${C.reset}`);
    console.log('');
}

// ─── Main Runner ─────────────────────────────────────────────────────────────
async function main() {
    const opts = parseArgs();
    printBanner();

    const levels = await loadTests(opts);
    if (levels.length === 0) {
        console.log(`${C.yellow}No tests matched the given filters.${C.reset}`);
        process.exit(0);
    }

    const allResults = [];
    const levelSummaries = [];

    for (const level of levels) {
        console.log(`${C.bold}${C.blue}${level.label}${C.reset}`);
        console.log(`${C.dim}${'─'.repeat(56)}${C.reset}`);

        let passed = 0;
        let failed = 0;
        let skipped = 0;

        for (const test of level.tests) {
            const result = await runTest(test, opts.verbose);

            const icon = result.status === 'PASS' ? `${C.green}✓ PASS` : `${C.red}✗ FAIL`;
            console.log(`  ${icon}${C.reset}  ${C.bold}${test.id}${C.reset} ${test.name} ${C.dim}(${result.elapsed}s)${C.reset}`);

            if (result.status === 'FAIL') {
                failed++;
                const errorLines = result.error.split('\n');
                for (const line of errorLines) {
                    console.log(`         ${C.red}→ ${line}${C.reset}`);
                }
            } else {
                passed++;
            }

            allResults.push({
                ...test,
                ...result,
                level: level.level,
            });
        }

        levelSummaries.push({
            level: level.level,
            label: level.label,
            passed,
            failed,
            total: passed + failed,
        });

        console.log('');
    }

    // ─── Final Cleanup ───────────────────────────────────────────────────────
    await fullCleanup();

    // ─── Summary ─────────────────────────────────────────────────────────────
    const totalPassed = allResults.filter((r) => r.status === 'PASS').length;
    const totalFailed = allResults.filter((r) => r.status === 'FAIL').length;
    const totalTests = allResults.length;
    const pct = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';

    console.log(`${C.bold}${C.cyan}${'═'.repeat(56)}${C.reset}`);
    console.log(`${C.bold}${C.cyan}                     SUMMARY${C.reset}`);
    console.log(`${C.bold}${C.cyan}${'═'.repeat(56)}${C.reset}`);
    console.log('');

    // Per-level table
    console.log(`  ${C.bold}${'Level'.padEnd(45)} Result${C.reset}`);
    console.log(`  ${C.dim}${'─'.repeat(54)}${C.reset}`);
    for (const s of levelSummaries) {
        const color = s.failed === 0 ? C.green : C.red;
        console.log(`  ${s.label.padEnd(45)} ${color}${s.passed}/${s.total}${C.reset}`);
    }
    console.log(`  ${C.dim}${'─'.repeat(54)}${C.reset}`);

    const totalColor = totalFailed === 0 ? C.green : C.red;
    console.log(`  ${C.bold}${'TOTAL'.padEnd(45)} ${totalColor}${totalPassed}/${totalTests} (${pct}%)${C.reset}`);
    console.log('');

    // Failed tests list
    if (totalFailed > 0) {
        console.log(`  ${C.red}${C.bold}Failed Tests:${C.reset}`);
        for (const r of allResults.filter((r) => r.status === 'FAIL')) {
            console.log(`    ${C.red}✗ ${r.id} — ${r.name}${C.reset}`);
        }
        console.log('');
    }

    console.log(`${C.bold}${C.cyan}${'═'.repeat(56)}${C.reset}`);
    console.log('');

    process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(`${C.red}Fatal error: ${err.message}${C.reset}`);
    console.error(err.stack);
    process.exit(2);
});
