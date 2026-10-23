if(import.meta.env.PROD&&'serviceWorker' in navigator){
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{
   // Installation support is optional; normal online use remains available.
  });
 });
}
