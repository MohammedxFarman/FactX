import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {sendWorkflowReminders,workflowInbox} from '../server/coordination.js';

const state={},password='Coordination-test-password-2026',today=new Date().toISOString().slice(0,10);
const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
let server,db,dir,base;
async function request(route,{method='GET',body,cookie=state.admin}={}) {
  const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function post(route,body,cookie=state.admin){const result=await request(route,{method:'POST',body,cookie});assert.ok(result.status<300,JSON.stringify(result.data));return result.data}
before(async()=>{
  dir=mkdtempSync(path.join(tmpdir(),'factx-coordination-'));const instance=createApp({dataDir:dir,setupToken:'coordination-token'});db=instance.db;
  server=await new Promise(resolve=>{const listener=instance.app.listen(0,'127.0.0.1',()=>resolve(listener))});base=`http://127.0.0.1:${server.address().port}`;
  state.admin=(await request('/auth/setup',{method:'POST',cookie:null,body:{name:'Coordination Admin',email:'admin@coordination.test',password,token:'coordination-token'}})).cookie;
  for(const n of [1,2]) {state['d'+n]=await post('/departments',{name:`Coordination department ${n}`,code:`CO${n}`});state['c'+n]=await post('/classes',{name:`Coordination class ${n}`,department_id:state['d'+n].id,semester:1});state['s'+n]=await post('/subjects',{name:`Coordination subject ${n}`,code:`COS${n}`,department_id:state['d'+n].id})}
  for(const[key,role,dept,classroom]of [['hod','HOD',state.d1],['otherHod','HOD',state.d2],['faculty','FACULTY',state.d1],['cover','FACULTY',state.d1],['colleague','FACULTY',state.d1],['student','STUDENT',state.d1,state.c1],['classmate','STUDENT',state.d1,state.c1],['otherStudent','STUDENT',state.d2,state.c2]]) {
    const email=`${key.toLowerCase()}@coordination.test`;
    state[key]=await post('/users',{name:`Coordination ${key}`,email,password,role,department_id:dept.id,...(classroom?{class_id:classroom.id,roll_number:`CO-${key}`}:{})});
    state[key].cookie=(await request('/auth/login',{method:'POST',cookie:null,body:{email,password}})).cookie;
  }
  state.teaching=await post('/teaching-assignments',{faculty_id:state.faculty.id,class_id:state.c1.id,subject_id:state.s1.id});
  await post('/teaching-assignments',{faculty_id:state.colleague.id,class_id:state.c1.id,subject_id:state.s1.id});
  state.slot=await post('/timetable',{faculty_id:state.faculty.id,class_id:state.c1.id,subject_id:state.s1.id,day_of_week:new Date(today+'T12:00:00Z').getUTCDay(),start_time:'09:00',end_time:'10:00'});
  state.leave=await post('/leave',{start_date:today,end_date:today,reason:'Today teaching cover'},state.faculty.cookie);
  await request(`/leave/${state.leave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved'}});
  state.sub=await post(`/leave/${state.leave.id}/substitutions`,{timetable_id:state.slot.id,session_date:today,substitute_id:state.cover.id},state.hod.cookie);
});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('factx-coordination-'));rmSync(resolved,{recursive:true,force:true})});

test('shared inbox is role scoped and links the actual leave, cover and attendance records',async()=>{
  state.pending=await post('/leave',{start_date:future,end_date:future,reason:'Future student leave'},state.student.cookie);
  const own=(await request('/inbox',{cookie:state.student.cookie})).data;
  assert.ok(own.items.some(item=>item.target.id===state.pending.id&&item.actionable===false));
  assert.ok(own.items.some(item=>item.category==='Class change'&&item.target.id===state.sub.id));
  assert.ok(!JSON.stringify(own).includes('Today teaching cover'));
  const teacher=(await request('/inbox',{cookie:state.faculty.cookie})).data;
  assert.ok(teacher.items.some(item=>item.target.id===state.pending.id&&item.actionable&&item.page==='leave'));
  const cover=(await request('/inbox',{cookie:state.cover.cookie})).data;
  assert.ok(cover.items.some(item=>item.category==='Attendance'&&item.target.id===state.sub.id));
  assert.equal((await request('/inbox',{cookie:state.otherHod.cookie})).data.items.length,0);
  assert.equal((await request('/inbox',{cookie:state.otherStudent.cookie})).data.items.length,0);
});

test('substitution roster is limited to the assigned session and never grants report or teaching access',async()=>{
  const result=await request(`/substitutions/${state.sub.id}/attendance`,{cookie:state.cover.cookie});
  assert.equal(result.status,200);assert.equal(result.data.can_record,true);assert.equal(result.data.session.period,1);
  assert.deepEqual(new Set(result.data.students.map(student=>student.id)),new Set([state.student.id,state.classmate.id]));
  for(const cookie of [state.colleague.cookie,state.otherHod.cookie,state.student.cookie])assert.equal((await request(`/substitutions/${state.sub.id}/attendance`,{cookie})).status,cookie===state.student.cookie?403:404);
  assert.equal((await request(`/students/${state.student.id}/report`,{cookie:state.cover.cookie})).status,404);
  assert.deepEqual((await request('/students',{cookie:state.cover.cookie})).data,[]);
  assert.equal((await request('/attendance',{method:'POST',cookie:state.cover.cookie,body:{class_id:state.c1.id,subject_id:state.s1.id,date:today,period:1,records:[{student_id:state.student.id,status:'present'}]}})).status,403);
  assert.equal((await request(`/substitutions/${state.sub.id}/attendance`,{cookie:state.hod.cookie})).data.can_record,false);
});

test('session attendance rejects wrong roles, forged metadata, missing students and duplicates',async()=>{
  const url=`/substitutions/${state.sub.id}/attendance`,records=[{student_id:state.student.id,status:'present'},{student_id:state.classmate.id,status:'absent'}];
  for(const cookie of [state.hod.cookie,state.student.cookie,state.colleague.cookie,state.faculty.cookie])assert.ok((await request(url,{method:'POST',cookie,body:{records}})).status>=400);
  assert.equal((await request(url,{method:'POST',cookie:state.cover.cookie,body:{records,class_id:state.c2.id,date:future,period:20}})).status,400);
  for(const invalid of [[records[0]],[records[0],records[0]],[records[0],{student_id:state.otherStudent.id,status:'present'}]])assert.equal((await request(url,{method:'POST',cookie:state.cover.cookie,body:{records:invalid}})).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance').get().n,0);
});

test('saved cover attendance updates real reports and monitoring without duplicate rows or reminders',async()=>{
  const url=`/substitutions/${state.sub.id}/attendance`;
  await post(url,{records:[{student_id:state.student.id,status:'present'},{student_id:state.classmate.id,status:'absent'}]},state.cover.cookie);
  assert.equal((await request(`/students/${state.student.id}/report`,{cookie:state.student.cookie})).data.analytics.attendance,100);
  assert.equal((await request('/academic-monitoring',{cookie:state.hod.cookie})).data.summary.attendance,50);
  assert.ok(!(await request('/inbox',{cookie:state.cover.cookie})).data.items.some(item=>item.key===`attendance:${state.sub.id}`));
  assert.ok((await request('/notifications',{cookie:state.hod.cookie})).data.some(item=>item.title==='Substitution attendance recorded'));
  await post(url,{records:[{student_id:state.student.id,status:'present'},{student_id:state.classmate.id,status:'present'}]},state.cover.cookie);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance').get().n,2);
  assert.equal((await request('/academic-monitoring',{cookie:state.hod.cookie})).data.summary.attendance,100);
  assert.equal((await request(`/substitutions/${state.sub.id}`,{method:'DELETE',cookie:state.hod.cookie})).status,409);
  assert.equal((await request(`/leave/${state.leave.id}/substitutions`,{method:'POST',cookie:state.hod.cookie,body:{timetable_id:state.slot.id,session_date:today,substitute_id:state.colleague.id}})).status,409);
});

test('future cover cannot record attendance before its own assigned date',async()=>{
  state.futureLeave=await post('/leave',{start_date:future,end_date:future,reason:'Future faculty leave'},state.faculty.cookie);
  await request(`/leave/${state.futureLeave.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'approved'}});
  assert.ok((await request('/inbox',{cookie:state.hod.cookie})).data.items.some(item=>item.category==='Teaching cover'&&item.target.id===state.futureLeave.id));
  const sub=await post(`/leave/${state.futureLeave.id}/substitutions`,{timetable_id:state.slot.id,session_date:future,substitute_id:state.cover.id},state.hod.cookie);
  assert.equal((await request(`/substitutions/${sub.id}/attendance`,{cookie:state.cover.cookie})).data.can_record,false);
  assert.equal((await request(`/substitutions/${sub.id}/attendance`,{method:'POST',cookie:state.cover.cookie,body:{records:[{student_id:state.student.id,status:'present'},{student_id:state.classmate.id,status:'present'}]}})).status,400);
});

