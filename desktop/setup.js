const input=document.querySelector('#server'),button=document.querySelector('#connect'),status=document.querySelector('#status');
window.factxSetup.server().then(value=>{input.value=value;}).catch(()=>{status.textContent='Could not read saved settings. Enter the server address again.';});
document.querySelector('#setup').addEventListener('submit',async event=>{
 event.preventDefault();button.disabled=true;status.textContent='Connecting…';
 try{const result=await window.factxSetup.connect(input.value);if(!result.ok)status.textContent=result.error;}
 catch{status.textContent='Could not connect. Please try again.';}
 finally{button.disabled=false;}
});
