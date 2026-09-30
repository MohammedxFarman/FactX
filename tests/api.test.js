import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createServer } from 'node:http';
import { startExecutionWorker } from '../server/execution.js';

let server,db,base,dir;
const password='Integration-only-password-937';
const state={};

async function service(handler) {
  const server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const result = await handler(req.url, raw ? JSON.parse(raw) : null, req.headers);
      res.writeHead(result.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await run(); }
  finally { for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

async function waitForSubmission(id) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const submission = db.prepare('SELECT * FROM submissions WHERE id=?').get(id);
    if (['evaluated', 'execution_error'].includes(submission.status)) return submission;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Execution worker did not finish within 15 seconds');
}
async function request(url,{body,cookie,method='GET',headers={}}={}) {const r=await fetch(base+'/api'+url,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const contentType=r.headers.get('content-type');const data=contentType?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer());return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function post(url,body,cookie=state.admin){const r=await request(url,{body,cookie,method:'POST'});assert.ok(r.status<300,JSON.stringify(r));return r.data;}
before(async()=>{dir=mkdtempSync(path.join(tmpdir(),'factx-test-'));const app=createApp({dataDir:dir,setupToken:'private-test-setup-token'});db=app.db;server=await new Promise(resolve=>{const s=app.app.listen(0,'127.0.0.1',()=>resolve(s))});base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});});

