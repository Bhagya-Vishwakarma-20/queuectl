import { getDeadJobs, retryDeadJob } from "../db/jobs.db.js";
export function getDLQJobs(){
    try {
        const jobs = getDeadJobs();
        return jobs;
    }
    catch(err){
        console.error(err.message);
    }
}
export function retryDLQJob(id){
    try{
        retryDeadJob(id);
    }
    catch(err){
        console.error(err.message);
    }
}