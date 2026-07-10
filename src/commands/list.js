import { Command } from "commander";

export function registerList(program) {
    program
        .command("list")
        .description("List jobs")
        .action(() => {
            console.log("List command");
        });
}