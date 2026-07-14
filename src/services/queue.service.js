import { getWorkerCount } from "../db/workers.db.js";
import { randomUUID } from "crypto";
import { createJob , getJobsCountGroupedByState } from "../db/jobs.db.js";
import { getConfig } from "./config.service.js";
// enqueue job
function runAtToDate(runAtRaw) {
    if (runAtRaw === undefined || runAtRaw === null) {
        return null;
    }
    const raw = String(runAtRaw).trim();
    if (!raw || raw === "0") {
        return null;
    }

    // 1. Check if it is just a number
    if (/^\d+$/.test(raw)) {
        const seconds = parseInt(raw, 10);
        const date = new Date();
        date.setSeconds(date.getSeconds() + seconds);
        return date.toISOString();
    }

    // 2. Parse time (am/pm) if present
    const timeMatch = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    
    // 3. Parse date if present
    // Support DD-MM-YYYY or YYYY-MM-DD
    let dateMatch = raw.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    let year, month, day;
    if (dateMatch) {
        day = parseInt(dateMatch[1], 10);
        month = parseInt(dateMatch[2], 10);
        year = parseInt(dateMatch[3], 10);
    } else {
        dateMatch = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (dateMatch) {
            year = parseInt(dateMatch[1], 10);
            month = parseInt(dateMatch[2], 10);
            day = parseInt(dateMatch[3], 10);
        }
    }

    if (timeMatch) {
        const hour = parseInt(timeMatch[1], 10);
        const minute = parseInt(timeMatch[2] || "0", 10);
        const period = timeMatch[3].toLowerCase();

        let hour24 = hour;
        if (period === "pm" && hour < 12) {
            hour24 += 12;
        } else if (period === "am" && hour === 12) {
            hour24 = 0;
        }

        const date = new Date();
        if (year !== undefined && month !== undefined && day !== undefined) {
            date.setFullYear(year, month - 1, day);
        }
        date.setHours(hour24, minute, 0, 0);
        return date.toISOString();
    }

    // 4. Fallback to standard Date parsing if possible
    const parsedTime = Date.parse(raw);
    if (!isNaN(parsedTime)) {
        return new Date(parsedTime).toISOString();
    }

    throw new Error(`Invalid run-at format: "${runAtRaw}". Expected seconds, time today (e.g. "2pm"), or date-time (e.g. "2-4-2026 2pm").`);
}

export function enqueueJob(jobPayload,priorityRaw,runAtRaw){
    const runAt = runAtToDate(runAtRaw);
    const priority = Number(priorityRaw);
    const input = JSON.parse(jobPayload);
    if (!input.command)throw new Error("Command is required.");
    const now = new Date().toISOString();
    const config = getConfig();
    const job = {
        id: input.id ?? randomUUID(),
        command: input.command,
        state: "pending",
        attempts: 0,
        max_retries: config["max-retries"],
        worker_id: null,
        next_retry_at: null,
        created_at: now,
        updated_at: now,
        priority:priority,
        run_at: runAt
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