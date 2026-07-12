import Database from "better-sqlite3";
import { initializeSchema } from "./schema.db.js";
import path from "path";
import fs from "fs";
const dataDir = path.join(import.meta.dirname, "..", "..", "data");
const db = new Database(path.join(dataDir, "queue.db"));
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL"); //This enables Write-Ahead Logging.
db.pragma("busy_timeout = 5000"); // SQLite waits instead of immediately failing when another writer briefly holds the lock
initializeSchema(db);
export default db;