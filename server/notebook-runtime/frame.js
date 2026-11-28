const kernelURL=new URL('./kernel.js',location.href);
window.addEventListener('message',async event=>{
  if(event.source!==parent || !event.ports.length)return;
  const port=event.ports[0];
  try {
    const response=await fetch(kernelURL,{credentials:'omit'});
    if(!response.ok)throw new Error('Python kernel is unavailable.');
    const url=URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'}));
    const worker=new Worker(url);
    worker.onmessage=e=>port.postMessage(e.data);
    worker.onerror=e=>port.postMessage({error:e.message||'Python stopped unexpectedly.'});
    port.onmessage=e=>worker.postMessage(e.data);
    worker.postMessage({base:new URL('./',kernelURL).href});
  }catch(error){port.postMessage({error:error.message});}
},{once:true});
