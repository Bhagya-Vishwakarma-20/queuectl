import { enqueueJob } from "../services/queue.service.js";
export function registerEnqueue(program) {
    program
        .command("enqueue")
        .description("Add a new job")
        .argument("<job>", "Job JSON")
        .option("-r, --run-at <runAt>", "Scheduled run time/delay (e.g., '10', '2pm', '2-4-2026 2pm')",null)
        .option("-p, --priority <priority>", "Job priority","0")
        .action((job,options) => {
            try{
                const data = enqueueJob(job,options.priority,options.runAt);
                console.log(data);
            } catch (err) {
                console.error(err.message);
            }
        });
}