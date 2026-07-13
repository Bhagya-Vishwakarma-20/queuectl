//one  worker
import { randomUUID } from "crypto";
import process from "process";
import { createWorker, deleteWorker, updateHeartbeat } from "../db/workers.db.js";
import { claimNextPendingJob, markFailed } from "../db/jobs.db.js";
import { executeJob } from "./executer.js";
import { handleFailure, handleSuccess } from "../services/jobs.service.js";

const startWorker = async () => {
    //register
    const workerId = randomUUID();
    const worker = {
        id: workerId,
        pid: process.pid,
        last_heartbeat: new Date().toISOString(),
        started_at: new Date().toISOString()
    };
    try {
        createWorker(worker);
    }
    catch (err) {
        console.error(err.message);
    }
    //heartbeat
    const heartbeatInterval = setInterval(() => {
        updateHeartbeat(workerId);
    }, 5000);
    // shutdown changes running to false
    function shutdown() {
        running = false;
    }
    // process message for shutdown
    process.on("message", (msg) => {
        if (msg.type === "shutdown") shutdown();
    });
    // signals 
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    // loop search for next job and execute it 
    let running = true;
    const POLL_INTERVAL = 1000;
    while (running) {
        const job = claimNextPendingJob(worker.id);
        if (!job) {
            await new Promise(resolve => setTimeout(()=>resolve(), POLL_INTERVAL));
            continue;
        }
        const success = await executeJob(job);
        if (success) handleSuccess(job);
        else handleFailure(job);
    }
    //cleaning
    clearInterval(heartbeatInterval);
    deleteWorker(worker.id);
    process.exit(0)
}
export { startWorker };