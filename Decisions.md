# 1. Which exact lines prevent two workers from claiming the same job, and why is that operation atomic across separate OS processes?

Job claiming is implemented using a **single SQL UPDATE statement** rather than performing a SELECT followed by a separate UPDATE.

```sql
UPDATE jobs
SET
    state = 'processing',
    worker_id = ?,
    updated_at = ?
WHERE id = (
    SELECT id
    FROM jobs
    WHERE
        state = 'pending'
        OR (
            state = 'failed'
            AND next_retry_at <= ?
        )
    ORDER BY created_at
    LIMIT 1
)
AND (
    state = 'pending'
    OR (
        state = 'failed'
        AND next_retry_at <= ?
    )
)
RETURNING *;
```

These lines are responsible for preventing duplicate execution:

```sql
UPDATE jobs
...
WHERE id = (
    SELECT ...
)
AND (
    state='pending'
    OR (
        state='failed'
        AND next_retry_at <= ?
    )
)
RETURNING *;
```
The atomic claim implementation is located in:

src/db/jobs.db.js (Lines 87–114)

## Why is this atomic?

SQLite executes the entire UPDATE statement as one write operation.

Two workers may attempt to claim a job simultaneously, but SQLite allows only one write transaction to modify the database at a time.

When one worker successfully changes the job state from `pending` to `processing`, the second worker's UPDATE no longer matches the `WHERE` condition and therefore updates zero rows.

Because the claim is performed by one SQL statement rather than separate SELECT and UPDATE operations, there is no race window where two workers can claim the same job.

Additionally:

- SQLite is running in WAL mode.
- `busy_timeout` is configured to wait for temporary database locks instead of immediately failing with `SQLITE_BUSY`.
- If a lock still cannot be acquired, the worker simply retries during the next polling cycle.

---

# 2. A worker is SIGKILLed halfway through a job. Walk through, step by step, what happens.

The worker updates its heartbeat periodically while running.

Suppose Worker A has already claimed a job.

```
Pending

↓

Processing
```

The worker then receives `SIGKILL`.

Since `SIGKILL` cannot be intercepted, no cleanup code executes.

At this point:

- the worker process disappears
- its database row still exists
- the job remains in `processing`

The supervisor process periodically checks worker heartbeats.

If the heartbeat becomes older than the configured worker timeout, the worker is considered dead.

The supervisor then:

1. Finds expired workers.
2. Finds jobs owned by those workers.
3. Moves those jobs back to `pending`.
4. Removes the stale worker entry.

The next available worker automatically claims the recovered job.

Therefore no job remains permanently stuck in `processing`.

## Worst-case recovery delay

Recovery delay equals approximately:

```
Worker timeout
+
Recovery polling interval
```

With the default configuration this is well under the assignment's required 60 seconds.

---

# 3. Does `dlq retry` reset attempts? Why?

Yes.

Running

```
queuectl dlq retry <job-id>
```

resets:

- attempts
- worker_id
- next_retry_at

before moving the job back to the `pending` state.

## Why?

A job that reaches the Dead Letter Queue has already exhausted all configured retries.

When a user manually retries a DLQ job, it usually means something external has changed.

Examples include:

- fixing a missing executable
- correcting an environment variable
- repairing a network dependency
- updating configuration

Keeping the old attempt count would cause the job to immediately return to the DLQ after one more failure.

Resetting attempts treats the retry as a completely new execution request, which matches user expectations.

---

# 4. What designs did you consider and reject for `worker stop`?

Several approaches were considered.

## Option 1 — PID Files

Each supervisor would create a PID file.

The `worker stop` command would read those files and signal the processes.

### Advantages

- Simple implementation.
- Common Unix approach.

### Why rejected?

It creates another source of truth outside SQLite.

It also requires managing stale PID files after crashes.

---

## Option 2 — Direct `process.kill()` on supervisor PIDs

The CLI would store supervisor PIDs and directly signal them.

### Advantages

Simple implementation.

### Why rejected?

Cross-platform graceful signal delivery is not reliable, especially on Windows.

Since the assignment may be evaluated on different operating systems, I preferred not to depend on OS-specific signal behavior for cross-terminal communication.

---

## Option 3 — Workers poll a stop flag

Each worker would periodically check the database for a stop request.

### Advantages

Works on every platform.

### Why rejected?

Every worker performs additional database queries.

More importantly, it makes the supervisor process almost unnecessary because every worker becomes responsible for shutdown coordination.

---

## Final Design

I introduced a `supervisors` table.

Each `worker start` command launches one supervisor process.

The supervisor:

- starts worker processes
- monitors worker crashes
- performs recovery
- coordinates graceful shutdown

The `worker stop` command updates a shutdown flag inside the supervisors table.

