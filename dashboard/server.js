import express from "express";
import Database from "better-sqlite3";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Database Connection ──────────────────────────────────────────────
const DB_PATH = path.join(__dirname, "..", "data", "queue.db");
let db;
try{ db = new Database(DB_PATH);}
catch(err){
  console.log(err.message,"\n Cannot access Database");
  process.exit(1);
}
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// ── Prepared Statements ──────────────────────────────────────────────
const stmts = {
  jobCountsByState: db.prepare(
    `SELECT state, COUNT(*) AS count FROM jobs GROUP BY state`
  ),
  workerCount: db.prepare(`SELECT COUNT(*) AS count FROM workers`),
  allJobs: db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`),
  jobsByState: db.prepare(
    `SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC`
  ),
  jobById: db.prepare(`SELECT * FROM jobs WHERE id = ?`),
  allConfig: db.prepare(`SELECT key, value FROM config`),
  setConfig: db.prepare(`UPDATE config SET value = ? WHERE key = ?`),
  deadJobs: db.prepare(
    `SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at DESC`
  ),
  retryDeadJob: db.prepare(
    `UPDATE jobs SET state='pending', attempts=0, worker_id=NULL, next_retry_at=NULL, updated_at=? WHERE id=? AND state='dead'`
  ),
  allWorkers: db.prepare(`SELECT * FROM workers ORDER BY started_at DESC`),
  allSupervisors: db.prepare(`SELECT * FROM supervisors`),
  createJob: db.prepare(
    `INSERT INTO jobs (id, command, state, attempts, max_retries, priority, created_at, updated_at) VALUES (@id, @command, @state, @attempts, @max_retries, @priority, @created_at, @updated_at)`
  ),
  getJobById: db.prepare(`SELECT * FROM jobs WHERE id = ?`),
  getMaxRetries: db.prepare(`SELECT value FROM config WHERE key = 'max-retries'`),
};

// ── Valid config keys (matches existing service layer) ───────────────
const VALID_CONFIG_KEYS = [
  "max-retries",
  "backoff-base",
  "recovery-interval",
  "worker-timeout",
];

// ── Express App ──────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── API: Queue Status ────────────────────────────────────────────────
app.get("/api/status", (_req, res) => {
  try {
    const counts = stmts.jobCountsByState.all();
    const workers = stmts.workerCount.get().count;
    const supervisors = stmts.allSupervisors.all();
    const result = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
      workers,
      supervisors: supervisors.length,
    };
    for (const row of counts) result[row.state] = row.count;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: List Jobs ───────────────────────────────────────────────────
app.get("/api/jobs", (req, res) => {
  try {
    const { state } = req.query;
    const jobs = state ? stmts.jobsByState.all(state) : stmts.allJobs.all();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Single Job ──────────────────────────────────────────────────
app.get("/api/jobs/:id", (req, res) => {
  try {
    const job = stmts.jobById.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Enqueue Job ─────────────────────────────────────────────────
app.post("/api/enqueue", (req, res) => {
  try {
    console.log("Enqueuing job req.body:", req.body);
    const { id, command, priority } = req.body;
    if (!command) return res.status(400).json({ error: "Command is required" });

    const jobId = id || crypto.randomUUID();

    // Check for duplicate
    const existing = stmts.getJobById.get(jobId);
    if (existing) {
      return res.status(409).json({ error: `Job with ID '${jobId}' already exists` });
    }

    // Get max-retries from config (mirrors queue.service.js logic)
    const configRow = stmts.getMaxRetries.get();
    const maxRetries = configRow ? Number(configRow.value) : 3;

    const now = new Date().toISOString();
    const job = {
      id: jobId,
      command,
      state: "pending",
      attempts: 0,
      max_retries: maxRetries,
      priority: typeof priority === "number" ? priority : Number(priority || 0),
      created_at: now,
      updated_at: now,
    };
    stmts.createJob.run(job);
    res.status(201).json({ success: true, job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Configuration ───────────────────────────────────────────────
app.get("/api/config", (_req, res) => {
  try {
    const rows = stmts.allConfig.all();
    const defaults = {
      "max-retries": 3,
      "backoff-base": 2,
      "recovery-interval": 15000,
      "worker-timeout": 30000,
    };
    for (const row of rows) {
      if (defaults[row.key] !== undefined) defaults[row.key] = Number(row.value);
    }
    res.json(defaults);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/config/:key", (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    if (!VALID_CONFIG_KEYS.includes(key)) {
      return res.status(400).json({
        error: `Invalid key. Valid keys: ${VALID_CONFIG_KEYS.join(", ")}`,
      });
    }
    stmts.setConfig.run(String(value), key);
    res.json({ success: true, key, value: Number(value) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Dead Letter Queue ───────────────────────────────────────────
app.get("/api/dlq", (_req, res) => {
  try {
    const jobs = stmts.deadJobs.all();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/dlq/:id/retry", (req, res) => {
  try {
    const result = stmts.retryDeadJob.run(new Date().toISOString(), req.params.id);
    if (result.changes === 0) {
      return res
        .status(404)
        .json({ error: "Job not found in DLQ or already retried" });
    }
    res.json({ success: true, message: "Job requeued successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Workers ─────────────────────────────────────────────────────
app.get("/api/workers", (_req, res) => {
  try {
    const workers = stmts.allWorkers.all();
    const supervisors = stmts.allSupervisors.all();
    res.json({ workers, supervisors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SPA Fallback ─────────────────────────────────────────────────────
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start Server ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3737;
app.listen(PORT, () => {
  console.log(`\n  ⚡ QueueCTL Dashboard running at http://localhost:${PORT}\n`);
});
