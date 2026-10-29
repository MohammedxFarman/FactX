import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,copyFileSync,cpSync,existsSync,readFileSync,writeFileSync,readdirSync,lstatSync,renameSync,realpathSync} from 'node:fs';
import path from 'node:path';

function inventory(root,relative=''){
 const result=[];
 for(const name of readdirSync(path.join(root,relative))){
  if(!relative&&name==='manifest.json')continue;
  const file=path.join(relative,name),absolute=path.join(root,file),stat=lstatSync(absolute);
  if(stat.isSymbolicLink())throw new Error('Backup data must not contain symbolic links');
  if(stat.isDirectory())result.push(...inventory(root,file));
  else if(stat.isFile())result.push({file,sha256:createHash('sha256').update(readFileSync(absolute)).digest('hex')});
 }
 return result.sort((a,b)=>a.file.localeCompare(b.file));
}
export function verifyBackup(directory){
 const root=path.resolve(directory),manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(manifest.version!==1||JSON.stringify(manifest.files)!==JSON.stringify(inventory(root)))throw new Error('Backup integrity check failed');
 const db=new DatabaseSync(path.join(root,'factx.sqlite'),{readOnly:true});
 try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup database validation failed');}finally{db.close();}
 return manifest;
}
// Synchronous snapshot + upload copy: no request handler/worker can mutate data
// between these operations in the supported single-process deployment.
export function createBackup(db,dataDir,backupDir){
 const data=path.resolve(dataDir),destination=path.resolve(backupDir);
 const within=(root,target)=>{const relative=path.relative(root,target);return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
 if(within(data,destination))throw new Error('Backup directory must be outside the runtime data directory');
 mkdirSync(destination,{recursive:true,mode:0o700});
 if(within(realpathSync(data),realpathSync(destination)))throw new Error('Backup directory must be outside the runtime data directory');
 const name=`factx-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`;
 const staging=path.join(destination,'.pending-'+name),final=path.join(destination,name);
 mkdirSync(staging,{mode:0o700});
 db.prepare('VACUUM INTO ?').run(path.join(staging,'factx.sqlite'));
 if(existsSync(path.join(data,'uploads')))cpSync(path.join(data,'uploads'),path.join(staging,'uploads'),{recursive:true,dereference:false});
 writeFileSync(path.join(staging,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),files:inventory(staging)},null,2),{mode:0o600});
 verifyBackup(staging);renameSync(staging,final);return {name,createdAt:new Date().toISOString()};
}
export function restoreBackup(source,target){
 const destination=path.resolve(target);
 if(existsSync(destination))throw new Error('Restore target must be a new directory; existing data is never overwritten');
 verifyBackup(source);mkdirSync(destination,{recursive:true,mode:0o700});
 copyFileSync(path.join(source,'factx.sqlite'),path.join(destination,'factx.sqlite'));
 if(existsSync(path.join(source,'uploads')))cpSync(path.join(source,'uploads'),path.join(destination,'uploads'),{recursive:true});
 return destination;
}
export function startBackups(db,dataDir){
 if(!process.env.FACTX_BACKUP_DIR)return()=>{};
 const hours=Number(process.env.BACKUP_INTERVAL_HOURS||24);
 if(!Number.isFinite(hours)||hours<1||hours>168)throw new Error('BACKUP_INTERVAL_HOURS must be between 1 and 168');
 const timer=setInterval(()=>{try{const result=createBackup(db,dataDir,process.env.FACTX_BACKUP_DIR);db.prepare('INSERT INTO backup_runs VALUES(?,?,?)').run(result.name,result.createdAt,'verified');}catch{db.prepare('INSERT INTO operational_errors VALUES(?,?,?,?)').run(randomUUID(),'backup_failed','scheduler',new Date().toISOString());}},hours*3600000);
 timer.unref();return()=>clearInterval(timer);
}
