import { randomUUID } from "crypto";
import { listJobs, markCompleted, markDead, markFailed } from "../db/jobs.db.js";
import { getConfig } from "./config.service.js";
// list jobs 
export function getJobs(state) {
    try {
        if(state){
            const validStates = ["pending", "processing", "completed", "failed", "dead"];
            if(!validStates.includes(state)){
                throw new Error("Invalid state");
            }
        }
        return listJobs(state);
    }catch (err) {
        throw new Error(err.message);
    }
}
// handle success
export function handleSuccess(job){
    try {
        markCompleted(job.id);
    }
    catch(err){
        console.error(err.message);
    }
}
//handle failure
export function handleFailure(job){
    try {
        const config = getConfig();
        const attempts =  Number(job.attempts)+1; // this time 
        // const max_retries = config["max-retries"]; // if we take from job then new config will not be impact old jobs 
        const max_retries = Number(job["max-retries"]); // new config will not be impact old jobs 
        console.log(job)
        console.log({max_retries})
        if(attempts > max_retries){
            // move to dlq;
            markDead(job.id , attempts);
        }
        else {
            const nextRetryTime = new Date( (Math.pow(config["backoff-base"],attempts))*1000 + Date.now() ).toISOString();
            console.log(config["backoff-base"]);
            markFailed(job.id, attempts, nextRetryTime);
        }
    }
    catch(err){
        console.error(err.message);
    }
}

