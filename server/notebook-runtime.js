import express from 'express';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const directory=path.dirname(require.resolve('pyodide'));
const lock=JSON.parse(readFileSync(path.join(directory,'pyodide-lock.json'),'utf8'));
const wheels=new Set(Object.values(lock.packages).map(pkg=>pkg.file_name));
const assets=new Set(['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']);

export function notebookRuntime() {
  const router=express.Router();
  router.get('/frame', (req,res)=>{
    const origin=new URL(req.protocol+'://'+req.get('host')).origin;
    const runtime=origin+'/notebook-runtime/ https://'+new URL(origin).host+'/notebook-runtime/';
    res.removeHeader('X-Frame-Options');
    res.set('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; frame-ancestors 'self'; base-uri 'none'; worker-src blob:; script-src "+runtime+" 'unsafe-eval'; connect-src "+runtime);
    res.type('html').send('<!doctype html><title>Python kernel</title><script src="./frame.js"></script>');
  });
  router.get('/:name',async (req,res)=>{
    const name=req.params.name;
    res.set('Access-Control-Allow-Origin','*');
    if(assets.has(name))return res.sendFile(path.join(directory,name));
    if(wheels.has(name)){
      try{
        const source=await fetch('https://cdn.jsdelivr.net/pyodide/v'+lock.info.version+'/full/'+name,{signal:AbortSignal.timeout(90000)});
        if(!source.ok||!source.body)return res.sendStatus(502);
        res.type('application/octet-stream').set('Cache-Control','public,max-age=31536000,immutable');
        await pipeline(Readable.fromWeb(source.body),res);
      }catch{if(!res.headersSent)res.sendStatus(502);}
      return;
    }
    if(['frame.js','kernel.js'].includes(name))return res.sendFile(path.resolve('server/notebook-runtime',name));
    res.sendStatus(404);
  });
  return router;
}
