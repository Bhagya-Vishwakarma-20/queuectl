import { getWorkerCount } from "../db/workers.db.js";
import { randomUUID } from "crypto";
import { createJob , getJobsCountGroupedByState } from "../db/jobs.db.js";
import { getConfig } from "./config.service.js";

// enqueue job
export function enqueueJob(jobPayload){
    const input = JSON.parse(jobPayload);
    if (!input.command)throw new Error("Command is required.");
    const now = new Date().toISOString();
    const config = getConfig();
    const job = {
        id: input.id ?? randomUUID(),
        command: input.command,
        state: "pending",
        attempts: 0,
        max_retries: config.max-retries,
        worker_id: null,
        next_retry_at: null,
        created_at: now,
        updated_at: now,
    };
    createJob(job);
    return {
        success: true,
        job
    };
}
// queue status
export function getQueueStatus() {
    try {
        const counts = getJobsCountGroupedByState();
        const workers = getWorkerCount();
        const result = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            dead: 0,
            workers
        };
        for (const i of counts)result[i.state] = i.count;
        return result;
    } catch (err) {
        throw new Error(err.message);
    }
}