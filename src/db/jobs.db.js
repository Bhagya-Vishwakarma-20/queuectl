import db from "./database.js";
// prepared outside the function
// insert job 
const create_job = db.prepare(`
INSERT INTO jobs(
    id,
    command,
    state,
    attempts,
    max_retries,
    created_at,
    updated_at
)
VALUES(
    @id,
    @command,
    @state,
    @attempts,
    @max_retries,
    @created_at,
    @updated_at
)
`);
// create job
export function createJob(job) {
    const existing = getJobById(job.id);
    if (existing) {
        throw new Error(`Job with ID: '${job.id}' already exists.`);
    }
    create_job.run(job);
}
const getJob = db.prepare(`
    SELECT *
    FROM jobs
    WHERE id = ?
`);
export function getJobById(id) {
    return getJob.get(id);
}
// list jobs
const listAll = db.prepare(`
    SELECT *
    FROM jobs
`);
// flag of state 
const listByState = db.prepare(`
    SELECT *
    FROM jobs
    WHERE state = ?
`);
export function listJobs(state) {
    if (state)
        return listByState.all(state);
    return listAll.all();
}
// update job 
const updateState = db.prepare(`
    UPDATE jobs
    SET state=?,updated_at=?
    WHERE id=?
`);
export function updateJobState(id, state) {
    updateState.run(
        state,
        new Date().toISOString(),
        id
    );
}
// delete job
const deleteStmt = db.prepare(`
    DELETE
    FROM jobs
    WHERE id=?
`);
export function deleteJob(id) {
    deleteStmt.run(id);
}
// get jobs groupedby state

const groupByState = db.prepare(`select state ,count(*) as count from jobs group by state;`)

export function getJobsCountGroupedByState() {
    return groupByState.all();
}

// claim next pending job
const claimJobStmt = db.prepare(`
    UPDATE jobs
    SET
        state = 'processing',
        worker_id = ?,
        updated_at = ?
    WHERE id = (
        SELECT id
        FROM jobs
        WHERE (state = 'pending') OR (state='failed' AND next_retry_at <= ?)
        ORDER BY created_at
        LIMIT 1
    )
    AND (
        state = 'pending' OR (state = 'failed' AND next_retry_at <= ?)
    )
    RETURNING *;
`);
export function claimNextPendingJob(workerId) {
    try {
        const now = new Date().toISOString();
        return claimJobStmt.get(workerId, now, now, now) ?? null;
    } catch (err) {
        console.error(err)
        if (err.code === "SQLITE_BUSY") return null;
        throw err;
    }
}
// mark job completed
const markCompletedstmt = db.prepare(`
    UPDATE jobs
    SET
        state='completed',
        worker_id=NULL,
        updated_at=?
    WHERE id=?
`);
export function markCompleted(id) {
    try {
        markCompletedstmt.run(new Date().toISOString(), id);
    }
    catch (err) {
        console.error(err)
        throw err;
    }
}
// mark job failed
const markFailedstmt = db.prepare(`
    UPDATE jobs
    SET
        state='failed',
        attempts = ?,
        updated_at=?,
        next_retry_at=?

    WHERE id=?
`);
export function markFailed(id, attempts, nextRetryTime) {
    try {
        markFailedstmt.run(attempts, new Date().toISOString(), nextRetryTime, id);
    }
    catch (err) {
        console.error(err)
        throw err;
    }
}
// mark job dead;
const markDeadStmt = db.prepare(`
        UPDATE jobs
        SET
            state='dead',
            attempts=?,
            worker_id=NULL,
            updated_at=?
        WHERE id=?
    `)
export function markDead(id, attempts) {
    try {
        markDeadStmt.run(attempts, new Date().toISOString(), id);
    }
    catch (err) {
        console.error(err);
        throw err;
    }
}
// setting worker_id = null and state to  pending for the jobs in which worker is killed ( recovery part)
const recoverWorkerJobsStmt = db.prepare(`
    UPDATE jobs
    SET
    state='pending',
    worker_id=NULL,
    updated_at=?
    WHERE
    (worker_id = ? OR worker_id = (SELECT id FROM workers WHERE pid = ?))
    AND state='processing'
    `)
export function recoverWorkerJobs(workerId){
    try {
        return recoverWorkerJobsStmt.run(
            new Date().toISOString(),
            workerId,
            workerId
        );
    } catch(err){
        throw err;
    }
}
// dlq list command ( listing all dead jobs)
const getDeadJobsSmtm = db.prepare(`
    SELECT *
    FROM jobs
    WHERE state='dead'
    ORDER BY updated_at;
`);
export function getDeadJobs(){
    try{
        return getDeadJobsSmtm.all();
    }
    catch(err){
        console.error(err);
        throw err;
    }
}
// dlq  convert dead job to pending job
const retryDeadJobStmt = db.prepare(`
        UPDATE jobs
        SET
        state='pending',
        attempts=0,
        worker_id=NULL,
        next_retry_at=NULL,
        updated_at=?
        WHERE (id=? AND state='dead')
    `)
export const retryDeadJob = (id)=>{
        try{
            return retryDeadJobStmt.run(new Date().toISOString() , id);
        }
        catch(err){
            console.error(err);
        }
}


