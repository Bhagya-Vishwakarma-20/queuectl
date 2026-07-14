import { enqueueJob } from "../services/queue.service.js";
export function registerEnqueue(program) {
    program
        .command("enqueue")
        .description("Add a new job")
        .argument("<job>", "Job JSON")
        .option("-p, --priority <priority>", "Job priority","0")
        .action((job,options) => {
            try{
                const priority = Number(options.priority);
                const data = enqueueJob(job,priority);
                console.log(data);
            } catch (err) {
                console.error(err.message);
            }
        });
}