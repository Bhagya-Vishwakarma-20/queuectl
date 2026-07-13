// start workers
import { fork } from "child_process";
import { deleteWorker, getExpiredWorkers } from "../db/workers.db.js";
import { recoverWorkerJobs } from "../db/jobs.db.js";
import { getConfigByKey } from "./config.service.js";
const workers = [];
let exitedWorkers = 0;
let shuttingDown = false;
export function startWorkers(count) {
    for (let i = 0; i < count; i++) {
        //start worker
        const child = fork("./src/worker/worker.js");
        workers.push(child);
        child.on("exit", code => {
            console.log(`Worker exited ${child.pid} code ${code}`);
            exitedWorkers++;
            if (shuttingDown && exitedWorkers === workers.length) {
                console.log("All workers exited.");
                process.exit(0);
            }
        });
    }
    // parent checking for killed workers and recovery of jobs 
    const RECOVERY_INTERVAL = getConfigByKey("recovery-interval");
    const recoveryTimer = setInterval(() => { recoverExpiredJobs(); }, RECOVERY_INTERVAL);
    function gracefulShutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("Gracefully shutting down...");
        clearInterval(recoveryTimer);
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
        const cutoff = new Date(Date.now() - WORKER_TIMEOUT).toISOString();
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