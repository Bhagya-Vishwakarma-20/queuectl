import { getQueueStatus } from "../services/queue.service.js";
export function registerStatus(program) {
    program
        .command("status")
        .description("Show queue status")
        .action(() => {
            try{
                console.log(getQueueStatus());
            }
            catch(err){
                console.log(err.message);
            }
        });
}