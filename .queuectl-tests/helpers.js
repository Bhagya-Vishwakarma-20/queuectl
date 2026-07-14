/**
 * QueueCTL Test Suite — Helpers & Utilities
 * 
 * Black-box test utilities that drive the CLI exactly as an interviewer's
 * hidden automated evaluation script would.
 * 
 * Platform: Windows (with Git Bash) + cross-platform fallbacks.
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Paths ───────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join('src', 'index.js');
const DB_DIR = path.join(PROJECT_ROOT, 'data');
const DB_FILE = path.join(DB_DIR, 'queue.db');

// ─── Process Tracking ────────────────────────────────────────────────────────
const trackedProcesses = new Set();

export function trackProcess(child) {
    trackedProcesses.add(child);
    child.on('close', () => trackedProcesses.delete(child));
    return child;
}

// ─── CLI Runner (no shell — avoids quoting issues) ───────────────────────────
/**
 * Run `node src/index.js <...args>` and capture output.
 * 
 * On Windows, JSON strings with double-quotes cause problems with spawn's
 * automatic argument quoting. We use execFile which handles quoting better.
 */
export function queuectl(...args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_PATH, ...args], {
            cwd: PROJECT_ROOT,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
            windowsHide: true,
            windowsVerbatimArguments: false,
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                try { child.kill(); } catch { }
                resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: -1, timedOut: true });
            }
        }, 30000);

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        child.on('close', (code) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 });
            }
        });

        child.on('error', (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve({ stdout: '', stderr: err.message, exitCode: -1 });
            }
        });
    });
}

// ─── Convenience Wrappers ────────────────────────────────────────────────────
export async function enqueue(jobObj, priority = null) {
    const payload = typeof jobObj === 'string' ? jobObj : JSON.stringify(jobObj);
    const args = ['enqueue', payload];
    if (priority !== null) {
        args.push('-p', String(priority));
    }
    return queuectl(...args);
}

export async function getJobs(state) {
    const args = state ? ['list', '--state', state, '--json'] : ['list', '--json'];
    const result = await queuectl(...args);
    try {
        return JSON.parse(result.stdout);
    } catch {
        return null;
    }
}

export async function getStatus() {
    const result = await queuectl('status');
    return result;
}

export async function stopWorkers() {
    return queuectl('worker', 'stop');
}

export async function configSet(key, value) {
    return queuectl('config', 'set', key, String(value));
}

export async function configList() {
    return queuectl('config', 'list');
}

export async function dlqList() {
    return queuectl('dlq', 'list');
}

export async function dlqRetry(id) {
    return queuectl('dlq', 'retry', id);
}

// ─── Worker Management ──────────────────────────────────────────────────────
export function startWorkersBackground(count = 1) {
    const child = spawn('node', [CLI_PATH, 'worker', 'start', '--count', String(count)], {
        cwd: PROJECT_ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
    });
    trackProcess(child);
    return child;
}

