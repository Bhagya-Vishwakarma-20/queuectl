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

# 5. If priorities were added tomorrow, what survives and what changes?

Most of the architecture remains unchanged.

## Unchanged

- CLI
- Service layer
- Worker runtime
- Crash recovery
- Dead Letter Queue
- Retry logic
- Supervisor architecture
- Database structure

Only the job selection query changes.

Current query:

```sql
ORDER BY created_at
```

would become:

```sql
ORDER BY priority DESC, created_at ASC
```

Higher priority jobs would therefore be claimed first while preserving FIFO ordering among jobs with equal priority.

No changes would be required in:

- worker execution
- graceful shutdown
- heartbeat
- recovery
- retry logic
- DLQ
- configuration system

This demonstrates why the project separates job selection from job execution.

Adding priorities only changes the scheduling policy rather than the rest of the system.

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