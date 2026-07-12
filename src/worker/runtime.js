//one  worker
import { randomUUID } from "crypto";
import process from "process";
import { createWorker, deleteWorker, updateHeartbeat } from "../db/workers.db.js";
import { claimNextPendingJob, markFailed } from "../db/jobs.db.js";
import { executeJob } from "./executer.js";
import { setTimeout as sleep } from "timers/promises";
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
        console.log(err.message);
    }
    //heartbeat
    const heartbeatInterval = setInterval(() => {
        updateHeartbeat(workerId);
    }, 5000);
    //actual work
    const POLL_INTERVAL = 1000;
    while(true){
        const job = claimNextPendingJob(worker.id);
        if (!job) {
            await setTimeout(()=>{},POLL_INTERVAL);
            continue;
        }
        const success = await executeJob(job);
        if(success)handleSuccess(job);
        else handleFailure(job);
    }
    //shutdown
    function shutdown() {
        try {
            clearInterval(heartbeatInterval);
            console.log("deleting worker" + worker.id)
            deleteWorker(worker.id);
            console.log("deleted worker" + worker.id)
        } catch (err) {
            console.error(err.message);
        } finally {
            process.exit(0);
        }
    }
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
export { startWorker };