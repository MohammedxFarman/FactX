import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRuntimeEnvironment} from '../server/runtime-config.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('production config rejects insecure cookies and placeholder services without exposing secrets',()=>{
 assert.doesNotThrow(()=>validateRuntimeEnvironment({}));
 const base={NODE_ENV:'production',COOKIE_SECURE:'true'};
 assert.doesNotThrow(()=>validateRuntimeEnvironment(base));
 assert.throws(()=>validateRuntimeEnvironment({...base,COOKIE_SECURE:'false'}),/COOKIE_SECURE/);
 assert.throws(()=>validateRuntimeEnvironment({...base,FACTX_SETUP_TOKEN:'replace-with-a-long-random-first-run-token'}),/setup token/);
 for(const value of ['file:///etc/passwd','https://user:private@host.test','https://host.test?key=private','https://your-sandbox.example']){
  try{validateRuntimeEnvironment({...base,JUDGE_URL:value});assert.fail('Invalid endpoint accepted');}catch(error){assert.match(error.message,/JUDGE_URL/);assert.ok(!error.message.includes('private'));}
 }
 assert.doesNotThrow(()=>validateRuntimeEnvironment({...base,OLLAMA_URL:'http://ollama:11434',JUDGE_URL:'https://sandbox.school.test',FACTX_SETUP_TOKEN:'c9'.repeat(32)}));
});
test('private environment file loads in a fresh process and cannot override orchestrator settings',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'factx-runtime-test-'));
 const filename=path.join(directory,'runtime.env');
 writeFileSync(filename,'COOKIE_SECURE=false\nOLLAMA_CHAT_MODEL=synthetic-test-model\n');
 const moduleUrl=new URL('../server/runtime-config.js',import.meta.url).href;
 const env={...process.env,NODE_ENV:'production',COOKIE_SECURE:'true',FACTX_ENV_FILE:filename};
 for(const key of ['FACTX_SETUP_TOKEN','OLLAMA_CHAT_MODEL','OLLAMA_URL','JUDGE_URL'])delete env[key];
 try{
  const output=execFileSync(process.execPath,['--input-type=module','-e',`import {loadRuntimeEnvironment} from ${JSON.stringify(moduleUrl)};loadRuntimeEnvironment();console.log(JSON.stringify({secure:process.env.COOKIE_SECURE,model:process.env.OLLAMA_CHAT_MODEL}));`],{cwd:directory,env,encoding:'utf8',windowsHide:true});
  assert.deepEqual(JSON.parse(output),{secure:'true',model:'synthetic-test-model'});
  assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',`import {loadRuntimeEnvironment} from ${JSON.stringify(moduleUrl)};loadRuntimeEnvironment();`],{cwd:directory,env:{...env,FACTX_ENV_FILE:path.join(directory,'missing.env')},stdio:'pipe',windowsHide:true}));
 }finally{
  assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(directory).startsWith('factx-runtime-test-'));
  rmSync(directory,{recursive:true,force:true});
 }
});
