import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {startExecutionWorker} from '../server/execution.js';

test('Judge0 failures and redirects cannot become results or forward private submissions', async t => {
  const previous = {JUDGE_URL:process.env.JUDGE_URL,JUDGE_TOKEN:process.env.JUDGE_TOKEN};
  const directory = mkdtempSync(path.join(tmpdir(),'factx-judge0-boundaries-'));
  let mode='internal-error', redirectedRequests=0, stop=()=>{};
  const destination=createServer(async(req,res)=>{
    redirectedRequests++;
    for await(const chunk of req) void chunk;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({token:'redirected-token'}));
  });
  await new Promise(resolve=>destination.listen(0,'127.0.0.1',resolve));
  const upstream=createServer(async(req,res)=>{
    for await(const chunk of req) void chunk;
    res.setHeader('Content-Type','application/json');
    if(req.url==='/languages')return res.end(JSON.stringify([{id:71,name:'Python (3.12)'}]));
    if(req.method==='POST'){
      if(mode==='redirect'){
        res.writeHead(307,{Location:`http://127.0.0.1:${destination.address().port}/unexpected`});
        return res.end();
      }
      return res.end(JSON.stringify({token:'test-token'}));
    }
    res.end(JSON.stringify({status:mode==='internal-error'?{id:13,description:'Internal Error'}:{id:3,description:'Accepted'},stdout:Buffer.from('5\n').toString('base64'),time:'0.01',memory:1024}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  process.env.JUDGE_URL=`http://127.0.0.1:${upstream.address().port}`;
  process.env.JUDGE_TOKEN='synthetic-test-token';
  const {app,db}=createApp({dataDir:directory,setupToken:'judge0-boundary-test-setup'});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const request=async(route,body,cookie)=>{
    const response=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const password='Synthetic-judge0-test-928';
    const admin=(await request('/auth/setup',{name:'Sandbox Test Admin',email:'admin@sandbox.invalid',password,token:'judge0-boundary-test-setup'})).cookie;
    const post=async(route,body)=>{const result=await request(route,body,admin);assert.ok(result.status<300,JSON.stringify(result.data));return result.data;};
    const dept=await post('/departments',{name:'Sandbox Test Department',code:'SBT'});
    const classroom=await post('/classes',{name:'Sandbox Test Class',department_id:dept.id,semester:1});
    const subject=await post('/subjects',{name:'Sandbox Test Subject',code:'SBTS',department_id:dept.id});
    await post('/users',{name:'Sandbox Test Student',email:'student@sandbox.invalid',password,role:'STUDENT',department_id:dept.id,class_id:classroom.id,roll_number:'SYNTHETIC-SBT-1'});
    const student=(await request('/auth/login',{email:'student@sandbox.invalid',password})).cookie;
    const lab=await post('/activities',{kind:'lab',title:'Sandbox boundary test',class_id:classroom.id,subject_id:subject.id,config:{language:'python',attempts:3,testCases:[{input:'PRIVATE-TEST-INPUT',output:'PRIVATE-TEST-OUTPUT'}]}});

    await t.test('practice reports infrastructure errors as unavailable without consuming an attempt',async()=>{
      mode='internal-error';
      const result=await request(`/activities/${lab.id}/run`,{content:'print(5)'},student);
      assert.equal(result.status,503);
      assert.match(result.data.error,/sandbox could not finish/i);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM submissions').get().n,0);
    });
    await t.test('practice rejects a submission redirect before forwarding code or authentication',async()=>{
      mode='redirect';redirectedRequests=0;
      const result=await request(`/activities/${lab.id}/run`,{content:'print(5)'},student);
      assert.equal(result.status,503);
      assert.equal(redirectedRequests,0);
    });
    await t.test('grading rejects redirects without forwarding hidden tests or assigning a score',async()=>{
      mode='redirect';redirectedRequests=0;stop=startExecutionWorker(db);
      const submitted=await request(`/activities/${lab.id}/submit`,{content:'print(5)'},student);
      assert.equal(submitted.status,201);
      let result;
      for(let i=0;i<100;i++){
        result=db.prepare('SELECT status,score FROM submissions WHERE id=?').get(submitted.data.id);
        if(['evaluated','execution_error'].includes(result.status))break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(result.status,'execution_error');
      assert.equal(result.score,null);
      assert.equal(redirectedRequests,0);
    });
  }finally{
    stop();
    await new Promise(resolve=>server.close(resolve));
    await new Promise(resolve=>upstream.close(resolve));
    await new Promise(resolve=>destination.close(resolve));
    db.close();
    for(const [key,value] of Object.entries(previous))value===undefined?delete process.env[key]:process.env[key]=value;
  }
});
