// start workers
const workers = [];
import { fork } from "child_process";
import { deleteWorker, getExpiredWorkers } from "../db/workers.db.js";
import { recoverWorkerJobs } from "../db/jobs.db.js";
import { getConfigByKey } from "./config.service.js";
//start worker
export function startWorkers(count) {
    for (let i = 0; i < count; i++) {
        const child = fork("./src/worker/worker.js");
        workers.push(child);
        child.on("exit", code => {
            console.log(`Worker exited ${child.pid} code ${code}`);
        });
    }
    // parent checking for killed workers and recovery of jobs 
    const RECOVERY_INTERVAL = getConfigByKey("recovery-interval");
    setInterval(() => {recoverExpiredJobs();}, RECOVERY_INTERVAL);
    process.on("SIGINT", () => {
        console.log("gracefully shutting down");
        for (const worker of workers) {
            worker.kill("SIGINT");
        }
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        for (const worker of workers) {
            worker.kill("SIGTERM");
        }
        process.exit(0);
    });
}
//  recover jobs from killed worker
const WORKER_TIMEOUT=getConfigByKey("worker-timeout");
export function recoverExpiredJobs() {
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