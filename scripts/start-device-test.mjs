import {existsSync,writeFileSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import path from 'node:path';
import {deviceTestWorkspace} from './device-test-workspace.mjs';

const host=process.argv[2];
const addresses=Object.values(networkInterfaces()).flat().filter(a=>a.family==='IPv4'&&!a.internal).map(a=>a.address);
if(!host||!addresses.includes(host)||!(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)))throw new Error('Pass the private Wi-Fi IPv4 address: node scripts/start-device-test.mjs 192.168.x.x');
if(!existsSync('dist/index.html'))throw new Error('Build FactX first: npm run build');
// This explicit local test does not load .env or run external AI/code services.
process.env.COOKIE_SECURE='false';
for(const name of ['OLLAMA_URL','JUDGE_URL'])delete process.env[name];
const dataDir=path.resolve('data/device-test');
const {app,db,manifest}=await deviceTestWorkspace(dataDir);
const url=`http://${host}:3003`;
const loginPath=path.join(dataDir,'DEVICE-TEST-LOGINS.md');
writeFileSync(loginPath,[
  '# FactX private device-test logins','',`Open ${url}/#access on each device connected to the same Wi-Fi.`,
  '', 'Synthetic test workspace only. Share each student login only with its tester; keep staff logins with the organizer.',
  '', '| Role | Name | Email | Password |','| --- | --- | --- | --- |',
  ...manifest.accounts.map(a=>`| ${a.role} | ${a.name} | ${a.email} | ${a.password} |`),
  '', '1. Students: Assessments -> Device Test - Computing Quiz -> Begin quiz. Submit and note the receipt/score.',
  '2. Students: open the written assignment, begin, fill both tasks, wait for Saved, refresh and reopen, then submit.',
  '3. Faculty: open the written assignment, select each student submission, enter task marks and feedback, and save.',
  '4. Students: reopen their submission to verify marks/feedback. Complete both lessons under Study Materials.',
  '5. Admin/Faculty: record attendance in Attendance, then refresh analytics to verify the new records.',
  '', 'Quiz answer key (organizer): HTTPS; SELECT; Queue; 5; Student. Question/option order differs by student.',
  'Ten attempts are allowed per assessment. The quiz timer is 15 minutes. Rehearsal activities have no closing deadline.',
  'AI generation, live code execution and ML predictions are not configured in this isolated workspace.',
  'Keep the laptop powered on and awake. This HTTP browser test does not test PWA installation or native desktop HTTPS requirements.',
].join('\n')+'\n',{mode:0o600});
let server;
try{server=await new Promise((resolve,reject)=>{const s=app.listen(3003,host,()=>resolve(s));s.once('error',reject);});}
catch(error){db.close();throw error;}
console.log(`Device-test workspace ready: ${url}`);
console.log(`Private account sheet: ${loginPath}`);
console.log('Five students, one faculty, one HOD and one administrator. Real workspace unchanged.');
const close=()=>server.close(()=>{db.close();process.exit(0);});
process.once('SIGINT',close);process.once('SIGTERM',close);
