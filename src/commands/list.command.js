import { getJobs } from "../services/jobs.service.js";

export function registerList(program) {
    program
        .command("list")
        .description("List jobs")
        .option("-s, --state <state>", "Filter jobs by state")
        .option("--json", "Output as JSON")
        .action((options) => {
            try{
                const jobs = getJobs(options.state ?? null);
                if (options.json) {
                    console.log(JSON.stringify(jobs));
                } else {
                    console.log(jobs);
                }
            }catch(err){
                console.error(err.message);
            }
        });
}