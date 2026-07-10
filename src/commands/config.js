import { Command } from "commander";

export function registerConfig(program) {
    const config = program
                    .command("config")
                    .description("config operations");

    config
        .command("set")
        .argument("<key>")
        .argument("<value>")
        .action((key, value) => {
            console.log(key, value);
        });
}