import { Command } from "commander";

export function registerWorker(program) {
    const worker = program
        .command("worker")
        .description("Worker operations");

    worker
        .command("start")
        .action(() => {
            console.log("Starting worker...");
        });

    worker
        .command("stop")
        .action(() => {
            console.log("Stopping workers...");
        });
}