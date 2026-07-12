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
            default_config[row.key] = Number(row.value);
        }
        return default_config;
    }
    catch(err){
        console.log(err.message);
    }
}
export const getConfigByKey = (key)=>{
    try{
        const value = getConfigFromDbByKey(key).value;
        default_config[key] =value;
        return value;
    }
    catch(err){
        console.log(err.message);
    }
}
export function setConfigDB(key , value){
    try{
        setConfigInDB(key , value);
    }
    catch(err){
        console.log(err.message);
    }
}