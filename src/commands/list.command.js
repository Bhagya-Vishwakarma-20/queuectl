import { getJobs } from "../services/jobs.service.js";

export function registerList(program) {
    process.argv = process.argv.map(arg => {
        if (arg === "[--json]") return "--json";
        return arg;
    }); // may be script include [] (just in case)
    program
        .command("list")
        .description("List jobs")
        .option("-s, --state <state>", "Filter jobs by state")
        .option("--json", "Output as JSON")
        .action((options) => {
            try {
                const jobs = getJobs(options.state ?? null);
                if (options.json) {
                    console.log(JSON.stringify(jobs));
                    return;
                }
                console.log(jobs);
            } catch (err) {
                console.error(err.message);
            }
        });
}