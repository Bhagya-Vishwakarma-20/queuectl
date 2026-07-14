import db from "./database.js";
//get config
const getConfigSmtm  = db.prepare(`select key , value from config`);
export const getConfigFromDb = ()=>{
    return getConfigSmtm.all();
}
//get config by key
const getConfigByKeySmtm  = db.prepare(`select value from config where key=?`);
export const getConfigFromDbByKey = (key)=>{
    return getConfigByKeySmtm.get(key);
}
//set config
const setConfigSmtm = db.prepare(`
    INSERT INTO config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
`);
export const  setConfigInDB = (key , value)=>{
    try{
        setConfigSmtm.run(key, value);
    }
    catch(err){
        throw err;
    }
}
