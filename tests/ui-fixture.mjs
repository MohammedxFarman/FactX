import {createServer} from 'node:http';
import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.js';
import {startExecutionWorker} from '../server/execution.js';
export function chromiumPath(){const root=path.join(homedir(),'AppData/Local/ms-playwright');return existsSync(root)?readdirSync(root).filter(n=>/^chromium-\d+$/.test(n)).flatMap(n=>['chrome-win64/chrome.exe','chrome-win/chrome.exe'].map(p=>path.join(root,n,p))).find(existsSync):undefined;}
export async function fixture(options={}){
 const directory=mkdtempSync(path.join(tmpdir(),'factx-redesign-'));
 const sandbox=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/languages')return res.end(JSON.stringify([{id:71,name:'Python (3.12)'}]));if(req.method==='POST'){for await(const _chunk of req){/* Consume the controlled request body. */}return res.end(JSON.stringify({token:'controlled-test-token'}));}res.end(JSON.stringify({status:{id:3,description:'Accepted'},stdout:Buffer.from('5\n').toString('base64'),time:'0.01',memory:1024}));});
 await new Promise(r=>sandbox.listen(0,'127.0.0.1',r));const previous=process.env.JUDGE_URL;process.env.JUDGE_URL=`http://127.0.0.1:${sandbox.address().port}`;
 const {app,db}=createApp({dataDir:directory,setupToken:'redesign-test-setup',...options});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(route,body,cookie,method=body?'POST':'GET')=>{const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify({route,data}));return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 const password='Synthetic-browser-password-284';const admin=(await request('/auth/setup',{name:'Design Admin',email:'admin@redesign.invalid',password,token:'redesign-test-setup'})).cookie;
 const post=async(route,body)=>(await request(route,body,admin)).data;
 const dept=await post('/departments',{name:'Computer Science',code:'CS'});const classroom=await post('/classes',{name:'Computer Science · Semester 3',department_id:dept.id,semester:3});const subject=await post('/subjects',{name:'Data Structures & Algorithms',code:'DSA',department_id:dept.id});const faculty=await post('/users',{name:'Taylor Faculty',email:'faculty@redesign.invalid',password,role:'FACULTY',department_id:dept.id});const student=await post('/users',{name:'Alex Student',email:'student@redesign.invalid',password,role:'STUDENT',department_id:dept.id,class_id:classroom.id,roll_number:'SYNTHETIC-001'});await post('/teaching-assignments',{faculty_id:faculty.id,class_id:classroom.id,subject_id:subject.id});
 const common={class_id:classroom.id,subject_id:subject.id,max_marks:100,deadline:new Date(Date.now()+86400000*7).toISOString()};
 const lab=await post('/activities',{...common,kind:'lab',title:'Add two integers',description:'Read two integers and print their sum.\nInput: two space-separated integers.\nOutput: their sum.',config:{language:'python',attempts:3,durationMinutes:30,week:1,testCases:[{input:'7 8',output:'15'}],sampleTests:[{input:'2 3',output:'5'}]}});
 await post('/activities',{...common,kind:'assignment',title:'Algorithm analysis reflection',description:'Explain the time complexity of binary search.'});
 await post('/activities',{...common,kind:'module',title:'Foundations of data structures',description:'Notes for the first unit.',config:{materialType:'notes'}});
 await post('/timetable',{class_id:classroom.id,subject_id:subject.id,faculty_id:faculty.id,day_of_week:new Date().getDay(),start_time:'09:00',end_time:'10:00',room:'Learning Studio 2'});
 for(let i=0;i<8;i++){const date=new Date(Date.now()-i*86400000).toISOString().slice(0,10);await post('/attendance',{class_id:classroom.id,subject_id:subject.id,date,period:1,records:[{student_id:student.id,status:i<5?'present':'absent'}]});}
 const stop=startExecutionWorker(db);
 return {base,db,directory,lab,student,subject,classroom,password,admin,request,close:async()=>{stop();await new Promise(r=>server.close(r));await new Promise(r=>sandbox.close(r));db.close();if(previous===undefined)delete process.env.JUDGE_URL;else process.env.JUDGE_URL=previous;const resolved=path.resolve(directory);if(!resolved.startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(resolved).startsWith('factx-redesign-'))throw new Error('Unexpected fixture directory');rmSync(resolved,{recursive:true,force:true});}};
}
