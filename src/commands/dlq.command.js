import { getDLQJobs, retryDLQJob } from "../services/dlq.service.js";

export function registerDLQ(program) {
    const dlq = program
        .command("dlq")
        .description("dlq operations");

    dlq.command("list")
        .action(() => {
            const data = getDLQJobs();
            console.log(data);
        });

    dlq.command("retry")
        .argument("<id>")
        .action((id) => {
            const data = retryDLQJob(id);
            data?console.log(data):null;
        });
}