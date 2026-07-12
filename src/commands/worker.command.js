import { startWorkers } from "../services/worker.service.js";

export function registerWorker(program) {
    const worker = program
        .command("worker")
        .description("Worker operations");

    worker
        .command("start")
        .option(
            "-c, --count <count>",
            "Number of workers",
            "1"
        )
        .action((options) => {
            try{
                startWorkers(Number(options.count));
            }
            catch(err){
                console.log(err.message);
            }
        });

    worker
        .command("stop")
        .action(() => {
            console.log("Stopping workers...");
        });
}