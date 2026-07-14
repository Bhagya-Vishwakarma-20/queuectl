import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

// adding bash 
const MAX_OUTPUT_BUFFER = 5 * 1024 * 1024;
//this max output buffer is by default is 1mb and most of the jobs exceed it and the exec fails so we increase
async function bash(command) {
    return execAsync(command, {
        shell: "C:\\Program Files\\Git\\bin\\bash.exe",
        maxBuffer: MAX_OUTPUT_BUFFER
    });
}

export async function executeJob(job) {
    try {
        const { stdout, stderr } = await bash(job.command);
        // await bash(`start cmd /k "${job.command}"`);
        return { "success":true,stdout, stderr, exitCode: 0 };
    } catch (err) {
        return {
            "success":false,
            stdout: err.stdout ?? "No error message",
            stderr: err.stderr ?? "No error message",
            exitCode: typeof err.code === "number" ? err.code : 1,
        };
    }
}