import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/app.js';

// Call only for an explicitly isolated test directory, never the real workspace.
export async function deviceTestWorkspace(dataDir){
  const manifestPath=path.join(dataDir,'device-test.json');
  const setupToken=randomBytes(24).toString('hex');
  const {app,db}=createApp({dataDir,setupToken});
  let server;
  try{
    if(existsSync(manifestPath)){
      const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
      if(manifest.kind!=='factx-device-test'||!manifest.ready)throw new Error('Incomplete test setup. Existing records have been preserved; inspect the isolated test directory.');
      for(const account of manifest.accounts){
        if(!db.prepare('SELECT id FROM users WHERE id=? AND email=? AND role=?').get(account.id,account.email,account.role))throw new Error('Test accounts do not match the saved manifest. Existing records have been preserved.');
      }
      return {app,db,manifest};
    }
    if(db.prepare('SELECT id FROM users LIMIT 1').get())throw new Error('Refusing to seed an existing workspace without a device-test manifest.');
    server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
    const base=`http://127.0.0.1:${server.address().port}/api`;
    const request=async(route,body,cookie,method=body?'POST':'GET')=>{
      const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
      const data=await response.json();
      if(!response.ok)throw new Error(`${route}: ${data.error||response.status}`);
      return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
    };
    const accounts=[{role:'ADMIN',name:'Device Test Administrator',email:'device.admin@factx.test',password:randomBytes(12).toString('base64url')}];
    const manifest={kind:'factx-device-test',ready:false,createdAt:new Date().toISOString(),accounts,activities:{}};
    const save=()=>writeFileSync(manifestPath,JSON.stringify(manifest,null,2),{mode:0o600});
    save();
    const admin=await request('/auth/setup',{...accounts[0],token:setupToken});
    accounts[0].id=admin.data.id;save();
    const post=async(route,body,cookie=admin.cookie)=>(await request(route,body,cookie)).data;
    await request('/preferences',{institutionName:'FactX Device Test - Synthetic Data Only'},admin.cookie,'PUT');
    const department=await post('/departments',{name:'Device Test Computer Science',code:'DEVICE-CS'});
    const classroom=await post('/classes',{name:'Device Test Class',department_id:department.id,semester:1,program:'Synthetic device rehearsal',batch:'TEST',section:'A'});
    const subject=await post('/subjects',{name:'Device Test Computing',code:'DEVICE-101',department_id:department.id});
    Object.assign(manifest,{departmentId:department.id,classId:classroom.id,subjectId:subject.id});
    for(const label of ['faculty','hod','student1','student2','student3','student4','student5']){
      const role=label.startsWith('student')?'STUDENT':label.toUpperCase();
      const account={role,name:role==='STUDENT'?`Device Student ${label.slice(-1)}`:`Device Test ${role}`,email:`device.${label}@factx.test`,password:randomBytes(12).toString('base64url')};
      accounts.push(account);save();
      const created=await post('/users',{...account,department_id:department.id,...(role==='STUDENT'?{class_id:classroom.id,roll_number:`DEVICE-00${label.slice(-1)}`}:{})});
      account.id=created.id;save();
      if(role==='FACULTY')await post('/teaching-assignments',{faculty_id:created.id,class_id:classroom.id,subject_id:subject.id});
    }
    const faculty=accounts.find(a=>a.role==='FACULTY');
    const teacher=await request('/auth/login',{email:faculty.email,password:faculty.password});
    const publish=async(blueprint,options={})=>{
      const draft=await post('/assessment-studio',blueprint,teacher.cookie);
      await post(`/assessment-studio/${draft.id}/preview`,{revision:draft.revision},teacher.cookie);
      return post(`/assessment-studio/${draft.id}/publish`,{revision:draft.revision,class_id:classroom.id,subject_id:subject.id,startAt:new Date(Date.now()-60000).toISOString(),deadline:null,attempts:10,...options},teacher.cookie);
    };
    const questions=[
      {prompt:'Which protocol protects browser traffic with encryption?',options:['HTTPS','HTTP','FTP'],answer:0},
      {prompt:'Which SQL command reads rows from a table?',options:['SELECT','DELETE','DROP'],answer:0},
      {prompt:'Which data structure follows first-in, first-out order?',options:['Queue','Stack','Tree'],answer:0},
      {prompt:'What is 2 + 3?',options:['5','6','8'],answer:0},
      {prompt:'Which role submits student assessments?',options:['Student','Administrator','HOD'],answer:0},
    ];
    manifest.activities.quiz=(await publish({kind:'quiz',title:'Device Test - Computing Quiz',description:'Synthetic rehearsal quiz. Five questions, 10 marks, 15 minutes per attempt. Each device must use a different student login.',questions,tasks:questions.map((q,i)=>({title:`Question ${i+1}`,instructions:q.prompt,marks:2,criteria:'Select the correct answer.'}))},{durationMinutes:15})).id;
    manifest.activities.assignment=(await publish({kind:'assignment',title:'Device Test - Written Assignment',description:'Write different responses on each device. Wait for Saved, refresh, reopen and verify your own work before submitting.',tasks:[
      {title:'Database explanation',instructions:'Explain what a database stores. Include your test student number.',marks:5,criteria:'A clear explanation with a relevant example.'},
      {title:'Testing observations',instructions:'Describe the device/browser you used and one observation about FactX.',marks:5,criteria:'Identify the device/browser and describe your observation.'},
    ]})).id;
    manifest.activities.module=(await publish({kind:'module',title:'Device Test - Learning Module',description:'Complete these two lessons in order. Progress belongs to your student account.',lessons:[
      {title:'Getting started',content:'This workspace contains synthetic test accounts. Open Assessments to find your quiz and written assignment.'},
      {title:'Submit and review',content:'Wait for a submission receipt. Faculty can grade the written assignment and return feedback. Open your submission again to view the result.'},
    ]})).id;
    await post('/auth/logout',{},teacher.cookie);
    await post('/auth/logout',{},admin.cookie);
    manifest.ready=true;save();
    return {app,db,manifest};
  }catch(error){db.close();throw error;}
  finally{if(server)await new Promise(resolve=>server.close(resolve));}
}
