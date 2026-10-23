function serverOrigin(value){
 if(typeof value!=='string'||value.length>2048)throw new Error('Enter your institution’s HTTPS server address.');
 let url;try{url=new URL(value.trim());}catch{throw new Error('Enter a complete address, such as https://factx.example.edu.');}
 const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('Use HTTPS. HTTP is only allowed for a server running on this laptop.');
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use the server origin only, without a path, login details, query or fragment.');
 return url.origin;
}
function sameOrigin(value,origin){try{return new URL(value).origin===origin;}catch{return false;}}
module.exports={serverOrigin,sameOrigin};
