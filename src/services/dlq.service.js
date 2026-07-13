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
        const data = retryDeadJob(id);
        const changes = data.changes;
        if(changes == 0)throw new Error("Either id is wrong or job not present in dlq");
        return `
Job requeued. 
Note: The job will be processed by an available worker. If no workers are running, start one using:
queuectl worker start`;
    }
    catch(err){
        console.error(err.message);
    }
}