export async function stopWorkersAndWait(workerProcess, timeoutMs = 15000) {
    await stopWorkers();
    return new Promise((resolve) => {
        if (workerProcess.exitCode !== null) {
            resolve(true);
            return;
        }
        const timer = setTimeout(() => {
            killProcessTree(workerProcess.pid);
            resolve(false);
        }, timeoutMs);
        workerProcess.on('close', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

// ─── Process Kill Helpers ────────────────────────────────────────────────────
export function killProcess(pid, force = false) {
    try {
        if (process.platform === 'win32') {
            if (force) {
                execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
            } else {
                execSync(`taskkill /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
            }
        } else {
            process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
        }
        return true;
    } catch {
        return false;
    }
}

export function killProcessTree(pid) {
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
        } else {
            try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
        }
        return true;
    } catch {
        return false;
    }
}

export function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// ─── DB Reset ────────────────────────────────────────────────────────────────
/**
 * Delete the DB files with retry logic for Windows file locking.
 */
export function resetDB() {
    const files = [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm', DB_FILE + '-journal'];
    for (let attempt = 0; attempt < 5; attempt++) {
        let allDeleted = true;
        for (const f of files) {
            try {
                if (fs.existsSync(f)) {
                    fs.unlinkSync(f);
                }
            } catch {
                allDeleted = false;
            }
        }
        if (allDeleted) break;
        const start = Date.now();
        while (Date.now() - start < 500) { /* spin */ }
    }
    try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch { }
}
/**
 * Clear all data by running a dedicated cleanup script that truncates tables.
 * This avoids file-locking issues since it goes through the same DB connection pattern.
 */
async function clearAllData() {
    // Use a small inline Node script to clear the DB using the app's own database module
    const script = `
        import db from '../src/db/database.js';
        try {
            db.exec('DELETE FROM jobs;');
            db.exec('DELETE FROM workers;');
            db.exec('DELETE FROM supervisors;');
            db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('max-retries', '3');");
            db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('backoff-base', '2');");
            db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('recovery-interval', '15000');");
            db.exec("INSERT OR REPLACE INTO config (key, value) VALUES ('worker-timeout', '30000');");
            process.exit(0);
        } catch(e) {
            console.error(e.message);
            process.exit(1);
        }
    `;
    const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const scriptPath = path.join(PROJECT_ROOT, '.queuectl-tests', `_cleanup_${uniqueId}.mjs`);
    fs.writeFileSync(scriptPath, script);
    
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [scriptPath], {
            cwd: PROJECT_ROOT,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        
        let stderr = '';
        child.stderr.on('data', (data) => {
            stderr += data;
        });

        let timeout = setTimeout(() => {
            timeout = null;
            try { child.kill(); } catch { }
            try { fs.unlinkSync(scriptPath); } catch { }
            resolve();
        }, 10000);

        child.on('close', (code) => {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            try { fs.unlinkSync(scriptPath); } catch { }
            if (code !== 0 && stderr) {
                console.error(`Database cleanup failed with code ${code}: ${stderr.trim()}`);
            }
            resolve();
        });
        child.on('error', (err) => {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            try { fs.unlinkSync(scriptPath); } catch { }
            console.error(`Database cleanup spawn error:`, err);
            resolve();
        });
    });
}

function killStaleCLIProcesses() {
    try {
        if (process.platform === 'win32') {
            const command = "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter 'Name = ''node.exe''' | Select-Object ProcessId, CommandLine | ConvertTo-Json\"";
            const stdout = execSync(command, { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }).trim();
            if (!stdout) return;
            
            const jsonStartIndex = stdout.indexOf('[');
            if (jsonStartIndex === -1) return;
            const cleanJson = stdout.substring(jsonStartIndex);
            
            const processes = JSON.parse(cleanJson);
            const myPid = process.pid;
            const myPpid = process.ppid;
            
            for (const proc of processes) {
                const pid = proc.ProcessId;
                const cmd = proc.CommandLine || '';
                
                const isQueuectlProc = cmd.includes('worker.js') || cmd.includes('worker start') || cmd.includes('queuectl');
                const isTestRunner = cmd.includes('test-runner.js') || pid === myPid || pid === myPpid;
                
                if (isQueuectlProc && !isTestRunner) {
                    try {
                        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 2000 });
                    } catch (e) {
                        // ignore
                    }
                }
            }
        }
    } catch (err) {
        // ignore
    }
}

/**
 * Full cleanup: kill all tracked processes, clear DB data, wait.
 */
export async function fullCleanup() {
    // 1. Request graceful stop (ignore failures)
    try { await queuectl('worker', 'stop'); } catch { }
    await sleep(500);

    // 2. Kill stale processes from previous test runs
    killStaleCLIProcesses();

    // 2. Force kill all tracked processes
    for (const child of [...trackedProcesses]) {
        try { killProcessTree(child.pid); } catch { }
    }
    trackedProcesses.clear();

    // 3. Wait for processes to die
    await sleep(1500);

    // 4. Clear all data from tables (avoids file-locking issues)
    await clearAllData();

    // 5. Brief pause to ensure DB is ready
    await sleep(300);
}


// ─── Wait Helpers ────────────────────────────────────────────────────────────
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCondition(conditionFn, timeoutMs = 30000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (await conditionFn()) return true;
        } catch { }
        await sleep(intervalMs);
    }
    return false;
}

export async function waitForJobState(jobId, state, timeoutMs = 30000) {
    return waitForCondition(async () => {
        const jobs = await getJobs(state);
        return jobs && jobs.some((j) => j.id === jobId);
    }, timeoutMs);
}

export async function waitForAllJobsInState(state, expectedCount, timeoutMs = 30000) {
    return waitForCondition(async () => {
        const jobs = await getJobs(state);
        return jobs && jobs.length >= expectedCount;
    }, timeoutMs);
}

export async function waitForNoJobsInState(state, timeoutMs = 30000) {
    return waitForCondition(async () => {
        const jobs = await getJobs(state);
        return jobs && jobs.length === 0;
    }, timeoutMs);
}

export async function waitForProcessExit(child, timeoutMs = 15000) {
    if (child.exitCode !== null) return true;
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        child.on('close', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

// ─── Batch Enqueue Helper ────────────────────────────────────────────────────
export async function enqueueMany(jobs) {
    const results = [];
    for (const job of jobs) {
        results.push(await enqueue(job));
    }
    return results;
}

export function generateJobs(count, commandFn = (i) => `echo job_${i}`, idPrefix = 'job') {
    return Array.from({ length: count }, (_, i) => ({
        id: `${idPrefix}-${String(i).padStart(4, '0')}`,
        command: commandFn(i),
    }));
}

// ─── Assertion Helpers ───────────────────────────────────────────────────────
export class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

export function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new AssertionError(message);
}

export function assertEqual(actual, expected, message = 'assertEqual failed') {
    if (actual !== expected) {
        throw new AssertionError(
            `${message}\n    Expected: ${JSON.stringify(expected)}\n    Actual:   ${JSON.stringify(actual)}`
        );
    }
}

export function assertGreaterThan(actual, expected, message = 'assertGreaterThan failed') {
    if (!(actual > expected)) {
        throw new AssertionError(
            `${message}\n    Expected > ${expected}, got ${actual}`
        );
    }
}

export function assertGreaterThanOrEqual(actual, expected, message = 'assertGreaterThanOrEqual failed') {
    if (!(actual >= expected)) {
        throw new AssertionError(
            `${message}\n    Expected >= ${expected}, got ${actual}`
        );
    }
}

export function assertJsonArray(str, message = 'Expected valid JSON array on stdout') {
    let parsed;
    try {
        parsed = JSON.parse(str);
    } catch (err) {
        throw new AssertionError(
            `${message}\n    Parse error: ${err.message}\n    Raw stdout: ${JSON.stringify(str.substring(0, 300))}`
        );
    }
    if (!Array.isArray(parsed)) {
        throw new AssertionError(
            `${message}\n    Expected array, got ${typeof parsed}`
        );
    }
    return parsed;
}

export function assertStdoutIsOnlyJson(result, message = 'stdout must contain only JSON (no extra text)') {
    const raw = result.stdout;
    // stdout should be parseable as JSON in its entirety
    try {
        JSON.parse(raw);
    } catch {
        throw new AssertionError(
            `${message}\n    stdout was not pure JSON:\n    ${JSON.stringify(raw.substring(0, 500))}`
        );
    }
}

// ─── Test Definition Helper ──────────────────────────────────────────────────
export function defineTest({ id, name, category, level, difficulty, priority, probability, requirement, timeout = 30000, fn }) {
    return { id, name, category, level, difficulty, priority, probability, requirement, timeout, fn };
}
