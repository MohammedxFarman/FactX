import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './ui-fixture.mjs';

test('readiness: login/logout, administrator password reset, session revocation, validation and API 404',async()=>{
 const f=await fixture();
 const request=async(route,{body,cookie,method=body?'POST':'GET'}={})=>{
  const response=await fetch(f.base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 };
 try{
  const login=await request('/auth/login',{body:{email:'student@redesign.invalid',password:f.password}});
  assert.equal(login.status,200);assert.equal(login.data.password_hash,undefined);
  assert.match(login.cookie,/HttpOnly/i);assert.match(login.cookie,/SameSite=Strict/i);
  const cookie=login.cookie.split(';')[0];
  assert.equal((await request('/auth/me',{cookie})).status,200);
  const logout=await request('/auth/logout',{cookie,body:{}});assert.equal(logout.status,200);
  assert.match(logout.cookie,/Expires=Thu, 01 Jan 1970/i);
  assert.equal((await request('/auth/me',{cookie})).status,401,'logged-out cookie cannot be reused');
  const second=await request('/auth/login',{body:{email:'student@redesign.invalid',password:f.password}});
  const oldCookie=second.cookie.split(';')[0],newPassword='Synthetic-reset-password-825';
  assert.equal((await request('/users/'+f.student.id,{method:'PATCH',cookie:oldCookie,body:{password:newPassword}})).status,403);
  const invalid=await request('/users/'+f.student.id,{method:'PATCH',cookie:f.admin,body:{password:'short'}});
  assert.equal(invalid.status,400);assert.equal(typeof invalid.data.error,'string');
  assert.equal((await request('/users/'+f.student.id,{method:'PATCH',cookie:f.admin,body:{password:newPassword}})).status,200);
  assert.equal((await request('/auth/me',{cookie:oldCookie})).status,401,'reset revokes existing sessions');
  assert.equal((await request('/auth/login',{body:{email:'student@redesign.invalid',password:f.password}})).status,401);
  assert.equal((await request('/auth/login',{body:{email:'student@redesign.invalid',password:newPassword}})).status,200);
  const missing=await request('/unknown-readiness-route',{cookie:f.admin});
  assert.equal(missing.status,404);assert.equal(missing.data.error,'API route not found.');
 }finally{await f.close();}
});
