import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';

const state={},password='Workflow-test-password-2026';
const sessionDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const weekday=new Date(sessionDate+'T12:00:00Z').getUTCDay();
let server,db,dir,base;
async function request(route,{method='GET',body,cookie=state.admin}={}) {
  const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function post(route,body,cookie=state.admin){const result=await request(route,{method:'POST',body,cookie});assert.ok(result.status<300,JSON.stringify(result.data));return result.data}
before(async()=>{
  dir=mkdtempSync(path.join(tmpdir(),'factx-workflows-'));const instance=createApp({dataDir:dir,setupToken:'workflow-test-token'});db=instance.db;
  server=await new Promise(resolve=>{const listener=instance.app.listen(0,'127.0.0.1',()=>resolve(listener))});base=`http://127.0.0.1:${server.address().port}`;
  state.admin=(await request('/auth/setup',{method:'POST',cookie:null,body:{name:'Workflow Admin',email:'admin@workflow.test',password,token:'workflow-test-token'}})).cookie;
  for(const number of [1,2]) {
    state['d'+number]=await post('/departments',{name:`Department ${number}`,code:`WF${number}`});
    state['c'+number]=await post('/classes',{name:`Class ${number}`,department_id:state['d'+number].id,semester:1});
    state['s'+number]=await post('/subjects',{name:`Subject ${number}`,code:`WFS${number}`,department_id:state['d'+number].id});
  }
  state.extraClass=await post('/classes',{name:'Second class',department_id:state.d1.id,semester:1});
  for(const[key,role,department,classroom]of [['hod','HOD',state.d1],['otherHod','HOD',state.d2],['faculty','FACULTY',state.d1],['cover','FACULTY',state.d1],['busy','FACULTY',state.d1],['otherFaculty','FACULTY',state.d2],['student','STUDENT',state.d1,state.c1],['otherStudent','STUDENT',state.d2,state.c2]]) {
    const email=`${key.toLowerCase()}@workflow.test`;
    state[key]=await post('/users',{name:`Workflow ${key}`,email,password,role,department_id:department.id,...(classroom?{class_id:classroom.id,roll_number:`WF-${key}`}:{})});
    state[key].cookie=(await request('/auth/login',{method:'POST',cookie:null,body:{email,password}})).cookie;
  }
  state.teaching=await post('/teaching-assignments',{faculty_id:state.faculty.id,class_id:state.c1.id,subject_id:state.s1.id});
  await post('/teaching-assignments',{faculty_id:state.busy.id,class_id:state.extraClass.id,subject_id:state.s1.id});
  await post('/teaching-assignments',{faculty_id:state.otherFaculty.id,class_id:state.c2.id,subject_id:state.s2.id});
  state.slot=await post('/timetable',{faculty_id:state.faculty.id,class_id:state.c1.id,subject_id:state.s1.id,day_of_week:weekday,start_time:'09:00',end_time:'10:00'});
  await post('/timetable',{faculty_id:state.busy.id,class_id:state.extraClass.id,subject_id:state.s1.id,day_of_week:weekday,start_time:'09:30',end_time:'10:30'});
});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true})});

