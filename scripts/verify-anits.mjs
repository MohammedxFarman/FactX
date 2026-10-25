import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {academicCounts} from '../server/academic-schema.js';
import {ANITS_SEED} from '../server/anits-seed.js';
const dir=path.resolve('data/anits-test');
assert.equal(JSON.parse(readFileSync(path.join(dir,'test-environment.json'),'utf8')).seed,ANITS_SEED);
assert.ok(process.env.ANITS_TEST_PASSWORD,'Set ANITS_TEST_PASSWORD to verify generated logins.');
const {app,db}=createApp({dataDir:dir}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/api`,results=[];
const request=async(route,cookie,body)=>{const start=performance.now(),r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined}),text=await r.text();let data;try{data=JSON.parse(text);}catch{throw new Error(`Invalid JSON for ${route}: status ${r.status}`);}return {status:r.status,data,ms:Math.round(performance.now()-start),bytes:text.length,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
try{
 const expected={BTECH:{departments:10,hods:10,faculty:100,batches:40,academicYears:4,sections:160,students:9600,classTeachers:160},BBA:{departments:1,hods:1,faculty:10,batches:3,academicYears:3,sections:12,students:720,classTeachers:12},MTECH:{departments:0,hods:0,faculty:0,batches:0,academicYears:0,sections:0,students:0,classTeachers:0}};
 const actual=Object.fromEntries(db.prepare('SELECT * FROM programs').all().map(p=>[p.code,academicCounts(db,p.id)]));assert.deepEqual(actual,expected);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const sections=db.prepare("SELECT c.id,count(u.id) students FROM academic_sections s JOIN classes c ON c.id=s.class_id LEFT JOIN users u ON u.class_id=c.id AND u.role='STUDENT' GROUP BY c.id").all();assert.equal(sections.length,172);assert.ok(sections.every(s=>s.students===60));
 const depts=db.prepare("SELECT d.code,count(DISTINCT c.id) sections,count(DISTINCT u.id) students FROM program_departments pd JOIN departments d ON d.id=pd.department_id JOIN classes c ON c.department_id=d.id JOIN users u ON u.class_id=c.id AND u.role='STUDENT' WHERE pd.program_id='BTECH' GROUP BY d.id").all();assert.equal(depts.length,10);assert.ok(depts.every(d=>d.sections===16&&d.students===960));
 assert.equal(db.prepare("SELECT count(*) n FROM (SELECT email FROM users GROUP BY lower(email) HAVING count(*)>1)").get().n,0);
 assert.equal(db.prepare("SELECT count(*) n FROM (SELECT roll_number FROM users WHERE roll_number IS NOT NULL GROUP BY roll_number HAVING count(*)>1)").get().n,0);
 assert.equal(db.prepare('SELECT count(DISTINCT password_hash) n FROM users u JOIN academic_test_accounts t ON t.user_id=u.id').get().n,10441);
 const staffing=db.prepare("SELECT d.department_id,sum(u.role='FACULTY') faculty,sum(u.role='HOD') hods FROM program_departments d JOIN users u ON u.department_id=d.department_id GROUP BY d.department_id").all();assert.equal(staffing.length,11);assert.ok(staffing.every(d=>d.faculty===10&&d.hods===1));
 assert.equal(db.prepare("SELECT count(*) n FROM users u JOIN classes c ON c.id=u.class_id JOIN academic_sections s ON s.class_id=c.id JOIN admission_batches b ON b.id=s.batch_id WHERE u.role='STUDENT' AND (u.department_id<>c.department_id OR c.department_id<>b.department_id OR s.academic_year<>b.current_year)").get().n,0);
 for(const row of db.prepare("SELECT u.roll_number,d.code,b.admission_year FROM users u JOIN classes c ON c.id=u.class_id JOIN departments d ON d.id=c.department_id JOIN academic_sections s ON s.class_id=c.id JOIN admission_batches b ON b.id=s.batch_id WHERE b.program_id='BTECH' AND u.role='STUDENT'").all())assert.match(row.roll_number,new RegExp('^'+({2026:'A261',2025:'A251',2024:'241',2023:'A231'}[row.admission_year])+row.code+'[0-9]{3}$'));
 for(const prefix of ['A261','A251','241','A231'])assert.ok(db.prepare('SELECT id FROM users WHERE roll_number=?').get(prefix+'CSM001'));
 const administrator=JSON.parse(readFileSync(path.join(dir,'administrator-login.json'),'utf8'));
 const accounts=[{...administrator,role:'ADMIN'},...['csm.hod','csm.faculty01','A261CSM001','A251CSM001','241CSM001','A231CSM001','bba.hod','bba.faculty01','test-bba-2026-001'].map(email=>({email:email+'@anits.edu.in',password:process.env.ANITS_TEST_PASSWORD}))];
 let adminCookie;
 for(const account of accounts){
  const auth=await request('/auth/login',null,account);assert.equal(auth.status,200);assert.ok(!('password_hash'in auth.data));if(auth.data.role==='ADMIN')adminCookie=auth.cookie;
  const routes=['/catalog','/students','/academics/catalog','/academics/summary','/academics/people',auth.data.role==='HOD'?'/department-overview':'/dashboard'];
  const timings=[];for(const route of routes){const result=await request(route,auth.cookie);assert.equal(result.status,200,route);if(route==='/students')assert.ok(result.data.length<=100);if(route==='/academics/people')assert.ok(result.data.rows.length<=50);timings.push({route,ms:result.ms,bytes:result.bytes});}
  if(auth.data.role!=='ADMIN'){
   const other=db.prepare("SELECT id FROM users WHERE role='STUDENT' AND department_id<>? LIMIT 1").get(auth.data.department_id);assert.equal((await request(`/students/${other.id}/report`,auth.cookie)).status,404);
  }
  if(auth.data.role==='STUDENT'){const other=db.prepare("SELECT id FROM users WHERE role='STUDENT' AND id<>? AND class_id=? LIMIT 1").get(auth.data.id,auth.data.class_id);assert.equal((await request(`/students/${other.id}/report`,auth.cookie)).status,404);}
  results.push({role:auth.data.role,program:auth.data.email.startsWith('bba')||auth.data.email.startsWith('test-bba')?'BBA':auth.data.role==='ADMIN'?'institution':'BTECH',login:'passed',timings});
 }
 assert.equal((await request('/auth/login',null,{email:accounts[2].email,password:'incorrect'})).status,401);
 const filtered=await request('/academics/people?program_id=BTECH&academic_year=1&q=A261CSM&limit=50&page=2',adminCookie);assert.equal(filtered.data.total,240);assert.equal(filtered.data.rows.length,50);
 const report={verifiedAt:new Date().toISOString(),expected,actual,integrity:'ok',foreignKeyViolations:0,sectionsWith60Students:sections.length,uniqueGeneratedPasswordHashes:10441,results};
 writeFileSync(path.join(dir,'verification-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({actual,logins:results.length,integrity:'ok',foreignKeyViolations:0,maxEndpointMs:Math.max(...results.flatMap(r=>r.timings.map(t=>t.ms)))},null,2));
}finally{await new Promise(r=>server.close(r));db.close();}
