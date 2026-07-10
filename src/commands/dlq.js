import { Command } from "commander";

export function registerDLQ(program) {
    const dlq = program
                    .command("dlq")
                    .description("dlq operations");

    dlq.command("list")
        .action(() => {
            console.log("DLQ List");
        });

    dlq.command("retry")
        .argument("<id>")
        .action((id) => {
            console.log("Retry:", id);
        });
}