test('empty database has no demo records; setup is token protected and one-time',async()=>{assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,0);assert.equal((await request('/students')).status,401);assert.equal((await request('/auth/setup',{method:'POST',body:{name:'Test Admin',email:'admin@test.invalid',password,token:'wrong'}})).status,403);const r=await request('/auth/setup',{method:'POST',body:{name:'Test Admin',email:'admin@test.invalid',password,token:'private-test-setup-token'}});assert.equal(r.status,201);assert.equal(r.data.password_hash,undefined);state.admin=r.cookie;assert.equal((await request('/auth/setup',{method:'POST',body:{}})).status,409);assert.equal((await request('/dashboard',{cookie:state.admin})).data.students,0);});
test('administrator configures departments, classes and all four roles',async()=>{state.d1=await post('/departments',{name:'Test Department One',code:'TEST1'});state.d2=await post('/departments',{name:'Test Department Two',code:'TEST2'});state.c1=await post('/classes',{name:'Test Class One',department_id:state.d1.id,semester:1});state.c2=await post('/classes',{name:'Test Class Two',department_id:state.d2.id,semester:1});state.subject=await post('/subjects',{name:'Test Subject',code:'TS1',department_id:state.d1.id});for(const [key,role,department_id,class_id,roll_number]of[['faculty','FACULTY',state.d1.id,null,null],['hod','HOD',state.d1.id,null,null],['s1','STUDENT',state.d1.id,state.c1.id,'TEST-001'],['s2','STUDENT',state.d2.id,state.c2.id,'TEST-002']]){state[key]=await post('/users',{name:`Test ${key}`,email:`${key}@test.invalid`,password,role,department_id,class_id,roll_number});const r=await request('/auth/login',{method:'POST',body:{email:`${key}@test.invalid`,password}});assert.equal(r.status,200);state[key].cookie=r.cookie;}await post('/teaching-assignments',{faculty_id:state.faculty.id,class_id:state.c1.id,subject_id:state.subject.id});});
test('department and student boundaries are enforced across reports and search',async()=>{for(const key of ['s1','faculty','hod']){const r=await request('/students',{cookie:state[key].cookie});assert.deepEqual(r.data.map(s=>s.id),[state.s1.id]);assert.equal((await request(`/students/${state.s2.id}/report`,{cookie:state[key].cookie})).status,404);assert.equal((await request(`/students/${state.s2.id}/report.pdf`,{cookie:state[key].cookie})).status,404);}assert.equal((await request('/users',{cookie:state.s1.cookie})).status,403);assert.equal((await request('/audit',{cookie:state.hod.cookie})).status,403);assert.equal((await request('/departments',{method:'POST',cookie:state.faculty.cookie,body:{name:'Not allowed',code:'NO'}})).status,403);assert.equal((await request('/users',{method:'POST',cookie:state.admin,headers:{Origin:'https://evil.invalid'},body:{}})).status,403);});
test('attendance is scoped, upserted without duplicates, and drives explainable suggestions',async()=>{const body={class_id:state.c1.id,subject_id:state.subject.id,date:'2026-01-05',period:1,records:[{student_id:state.s1.id,status:'present'}]};await post('/attendance',body,state.faculty.cookie);body.records[0].status='absent';await post('/attendance',body,state.faculty.cookie);assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance').get().n,1);const report=(await request(`/students/${state.s1.id}/report`,{cookie:state.s1.cookie})).data;assert.equal(report.analytics.attendance,0);assert.equal(report.analytics.prediction,null);assert.equal(report.analytics.suggestions.length,1);assert.equal((await request('/attendance',{method:'POST',cookie:state.s1.cookie,body})).status,403);body.records[0].student_id=state.s2.id;assert.equal((await request('/attendance',{method:'POST',cookie:state.faculty.cookie,body})).status,400);});
test('quiz answers stay private and grading validates valid options and attempt limits',async()=>{state.quiz=await post('/activities',{kind:'quiz',title:'Test quiz',class_id:state.c1.id,subject_id:state.subject.id,max_marks:10,config:{questions:[{prompt:'Test question',options:['First','Second'],answer:1}]}},state.faculty.cookie);const listed=(await request('/activities',{cookie:state.s1.cookie})).data;assert.equal(listed[0].config.questions[0].answer,undefined);assert.deepEqual((await request('/activities',{cookie:state.s2.cookie})).data,[]);assert.equal((await request(`/activities/${state.quiz.id}/submit`,{method:'POST',cookie:state.s1.cookie,body:{answers:[-1]}})).status,400);const result=await post(`/activities/${state.quiz.id}/submit`,{answers:[listed[0].config.questions[0].options.indexOf('Second')]},state.s1.cookie);assert.equal(result.score,10);assert.equal(result.status,'evaluated');assert.equal((await request(`/activities/${state.quiz.id}/submit`,{method:'POST',cookie:state.s1.cookie,body:{answers:[1]}})).status,400);assert.equal((await request(`/activities/${state.quiz.id}/submissions`,{cookie:state.s2.cookie})).status,404);});
test('lab submissions fail closed when sandbox is unavailable; hidden tests never leak',async()=>{const lab=await post('/activities',{kind:'lab',title:'Private test lab',class_id:state.c1.id,subject_id:state.subject.id,config:{language:'python',testCases:[{input:'secret input',output:'secret output'}]}},state.faculty.cookie);const listed=(await request('/activities',{cookie:state.s1.cookie})).data.find(a=>a.id===lab.id);assert.equal(listed.config.testCases,undefined);const r=await request(`/activities/${lab.id}/submit`,{method:'POST',cookie:state.s1.cookie,body:{content:'print(1)'}});assert.equal(r.status,503);assert.equal(db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(lab.id).n,0);});
test('marks, feedback, module progress and leave use persisted authorized records',async()=>{await post('/marks',{student_id:state.s1.id,subject_id:state.subject.id,title:'Internal assessment',kind:'internal',semester:1,score:35,max_marks:100},state.faculty.cookie);await post('/feedback',{student_id:state.s1.id,content:'Revise the assessed concepts.'},state.faculty.cookie);const module=await post('/activities',{kind:'module',title:'Test learning module',class_id:state.c1.id,subject_id:state.subject.id,config:{}},state.faculty.cookie);await post(`/activities/${module.id}/progress`,{completed:true},state.s1.cookie);const leave=await post('/leave',{start_date:'2026-10-01',end_date:'2026-10-02',reason:'Test leave reason'},state.s1.cookie);assert.equal((await request('/leave/'+leave.id,{method:'PATCH',cookie:state.faculty.cookie,body:{status:'approved'}})).status,200);assert.equal((await request('/leave/'+leave.id,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved',review_note:'Approved for test'}})).status,409);const r=(await request(`/students/${state.s1.id}/report`,{cookie:state.s1.cookie})).data;assert.equal(r.marks.length,1);assert.equal(r.feedback.length,1);assert.equal(r.learning.length,1);assert.equal(r.leave[0].status,'approved');assert.equal(r.analytics.average,35);});
test('private documents cannot be downloaded outside scope and PDFs are real',async()=>{const fd=new FormData();fd.append('name','Private test document');fd.append('kind','academic');fd.append('student_id',state.s1.id);fd.append('file',new Blob(['A private academic document'],{type:'text/plain'}),'record.txt');const doc=await post('/documents',fd);assert.equal((await request(`/documents/${doc.id}/download`,{cookie:state.s1.cookie})).status,200);assert.equal((await request(`/documents/${doc.id}/download`,{cookie:state.s2.cookie})).status,404);assert.deepEqual((await request('/documents',{cookie:state.s2.cookie})).data,[]);const pdf=await request(`/students/${state.s1.id}/report.pdf`,{cookie:state.hod.cookie});assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,5).toString(),'%PDF-');});
test('assistant does not reveal other students and disabled sessions are revoked',async()=>{const r=await post('/assistant',{message:'Tell me about TEST-002'},state.s1.cookie);assert.ok(!r.answer.includes('Test s2'));assert.ok(r.sources.every(s=>s.student_id===state.s1.id));assert.equal((await request('/users/'+state.s1.id,{method:'PATCH',cookie:state.admin,body:{active:false}})).status,200);assert.equal((await request('/auth/me',{cookie:state.s1.cookie})).status,401);const audit=(await request('/audit',{cookie:state.admin})).data;assert.ok(audit.some(a=>a.action==='document.downloaded'));assert.ok(audit.some(a=>a.action==='report.exported'));assert.ok(audit.some(a=>a.action==='attendance.saved'));});

test('timetable detects conflicts and HOD cannot schedule another department',async()=>{await request('/users/'+state.s1.id,{method:'PATCH',cookie:state.admin,body:{active:true}});state.s1.cookie=(await request('/auth/login',{method:'POST',body:{email:'s1@test.invalid',password}})).cookie;const body={class_id:state.c1.id,subject_id:state.subject.id,faculty_id:state.faculty.id,day_of_week:1,start_time:'09:00',end_time:'10:00',room:'Test room'};await post('/timetable',body,state.hod.cookie);assert.equal((await request('/timetable',{method:'POST',cookie:state.hod.cookie,body:{...body,start_time:'09:30',end_time:'10:30'}})).status,409);assert.equal((await request('/timetable',{method:'POST',cookie:state.hod.cookie,body:{...body,class_id:state.c2.id}})).status,403);assert.equal((await request('/timetable',{cookie:state.s1.cookie})).data.length,1);assert.equal((await request('/timetable',{cookie:state.s2.cookie})).data.length,0);});
test('department announcements, official grades, SGPA and report exports respect scope',async()=>{await post('/announcements',{title:'Department-only notice',content:'Private departmental announcement.',department_id:state.d1.id,audience:'STUDENT'},state.hod.cookie);assert.equal((await request('/announcements',{cookie:state.s1.cookie})).data.length,1);assert.equal((await request('/announcements',{cookie:state.s2.cookie})).data.length,0);await post('/grades',{student_id:state.s1.id,subject_id:state.subject.id,semester:1,grade:'A',grade_points:8,credits:3},state.faculty.cookie);const report=(await request(`/students/${state.s1.id}/report`,{cookie:state.hod.cookie})).data;assert.equal(report.sgpa[0].value,8);assert.equal(report.sgpa[0].credits,3);const csv=await request('/reports/export?format=csv&type=performance',{cookie:state.hod.cookie});assert.equal(csv.status,200);assert.ok(csv.data.toString().includes('TEST-001'));assert.ok(!csv.data.toString().includes('TEST-002'));assert.equal((await request('/reports/export?format=csv',{cookie:state.s1.cookie})).status,403);const pdf=await request('/reports/export?format=pdf&type=attendance',{cookie:state.faculty.cookie});assert.equal(pdf.data.subarray(0,5).toString(),'%PDF-');const risk=await request('/reports/export?format=csv&type=risk',{cookie:state.admin});assert.equal(risk.data.toString().split('\r\n').length,1);});
test('document indexing filters permissions before searching and AI history is private',async()=>{const doc=db.prepare('SELECT id FROM documents WHERE student_id=?').get(state.s1.id);const result=await post(`/knowledge/${doc.id}/index`,{},state.admin);assert.equal(result.chunks,1);assert.equal(result.embedded,false);assert.equal((await request('/knowledge/search?q=private',{cookie:state.s1.cookie})).data.length,1);assert.equal((await request('/knowledge/search?q=private',{cookie:state.s2.cookie})).data.length,0);assert.equal((await request(`/knowledge/${doc.id}/index`,{method:'POST',cookie:state.s1.cookie})).status,403);assert.equal((await request('/ai/status',{cookie:state.admin})).data.mode,'record_lookup');await post('/assistant',{message:'Show my attendance'},state.s1.cookie);assert.ok((await request('/ai/conversations',{cookie:state.s1.cookie})).data.length>0);assert.equal((await request('/ai/conversations',{cookie:state.s2.cookie})).data.length,0);});
test('timed assessments cannot be submitted before start or after server expiry',async()=>{const activity=await post('/activities',{kind:'quiz',title:'Timed quiz',class_id:state.c1.id,subject_id:state.subject.id,config:{durationMinutes:1,questions:[{prompt:'Select the correct option',options:['Correct','Incorrect'],answer:0}]}},state.faculty.cookie);assert.equal((await request(`/activities/${activity.id}/submit`,{method:'POST',cookie:state.s1.cookie,body:{answers:[0]}})).status,400);const started=await post(`/activities/${activity.id}/events`,{event:'assessment.started'},state.s1.cookie);assert.ok(started.session.expires_at);const again=await post(`/activities/${activity.id}/events`,{event:'assessment.started'},state.s1.cookie);assert.equal(again.session.expires_at,started.session.expires_at);db.prepare('UPDATE assessment_sessions SET expires_at=? WHERE activity_id=?').run('2000-01-01T00:00:00.000Z',activity.id);assert.equal((await request(`/activities/${activity.id}/submit`,{method:'POST',cookie:state.s1.cookie,body:{answers:[0]}})).status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=?').get(activity.id).n,0);});
test('individual assessment targeting excludes classmates and support rules use assignments',async()=>{const s3=await post('/users',{name:'Test classmate',email:'classmate@test.invalid',password,role:'STUDENT',department_id:state.d1.id,class_id:state.c1.id,roll_number:'TEST-003'});const cookie=(await request('/auth/login',{method:'POST',body:{email:'classmate@test.invalid',password}})).cookie;const activity=await post('/activities',{kind:'assignment',title:'Individual task',class_id:state.c1.id,subject_id:state.subject.id,student_ids:[state.s1.id],config:{assignmentMode:'individual'}},state.faculty.cookie);assert.ok((await request('/activities',{cookie:state.s1.cookie})).data.some(a=>a.id===activity.id));assert.ok(!(await request('/activities',{cookie})).data.some(a=>a.id===activity.id));assert.equal((await request(`/activities/${activity.id}/submissions`,{cookie})).status,404);assert.equal((await request(`/activities/${activity.id}/submit`,{method:'POST',cookie,body:{content:'Unauthorized'}})).status,404);});
test('institution settings enforce allowed profile fields and persist thresholds',async()=>{assert.equal((await request('/profile',{method:'PATCH',cookie:state.s1.cookie,body:{phone:'12345'}})).status,403);const r=await request('/preferences',{method:'PUT',cookie:state.admin,body:{institutionName:'Test Institution',attendanceThreshold:80,marksThreshold:60,allowStudentPhoneEdit:true,allowStudentBioEdit:false}});assert.equal(r.status,200);assert.equal((await request('/profile',{method:'PATCH',cookie:state.s1.cookie,body:{phone:'12345'}})).status,200);assert.equal((await request('/profile',{method:'PATCH',cookie:state.s1.cookie,body:{bio:'Not permitted'}})).status,403);assert.equal((await request('/profile',{cookie:state.s1.cookie})).data.profile.phone,'12345');const report=(await request(`/students/${state.s1.id}/report`,{cookie:state.s1.cookie})).data;assert.ok(report.analytics.suggestionMethod.includes('80%'));assert.equal((await request('/catalog',{cookie:state.s1.cookie})).data.institutionName,'Test Institution');});

test('assignment and leave attachments enforce ownership, file type and review locks', async () => {
  const upload = (url, cookie, type='text/plain', content='Private attachment') => {
    const form = new FormData();
    form.append('file', new Blob([content], { type }), 'evidence.txt');
    return request(url, { method:'POST', cookie, body:form });
  };
  const activity = await post('/activities', { kind:'assignment', title:'Attachment test', class_id:state.c1.id, subject_id:state.subject.id }, state.faculty.cookie);
  const submission = await post(`/activities/${activity.id}/submit`, { content:'My submitted assignment' }, state.s1.cookie);
  const url = `/submissions/${submission.id}/files`;
  assert.equal((await upload(url, state.s2.cookie)).status, 404);
  assert.equal((await upload(url, state.s1.cookie, 'application/pdf')).status, 400);
  const file = await upload(url, state.s1.cookie);
  assert.equal(file.status, 201);
  assert.equal((await request(`/attachments/${file.data.id}/download`, {cookie:state.faculty.cookie})).status, 200);
  assert.equal((await request(`/attachments/${file.data.id}/download`, {cookie:state.s2.cookie})).status, 404);
  assert.deepEqual((await request(`/attachments?submission_id=${submission.id}`, {cookie:state.s2.cookie})).data, []);
  await request(`/submissions/${submission.id}`, { method:'PATCH', cookie:state.faculty.cookie, body:{score:85} });
  assert.equal((await upload(url, state.s1.cookie)).status, 409);
  const leave = await post('/leave', { start_date:'2026-10-05', end_date:'2026-10-06', reason:'Attachment review test' }, state.s1.cookie);
  assert.equal((await upload(`/leave/${leave.id}/files`, state.s1.cookie)).status, 201);
  await request(`/leave/${leave.id}`, {method:'PATCH',cookie:state.hod.cookie,body:{status:'approved'}});
  assert.equal((await upload(`/leave/${leave.id}/files`, state.s1.cookie)).status, 409);
});

test('configured RAG retrieves authorized evidence and fails clearly when its service fails', async () => {
  const prompts = [];
  let unavailable = false;
  const mock = await service((url, body, headers) => {
    assert.equal(headers.authorization, 'Bearer integration-test-only');
    if (unavailable) return {status:503,body:{error:'Test outage'}};
    if (url === '/api/embed') return {body:{embeddings:body.input.map(() => [1, 0, 0])}};
    if (url === '/api/chat') { prompts.push(body); return {body:{message:{content:'Authorized academic evidence [D1].'}}}; }
    return {status:404,body:{}};
  });
  try {
    await withEnvironment({ OLLAMA_URL:mock.url, OLLAMA_EMBED_MODEL:'test-embed', OLLAMA_CHAT_MODEL:'test-chat', OLLAMA_API_KEY:'integration-test-only' }, async () => {
      const privateDocument = db.prepare('SELECT id FROM documents WHERE student_id=?').get(state.s1.id);
      assert.equal((await post(`/knowledge/${privateDocument.id}/index`, {})).embedded, true);
      const form = new FormData();
      form.append('name','Other department secret'); form.append('kind','academic'); form.append('student_id',state.s2.id);
      form.append('file',new Blob(['OTHER-DEPARTMENT-SECRET: restricted academic evidence'],{type:'text/plain'}),'private.txt');
      const otherDocument = await post('/documents',form);
      await post(`/knowledge/${otherDocument.id}/index`,{});
      const answer = await post('/assistant',{message:'Summarize my academic evidence'},state.s1.cookie);
      assert.equal(answer.mode,'rag');
      assert.ok(answer.sources.some(source=>source.document_id===privateDocument.id));
      assert.ok(answer.sources.every(source=>!source.document_id||source.document_id!==otherDocument.id));
      assert.ok(!JSON.stringify(prompts).includes('OTHER-DEPARTMENT-SECRET'));
      assert.equal(prompts.length,1);
      unavailable = true;
      const beforeCount=db.prepare('SELECT COUNT(*) n FROM ai_conversations').get().n;
      assert.equal((await request('/assistant',{method:'POST',cookie:state.s1.cookie,body:{message:'Summarize my evidence'}})).status,503);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_conversations').get().n,beforeCount);
    });
  } finally { await mock.close(); }
});

test('Judge0 worker grades returned results, hides test data and never scores a service failure', async () => {
  let unavailable=false;
  const sent=[];
  const mock=await service((url,body,headers)=>{
    assert.equal(headers['x-auth-token'],'integration-test-only');
    if(unavailable)return {status:503,body:{error:'Test outage'}};
    if(url==='/languages')return {body:[{id:71,name:'Python (3.8.1)'}]};
    if(url.startsWith('/submissions?')){sent.push(body);return {body:{token:'test-token'}};}
    if(url.startsWith('/submissions/test-token?'))return {body:{status:{id:3,description:'Accepted'},time:'0.01',memory:1024,stdout:'DO-NOT-EXPOSE'}};
    return {status:404,body:{}};
  });
  try {
    await withEnvironment({JUDGE_URL:mock.url,JUDGE_TOKEN:'integration-test-only'},async()=>{
      const stop=startExecutionWorker(db);
      try {
        const lab=await post('/activities',{kind:'lab',title:'Worker integration',class_id:state.c1.id,subject_id:state.subject.id,config:{language:'python',attempts:2,testCases:[{input:'private input',output:'private output'}]}},state.faculty.cookie);
        const submitted=await post(`/activities/${lab.id}/submit`,{content:'print("private output")'},state.s1.cookie);
        const result=await waitForSubmission(submitted.id);
        assert.equal(result.status,'evaluated'); assert.equal(result.score,100);
        assert.equal(sent.length,1); assert.equal(sent[0].enable_network,false);
        assert.ok(sent[0].cpu_time_limit>0); assert.ok(sent[0].memory_limit>0);
        assert.equal(Buffer.from(sent[0].stdin,'base64').toString(),'private input');
        assert.ok(!result.results.includes('private input')); assert.ok(!result.results.includes('DO-NOT-EXPOSE'));
        unavailable=true;
        const failed=await post(`/activities/${lab.id}/submit`,{content:'print(1)'},state.s1.cookie);
        const error=await waitForSubmission(failed.id);
        assert.equal(error.status,'execution_error'); assert.equal(error.score,null);
      } finally {stop();}
    });
  } finally {await mock.close();}
});
