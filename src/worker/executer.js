import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
// adding bash 
async function bash(command) {
    return execAsync(command, {
        shell: "C:\\Program Files\\Git\\bin\\bash.exe"
    });
}

export async function executeJob(job){
    try{
        const result = await bash(job.command);
        // console.log(result);
        // await execAsync(`start cmd /k "${job.command}"`);
        return true;
    }catch(err){
        return false;
    }
}