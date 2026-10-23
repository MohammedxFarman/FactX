import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fixture} from './ui-fixture.mjs';
import {personalizedQuestions} from '../server/assessments.js';

const blueprint=(kind='assignment')=>({kind,title:'Five task assessment',description:'Submit evidence for each task.',tasks:Array.from({length:5},(_,i)=>({title:`Task ${i+1}`,instructions:'Demonstrate the requested operation.',marks:2,criteria:'Correct operation and explanation.'})),facultyNotes:'PRIVATE ANSWER KEY',lessons:[],questions:[],testCases:[],sampleTests:[],language:'python'});
test('draft ownership, preview approval, scheduled visibility, work recovery, rubric grading and ordered lessons',async()=>{
 const f=await fixture();
 try{
  const student=(await f.request('/auth/login',{email:'student@redesign.invalid',password:f.password})).cookie;
  const faculty=(await f.request('/auth/login',{email:'faculty@redesign.invalid',password:f.password})).cookie;
  const raw=async(route,body,cookie=faculty,method='POST')=>fetch(f.base+'/api'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  const request=async(route,body,method)=> (await f.request(route,body,faculty,method)).data;
  let d=await request('/assessment-studio',blueprint());
  assert.equal((await raw('/assessment-studio',null,student,'GET')).status,403);
  assert.equal((await raw(`/assessment-studio/${d.id}`,null,f.admin,'GET')).status,404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activities WHERE title=?').get(d.blueprint.title).n,0);
  const schedule={revision:d.revision,class_id:f.classroom.id,subject_id:f.subject.id,startAt:new Date(Date.now()+3600000).toISOString(),deadline:new Date(Date.now()+7200000).toISOString()};
  assert.equal((await raw(`/assessment-studio/${d.id}/publish`,schedule)).status,409);
  const preview=await request(`/assessment-studio/${d.id}/preview`,{revision:d.revision});assert.equal(preview.facultyNotes,undefined);assert.equal(preview.testCases,undefined);
  d=await request(`/assessment-studio/${d.id}`,{revision:d.revision,blueprint:{...d.blueprint,title:'Revised tasks'}},'PATCH');
  assert.equal((await raw(`/assessment-studio/${d.id}/publish`,{...schedule,revision:d.revision})).status,409);
  assert.equal((await raw(`/assessment-studio/${d.id}`,{revision:1,blueprint:blueprint()},faculty,'PATCH')).status,409);
  await request(`/assessment-studio/${d.id}/preview`,{revision:d.revision});
  const published=await request(`/assessment-studio/${d.id}/publish`,{...schedule,revision:d.revision});
  assert.equal((await request(`/assessment-studio/${d.id}/publish`,{...schedule,revision:d.revision})).id,published.id);
  assert.ok(!(await f.request('/activities',null,student)).data.some(a=>a.id===published.id));
  assert.equal((await raw(`/activities/${published.id}/work`,null,student,'GET')).status,404);
  assert.equal((await raw(`/activities/${published.id}/submit`,{content:'early'},student)).status,404);
  const config=JSON.parse(f.db.prepare('SELECT config FROM activities WHERE id=?').get(published.id).config);config.startAt=new Date(Date.now()-1000).toISOString();f.db.prepare('UPDATE activities SET config=? WHERE id=?').run(JSON.stringify(config),published.id);
  const activity=(await f.request('/activities',null,student)).data.find(a=>a.id===published.id);assert.ok(activity);assert.equal(activity.config.facultyNotes,undefined);
  const work=await f.request(`/activities/${published.id}/work`,{content:'My recoverable work',revision:0},student,'PUT');assert.equal(work.data.revision,1);
  assert.equal((await f.request(`/activities/${published.id}/work`,null,student)).data.content,'My recoverable work');
  assert.equal((await raw(`/activities/${published.id}/work`,{content:'stale',revision:0},student,'PUT')).status,409);
  const submission=(await f.request(`/activities/${published.id}/submit`,{content:'Evidence for all tasks'},student)).data;
  assert.equal((await raw(`/submissions/${submission.id}`,{taskScores:[3,2,2,2,2]},faculty,'PATCH')).status,400);
  await request(`/submissions/${submission.id}`,{taskScores:[2,2,0,1,2],feedback:'Task 3 needs more evidence.'},'PATCH');
  const result=(await f.request(`/activities/${published.id}/submissions`,null,student)).data[0];assert.equal(result.score,7);assert.equal(result.results.tasks.length,5);
  const m=await request('/assessment-studio',{...blueprint('module'),tasks:[],lessons:[{title:'First',content:'Learn the basics.'},{title:'Second',content:'Practice the basics.'}]});
  await request(`/assessment-studio/${m.id}/preview`,{revision:m.revision});const module=await request(`/assessment-studio/${m.id}/publish`,{...schedule,revision:m.revision,startAt:new Date().toISOString()});
  assert.equal((await raw(`/activities/${module.id}/lessons/1`,{},student)).status,400);
  assert.equal((await raw(`/activities/${module.id}/progress`,{completed:true},student)).status,400);
  await f.request(`/activities/${module.id}/lessons/0`,{},student);await f.request(`/activities/${module.id}/lessons/1`,{},student);
  assert.deepEqual((await f.request(`/activities/${module.id}/lessons`,null,student)).data,[0,1]);
  assert.ok(f.db.prepare('SELECT completed_at FROM learning_progress WHERE activity_id=?').get(module.id).completed_at);
  const q=await request('/assessment-studio',{...blueprint('quiz'),tasks:[{...blueprint().tasks[0],marks:2},{...blueprint().tasks[1],marks:5}],questions:[{prompt:'First?',options:['A','B'],answer:0},{prompt:'Second?',options:['C','D'],answer:1}]});
  await request(`/assessment-studio/${q.id}/preview`,{revision:q.revision});const quiz=await request(`/assessment-studio/${q.id}/publish`,{...schedule,revision:q.revision,startAt:new Date().toISOString()});
  const qc=JSON.parse(f.db.prepare('SELECT config FROM activities WHERE id=?').get(quiz.id).config),ordered=personalizedQuestions(qc.questions,f.student.id,quiz.id);
  const graded=(await f.request(`/activities/${quiz.id}/submit`,{answers:ordered.map(q=>q.taskIndex===1?q.answer:1-q.answer)},student)).data;assert.equal(graded.score,5);
  const lab=await request('/assessment-studio',{...blueprint('lab'),tasks:blueprint().tasks.slice(0,2),testCases:[{input:'2 3',output:'5',task:0},{input:'3 2',output:'5',task:1}]});
  const demo=await request(`/assessment-studio/${lab.id}/demo`,{revision:lab.revision,content:'print(5)'});assert.equal(demo.tasks.reduce((n,t)=>n+t.score,0),4);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions').get().n,2,'demo does not create submissions');
  await request(`/assessment-studio/${lab.id}/preview`,{revision:lab.revision});const liveLab=await request(`/assessment-studio/${lab.id}/publish`,{...schedule,revision:lab.revision,startAt:new Date().toISOString()});
  const code=(await f.request(`/activities/${liveLab.id}/submit`,{content:'print(5)'},student)).data;
  let evaluated;for(let i=0;i<40;i++){evaluated=f.db.prepare('SELECT * FROM submissions WHERE id=?').get(code.id);if(evaluated.status==='evaluated')break;await new Promise(r=>setTimeout(r,200));}
  assert.equal(evaluated.score,4);assert.deepEqual(JSON.parse(evaluated.results).tasks.map(t=>t.score),[2,2]);
  assert.ok(!JSON.stringify((await f.request('/activities',null,student)).data.find(a=>a.id===liveLab.id)).includes('PRIVATE ANSWER KEY'));
 }finally{await f.close();}
});

test('AI generation and revision use private source material, validate output and never publish',async()=>{
 const f=await fixture();const previous={url:process.env.OLLAMA_URL,model:process.env.OLLAMA_CHAT_MODEL};let invalid=false,last;
 const model=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;last=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:invalid?'not JSON':JSON.stringify(blueprint())}}));});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));process.env.OLLAMA_URL=`http://127.0.0.1:${model.address().port}`;process.env.OLLAMA_CHAT_MODEL='controlled-studio-model';
 try{
  const form=new FormData();form.set('prompt','Generate five tasks worth two marks each.');form.set('source',new Blob(['Private reference material'],{type:'text/plain'}),'notes.txt');
  const r=await fetch(f.base+'/api/assessment-studio/generate',{method:'POST',headers:{Cookie:f.admin},body:form});assert.equal(r.status,201);const d=await r.json();
  assert.ok(last.messages[1].content.includes('Private reference material'));assert.equal(d.blueprint.tasks.length,5);assert.equal(d.activity_id,null);
  const before=f.db.prepare('SELECT COUNT(*) n FROM activities').get().n;
  const revise=new FormData();revise.set('prompt','Improve the task wording.');revise.set('draftId',d.id);revise.set('revision',String(d.revision));invalid=true;
  assert.equal((await fetch(f.base+'/api/assessment-studio/generate',{method:'POST',headers:{Cookie:f.admin},body:revise})).status,503);
  assert.equal(f.db.prepare('SELECT revision FROM assessment_drafts WHERE id=?').get(d.id).revision,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM activities').get().n,before);
  delete process.env.OLLAMA_CHAT_MODEL;assert.equal((await fetch(f.base+'/api/assessment-studio/generate',{method:'POST',headers:{Cookie:f.admin},body:form})).status,503);
 }finally{if(previous.url===undefined)delete process.env.OLLAMA_URL;else process.env.OLLAMA_URL=previous.url;if(previous.model===undefined)delete process.env.OLLAMA_CHAT_MODEL;else process.env.OLLAMA_CHAT_MODEL=previous.model;await new Promise(r=>model.close(r));await f.close();}
});
