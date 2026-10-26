import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {listen} from '../server/listen.js';
import {readApiResponse} from '../src/lib/response.js';
import {createServer} from 'vite';
import viteConfig from '../vite.config.js';

test('occupied port rejects startup instead of reporting success',async()=>{
 const server=await listen(express(),{port:0});
 try{await assert.rejects(listen(express(),{port:server.address().port}),{code:'EADDRINUSE'});}finally{await new Promise(resolve=>server.close(resolve));}
});
test('empty proxy failure reproduces JSON error and provides actionable error',async()=>{
 await assert.rejects(new Response('',{status:500}).json(),SyntaxError);
 await assert.rejects(readApiResponse(new Response('',{status:500})),/Request failed \(500\)/);
 await assert.rejects(readApiResponse(new Response('<html>Gateway error</html>',{status:502})),/API server is unavailable/);
 await assert.rejects(readApiResponse(new Response('{bad',{status:200})),/invalid JSON/);
 assert.deepEqual(await readApiResponse(Response.json({students:0})),{students:0});
 assert.equal(await readApiResponse(Response.json(null)),null,'An unstarted assessment has no session yet');
 await assert.rejects(readApiResponse(new Response('',{status:200})),/empty response/);
 assert.equal(await readApiResponse(new Response(null,{status:204})),null);
});
test('Vite returns JSON 503 when the API connection is refused',async()=>{
 const temporary=await listen(express(),{port:0}),port=temporary.address().port;await new Promise(r=>temporary.close(r));
 const vite=await createServer({configFile:false,logLevel:'silent',server:{host:'127.0.0.1',port:0,proxy:{'/api':{...viteConfig.server.proxy['/api'],target:`http://127.0.0.1:${port}`}}}});
 try{await vite.listen();const r=await fetch(`http://127.0.0.1:${vite.httpServer.address().port}/api/catalog`);assert.equal(r.status,503);assert.match(r.headers.get('content-type'),/json/);assert.match((await r.json()).error,/API server is unavailable/);}finally{await vite.close();}
});
