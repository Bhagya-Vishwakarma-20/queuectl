import { createSupervisor , deleteSupervisor , isShutdownRequested} from "../db/supervisor.db.js";

export function registerSupervisor(workerCount) {
    createSupervisor({
        pid: process.pid,
        worker_count: workerCount,
        started_at: new Date().toISOString()
    });
}
export function removeSupervisor() {
    deleteSupervisor(process.pid);
}
export function shouldShutdown() {
    return isShutdownRequested(process.pid);
}