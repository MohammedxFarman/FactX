import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {hashPassword} from '../server/security.js';
import {seedAnits,ANITS_SEED} from '../server/anits-seed.js';

// Explicit isolation: this command never targets the normal application data directory.
const dir=path.resolve('data/anits-test');
if(process.env.NODE_ENV==='production')throw new Error('This command is only for the controlled test environment.');
if(!process.env.ANITS_TEST_PASSWORD)throw new Error('Set ANITS_TEST_PASSWORD before seeding. It is never printed or written to an export.');
mkdirSync(dir,{recursive:true});
const marker=path.join(dir,'test-environment.json');
if(existsSync(path.join(dir,'factx.sqlite'))&&!existsSync(marker))throw new Error('Existing unmarked database: refusing to mix test accounts with existing data.');
if(existsSync(marker)&&JSON.parse(readFileSync(marker,'utf8')).seed!==ANITS_SEED)throw new Error('Wrong test environment marker.');
writeFileSync(marker,JSON.stringify({seed:ANITS_SEED,testOnly:true}),{mode:0o600});
const {db}=createApp({dataDir:dir});
try{
 if(db.prepare('SELECT 1 FROM users LIMIT 1').get()){
  const backup=path.resolve('data/anits-backups');mkdirSync(backup,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(backup,`before-seed-${Date.now()}.sqlite`));
 }
 if(!db.prepare("SELECT 1 FROM users WHERE role='ADMIN'").get()){
  const password=randomBytes(24).toString('base64url'),email='anits.test.admin@local.invalid';
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(randomUUID(),'ANITS Test Administrator',email,hashPassword(password),new Date().toISOString());
  writeFileSync(path.join(dir,'administrator-login.json'),JSON.stringify({email,password},null,2),{flag:'wx',mode:0o600});
 }
 const result=await seedAnits(db,{password:process.env.ANITS_TEST_PASSWORD,onProgress:p=>console.log(`Password hashes prepared: ${p.hashed}/${p.total}`)});
 writeFileSync(path.join(dir,'seed-result.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{db.close();}
