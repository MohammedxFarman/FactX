export function track(body:{type:'page';page:string}|{type:'error';kind:'render'|'unhandled'|'network'}){
 void fetch('/api/telemetry',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});
}
export function installErrorTracking(){
 window.addEventListener('error',()=>track({type:'error',kind:'unhandled'}));
 window.addEventListener('unhandledrejection',()=>track({type:'error',kind:'unhandled'}));
}
