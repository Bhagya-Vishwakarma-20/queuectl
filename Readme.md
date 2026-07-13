# QueueCTL

> A CLI-based background job queue built with **Node.js**, **better-sqlite3**, and **Commander.js**. QueueCTL supports concurrent worker processes, automatic retries with exponential backoff, crash recovery, a Dead Letter Queue (DLQ), and persistent storage.
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

---

# Tech Stack

* **Node.js**
* **better-sqlite3**
* **Commander.js**
* **SQLite (WAL Mode)**

---

# Architecture

```
                   +----------------------+
                   |      queuectl CLI    |
                   +----------+-----------+
                              |
                           Commands
                              |
                              v
                         Service Layer
                              |
                              v
                        Database Layer
                              |
                        better-sqlite3 (SQLite)
                              |
            +-----------+-----------+-----------+
            |           |           |           |
            v           v           v           v
            Jobs      Workers    Supervisors   Config   (TABLES)
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

Each supervisor is responsible for:

* Starting child workers
* Recovering crashed jobs
* Handling graceful shutdown
* Coordinating its own workers using IPC

---

# Job Lifecycle

```
            +-----------+
            |  Pending  |
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
             |   | Completed |
             |   +-----------+
             |
             v
      +-------------+
      |   Failed    |
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
 Retry Again     +------+
                 | Dead |
                 +------+
```

---

# Atomic Job Claiming

QueueCTL guarantees that a job can only be claimed by **one worker**, even when multiple worker processes are running simultaneously.

Instead of performing:

```
SELECT

↓

UPDATE
```

the system claims jobs using **one atomic SQL statement**:

```sql
UPDATE jobs
SET
    state='processing',
    worker_id=?,
    updated_at=?
WHERE id=(
    SELECT id
    FROM jobs
    WHERE ...
    LIMIT 1
)
RETURNING *;
```

SQLite executes this as a single write statement, preventing duplicate job execution across separate OS processes.

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

## Installation

```bash
git clone <repository-url>
cd queuectl
npm install
npm link
```
# Running

Start workers:

```bash
queuectl worker start --count 3
```

Add jobs:

```bash
queuectl enqueue '{"id":"job1","command":"echo Hello"}'
```

Check status:

```bash
queuectl status
```

---

# Testing

The implementation has been manually tested for the following scenarios:

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

---

# Future Improvements

Some features intentionally left out to keep the implementation focused:

* Job priorities
* Scheduled jobs (`run_at`)
* Job timeouts
* Job output logging
* Metrics
* Web dashboard
* REST API
* Worker auto-scaling

---


---

