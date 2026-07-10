import { Command } from "commander";

export function registerEnqueue(program) {
    program
        .command("enqueue")
        .description("Add a new job")
        .argument("<job>", "Job JSON")
        .action((job) => {
            console.log("Received Job:");
            console.log(job);
        });
}