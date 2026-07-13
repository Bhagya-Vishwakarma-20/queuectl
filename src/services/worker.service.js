// start workers
import { fork } from "child_process";
import { deleteWorker, getExpiredWorkers } from "../db/workers.db.js";
import { recoverWorkerJobs } from "../db/jobs.db.js";
import { getConfigByKey } from "./config.service.js";
import { registerSupervisor, removeSupervisor, shouldShutdown } from "./supervisor.service.js";
import { requestShutdownForAllSupervisors } from "../db/supervisor.db.js";
const workers = [];
let exitedWorkers = 0;
let shuttingDown = false;
export function startWorkers(count) {
    if (count < 1) throw Error("Count must be greater than 0");
    registerSupervisor(count);
    for (let i = 0; i < count; i++) {
        //start worker
        const child = fork("./src/worker/worker.js");
        workers.push(child);
        // listing each worker for exit
        child.on("exit", code => {
            console.log(`Worker exited ${child.pid} code ${code}`);
            exitedWorkers++;
            if (shuttingDown && exitedWorkers === workers.length) {
                /// actual exit of the program
                removeSupervisor();
                console.log("All workers exited.");
                process.exit(0);
            }
        });
    }
    // parent checking for killed workers and recovery of jobs 
    const RECOVERY_INTERVAL = getConfigByKey("recovery-interval");
    const recoveryTimer = setInterval(() => { recoverExpiredJobs(); }, RECOVERY_INTERVAL);
    // checking db for worker stop command 
    const SUPERVISOR_CHECK_INTERVAL = 1000;
    const stopTimer = setInterval(() => {if(shouldShutdown())gracefulShutdown();}, SUPERVISOR_CHECK_INTERVAL);
    function gracefulShutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("Gracefully shutting down...");
        clearInterval(recoveryTimer);
        clearInterval(stopTimer);
        for (const worker of workers) {
            worker.send({ type: "shutdown" });
        }
    }
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
}
//  recover jobs from killed worker
export function recoverExpiredJobs() {
    const WORKER_TIMEOUT = getConfigByKey("worker-timeout");
    try {
        const cutoff = new Date(Date.now() - WORKER_TIMEOUT).toISOString(); // 30s
        const workers = getExpiredWorkers(cutoff);
        for (const worker of workers) {
            const result = recoverWorkerJobs(worker.id);
            deleteWorker(worker.id)
            if (result.changes > 0) {
                console.log(`Recovered ${result.changes} jobs from worker ${worker.id}`);
            }
        }
    } catch (err) {
        console.error(err.message);
    }
}
// worker stop command  ( kill all workers)
export function stopWorkers() {
    requestShutdownForAllSupervisors();
}