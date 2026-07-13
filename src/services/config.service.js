import {  getConfigFromDb, getConfigFromDbByKey, setConfigInDB } from "../db/config.db.js";
let default_config = {
        "max-retries" : 3,
        "backoff-base": 2,
        "recovery-interval":15000,
        "worker-timeout":30000
};
export function getConfig (){
    try{
        const rows = getConfigFromDb();
        for (const row of rows){
            if(default_config[row.key])default_config[row.key] = Number(row.value);
        }
        return default_config;
    }
    catch(err){
        console.error(err.message);
    }
}
export const getConfigByKey = (key)=>{
    try{
        const value = getConfigFromDbByKey(key).value;
        default_config[key] =value;
        return value;
    }
    catch(err){
        console.error(err.message);
    }
}
export function setConfigDB(key , value){
    try{
        if(!default_config[key]){
            throw new Error("Invalid key" + "\n valid keys are: " + Object.keys(default_config).join(", "));   
        }
        setConfigInDB(key , value);
    }
    catch(err){
        console.error(err.message);
    }
}