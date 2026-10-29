import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {createBackup,restoreBackup,verifyBackup} from '../server/backups.js';
import {loadRuntimeEnvironment} from '../server/runtime-config.js';
loadRuntimeEnvironment();
const [command,source,target]=process.argv.slice(2);
if(command==='verify'&&source){verifyBackup(source);console.log('Backup integrity verified.');}
else if(command==='restore'&&source&&target){restoreBackup(source,target);console.log('Backup restored to the new target directory. Start an isolated instance to verify records and attachments.');}
else if(command==='create'&&process.argv.includes('--offline')){
 const data=path.resolve(process.env.FACTX_DATA_DIR||'data'),destination=process.env.FACTX_BACKUP_DIR;
 if(!destination)throw new Error('Set FACTX_BACKUP_DIR outside the data directory. Stop the application before using --offline.');
 const db=new DatabaseSync(path.join(data,'factx.sqlite'));
 try{console.log(createBackup(db,data,destination));}finally{db.close();}
}else{console.error('Usage: node scripts/backup.mjs create --offline | verify BACKUP | restore BACKUP NEW_DIRECTORY');process.exitCode=1;}
