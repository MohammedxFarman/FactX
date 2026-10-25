import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {ANITS_SEED} from '../server/anits-seed.js';
const dir=path.resolve('data/anits-test');
if(!existsSync(path.join(dir,'test-environment.json'))||JSON.parse(readFileSync(path.join(dir,'test-environment.json'),'utf8')).seed!==ANITS_SEED)throw new Error('Run scripts/seed-anits.mjs first.');
if(process.env.NODE_ENV==='production')throw new Error('The synthetic environment is disabled in production.');
if(process.argv.includes('--disable-accounts')){
 const {db}=createApp({dataDir:dir});
 try{db.exec('BEGIN IMMEDIATE');db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM academic_test_accounts WHERE seed=?)').run(ANITS_SEED);db.prepare('UPDATE academic_sections SET class_teacher_id=NULL WHERE class_teacher_id IN (SELECT user_id FROM academic_test_accounts WHERE seed=?)').run(ANITS_SEED);db.prepare('UPDATE program_departments SET hod_id=NULL WHERE hod_id IN (SELECT user_id FROM academic_test_accounts WHERE seed=?)').run(ANITS_SEED);const result=db.prepare('UPDATE users SET active=0 WHERE id IN (SELECT user_id FROM academic_test_accounts WHERE seed=?)').run(ANITS_SEED);db.exec('COMMIT');console.log(`Disabled ${result.changes} generated accounts and cleared their teaching/coordinator duties; academic records preserved.`);}finally{db.close();}
}else{
 const env={...process.env,FACTX_DATA_DIR:dir,PORT:'3101',HOST:'127.0.0.1',COOKIE_SECURE:'false',REQUIRE_EMAIL_VERIFICATION:'false',FACTX_API_URL:'http://127.0.0.1:3101'};
 const processes=[spawn(process.execPath,['server/index.js'],{env,stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5175','--strictPort'],{env,stdio:'inherit'})];
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;for(const child of processes)child.kill();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 for(const child of processes)child.on('exit',code=>{if(!stopping){process.exitCode=code||0;stop();}});
}
