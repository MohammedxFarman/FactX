import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ui-fixture.mjs';
test('practice runs preserve attempts, enforce role scope and keep hidden tests private',async()=>{
 const f=await fixture();
 try{
  const student=(await f.request('/auth/login',{email:'student@redesign.invalid',password:f.password})).cookie;
  const activities=(await f.request('/activities',null,student)).data;const lab=activities.find(a=>a.id===f.lab.id);
  assert.equal(lab.config.testCases,undefined);assert.deepEqual(lab.config.sampleTests,[{input:'2 3',output:'5'}]);
  const denied=await fetch(f.base+'/api/activities/'+lab.id+'/run',{method:'POST',headers:{'Content-Type':'application/json',Cookie:f.admin},body:JSON.stringify({content:'print(5)'})});assert.equal(denied.status,403);
  const before=await fetch(f.base+'/api/activities/'+lab.id+'/run',{method:'POST',headers:{'Content-Type':'application/json',Cookie:student},body:JSON.stringify({content:'print(5)'})});assert.equal(before.status,400);
  await f.request(`/activities/${lab.id}/events`,{event:'assessment.started'},student);
  const result=(await f.request(`/activities/${lab.id}/run`,{content:'print(5)',mode:'samples'},student)).data;assert.equal(result.tests[0].passed,true);assert.equal(result.tests[0].stdout,'5\n');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM submissions').get().n,0);
  await f.request(`/activities/${lab.id}/events`,{event:'browser.hidden'},student);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM assessment_events WHERE event='browser.hidden'").get().n,1);
  const secret=await fetch(f.base+'/api/activities/not-authorized/run',{method:'POST',headers:{'Content-Type':'application/json',Cookie:student},body:JSON.stringify({content:'print(5)'})});assert.equal(secret.status,404);
  f.db.prepare('UPDATE assessment_sessions SET expires_at=?').run('2000-01-01T00:00:00Z');
  const expired=await fetch(f.base+'/api/activities/'+lab.id+'/run',{method:'POST',headers:{'Content-Type':'application/json',Cookie:student},body:JSON.stringify({content:'print(5)'})});assert.equal(expired.status,400);
 }finally{await f.close();}
});