Each supervisor periodically checks only its own shutdown flag.

When shutdown is requested:

1. The supervisor stops accepting new work.
2. It sends an IPC shutdown message to every child worker.
3. Workers finish their current job.
4. Workers exit.
5. The supervisor removes its database entry and exits.

This keeps database polling to one query per supervisor instead of one query per worker while preserving a clear separation of responsibilities.

---

# 5. Priority Jobs — Implementation and Design

Priority jobs have been implemented as a **bonus feature**.

## Schema Change

A `priority` column was added to the `jobs` table:

```sql
priority INTEGER NOT NULL DEFAULT 0
```

Higher values mean higher priority. The default is `0`, so existing jobs and jobs enqueued without specifying a priority continue to work as before.

## CLI

The `enqueue` command accepts an optional `--priority` (or `-p`) flag:

```bash
queuectl enqueue '{"id":"urgent","command":"echo urgent"}' --priority 10
```

## Job Claiming

The atomic claim query now orders by priority first:

```sql
ORDER BY priority DESC, created_at ASC
```

Higher priority jobs are always claimed before lower priority jobs. Among jobs with equal priority, FIFO ordering is preserved.

## What survived unchanged?

As predicted in the original design, almost nothing else changed:

- Worker execution — unchanged
- Graceful shutdown — unchanged
- Heartbeat — unchanged
- Crash recovery — unchanged
- Retry logic — unchanged
- Dead Letter Queue — unchanged
- Supervisor architecture — unchanged
- Configuration system — unchanged

Only three files were modified:

1. `schema.db.js` — added the `priority` column
2. `jobs.db.js` — added `priority` to the INSERT statement and updated the ORDER BY in the claim query
3. `enqueue.command.js` — added the `--priority` CLI option

This confirms that separating job selection from job execution keeps the scheduling policy isolated from the rest of the system.

---

# 6. Dashboard — Design Decision

A web-based monitoring dashboard was implemented as a **bonus feature**.

## Architecture

The dashboard is a standalone Express.js server that reads the same SQLite database used by the CLI and workers.

```
┌──────────────┐     ┌──────────────┐
│  queuectl    │     │  Dashboard   │
│  CLI/Workers │     │  (Express)   │
└──────┬───────┘     └──────┬───────┘
       │                    │
       │   SQLite (WAL)     │
       └────────┬───────────┘
                │
          data/queue.db
```

Because SQLite runs in WAL mode, the dashboard can read the database concurrently while workers write to it, without blocking either side.

## Why a separate server instead of embedding in the CLI?

The dashboard serves static HTML/CSS/JS and exposes a REST API. Embedding a web server inside the CLI or supervisor process would:

- Couple the dashboard lifecycle to the worker lifecycle
- Add dependencies (Express, CORS) to the core package
- Complicate the supervisor's single responsibility

Keeping the dashboard as a separate process follows the same separation-of-concerns principle used throughout the project.

## Features

The dashboard provides:

- **Overview** — real-time job counts by state and worker/supervisor counts
- **Jobs** — filterable job list with detail modals
- **Dead Letter Queue** — view and retry dead jobs
- **Workers** — live worker and supervisor status
- **Configuration** — view and update runtime config
- **Enqueue** — submit new jobs (with priority) directly from the UI
- **Auto-refresh** — dashboard polls the API to stay current

## REST API

The dashboard exposes the following endpoints:

| Method | Endpoint              | Description                |
| ------ | --------------------- | -------------------------- |
| GET    | `/api/status`         | Job counts and worker info |
| GET    | `/api/jobs`           | List all jobs              |
| GET    | `/api/jobs?state=...` | Filter jobs by state       |
| GET    | `/api/jobs/:id`       | Single job detail          |
| POST   | `/api/enqueue`        | Enqueue a new job          |
| GET    | `/api/config`         | Get configuration          |
| PUT    | `/api/config/:key`    | Update a config value      |
| GET    | `/api/dlq`            | List dead jobs             |
| POST   | `/api/dlq/:id/retry`  | Retry a dead job           |
| GET    | `/api/workers`        | List workers/supervisors   |

---

# 7. Scheduled Jobs — Implementation and Design

Scheduled jobs have been implemented as a **bonus feature**.

## Schema Change

A `run_at` column was added to the `jobs` table:

```sql
run_at DATETIME
```

When `run_at` is `NULL`, the job is eligible for immediate execution (default behavior). When set to a future timestamp, the job remains in `pending` but is skipped by the claim query until the scheduled time arrives.

## CLI

The `enqueue` command accepts an optional `--run-at` (or `-r`) flag:

```bash
queuectl enqueue '{"id":"delayed","command":"echo later"}' --run-at 60
queuectl enqueue '{"id":"afternoon","command":"echo hello"}' --run-at "2pm"
queuectl enqueue '{"id":"future","command":"echo hello"}' --run-at "15-7-2026 2pm"
```

