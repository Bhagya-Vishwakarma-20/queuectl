import db from "./database.js";

const createSupervisorStmt = db.prepare(`
    INSERT INTO supervisors (
        pid,
        worker_count,
        started_at
    )
    VALUES (?, ?, ?)
`);
export function createSupervisor(supervisor) {
    createSupervisorStmt.run(
        supervisor.pid,
        supervisor.worker_count,
        supervisor.started_at
    );
}

const deleteSupervisorStmt = db.prepare(`
        DELETE FROM supervisors
        WHERE pid = ?
    `);

export function deleteSupervisor(pid) {
    deleteSupervisorStmt.run(pid);
}

const requestShutdownStmt = db.prepare(`
        UPDATE supervisors
        SET shutdown_requested = 1
    `);

export function requestShutdownForAllSupervisors() {
    requestShutdownStmt.run();
}

const isShutdownRequestedStmt = db.prepare(`
    SELECT shutdown_requested
    FROM supervisors
    WHERE pid = ?
`);
export function isShutdownRequested(pid) {
    const row = isShutdownRequestedStmt.get(pid);
    if (!row)
        return false;
    return row.shutdown_requested === 1;
}