test('faculty leave reaches the department HOD and cannot be self-approved',async()=>{
  state.facultyLeave=await post('/leave',{start_date:sessionDate,end_date:sessionDate,reason:'Faculty leave for coverage test'},state.faculty.cookie);
  const queue=(await request('/leave',{cookie:state.hod.cookie})).data;
  assert.equal(queue.find(leave=>leave.id===state.facultyLeave.id).applicant_role,'FACULTY');
  assert.equal((await request('/leave',{cookie:state.otherHod.cookie})).data.length,0);
  assert.equal((await request(`/leave/${state.facultyLeave.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{status:'approved'}})).status,403);
  assert.equal((await request(`/leave/${state.facultyLeave.id}`,{method:'PATCH',cookie:state.otherHod.cookie,body:{status:'approved'}})).status,404);
  assert.equal((await request(`/leave/${state.facultyLeave.id}/substitutions`,{method:'POST',cookie:state.hod.cookie,body:{}})).status,409);
  assert.equal((await request(`/leave/${state.facultyLeave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved',review_note:'Cover will be assigned'}})).status,200);
  assert.equal((await request(`/leave/${state.facultyLeave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'rejected'}})).status,409);
});

test('faculty review only assigned student leave and the decision is recorded once',async()=>{
  const leave=await post('/leave',{start_date:sessionDate,end_date:sessionDate,reason:'Assigned student leave request'},state.student.cookie);
  assert.ok((await request('/notifications',{cookie:state.faculty.cookie})).data.some(notification=>notification.title==='New student leave request'));
  assert.equal((await request(`/leave/${leave.id}`,{method:'PATCH',cookie:state.cover.cookie,body:{status:'approved'}})).status,404);
  assert.equal((await request(`/leave/${leave.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{status:'rejected',review_note:'Attend the scheduled assessment'}})).status,200);
  assert.equal((await request(`/leave/${leave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved'}})).status,409);
  const decision=(await request('/leave',{cookie:state.student.cookie})).data.find(row=>row.id===leave.id);
  assert.equal(decision.status,'rejected');assert.equal(decision.reviewer_name,'Workflow faculty');
  assert.equal(decision.review_note,'Attend the scheduled assessment');
});

test('substitution validates department, session dates, disabled faculty and timetable conflicts',async()=>{
  const url=`/leave/${state.facultyLeave.id}/substitutions`;
  const body={timetable_id:state.slot.id,session_date:sessionDate,substitute_id:state.cover.id};
  const coverage=(await request(`/leave/${state.facultyLeave.id}/coverage`,{cookie:state.hod.cookie})).data;
  assert.equal(coverage.sessions.length,1);
  assert.equal(coverage.sessions[0].candidates.find(member=>member.id===state.busy.id).available,false);
  assert.equal((await request(url,{method:'POST',cookie:state.hod.cookie,body:{...body,substitute_id:state.busy.id}})).status,409);
  assert.equal((await request(url,{method:'POST',cookie:state.hod.cookie,body:{...body,substitute_id:state.otherFaculty.id}})).status,400);
  assert.equal((await request(url,{method:'POST',cookie:state.hod.cookie,body:{...body,substitute_id:state.faculty.id}})).status,400);
  assert.equal((await request(url,{method:'POST',cookie:state.faculty.cookie,body})).status,403);
  await request(`/users/${state.cover.id}`,{method:'PATCH',body:{active:false}});
  assert.equal((await request(url,{method:'POST',cookie:state.hod.cookie,body})).status,409);
  await request(`/users/${state.cover.id}`,{method:'PATCH',body:{active:true}});
  state.cover.cookie=(await request('/auth/login',{method:'POST',cookie:null,body:{email:'cover@workflow.test',password}})).cookie;
  state.substitution=await post(url,body,state.hod.cookie);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM teaching_assignments WHERE faculty_id=?').get(state.cover.id).n,0,'Temporary cover must not become permanent teaching access');
});

test('cover reaches the colleague and students without exposing faculty leave details',async()=>{
  const cover=(await request('/substitutions',{cookie:state.cover.cookie})).data;
  assert.equal(cover.length,1);assert.equal(cover[0].id,state.substitution.id);
  assert.equal((await request('/substitutions',{cookie:state.otherHod.cookie})).data.length,0);
  assert.equal((await request('/substitutions',{cookie:state.otherStudent.cookie})).data.length,0);
  const student=(await request('/substitutions',{cookie:state.student.cookie})).data[0];
  assert.equal(student.substitute_name,'Workflow cover');assert.equal(student.session_date,sessionDate);
  assert.equal(student.leave_id,undefined);assert.equal(student.note,undefined);assert.equal(student.reason,undefined);
  assert.ok((await request('/notifications',{cookie:state.student.cookie})).data.some(notification=>notification.title==='Class teaching cover updated'));
  assert.equal((await request(`/leave/${state.facultyLeave.id}/coverage`,{cookie:state.student.cookie})).status,404);
});

test('a faculty member on approved leave cannot be assigned as substitute',async()=>{
  const leave=await post('/leave',{start_date:sessionDate,end_date:sessionDate,reason:'Covering faculty unavailable'},state.cover.cookie);
  assert.equal((await request(`/leave/${leave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved'}})).status,409,'Existing cover must be reassigned before approving overlapping leave');
  state.backup=await post('/users',{name:'Backup faculty',email:'backup@workflow.test',password,role:'FACULTY',department_id:state.d1.id});
  await post(`/leave/${state.facultyLeave.id}/substitutions`,{timetable_id:state.slot.id,session_date:sessionDate,substitute_id:state.backup.id},state.hod.cookie);
  assert.equal((await request(`/leave/${leave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved'}})).status,200);
  assert.equal((await request(`/leave/${state.facultyLeave.id}/substitutions`,{method:'POST',cookie:state.hod.cookie,body:{timetable_id:state.slot.id,session_date:sessionDate,substitute_id:state.cover.id}})).status,409);
});

test('faculty syllabus progress is weighted by planned hours and protected from other roles',async()=>{
  state.topic=await post('/syllabus/topics',{teaching_assignment_id:state.teaching.id,title:'Completed unit',planned_hours:2,status:'completed'},state.faculty.cookie);
  state.planned=await post('/syllabus/topics',{teaching_assignment_id:state.teaching.id,title:'Upcoming unit',planned_hours:6,target_date:'2026-01-01',status:'planned'},state.faculty.cookie);
  const syllabus=(await request('/syllabus',{cookie:state.hod.cookie})).data.find(course=>course.id===state.teaching.id);
  assert.equal(syllabus.completionPercent,25);assert.equal(syllabus.overdueTopics,1);
  assert.equal((await request('/syllabus',{cookie:state.student.cookie})).status,403);
  assert.equal((await request(`/syllabus/topics/${state.topic.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{}})).status,403);
  assert.equal((await request(`/syllabus/topics/${state.topic.id}`,{method:'PATCH',cookie:state.busy.cookie,body:{}})).status,404);
  await request(`/syllabus/topics/${state.planned.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{title:'Upcoming unit',planned_hours:6,target_date:null,status:'completed',note:'Recorded actual completion'}});
  assert.equal((await request('/syllabus',{cookie:state.hod.cookie})).data.find(course=>course.id===state.teaching.id).completionPercent,100);
});

test('branch monitoring uses recorded class performance and excludes other departments',async()=>{
  await post('/attendance',{class_id:state.c1.id,subject_id:state.s1.id,date:'2026-01-05',period:1,records:[{student_id:state.student.id,status:'present'}]},state.faculty.cookie);
  await post('/marks',{student_id:state.student.id,subject_id:state.s1.id,title:'Recorded class assessment',kind:'internal',semester:1,score:80,max_marks:100},state.faculty.cookie);
  const monitor=(await request('/academic-monitoring',{cookie:state.hod.cookie})).data;
  assert.equal(monitor.summary.students,1);assert.equal(monitor.summary.attendance,100);assert.equal(monitor.summary.averageMarks,80);assert.equal(monitor.summary.syllabusCompletion,100);
  assert.ok(!JSON.stringify(monitor).includes('Workflow otherFaculty'));
  assert.ok(monitor.courses.some(course=>course.faculty_id===state.faculty.id&&course.averageMarks===80));
  const own=(await request('/academic-monitoring',{cookie:state.faculty.cookie})).data;
  assert.deepEqual(own.faculty.map(member=>member.id),[state.faculty.id]);
  assert.equal((await request('/academic-monitoring',{cookie:state.student.cookie})).status,403);
  assert.equal((await request('/department-overview',{cookie:state.hod.cookie})).data.syllabusCompletion,100);
});

test('faculty supporting documents follow the leave reviewer boundary and lock after review',async()=>{
  const nextDate=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  const leave=await post('/leave',{start_date:nextDate,end_date:nextDate,reason:'Faculty supporting document request'},state.faculty.cookie);
  const upload=async()=>{const body=new FormData();body.append('file',new Blob(['Faculty supporting text'],{type:'text/plain'}),'supporting.txt');return fetch(base+`/api/leave/${leave.id}/files`,{method:'POST',headers:{Cookie:state.faculty.cookie},body})};
  const response=await upload();assert.equal(response.status,201);const file=await response.json();
  for(const cookie of [state.faculty.cookie,state.hod.cookie,state.admin])assert.equal((await request(`/attachments?leave_id=${leave.id}`,{cookie})).data.length,1);
  for(const cookie of [state.student.cookie,state.cover.cookie,state.otherHod.cookie]) {
    assert.equal((await request(`/attachments?leave_id=${leave.id}`,{cookie})).data.length,0);
    assert.equal((await fetch(base+`/api/attachments/${file.id}/download`,{headers:{Cookie:cookie}})).status,404);
  }
  assert.equal((await fetch(base+`/api/attachments/${file.id}/download`,{headers:{Cookie:state.hod.cookie}})).status,200);
  await request(`/leave/${leave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'rejected'}});
  assert.equal((await upload()).status,409);
});

test('branch assessment monitoring attributes multi-class submissions to the student class',async()=>{
  const email='secondclass@workflow.test';
  const student=await post('/users',{name:'Second class student',email,password,role:'STUDENT',department_id:state.d1.id,class_id:state.extraClass.id,roll_number:'WF-SECOND'});
  const cookie=(await request('/auth/login',{method:'POST',cookie:null,body:{email,password}})).cookie;
  await post('/teaching-assignments',{faculty_id:state.faculty.id,class_id:state.extraClass.id,subject_id:state.s1.id});
  const activity=await post('/activities',{kind:'assignment',title:'Multi-class monitoring',class_id:state.c1.id,subject_id:state.s1.id,additional_class_ids:[state.extraClass.id]},state.faculty.cookie);
  const submission=await post(`/activities/${activity.id}/submit`,{content:'Submission from the second class'},cookie);
  let monitor=(await request('/academic-monitoring',{cookie:state.hod.cookie})).data;
  assert.equal(monitor.classPerformance.find(row=>row.id===state.c1.id).pendingEvaluations,0);
  assert.equal(monitor.classPerformance.find(row=>row.id===state.extraClass.id).pendingEvaluations,1);
  assert.equal((await request('/department-overview',{cookie:state.hod.cookie})).data.classOverview.find(row=>row.id===state.extraClass.id).pendingEvaluations,1);
  await request(`/submissions/${submission.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{score:75}});
  monitor=(await request('/academic-monitoring',{cookie:state.hod.cookie})).data;
  assert.equal(monitor.classPerformance.find(row=>row.id===state.extraClass.id).assessmentAverage,75);
  assert.equal(monitor.classPerformance.find(row=>row.id===state.c1.id).assessmentAverage,null);
  assert.equal(monitor.courses.find(row=>row.faculty_id===state.faculty.id&&row.class_id===state.extraClass.id).assessmentAverage,75);
});

test('workflow records survive reopening and HOD can remove its own teaching cover',async()=>{
  const reopened=createApp({dataDir:dir});
  try{assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM faculty_substitutions').get().n,1);assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM syllabus_topics').get().n,2)}finally{reopened.db.close()}
  assert.equal((await request(`/substitutions/${state.substitution.id}`,{method:'DELETE',cookie:state.otherHod.cookie})).status,404);
  assert.equal((await request(`/substitutions/${state.substitution.id}`,{method:'DELETE',cookie:state.hod.cookie})).status,200);
  assert.equal((await request('/substitutions',{cookie:state.student.cookie})).data.length,0);
});

test('authorized timetable and faculty-assignment removal cleans dependent workflow records',async()=>{
  await post(`/leave/${state.facultyLeave.id}/substitutions`,{timetable_id:state.slot.id,session_date:sessionDate,substitute_id:state.backup.id},state.hod.cookie);
  assert.equal((await request(`/timetable/${state.slot.id}`,{method:'DELETE',cookie:state.otherHod.cookie})).status,404);
  assert.equal((await request(`/teaching-assignments/${state.teaching.id}`,{method:'DELETE',cookie:state.hod.cookie})).status,409,'Existing timetable protection stays intact');
  assert.equal((await request(`/timetable/${state.slot.id}`,{method:'DELETE',cookie:state.hod.cookie})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM faculty_substitutions').get().n,0);
  assert.equal((await request(`/teaching-assignments/${state.teaching.id}`,{method:'DELETE',cookie:state.hod.cookie})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM syllabus_topics').get().n,0);
});