## Date/Time Parser

A `runAtToDate()` function in `queue.service.js` converts user input to an ISO 8601 timestamp. It supports:

1. **Seconds** — a plain integer is treated as a delay from now
2. **Time today** — e.g. `2pm`, `2:30pm` (12-hour format with am/pm)
3. **Date + time** — e.g. `15-7-2026 2pm` or `2026-07-15 2pm`
4. **ISO 8601 / standard** — any string parseable by `Date.parse()`

Invalid formats throw a descriptive error.

## Why parse in the service layer?

The parsing logic lives in the service layer rather than the CLI command because:

- The dashboard REST API also needs to accept `run_at` values
- Keeping the parser in the service layer avoids duplicating logic between CLI and API
- The CLI layer remains a thin pass-through

## Job Claiming

The atomic claim query was updated to respect `run_at`:

```sql
WHERE (state = 'pending' AND (run_at IS NULL OR run_at <= @now))
   OR (state = 'failed' AND next_retry_at <= @now)
```

Jobs whose `run_at` is still in the future are silently skipped. No additional polling or timer mechanism is needed — workers naturally pick up scheduled jobs on their next poll cycle after the scheduled time passes.

## What survived unchanged?

- Worker execution — unchanged
- Graceful shutdown — unchanged
- Heartbeat — unchanged
- Crash recovery — unchanged
- Retry logic — unchanged
- Dead Letter Queue — unchanged
- Priority ordering — unchanged (priority still takes precedence)

Only three areas were modified:

1. `schema.db.js` — added the `run_at` column
2. `jobs.db.js` — added `run_at` to INSERT and updated the WHERE clause in the claim query
3. `enqueue.command.js` — added the `--run-at` CLI option
4. `queue.service.js` — added the `runAtToDate()` parser and passed `run_at` to the job object

---

# 8. Job Output Logging — Implementation and Design

Job output logging has been implemented as a **bonus feature**.

## Schema Change

Three columns were added to the `jobs` table:

```sql
stdout TEXT,
stderr TEXT,
exit_code INTEGER
```

These columns are nullable and remain `NULL` until the job executes.

## How it works

The worker runtime (`runtime.js`) already receives `stdout`, `stderr`, and `exitCode` from the job executor. After marking the job as completed or failed, the worker calls `saveLog()` to persist the output:

```js
const data = await executeJob(job);
if (data.success) handleSuccess(job);
else handleFailure(job);
saveLog({ ...data, id: job.id, now: new Date().toISOString() });
```

## Database Layer

A `saveLog()` function in `jobs.db.js` updates the output columns:

```sql
UPDATE jobs
SET stdout = @stdout, stderr = @stderr, exit_code = @exitCode, updated_at = @now
WHERE id = @id
```

## Why store in the jobs table?

Alternatives considered:

1. **Separate `job_logs` table** — normalized but adds JOINs for every job query and complicates the dashboard
2. **File-based logs** — avoids database bloat but introduces filesystem dependencies and makes the dashboard harder to implement
3. **Inline in jobs table** — simple, no JOINs, and the output is always available when querying a job

Option 3 was chosen because:

- Output is always 1:1 with a job (not one-to-many)
- The dashboard and CLI can display output without additional queries
- SQLite handles TEXT columns efficiently
- A `maxBuffer` of 5 MB limits the size of captured output

## What survived unchanged?

- Job claiming — unchanged
- Retry logic — unchanged
- Dead Letter Queue — unchanged
- Priority ordering — unchanged
- Scheduled jobs — unchanged
- Supervisor architecture — unchanged

Only three files were modified:

1. `schema.db.js` — added `stdout`, `stderr`, `exit_code` columns
2. `jobs.db.js` — added the `saveLog()` function
3. `runtime.js` — added the `saveLog()` call after job execution

---

# Summary of Major Design Decisions

- SQLite chosen for persistent storage and atomic writes.
- WAL mode enabled for improved concurrency.
- Job claiming implemented as a single UPDATE...RETURNING statement.
- Parent supervisor coordinates worker lifecycle.
- Worker heartbeats used for crash recovery.
- Retry uses exponential backoff.
- DLQ retry resets attempts.
- Business logic isolated inside the service layer.
- SQL kept inside the database layer.
- **Priority jobs** implemented via a `priority` column and `ORDER BY priority DESC, created_at ASC` in the claim query.
- **Web dashboard** implemented as a standalone Express server sharing the same SQLite database via WAL mode.
- **Scheduled jobs** implemented via a `run_at` column with a flexible date/time parser in the service layer.
- **Job output logging** implemented by storing stdout, stderr, and exit_code directly in the jobs table.