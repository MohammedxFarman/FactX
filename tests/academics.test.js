import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {seedAnits,rollNumber,anitsConfiguration} from '../server/anits-seed.js';

test('academic seed is repeatable, scoped, paginated and preserves admission cohorts',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'factx-academic-')),{app,db}=createApp({dataDir:dir,setupToken:'academic-setup'}),server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api`,password='Academic-test-password-2026';
 const request=async(route,{body,cookie,method=body?'POST':'GET'}={})=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const data=r.headers.get('content-type')?.includes('json')?await r.json():await r.text();return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const admin=await request('/auth/setup',{body:{name:'Test Admin',email:'admin@test.invalid',password,token:'academic-setup'}});assert.equal(admin.status,201);
  const config={...anitsConfiguration,departments:['CSM'],cohorts:anitsConfiguration.cohorts.slice(0,1),sections:['A','B'],studentsPerSection:2,facultyPerDepartment:2};
  const first=await seedAnits(db,{password,config}),second=await seedAnits(db,{password,config});assert.equal(first.created,14);assert.equal(second.created,0);assert.equal(second.reused,14);
  assert.deepEqual(anitsConfiguration.cohorts.map(c=>rollNumber('CSM',c,1)),['A261CSM001','A251CSM001','241CSM001','A231CSM001']);
  const salts=db.prepare("SELECT password_hash FROM users WHERE role='STUDENT'").all().map(r=>r.password_hash.split(':')[0]);assert.equal(new Set(salts).size,8);
  const student=await request('/auth/login',{body:{email:'A261CSM001@anits.edu.in',password}}),faculty=await request('/auth/login',{body:{email:'csm.faculty01@anits.edu.in',password}}),hod=await request('/auth/login',{body:{email:'csm.hod@anits.edu.in',password}});
  assert.equal(student.status,200);assert.equal(faculty.status,200);assert.equal(hod.status,200);
  assert.equal((await request('/auth/login',{body:{email:'A261CSM001@anits.edu.in',password:'wrong'}})).status,401);
  assert.equal((await request('/academics/people',{cookie:student.cookie})).data.total,1);
  assert.equal((await request('/academics/people',{cookie:faculty.cookie})).data.total,2);
  assert.equal((await request('/academics/people',{cookie:hod.cookie})).data.total,4);
  const bba=db.prepare("SELECT id FROM users WHERE roll_number='TEST-BBA-2026-001'").get();
  for(const cookie of [student.cookie,faculty.cookie,hod.cookie]){
   assert.equal((await request(`/students/${bba.id}/report`,{cookie})).status,404);
   assert.equal((await request('/academics/credentials.csv?program=BTECH&role=STUDENT',{cookie})).status,403);
   assert.equal((await request('/academics/batches',{cookie,body:{}})).status,403);
  }
  const page=await request('/academics/people?program_id=BTECH&limit=2&page=2',{cookie:admin.cookie});assert.equal(page.data.total,4);assert.equal(page.data.rows.length,2);assert.ok(page.data.rows.every(r=>r.program==='B.Tech'&&!('password_hash'in r)));
  assert.equal((await request('/academics/people?q=A261CSM001',{cookie:admin.cookie})).data.total,1);
  const batch=db.prepare("SELECT * FROM admission_batches WHERE program_id='BTECH'").get();
  assert.equal((await request(`/academics/batches/${batch.id}`,{cookie:admin.cookie,method:'PATCH',body:{current_year:2,status:'active'}})).status,200);
  const profile=(await request('/academics/people',{cookie:student.cookie})).data.rows[0];assert.equal(profile.admission_year,2026);assert.equal(profile.academic_year,2);assert.equal(profile.roll_number,'A261CSM001');
  const section=db.prepare('SELECT * FROM academic_sections WHERE batch_id=?').get(batch.id),bbaTeacher=db.prepare("SELECT id FROM users WHERE email='bba.faculty01@anits.edu.in'").get();
  assert.notEqual((await request(`/academics/sections/${section.class_id}`,{cookie:admin.cookie,method:'PATCH',body:{class_teacher_id:bbaTeacher.id}})).status,200);
  const csv=await request('/academics/credentials.csv?program=BTECH&role=STUDENT',{cookie:admin.cookie});assert.equal(csv.status,200);assert.equal(csv.data.split('\r\n').length,5);assert.ok(!csv.data.includes(password));
  const dashboard=await request('/dashboard',{cookie:admin.cookie});assert.equal(dashboard.status,200);assert.equal(dashboard.data.students,8);
  assert.equal((await request('/department-overview',{cookie:hod.cookie})).data.students,4);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('factx-academic-'));rmSync(resolved,{recursive:true,force:true});}
});
