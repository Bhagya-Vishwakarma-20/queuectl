import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
export async function executeJob(job){
    try{
        await execAsync(job.command);
        // await execAsync(`start cmd /k "${job.command}"`);
        return true;
    }catch(err){
        return false;
    }
}