import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {rateLimit} from './write-safety.js';
import {createBackup} from './backups.js';

export const pageNames=['overview','inbox','students','academics','attendance','timetable','assessments','labs','analytics','support','learning','reports','grades','documents','feedback','leave','substitutions','syllabus','monitoring','users','announcements','knowledge','workload','configuration','audit','settings','programs'];
export function createOperations(db){
 db.exec(`CREATE TABLE IF NOT EXISTS usage_counts(day TEXT NOT NULL,page TEXT NOT NULL,role TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,page,role));
 CREATE TABLE IF NOT EXISTS operational_errors(id TEXT PRIMARY KEY,kind TEXT NOT NULL,route TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS backup_runs(name TEXT PRIMARY KEY,created_at TEXT NOT NULL,status TEXT NOT NULL);`);
 const recordError=(kind,route)=>{
  const id=randomUUID();
  db.prepare('DELETE FROM operational_errors WHERE created_at < ?').run(new Date(Date.now()-30*86400000).toISOString());
  db.prepare('INSERT INTO operational_errors VALUES(?,?,?,?)').run(id,kind,String(route).slice(0,160),new Date().toISOString());return id;
 };
 const routes=(app,dataDir)=>{
  app.post('/api/telemetry',rateLimit(db,{name:'telemetry',max:120,windowMs:60000}),(req,res)=>{
   const v=z.discriminatedUnion('type',[
    z.object({type:z.literal('page'),page:z.enum(pageNames)}).strict(),
    z.object({type:z.literal('error'),kind:z.enum(['render','unhandled','network'])}).strict()
   ]).parse(req.body);
   if(v.type==='error')recordError('browser_'+v.kind,'browser');
   else if(process.env.USAGE_ANALYTICS!=='false'){
    db.prepare('DELETE FROM usage_counts WHERE day < ?').run(new Date(Date.now()-90*86400000).toISOString().slice(0,10));
    db.prepare('INSERT INTO usage_counts VALUES(?,?,?,1) ON CONFLICT(day,page,role) DO UPDATE SET count=count+1').run(new Date().toISOString().slice(0,10),v.page,req.user.role);
   }
   res.json({ok:true});
  });
  app.get('/api/operations',(req,res)=>{
   if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});
   res.json({usage:db.prepare('SELECT * FROM usage_counts ORDER BY day DESC LIMIT 1000').all(),errors:db.prepare('SELECT * FROM operational_errors ORDER BY created_at DESC LIMIT 100').all(),backups:db.prepare('SELECT * FROM backup_runs ORDER BY created_at DESC LIMIT 20').all(),backupConfigured:!!process.env.FACTX_BACKUP_DIR,analyticsEnabled:process.env.USAGE_ANALYTICS!=='false'});
  });
  app.post('/api/operations/backup',rateLimit(db,{name:'backup',max:2,windowMs:3600000}),(req,res)=>{
   if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});
   if(!process.env.FACTX_BACKUP_DIR)return res.status(503).json({error:'Configure a private backup directory on the server first.'});
   const result=createBackup(db,dataDir,process.env.FACTX_BACKUP_DIR);db.prepare('INSERT INTO backup_runs VALUES(?,?,?)').run(result.name,result.createdAt,'verified');res.status(201).json(result);
  });
 };
 return {recordError,routes};
}
