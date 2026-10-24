import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './ui-fixture.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const labDraft={kind:'lab',title:'Limiter test',tasks:[{title:'Add',instructions:'Print five.',marks:1,criteria:'Correct output'}],testCases:[{input:'',output:'5',task:0}]};
async function raw(f,route,cookie,body={},headers={}) {
 const response=await fetch(f.base+'/api'+route,{method:'POST',headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),Cookie:cookie||'',...headers},body:body instanceof FormData?body:JSON.stringify(body)});
 return {status:response.status,data:await response.json()};
}
async function gate() {
 const pending=[];let count=0;
 const server=createServer(async(req,res)=>{for await(const chunk of req){void chunk;}count++;pending.push(res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const release=()=>{for(const res of pending.splice(0))res.writeHead(503,{'Content-Type':'application/json'}).end('{}');};
 return {url:`http://127.0.0.1:${server.address().port}`,release,wait:async n=>{for(let i=0;i<500&&count<n;i++)await delay(10);assert.equal(count,n,'Expected requests reached controlled upstream');},close:async()=>{release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
async function identities(f,role,count) {
 const department=f.db.prepare('SELECT department_id FROM classes WHERE id=?').get(f.classroom.id).department_id;
 const cookies=[];
 for(let i=0;i<count;i++){
  const email=`limiter-${role.toLowerCase()}-${i}@test.invalid`;
  await f.request('/users',{name:`Limiter ${role} ${i}`,email,password:f.password,role,department_id:department,...(role==='STUDENT'?{class_id:f.classroom.id,roll_number:`LIMIT-${i}`}:{})},f.admin);
  cookies.push((await f.request('/auth/login',{email,password:f.password})).cookie);
 }
 return cookies;
}

test('auth: 30 writes per IP, shared endpoints, GET exemption, spoof protection and expiry',async t=>{
 const f=await fixture();
 try{
  // Setup consumed the first write; validation failures also consume attempts.
  for(let i=1;i<30;i++)assert.equal((await raw(f,'/auth/login',null,{})).status,400,`allowed write ${i+1}`);
  for(const route of ['/auth/login','/auth/setup','/auth/logout'])assert.equal((await raw(f,route,f.admin,{})).status,429,route);
  assert.equal((await raw(f,'/auth/login',null,{}, {'X-Forwarded-For':'203.0.113.7'})).status,429);
  for(let i=0;i<35;i++)assert.equal((await fetch(f.base+'/api/auth/status')).status,200);
  assert.equal((await fetch(f.base+'/api/health')).status,200);
  t.mock.method(Date,'now',()=>new Date().getTime()+15*60*1000+1000);
  assert.equal((await raw(f,'/auth/login',null,{})).status,400,'expired window accepts requests again');
 }finally{t.mock.restoreAll();await f.close();}
});

for(const kind of ['generation','demo','timetable','practice'])test(`${kind}: per-user and global concurrency limits, rejected-request isolation and failure recovery`,async()=>{
 const f=await fixture(),upstream=await gate();
 const keys=['OLLAMA_URL','OLLAMA_CHAT_MODEL','OLLAMA_VISION_MODEL','JUDGE_URL'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const inFlight=[];
 try{
  const cap={generation:4,demo:4,timetable:2,practice:8}[kind];
  const cookies=await identities(f,kind==='practice'?'STUDENT':'ADMIN',cap+1);
  const drafts=[];
  if(kind==='demo'||kind==='generation')for(const cookie of cookies)drafts.push((await f.request('/assessment-studio',labDraft,cookie)).data);
  if(kind==='practice')for(const cookie of cookies)await f.request(`/activities/${f.lab.id}/events`,{event:'assessment.started'},cookie);
  Object.assign(process.env,{OLLAMA_URL:upstream.url,OLLAMA_CHAT_MODEL:'controlled',OLLAMA_VISION_MODEL:'controlled',JUDGE_URL:upstream.url});
  const request=(i,override=kind)=>{
   if(override==='generation')return raw(f,'/assessment-studio/generate',cookies[i],{prompt:'Create a simple assignment.'});
   if(override==='demo')return raw(f,`/assessment-studio/${drafts[i].id}/demo`,cookies[i],{revision:1,content:'print(5)'});
   if(override==='practice')return raw(f,`/activities/${f.lab.id}/run`,cookies[i],{content:'print(5)'});
   const form=new FormData();form.set('instruction','Read this timetable');form.set('file',new Blob([png],{type:'image/png'}),'timetable.png');
   return raw(f,'/assistant/timetable/drafts',cookies[i],form);
  };
  inFlight.push(request(0));await upstream.wait(1);
  assert.equal((await request(0)).status,429,'same user cannot start another operation');
  assert.equal((await request(0)).status,429,'rejected response must not release active slot');
  if(kind==='generation'||kind==='demo')assert.equal((await request(0,kind==='generation'?'demo':'generation')).status,429,'generation and demos share capacity');
  for(let i=1;i<cap;i++){inFlight.push(request(i));await upstream.wait(i+1);}
  assert.equal((await request(cap)).status,429,'next distinct user exceeds global capacity');
  upstream.release();
  for(const result of await Promise.all(inFlight))assert.equal(result.status,503,'controlled upstream failure');
  // A new user and a previously active user can both enter after failure.
  for(const i of [cap,0]){
   const retry=request(i);inFlight.push(retry);await upstream.wait(cap+(i===cap?1:2));upstream.release();
   assert.equal((await retry).status,503,'retry reaches upstream rather than stale limiter');
  }
 }finally{
  upstream.release();await Promise.allSettled(inFlight);await upstream.close();
  for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
  await f.close();
 }
});
