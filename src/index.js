#!/usr/bin/env node
import { Command } from "commander";
import { registerEnqueue } from "./commands/enqueue.command.js";
import { registerStatus } from "./commands/status.command.js";
import { registerList } from "./commands/list.command.js";
import { registerWorker } from "./commands/worker.command.js";
import { registerConfig } from "./commands/config.command.js";
import { registerDLQ } from "./commands/dlq.command.js";
import db from "./db/database.js";
// Initialize 
const program = new Command();
program
  .name("queuectl")
  .description("Background Job Queue CLI")
  .version("1.0.0");

// commands registration
registerEnqueue(program);
registerStatus(program);
registerList(program);
registerWorker(program);
registerConfig(program);
registerDLQ(program);


// parse the commands 
program.parse();