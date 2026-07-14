# QueueCTL

> A CLI-based background job queue built with **Node.js**, **better-sqlite3**, and **Commander.js**. QueueCTL supports concurrent worker processes, automatic retries with exponential backoff, crash recovery, a Dead Letter Queue (DLQ), priority-based scheduling, scheduled jobs, job output logging, a web dashboard, and persistent storage.
---

# Demo

Demo video:


[Demo Video](https://drive.google.com/file/d/1PTwfydL6YGTubXUZsmuayplkxbjYLzjb/view?usp=sharing)



# Features

* Persistent job storage using SQLite
* Multiple worker processes running in parallel
* Workers can be started from multiple terminal sessions
* Atomic job claiming (no duplicate execution)
* Automatic retries with exponential backoff
* Dead Letter Queue (DLQ)
* Crash recovery after worker failure (`SIGKILL`)
* Graceful shutdown
* Runtime configuration through CLI
* Job listing and status commands
* **Priority-based job scheduling** (bonus)
* **Web dashboard** for real-time monitoring and job management (bonus)
* **Scheduled jobs** — defer execution to a future time (bonus)
* **Job output logging** — stdout, stderr, and exit code captured per job (bonus)

---

# Tech Stack

* **Node.js**
* **better-sqlite3**
* **Commander.js**
* **SQLite (WAL Mode)**
* **Express.js** (dashboard)

---

# Architecture

```
                   +----------------------+        +-------------------+
                   |      queuectl CLI    |        |    Dashboard      |
                   +----------+-----------+        |  (Express :3737)  |
                              |                    +--------+----------+
                           Commands                         |
                              |                             |
                              v                             |
                         Service Layer                      |
                              |                             |
                              v                             v
                         Database Layer  <────────── REST API reads
                               |
                         better-sqlite3 (SQLite WAL)
                               |
             +-----------+-----------+-----------+
             |           |           |           |
             v           v           v           v
             Jobs      Workers    Supervisors   Config   (TABLES)
          (stdout, stderr, exit_code, run_at)
```

The project follows a layered architecture:

```
CLI
   ↓
Service Layer
   ↓
Database Layer
   ↓
SQLite
```

Business logic lives in the **service layer**, while the database layer only performs SQL operations.

---

# Worker Architecture

Each `worker start` command launches a **Supervisor Process**.

```
Terminal 1

Supervisor
    │
    ├── Worker 1
    ├── Worker 2
    └── Worker 3
```

Another terminal may launch another supervisor:

```
Terminal 2

Supervisor
    │
    ├── Worker 4
    └── Worker 5
```

The dashboard runs as a separate process (port 3737) and reads the shared SQLite database via WAL mode.

Each supervisor is responsible for:

* Starting child workers
* Recovering crashed jobs
* Handling graceful shutdown
* Coordinating its own workers using IPC

---

# Job Lifecycle

```
     +-----------+       +-----------+
     |  Enqueued |       | Scheduled |
     | (run_at   |       | (run_at   |
     |  = NULL)  |       |  = future)|
     +-----+-----+       +-----+-----+
           |                    |
           v                    | (waits until run_at <= now)
     +-----------+              |
     |  Pending  | <────────────+
     +-----------+
           |
           v
     +-----------+
     |Processing |
     +-----------+
      |        |
      |        |
      |        v
      |   +-----------+
      |   | Completed |  (stdout, stderr, exit_code saved)
      |   +-----------+
      |
      v
+-------------+
|   Failed    |  (stdout, stderr, exit_code saved)
+-------------+
      |
      v
Wait (Backoff)
      |
      v
+-------------+
| Processing  |
+-------------+
      |
      v
 Max Retries?
  /        \
No          Yes
|            |
v            v
Retry Again  +------+
             | Dead |
             +------+
```

Priority-aware scheduling ensures higher-priority jobs are always picked first (see Priority Jobs below). Scheduled jobs remain in `pending` but are not claimed until `run_at <= now`.

---

# Priority Jobs

Jobs can be enqueued with an optional priority (default `0`). Higher values mean higher priority.

```bash
queuectl enqueue '{"id":"urgent","command":"echo URGENT"}' --priority 10
queuectl enqueue '{"id":"normal","command":"echo normal"}'              # priority 0
```

The atomic claim query orders by:

```sql
ORDER BY priority DESC, created_at ASC
```

So a priority-10 job will always be picked before a priority-0 job, regardless of creation time. Among jobs with equal priority, FIFO ordering is preserved.

The dashboard also supports setting priority when enqueuing jobs from the UI.

---

# Scheduled Jobs

Jobs can be scheduled for future execution using the `--run-at` (or `-r`) flag.

```bash
# Delay by N seconds from now
queuectl enqueue '{"id":"delayed","command":"echo later"}' --run-at 60

# Schedule for a specific time today
queuectl enqueue '{"id":"afternoon","command":"echo hello"}' --run-at "2pm"
queuectl enqueue '{"id":"precise","command":"echo hello"}' --run-at "2:30pm"

# Schedule for a specific date and time
queuectl enqueue '{"id":"future","command":"echo hello"}' --run-at "15-7-2026 2pm"
```

Supported formats:

| Format                  | Example           | Meaning                          |
| ----------------------- | ----------------- | -------------------------------- |
| Seconds (integer)       | `60`              | Run 60 seconds from now          |
| Time today (12h)        | `2pm`, `2:30pm`   | Run at that time today           |
| Date + time             | `15-7-2026 2pm`   | Run at that date and time        |
| ISO 8601 / standard     | `2026-07-15T14:00`| Parsed directly                  |

Scheduled jobs are stored with `state = 'pending'` and a `run_at` timestamp. The claim query skips them until `run_at <= now`:

```sql
WHERE (state = 'pending' AND (run_at IS NULL OR run_at <= @now))
```

Jobs without `--run-at` have `run_at = NULL` and are eligible immediately.

---

# Job Output Logging

Every job's execution output is captured and persisted in the database.

After a job finishes (success or failure), the worker saves:

| Column      | Description                                |
| ----------- | ------------------------------------------ |
| `stdout`    | Standard output from the command           |
| `stderr`    | Standard error output from the command     |
| `exit_code` | Process exit code (`0` = success)          |

This data is stored directly in the `jobs` table and is available via:

* `queuectl list --state completed --json` — includes stdout, stderr, exit_code per job
* The dashboard job detail modal
* The REST API (`GET /api/jobs/:id`)

---

# Crash Recovery

Every worker periodically updates its heartbeat.

If a worker crashes (including `SIGKILL`):

```
Worker

↓

Heartbeat stops

↓

Supervisor detects timeout

↓

Recover processing jobs

↓

Move them back to Pending

↓

Another worker executes them
```

No job remains permanently stuck in the `processing` state.

---

# Graceful Shutdown

Workers support graceful shutdown in two ways:

### Ctrl+C

```
Ctrl+C

↓

Supervisor

↓

IPC Message

↓

Workers finish current job

↓

Workers exit

↓

Supervisor exits
```

---

### queuectl worker stop

```
queuectl worker stop

↓

Update supervisors table

↓

Supervisors detect shutdown request

↓

IPC

↓

Workers finish current job

↓

Supervisor exits
```

This allows workers started from **different terminal sessions** to be stopped without interrupting running jobs.

---

# Retry Policy

Failed jobs automatically retry using exponential backoff.

Formula:

```
delay = base ^ attempts
```

Default:

```
Backoff Base = 2
```

Retry delays:

| Attempt |     Delay |
| ------: | --------: |
|       1 | 2 seconds |
|       2 | 4 seconds |
|       3 | 8 seconds |

When the retry limit is exceeded, the job moves to the **Dead Letter Queue**.

---

# Dead Letter Queue

Commands:

```bash
queuectl dlq list
```

Lists all permanently failed jobs.

---

```bash
queuectl dlq retry <job-id>
```

Moves a dead job back to the queue.

The retry command resets:

* attempts
* next_retry_at
* worker_id

allowing the job to start as a completely new execution.

---

# Configuration

Configuration is stored persistently inside SQLite.

Supported configuration:

* max-retries
* backoff-base
* worker-timeout
* recovery-interval

Examples:

```bash
queuectl config list
```

```bash
queuectl config get max-retries
```

```bash
queuectl config set max-retries 5
```

---

# CLI Commands

## Enqueue

```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}'
```

With priority:

```bash
queuectl enqueue '{"id":"job2","command":"echo Urgent"}' --priority 10
```

With scheduled time:

```bash
queuectl enqueue '{"id":"job3","command":"echo Later"}' --run-at 60
queuectl enqueue '{"id":"job4","command":"echo Afternoon"}' --run-at "2pm"
```

With both:

```bash
queuectl enqueue '{"id":"job5","command":"echo VIP"}' --priority 5 --run-at "3pm"
```

---

## Start Workers

```bash
queuectl worker start --count 3
```

Starts three workers in the foreground.

---

## Stop Workers

```bash
queuectl worker stop
```

Gracefully stops all running supervisors and workers.

---

## Status

```bash
queuectl status
```

Displays:

* Pending jobs
* Processing jobs
* Completed jobs
* Failed jobs
* Dead jobs
* Active workers

---

## List Jobs

```bash
queuectl list --state pending
```

JSON output:

```bash
queuectl list --state pending --json
```

---

## Dead Letter Queue

```bash
queuectl dlq list
```

```bash
queuectl dlq retry job1
```

---

## Configuration

```bash
queuectl config list
```

```bash
queuectl config set backoff-base 3
```

---

## Dashboard

```bash
npm start
```

Opens the dashboard at [http://localhost:3737](http://localhost:3737).

---

## Installation

```bash
git clone <repository-url>
cd queuectl
npm install
npm link
```

`npm install` automatically installs both root and dashboard dependencies.

# Running

Start workers:

```bash
queuectl worker start --count 3
```

Add jobs:

```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}'
```

Add a scheduled job:

```bash
queuectl enqueue '{"id":"job2","command":"echo Later"}' --run-at 30
```

Check status:

```bash
queuectl status
```

---

# Testing

To run the automated test suite, execute:

```bash
npm test
```

The implementation has also been manually tested for the following scenarios:

*  Successful job execution
*  Failed job retries
*  Dead Letter Queue
*  Multiple concurrent workers
*  No duplicate job execution
*  Crash recovery after `SIGKILL`
*  Graceful shutdown using Ctrl+C
*  Graceful shutdown using `worker stop`
*  Persistent storage across restarts
*  Configuration updates
*  Priority-based job ordering
*  Dashboard API endpoints
*  Enqueuing jobs from the dashboard UI
*  Scheduled jobs (`--run-at` with various formats)
*  Job output logging (stdout, stderr, exit_code)

---

# Design Highlights

* Layered architecture (CLI → Services → Database)
* Atomic SQL job claiming
* SQLite WAL mode for improved concurrency
* Parent supervisor responsible for worker coordination
* IPC between supervisor and workers
* Crash recovery using worker heartbeats
* Configuration stored persistently
* Small, focused database functions
* Business logic isolated from SQL
* **Priority-based scheduling** via `ORDER BY priority DESC, created_at ASC`
* **Web dashboard** (standalone Express server sharing the SQLite DB via WAL)
* **Scheduled jobs** via `run_at` column and flexible date/time parser
* **Job output logging** — stdout, stderr, exit_code persisted per job

---

# Future Improvements

* Job timeouts
* Metrics / observability
* Worker auto-scaling

---


