import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
export function loadRuntimeEnvironment(){
 const configured=process.env.FACTX_ENV_FILE;
 if(configured)loadEnvFile(configured);
 else if(existsSync('.env'))loadEnvFile('.env');
 validateRuntimeEnvironment(process.env);
}
export function validateRuntimeEnvironment(env){
 if(env.NODE_ENV!=='production')return;
 if(env.COOKIE_SECURE!=='true')throw new Error('Production requires COOKIE_SECURE=true and an HTTPS reverse proxy.');
 if(env.FACTX_SETUP_TOKEN&&(/replace|placeholder|your-/i.test(env.FACTX_SETUP_TOKEN)||env.FACTX_SETUP_TOKEN.length<32))throw new Error('Production setup token must be a random secret of at least 32 characters, or omitted for automatic generation.');
 for(const key of ['OLLAMA_URL','JUDGE_URL']){
  if(!env[key])continue;
  let url;try{url=new URL(env[key]);}catch{throw new Error(`${key} must be an HTTP(S) service URL.`);}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.hostname.endsWith('.example'))throw new Error(`${key} must be a real HTTP(S) service URL without embedded credentials or query parameters.`);
 }
}
