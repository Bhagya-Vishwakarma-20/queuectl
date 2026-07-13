import { getConfig, setConfigDB  } from "../services/config.service.js";
export function registerConfig(program) {
    const config = program
                    .command("config")
                    .description("config operations");
    config
        .command("list")
        .action(()=>{
            console.log(getConfig());
        })
    config
        .command("set")
        .argument("<key>")
        .argument("<value>")
        .action((key, value) => {
            setConfigDB(key,value)
        });
}