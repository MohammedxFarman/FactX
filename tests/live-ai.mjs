// Explicit acceptance check: sends synthetic material to configured Ollama only.
// Uses a temporary application database; never reads institutional records.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {createCanvas} from '@napi-rs/canvas';
import {fixture} from './ui-fixture.mjs';

const env=parseEnv(readFileSync(process.env.FACTX_ENV_FILE||'.env','utf8'));
for(const key of ['OLLAMA_URL','OLLAMA_CHAT_MODEL','OLLAMA_EMBED_MODEL','OLLAMA_VISION_MODEL','OLLAMA_API_KEY'])if(env[key])process.env[key]=env[key];
for(const key of ['OLLAMA_URL','OLLAMA_CHAT_MODEL','OLLAMA_EMBED_MODEL','OLLAMA_VISION_MODEL'])assert.ok(process.env[key],`Configure ${key} before running live AI acceptance.`);
const f=await fixture();
const call=async(route,body)=>{
 const r=await fetch(f.base+'/api'+route,{method:'POST',headers:{Cookie:f.admin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});
 const data=await r.json();assert.ok(r.ok,`${route}: HTTP ${r.status}: ${data.error||'request failed'}`);return data;
};
let failures=0;
const check=async(name,run)=>{try{await run();console.log('PASS: '+name);}catch(error){failures++;console.error('FAIL: '+name+' — '+error.message);}};
try{
 await check('live document embeddings and cited answer',async()=>{
  const form=new FormData();form.set('name','Synthetic library policy');form.set('kind','institutional');form.set('student_id',f.student.id);
  form.set('file',new Blob(['Synthetic test policy: the library opens at 09:30 on Monday. The library closes at 17:00 on Monday.'],{type:'text/plain'}),'synthetic-policy.txt');
  const document=await call('/documents',form);await call('/knowledge/'+document.id+'/index',{});
  const answer=await call('/assistant',{message:'According to the synthetic library policy, when does the library open on Monday? Cite the policy.'});
  assert.equal(answer.mode,'rag');assert.match(answer.answer,/09:30|9:30/);assert.match(answer.answer,/\[D1\]/);
  assert.ok(answer.sources.some(source=>source.document_id===document.id));
 });
 await check('live assessment draft generation',async()=>{
  const form=new FormData();form.set('prompt','Create an assignment with exactly two short tasks about binary search, worth 2 marks each. Each task needs student instructions and visible grading criteria. No quiz, lessons or coding tests.');
  const draft=await call('/assessment-studio/generate',form);
  assert.equal(draft.blueprint.kind,'assignment');assert.equal(draft.blueprint.tasks.length,2);assert.equal(draft.activity_id,null);
 });
 const lines=['Class: Computer Science · Semester 3','Subject: Data Structures & Algorithms','Faculty: Taylor Faculty','Monday 13:00 to 14:00','Room: Synthetic Room 8'];
 const extraction=async(buffer,type,name)=>{
  const form=new FormData();form.set('instruction','Extract the one Monday session in this synthetic timetable.');form.set('file',new Blob([buffer],{type}),name);
  const draft=await call('/assistant/timetable/drafts',form);
  assert.equal(draft.rows.length,1);assert.equal(draft.rows[0].day_of_week,1);assert.equal(draft.rows[0].start_time,'13:00');assert.equal(draft.rows[0].end_time,'14:00');
  assert.equal(draft.rows[0].class_id,f.classroom.id);assert.equal(draft.rows[0].subject_id,f.subject.id);
 };
 await check('live text PDF timetable extraction',async()=>{
  const pdf=new PDFDocument(),chunks=[];pdf.on('data',chunk=>chunks.push(chunk));const done=new Promise(resolve=>pdf.on('end',resolve));
  pdf.fontSize(18).text('Synthetic timetable').moveDown();for(const line of lines)pdf.fontSize(14).text(line);pdf.end();await done;
  await extraction(Buffer.concat(chunks),'application/pdf','synthetic-timetable.pdf');
 });
 await check('live image timetable extraction',async()=>{
  const canvas=createCanvas(1200,480),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,480);ctx.fillStyle='black';ctx.font='30px Arial';
  ['Synthetic timetable',...lines].forEach((line,i)=>ctx.fillText(line,35,55+i*65));
  await extraction(canvas.toBuffer('image/png'),'image/png','synthetic-timetable.png');
 });
}finally{await f.close();}
if(failures)process.exitCode=1;
