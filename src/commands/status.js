import { Command } from "commander";

export function registerStatus(program) {
    program
        .command("status")
        .description("Show queue status")
        .action(() => {
            console.log("Status command");
        });
}