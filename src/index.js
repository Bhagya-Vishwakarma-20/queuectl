#!/usr/bin/env node
import { Command } from "commander";
import { registerEnqueue } from "./commands/enqueue.js";
import { registerStatus } from "./commands/status.js";
import { registerList } from "./commands/list.js";
import { registerWorker } from "./commands/worker.js";
import { registerConfig } from "./commands/config.js";
import { registerDLQ } from "./commands/dlq.js";
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