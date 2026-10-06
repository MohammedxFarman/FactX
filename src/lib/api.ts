import type { Api } from './types';
const cache=new Map<string,{at:number;value:unknown}>();
const pending=new Map<string,Promise<unknown>>();
let generation=0;
export function clearCache(){generation++;cache.clear();pending.clear();}
export const api:Api=async<T,>(url:string,options:Parameters<Api>[1]={}):Promise<T>=>{
  const method=options.method||'GET';
  const cached=cache.get(url);
  // Keep mutable workflow and academic records fresh. The shell can cache stable
  // catalogue data, but leave requests, attendance, assessments and dashboard
  // summaries change during a session and may be updated by another role.
  const cacheable=method==='GET'&&!/auth|session|submissions|events|notifications|timetable\/drafts|leave|substitutions|support-plans|syllabus|academic-monitoring|inbox|attendance|activities|dashboard|grades|feedback|students/.test(url);
  if(cacheable&&cached&&Date.now()-cached.at<20000)return cached.value as T;
  if(cacheable&&pending.has(url))return pending.get(url) as Promise<T>;
  if(method!=='GET')clearCache();
  const requestGeneration=generation;
  const request=(async()=>{
    const response=await fetch('/api'+url,{credentials:'same-origin',method,signal:options.signal,headers:options.body instanceof FormData?{}:{'Content-Type':'application/json'},body:options.body instanceof FormData?options.body:options.body?JSON.stringify(options.body):undefined});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'Unable to load this information.'),{status:response.status,details:data});
    if(cacheable&&requestGeneration===generation)cache.set(url,{at:Date.now(),value:data});
    return data as T;
  })();
  if(cacheable)pending.set(url,request);
  try{return await request;}finally{if(pending.get(url)===request)pending.delete(url);}
};
export function prefetch(url:string){void api(url).catch(()=>undefined);}