const planBody=()=>({student_id:state.student.id,faculty_id:state.faculty.id,subject_id:state.s1.id,title:'Practice and attendance follow-up',goal:'Complete guided practice and discuss attendance routines.',category:'subject',due_date:today,tasks:[{title:'Complete guided practice',due_date:yesterday}]});
test('support plans require real teaching assignments and reach only their authorized participants',async()=>{
  assert.equal((await request('/support-plans',{method:'POST',cookie:state.student.cookie,body:planBody()})).status,403);
  assert.equal((await request('/support-plans',{method:'POST',cookie:state.otherHod.cookie,body:planBody()})).status,404);
  assert.equal((await request('/support-plans',{method:'POST',cookie:state.cover.cookie,body:planBody()})).status,404);
  assert.equal((await request('/support-plans',{method:'POST',cookie:state.faculty.cookie,body:{...planBody(),faculty_id:state.colleague.id}})).status,400);
  state.plan=await post('/support-plans',planBody(),state.faculty.cookie);
  state.task=(await request(`/support-plans/${state.plan.id}`,{cookie:state.student.cookie})).data.tasks[0];
  for(const cookie of [state.admin,state.hod.cookie,state.faculty.cookie,state.student.cookie])assert.equal((await request(`/support-plans/${state.plan.id}`,{cookie})).status,200);
  for(const cookie of [state.classmate.cookie,state.otherStudent.cookie,state.otherHod.cookie,state.cover.cookie,state.colleague.cookie])assert.equal((await request(`/support-plans/${state.plan.id}`,{cookie})).status,404);
  assert.ok((await request('/notifications',{cookie:state.student.cookie})).data.some(item=>item.title==='New student support plan'));
  assert.equal((await request('/support-plans',{cookie:state.hod.cookie})).data.summary.overdue,1);
});

