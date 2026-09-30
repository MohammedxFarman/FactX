import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

const state = {}, password = 'Hod-duty-test-password-2026';
let server, db, dir, base;
async function request(route, { method='GET', body, cookie=state.admin }={}) {
  const response = await fetch(base+'/api'+route, {
    method, headers:{'Content-Type':'application/json', ...(cookie?{Cookie:cookie}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const data=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function post(route, body, cookie=state.admin) {
  const result=await request(route,{method:'POST',body,cookie});
  assert.ok(result.status<300,JSON.stringify(result.data));
  return result.data;
}
before(async()=>{
  dir=mkdtempSync(path.join(tmpdir(),'factx-hod-'));
  const instance=createApp({dataDir:dir,setupToken:'hod-duty-test-token'});
  db=instance.db;
  server=await new Promise(resolve=>{const listening=instance.app.listen(0,'127.0.0.1',()=>resolve(listening))});
  base=`http://127.0.0.1:${server.address().port}`;
  state.admin=(await request('/auth/setup',{method:'POST',cookie:null,body:{name:'HOD Test Admin',email:'admin@hod.test',password,token:'hod-duty-test-token'}})).cookie;
  state.d1=await post('/departments',{name:'Own department',code:'OWN'});
  state.d2=await post('/departments',{name:'Other department',code:'OTHER'});
  for(const number of [1,2]) {
    state['c'+number]=await post('/classes',{name:`Class ${number}`,department_id:state['d'+number].id,semester:1});
    state['subject'+number]=await post('/subjects',{name:`Subject ${number}`,code:`SUB${number}`,department_id:state['d'+number].id});
    for(const role of ['FACULTY','STUDENT',...(number===1?['HOD']:[])]) {
      const key=role.toLowerCase()+number;
      const email=`${key}@hod.test`;
      state[key]=await post('/users',{name:`Test ${key}`,email,password,role,department_id:state['d'+number].id,
        ...(role==='STUDENT'?{class_id:state['c'+number].id,roll_number:`STU${number}`}:{})});
      state[key].cookie=(await request('/auth/login',{method:'POST',cookie:null,body:{email,password}})).cookie;
    }
    state['assignment'+number]=await post('/teaching-assignments',{faculty_id:state['faculty'+number].id,class_id:state['c'+number].id,subject_id:state['subject'+number].id});
    state['leave'+number]=await post('/leave',{start_date:'2026-10-01',end_date:'2026-10-02',reason:`Private department ${number} leave`},state['student'+number].cookie);
  }
  const teaching={class_id:state.c1.id,subject_id:state.subject1.id};
  await post('/attendance',{...teaching,date:'2026-01-05',period:1,records:[{student_id:state.student1.id,status:'absent'}]},state.faculty1.cookie);
  await post('/marks',{student_id:state.student1.id,subject_id:state.subject1.id,title:'Recorded mark',kind:'internal',semester:1,score:40,max_marks:100},state.faculty1.cookie);
  state.activity=await post('/activities',{...teaching,kind:'assignment',title:'Faculty assignment'},state.faculty1.cookie);
  state.submission=await post(`/activities/${state.activity.id}/submit`,{content:'Submitted work'},state.student1.cookie);
});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true})});

test('HOD overview includes only its department and actual pending work',async()=>{
  const result=await request('/department-overview',{cookie:state.hod1.cookie});
  assert.equal(result.status,200);
  assert.equal(result.data.department.id,state.d1.id);
  assert.equal(result.data.students,1); assert.equal(result.data.faculty,1); assert.equal(result.data.classes,1);
  assert.equal(result.data.attendance,0); assert.equal(result.data.average,40);
  assert.equal(result.data.pendingLeaves,1); assert.equal(result.data.pendingEvaluations,1);
  assert.equal(result.data.supportCount,1);
  assert.deepEqual(result.data.leaveQueue.map(leave=>leave.id),[state.leave1.id]);
  assert.deepEqual(result.data.classOverview.map(classroom=>classroom.id),[state.c1.id]);
  assert.ok(!JSON.stringify(result.data).includes('Private department 2'));
  for(const cookie of [state.student1.cookie,state.faculty1.cookie]) assert.equal((await request('/department-overview',{cookie})).status,403);
});

test('HOD cannot author activities or change attendance, marks, grades, or evaluations',async()=>{
  for(const kind of ['assignment','quiz','lab','module']) {
    assert.equal((await request('/activities',{method:'POST',cookie:state.hod1.cookie,body:{kind,title:'HOD cannot publish',class_id:state.c1.id,subject_id:state.subject1.id}})).status,403);
  }
  for(const route of ['/attendance','/marks','/grades',`/activities/${state.activity.id}/files`]) {
    assert.equal((await request(route,{method:'POST',cookie:state.hod1.cookie,body:{}})).status,403);
  }
  assert.equal((await request(`/submissions/${state.submission.id}`,{method:'PATCH',cookie:state.hod1.cookie,body:{score:99}})).status,403);
  assert.equal(db.prepare('SELECT score FROM submissions WHERE id=?').get(state.submission.id).score,null);
  assert.equal((await request('/activities',{cookie:state.hod1.cookie})).status,200);
  assert.equal((await request(`/activities/${state.activity.id}/submissions`,{cookie:state.hod1.cookie})).data.length,1);
  assert.equal((await request('/grades',{cookie:state.hod1.cookie})).status,200);
});

test('HOD coordinates faculty assignments only within its department',async()=>{
  const classroom=await post('/classes',{name:'New own class',department_id:state.d1.id,semester:1});
  const assignment=await post('/teaching-assignments',{faculty_id:state.faculty1.id,class_id:classroom.id,subject_id:state.subject1.id},state.hod1.cookie);
  assert.equal((await request(`/teaching-assignments/${assignment.id}`,{method:'DELETE',cookie:state.hod1.cookie})).status,200);
  assert.equal((await request('/teaching-assignments',{method:'POST',cookie:state.hod1.cookie,body:{faculty_id:state.faculty2.id,class_id:state.c2.id,subject_id:state.subject2.id}})).status,403);
  assert.equal((await request(`/teaching-assignments/${state.assignment2.id}`,{method:'DELETE',cookie:state.hod1.cookie})).status,404);
  assert.ok(db.prepare('SELECT id FROM teaching_assignments WHERE id=?').get(state.assignment2.id));
});

test('HOD can approve departmental leave, publish announcements and provide guidance',async()=>{
  assert.equal((await request(`/leave/${state.leave1.id}`,{method:'PATCH',cookie:state.hod1.cookie,body:{status:'approved',review_note:'Department approval'}})).status,200);
  assert.equal((await request(`/leave/${state.leave2.id}`,{method:'PATCH',cookie:state.hod1.cookie,body:{status:'approved'}})).status,404);
  await post('/announcements',{title:'Department notice',content:'Teaching coordination notice',department_id:state.d1.id,audience:'ALL'},state.hod1.cookie);
  await post('/feedback',{student_id:state.student1.id,content:'Arrange academic support with your faculty.'},state.hod1.cookie);
  assert.equal((await request('/department-overview',{cookie:state.hod1.cookie})).data.pendingLeaves,0);
});
