import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ui-fixture.mjs';
import {digest} from '../server/security.js';

test('password recovery rejects expired links, revokes credentials and does not reveal accounts',async()=>{
 const mail=[];let failDelivery=false;
 const f=await fixture({sendMail:async message=>{if(failDelivery)throw new Error('Synthetic delivery failure');mail.push(message);}});
 const call=async(route,body,cookie='',method=body?'POST':'GET')=>{
  const r=await fetch(f.base+'/api'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 };
 const token=()=>new URL(mail.at(-1).text.match(/http[^\s]+/)[0]).hash.split('token=')[1];
 try{
  const login=await call('/auth/login',{email:'  STUDENT@REDESIGN.INVALID  ',password:f.password});
  assert.equal(login.status,200);
  const known=await call('/auth/forgot-password',{email:'student@redesign.invalid'});
  const expired=token();
  const unknown=await call('/auth/forgot-password',{email:'unknown@redesign.invalid'});
  assert.deepEqual(known.data,unknown.data);assert.equal(mail.length,1);
  assert.equal((await call('/auth/verify-email',{token:expired})).status,400,'reset token cannot verify email');
  f.db.prepare('UPDATE account_tokens SET expires_at=? WHERE token_hash=?').run(Date.now()-1,digest(expired));
  assert.equal((await call('/auth/reset-password',{token:expired,password:'Synthetic-new-password-123'})).status,400);
  await call('/auth/forgot-password',{email:'student@redesign.invalid'});
  const superseded=token();
  assert.equal((await call('/users/'+f.student.id,{password:'Synthetic-admin-reset-123'},f.admin,'PATCH')).status,200);
  assert.equal((await call('/auth/reset-password',{token:superseded,password:'Synthetic-stale-reset-123'})).status,400);
  assert.equal((await call('/auth/me',null,login.cookie)).status,401);
  const second=await call('/auth/login',{email:'student@redesign.invalid',password:'Synthetic-admin-reset-123'});
  assert.equal((await call('/account/password',{currentPassword:'wrong',password:'Synthetic-changed-123'},second.cookie)).status,403);
  assert.equal((await call('/account/password',{currentPassword:'Synthetic-admin-reset-123',password:'Synthetic-changed-123'},second.cookie)).status,200);
  assert.equal((await call('/auth/me',null,second.cookie)).status,401);
  assert.equal((await call('/auth/login',{email:'student@redesign.invalid',password:'Synthetic-admin-reset-123'})).status,401);
  assert.equal((await call('/auth/login',{email:'student@redesign.invalid',password:'Synthetic-changed-123'})).status,200);
  failDelivery=true;
  const failed=await call('/auth/forgot-password',{email:'student@redesign.invalid'});
  assert.deepEqual(failed.data,unknown.data);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM account_tokens WHERE user_id=?').get(f.student.id).n,0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM operational_errors WHERE kind='email_delivery'").get().n,1);
 }finally{await f.close();}
});

test('mandatory verification permits account recovery and logout but blocks academic records',async()=>{
 const mail=[],f=await fixture({sendMail:async message=>mail.push(message)});
 const previous=process.env.REQUIRE_EMAIL_VERIFICATION;
 process.env.REQUIRE_EMAIL_VERIFICATION='true';
 try{
  const login=await f.request('/auth/login',{email:'student@redesign.invalid',password:f.password});
  assert.equal(login.data.verificationRequired,true);
  assert.equal((await fetch(f.base+'/api/catalog',{headers:{Cookie:login.cookie}})).status,403);
  await f.request('/account/send-verification',{},login.cookie);
  const token=new URL(mail[0].text.match(/http[^\s]+/)[0]).hash.split('token=')[1];
  await f.request('/auth/verify-email',{token});
  assert.equal((await f.request('/auth/me',undefined,login.cookie)).data.verificationRequired,false);
  assert.equal((await fetch(f.base+'/api/catalog',{headers:{Cookie:login.cookie}})).status,200);
  await f.request('/auth/logout',{},login.cookie);
 }finally{if(previous===undefined)delete process.env.REQUIRE_EMAIL_VERIFICATION;else process.env.REQUIRE_EMAIL_VERIFICATION=previous;await f.close();}
});
