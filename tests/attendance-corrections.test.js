import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ui-fixture.mjs';

test('attendance corrections enforce role and subject assignments and update reports without duplicating records',async()=>{
 const f=await fixture();
 try{
  const login=async email=>(await f.request('/auth/login',{email,password:f.password})).cookie;
  const faculty=await login('faculty@redesign.invalid'),student=await login('student@redesign.invalid');
  const row=f.db.prepare('SELECT * FROM attendance ORDER BY date DESC LIMIT 1').get();
  const patch=async(cookie,body,id=row.id)=>{
   const response=await fetch(`${f.base}/api/attendance/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
   return response.status;
  };
  const count=f.db.prepare('SELECT COUNT(*) n FROM attendance').get().n;
  assert.equal(await patch(undefined,{status:'absent'}),401);
  assert.equal(await patch(student,{status:'absent'}),403);
  const dept=f.db.prepare('SELECT department_id FROM classes WHERE id=?').get(f.classroom.id).department_id;
  for(const role of ['HOD','FACULTY']){
   const email=`unassigned-${role.toLowerCase()}@test.invalid`;
   await f.request('/users',{name:`Unassigned ${role}`,email,password:f.password,role,department_id:dept},f.admin);
   assert.equal(await patch(await login(email),{status:'absent'}),403);
  }
  const other=(await f.request('/subjects',{name:'Unassigned subject',code:'OTHER',department_id:dept},f.admin)).data;
  await f.request('/attendance',{class_id:f.classroom.id,subject_id:other.id,date:row.date,period:2,records:[{student_id:f.student.id,status:'present'}]},f.admin);
  const otherRow=f.db.prepare('SELECT id FROM attendance WHERE subject_id=?').get(other.id);
  assert.equal(await patch(faculty,{status:'absent'},otherRow.id),403);
  assert.equal(await patch(faculty,{status:'invalid'}),400);
  assert.equal(await patch(faculty,{status:'present',student_id:'different-student'}),400);
  assert.equal(await patch(faculty,{status:'present'},'missing-record'),404);
  assert.equal(await patch(faculty,{status:'absent'}),200);
  const report=(await f.request(`/students/${f.student.id}/report`,undefined,student)).data;
  assert.equal(report.analytics.attendance,56);
  const updated=f.db.prepare('SELECT * FROM attendance WHERE id=?').get(row.id);
  assert.equal(updated.status,'absent');
  assert.equal(updated.student_id,row.student_id);
  assert.equal(updated.date,row.date);
  assert.notEqual(updated.recorded_by,row.recorded_by);
  assert.equal(await patch(f.admin,{status:'excused'}),200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attendance').get().n,count+1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='attendance.updated'").get().n,2);
 }finally{await f.close();}
});