test('students submit progress and only their responsible faculty can review it',async()=>{
  const task=state.task;
  assert.equal((await request(`/support-tasks/${task.id}/progress`,{method:'POST',cookie:state.classmate.cookie,body:{status:'submitted',student_note:'Not my work'}})).status,404);
  assert.equal((await request(`/support-tasks/${task.id}/progress`,{method:'POST',cookie:state.student.cookie,body:{status:'completed',student_note:'Bypass faculty'}})).status,400);
  await post(`/support-tasks/${task.id}/progress`,{status:'submitted',student_note:'Completed the practice exercises and noted questions.'},state.student.cookie);
  assert.ok((await request('/inbox',{cookie:state.faculty.cookie})).data.items.some(item=>item.target.taskId===task.id&&item.actionable));
  for(const cookie of [state.hod.cookie,state.colleague.cookie,state.cover.cookie])assert.ok((await request(`/support-tasks/${task.id}/review`,{method:'POST',cookie,body:{status:'completed',faculty_feedback:'Unauthorized review'}})).status>=400);
  await post(`/support-tasks/${task.id}/review`,{status:'in_progress',faculty_feedback:'Please explain the final exercise.'},state.faculty.cookie);
  let detail=(await request(`/support-plans/${state.plan.id}`,{cookie:state.student.cookie})).data;
  assert.equal(detail.tasks[0].status,'in_progress');assert.equal(detail.tasks[0].faculty_feedback,'Please explain the final exercise.');
  assert.equal((await request(`/support-plans/${state.plan.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{status:'completed'}})).status,409);
  await post(`/support-tasks/${task.id}/progress`,{status:'submitted',student_note:'Added my explanation of the final exercise.'},state.student.cookie);
  await post(`/support-tasks/${task.id}/review`,{status:'completed',faculty_feedback:'Reviewed and accepted.'},state.faculty.cookie);
  assert.equal((await request(`/support-tasks/${task.id}/review`,{method:'POST',cookie:state.faculty.cookie,body:{status:'completed'}})).status,409);
  detail=(await request(`/support-plans/${state.plan.id}`,{cookie:state.hod.cookie})).data;
  assert.equal(detail.completedTasks,1);assert.ok(detail.updates.some(update=>update.kind==='student_progress'));assert.ok(detail.updates.some(update=>update.kind==='faculty_review'));
});

test('completed support plans retain history, disappear from open work, and reject later changes',async()=>{
  assert.equal((await request(`/support-plans/${state.plan.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'completed'}})).status,409);
  assert.equal((await request(`/support-plans/${state.plan.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{status:'completed',note:'Guided practice reviewed; follow-up complete.'}})).status,200);
  for(const cookie of [state.admin,state.hod.cookie,state.student.cookie])assert.equal((await request(`/support-plans/${state.plan.id}`,{cookie})).data.status,'completed');
  assert.ok(!(await request('/inbox',{cookie:state.student.cookie})).data.items.some(item=>item.target.id===state.plan.id));
  assert.equal((await request(`/support-tasks/${state.task.id}/progress`,{method:'POST',cookie:state.student.cookie,body:{status:'submitted',student_note:'After closure'}})).status,409);
  assert.equal((await request(`/support-plans/${state.plan.id}/tasks`,{method:'POST',cookie:state.faculty.cookie,body:{title:'Late task',due_date:today}})).status,403);
});

test('HOD assigns support to a real faculty member and retains monitoring and cancellation access',async()=>{
  const result=await post('/support-plans',{...planBody(),faculty_id:state.colleague.id,title:'HOD assigned support'},state.hod.cookie);
  assert.equal((await request(`/support-plans/${result.id}`,{cookie:state.colleague.cookie})).data.can_review,true);
  assert.equal((await request(`/support-plans/${result.id}`,{cookie:state.faculty.cookie})).status,404);
  assert.ok((await request('/notifications',{cookie:state.colleague.cookie})).data.some(item=>item.title==='Student support plan assigned'));
  assert.equal((await request(`/support-plans/${result.id}`,{method:'PATCH',cookie:state.hod.cookie,body:{status:'cancelled',note:'Follow-up responsibility changed.'}})).status,200);
  assert.equal((await request(`/support-plans/${result.id}`,{cookie:state.student.cookie})).data.status,'cancelled');
});

test('reminders persist their daily deduplication, follow role permissions, and stop on resolution',async()=>{
  state.reminderPlan=await post('/support-plans',{...planBody(),title:'Open reminder follow-up'},state.faculty.cookie);
  const facultyUser=db.prepare('SELECT * FROM users WHERE id=?').get(state.faculty.id);
  assert.ok(workflowInbox(db,facultyUser).items.some(item=>item.overdue&&item.target.id===state.reminderPlan.id));
  const sent=[],notify=(user,title,body)=>sent.push({user,title,body});
  const instant=new Date();sendWorkflowReminders(db,notify,instant);const count=sent.length;assert.ok(count>0);
  sendWorkflowReminders(db,notify,new Date(instant.getTime()+60000));assert.equal(sent.length,count);
  assert.ok(!sent.some(item=>[state.otherHod.id,state.otherStudent.id].includes(item.user)));
  const reopened=createApp({dataDir:dir});try{assert.equal(sendWorkflowReminders(reopened.db,notify,new Date(instant.getTime()+120000)),0)}finally{reopened.db.close()}
  assert.ok(sendWorkflowReminders(db,notify,new Date(instant.getTime()+86400000))>0,'Open work is reminded again after twenty-four hours');
  await request(`/support-plans/${state.reminderPlan.id}`,{method:'PATCH',cookie:state.faculty.cookie,body:{status:'cancelled'}});
  assert.ok(!workflowInbox(db,facultyUser).items.some(item=>item.target.id===state.reminderPlan.id));
  assert.equal(sendWorkflowReminders(db,notify,new Date(instant.getTime()+86460000)),0);
  await request('/preferences',{method:'PUT',body:{notificationsEnabled:false}});
  assert.equal(sendWorkflowReminders(db,notify,new Date(instant.getTime()+86400000)),0);
});
