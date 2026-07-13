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
        if(result.stdout != '')console.log(result.stdout);
        else if(result.stderr != '')console.log(result.stderr);
        else console.log('No output from this command ')
        // await execAsync(`start cmd /k "${job.command}"`);
        return true;
    }catch(err){
        return false;
    }
}