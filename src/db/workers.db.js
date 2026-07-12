import db from "./database.js";
// get Workers count
const getWorkerCountStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM workers
`);
export function getWorkerCount() {
    return getWorkerCountStmt.get().count;
}
// insert worker 
const createWorkerstmt = db.prepare(`
    INSERT INTO workers(
    id,
    pid,
    last_heartbeat,
    started_at
    )
    VALUES(
        @id,
        @pid,
        @last_heartbeat,
        @started_at
    )
    `)
export function createWorker(worker){
    try{
        createWorkerstmt.run(worker);
    }catch(err){
        throw new Error(`Failed to register worker: ${err.message}`);
    }
}
// update heartbeat
const updateHeartbeatStmt = db.prepare(`
        update workers set last_heartbeat = ?
        where id = ?
    `)
export function updateHeartbeat(id){
    try{
        updateHeartbeatStmt.run(
            new Date().toISOString(),
            id
        );
    }catch(err){
        throw err;
    }
}
// delete 
const deleteWorkerStmt = db.prepare(`
        DELETE
        FROM workers
        WHERE id=?
    `)
export function deleteWorker(id){
    try{
        deleteWorkerStmt.run(id);
    }catch(err){
        throw err;
    }
}
// get expired workers 
const getExpiredWorkersStmt = db.prepare(
    `SELECT id
    FROM workers
    WHERE last_heartbeat < ?
    `)
export function getExpiredWorkers(cutoff) {
    try {
        return getExpiredWorkersStmt.all(cutoff);
    } catch (err) {
        throw new Error(err.message);
    }
}


