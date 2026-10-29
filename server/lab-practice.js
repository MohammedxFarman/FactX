import { z } from 'zod';
import { validateAssessmentWindow } from './assessments.js';
const patterns={python:/^Python \(3/,javascript:/^JavaScript \(Node/,c:/^C \(GCC/,cpp:/^C\+\+ \(GCC/,java:/^Java \(/};
const encode=value=>Buffer.from(value,'utf8').toString('base64');
const decode=value=>value?Buffer.from(value,'base64').toString('utf8').slice(0,12000):'';
export function registerLabPractice({app,db,roles,activityFor}){
 const running=new Set();
 app.post('/api/activities/:id/run',roles('STUDENT'),async(req,res)=>{
  const activity=activityFor(req,req.params.id),config=JSON.parse(activity.config);
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  if(activity.kind!=='lab')fail(400,'Only coding labs support practice runs.');
  const input=z.object({content:z.string().trim().min(1).max(100000),input:z.string().max(10000).default(''),mode:z.enum(['custom','samples']).default('custom')}).parse(req.body);
  if(activity.deadline&&Date.parse(activity.deadline)<Date.now())fail(400,'The lab deadline has passed.');
  const attempts=db.prepare('SELECT COUNT(*) n FROM submissions WHERE activity_id=? AND student_id=?').get(activity.id,req.user.id).n;
  if(attempts>=(config.attempts||1))fail(400,'All permitted attempts have been submitted.');
  validateAssessmentWindow(db,activity,req.user,attempts+1);
  if(!process.env.JUDGE_URL)fail(503,'Practice execution needs an administrator-configured sandbox. Your work has not been submitted.');
  if(running.has(req.user.id)||running.size>=8)fail(429,'A practice run is already active. Please wait and try again.');
  const tests=input.mode==='samples'?(config.sampleTests||[]):[{input:input.input}];
  if(!tests.length)fail(400,'No public sample tests were provided for this lab. Use custom input.');
  running.add(req.user.id);
  const remote=async(route,options={})=>{const response=await fetch(process.env.JUDGE_URL.replace(/\/$/,'')+route,{...options,headers:{'Content-Type':'application/json',...(process.env.JUDGE_TOKEN?{'X-Auth-Token':process.env.JUDGE_TOKEN}:{})},redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Sandbox unavailable');return response.json();};
  try{
   const languages=await remote('/languages'),language=languages.filter(l=>patterns[config.language||'python'].test(l.name)).at(-1);
   if(!language)fail(503,'This lab language is unavailable on the sandbox.');
   const results=[];
   for(const [i,test] of tests.entries()){
    const job=await remote('/submissions?base64_encoded=true&wait=false',{method:'POST',body:JSON.stringify({source_code:encode(input.content),language_id:language.id,stdin:encode(test.input),...(test.output!==undefined?{expected_output:encode(test.output)}:{}),cpu_time_limit:config.timeLimit||2,wall_time_limit:Math.min((config.timeLimit||2)*3,30),memory_limit:config.memoryLimit||64000,max_file_size:1024,enable_network:false})});
    if(!job.token)throw new Error('No sandbox token');
    let result;
    for(let poll=0;poll<30;poll++){await new Promise(resolve=>setTimeout(resolve,500));result=await remote(`/submissions/${encodeURIComponent(job.token)}?base64_encoded=true&fields=status,stdout,stderr,compile_output,time,memory`);if(result.status?.id>2)break;}
    if(!result?.status||result.status.id<=2||result.status.id>=13)throw new Error('Sandbox evaluation did not complete successfully');
    results.push({test:i+1,status:result.status.description,passed:result.status.id===3,stdout:decode(result.stdout),stderr:decode(result.stderr)||decode(result.compile_output),timeSeconds:result.time});
   }
   res.json({mode:input.mode,tests:results});
  }catch(error){if(error.status)throw error;fail(503,'The sandbox could not finish the practice run. Please try again.');}finally{running.delete(req.user.id);}
 });
}
