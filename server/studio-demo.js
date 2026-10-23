// Faculty-only draft checks use the same separate sandbox protocol as student labs.
// No submitted code runs in the application process.
const patterns={python:/^Python \(3/,javascript:/^JavaScript \(Node/,c:/^C \(GCC/,cpp:/^C\+\+ \(GCC/,java:/^Java \(/};
const encode=text=>Buffer.from(text,'utf8').toString('base64');
export async function runDraftChecks(blueprint,content){
 if(!process.env.JUDGE_URL)throw Object.assign(new Error('Connect the isolated code sandbox to run the demo checks.'),{status:503});
 const remote=async(route,body)=>{const r=await fetch(process.env.JUDGE_URL.replace(/\/$/,'')+route,{method:body?'POST':'GET',redirect:'error',headers:{'Content-Type':'application/json',...(process.env.JUDGE_TOKEN?{'X-Auth-Token':process.env.JUDGE_TOKEN}:{})},signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error('Sandbox request failed');return r.json();};
 try{
  const languages=await remote('/languages'),language=languages.filter(l=>patterns[blueprint.language].test(l.name)).at(-1);
  if(!language)throw new Error('Language unavailable');
  const checks=[];
  for(const t of blueprint.testCases){
   const job=await remote('/submissions?base64_encoded=true&wait=false',{source_code:encode(content),language_id:language.id,stdin:encode(t.input),expected_output:encode(t.output),cpu_time_limit:2,wall_time_limit:6,memory_limit:64000,max_file_size:1024,enable_network:false});
   if(!job.token)throw new Error('No sandbox token');
   let result;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));result=await remote(`/submissions/${encodeURIComponent(job.token)}?base64_encoded=true&fields=status`);if(result.status?.id>2)break;}
   if(!result?.status||result.status.id<=2||result.status.id>=13)throw new Error('Sandbox did not complete evaluation');
   checks.push({task:t.task,passed:result.status.id===3,status:result.status.description});
  }
  return {tasks:blueprint.tasks.map((t,i)=>({title:t.title,score:checks.filter(c=>c.task===i).every(c=>c.passed)?t.marks:0,max_marks:t.marks})),checks};
 }catch{throw Object.assign(new Error('The sandbox could not complete this demo. No score or student submission was saved.'),{status:503});}
}
