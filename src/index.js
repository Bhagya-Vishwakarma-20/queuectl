#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("queuectl")
  .description("Background Job Queue CLI")
  .version("1.0.0");

program
  .command("hello")
  .description("Say hello")
  .action(() => {
    console.log("Hello Backend!");
  });


program.parse();