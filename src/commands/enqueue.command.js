import { enqueueJob } from "../services/queue.service.js";
export function registerEnqueue(program) {
    program
        .command("enqueue")
        .description("Add a new job")
        .argument("<job>", "Job JSON")
        .action((jobPayload) => {
             try {
                const data = enqueueJob(jobPayload);
                console.log(data);
            } catch (err) {
                console.error(err.message);
            }
        });
        
}