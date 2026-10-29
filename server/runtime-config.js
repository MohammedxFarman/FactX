import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
export function loadRuntimeEnvironment(){
 const configured=process.env.FACTX_ENV_FILE;
 if(configured)loadEnvFile(configured);
 else if(existsSync('.env'))loadEnvFile('.env');
 validateRuntimeEnvironment(process.env);
}
export function validateRuntimeEnvironment(env){
 const email=emailConfiguration(env);
 if(email.error)throw new Error(email.error);
 if(env.REQUIRE_EMAIL_VERIFICATION==='true'&&!email.configured)throw new Error('REQUIRE_EMAIL_VERIFICATION requires working SMTP and PUBLIC_URL settings.');
 if(env.FACTX_BACKUP_DIR){const hours=Number(env.BACKUP_INTERVAL_HOURS||24);if(!Number.isFinite(hours)||hours<1||hours>168)throw new Error('BACKUP_INTERVAL_HOURS must be between 1 and 168.');}
 if(env.NODE_ENV!=='production')return;
 if(env.COOKIE_SECURE!=='true')throw new Error('Production requires COOKIE_SECURE=true and an HTTPS reverse proxy.');
 if(env.FACTX_SETUP_TOKEN&&(/replace|placeholder|your-/i.test(env.FACTX_SETUP_TOKEN)||env.FACTX_SETUP_TOKEN.length<32))throw new Error('Production setup token must be a random secret of at least 32 characters, or omitted for automatic generation.');
 for(const key of ['OLLAMA_URL','JUDGE_URL']){
  if(!env[key])continue;
  let url;try{url=new URL(env[key]);}catch{throw new Error(`${key} must be an HTTP(S) service URL.`);}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.hostname.endsWith('.example'))throw new Error(`${key} must be a real HTTP(S) service URL without embedded credentials or query parameters.`);
 }
}

export function emailConfiguration(env){
 const configured=!!(env.SMTP_HOST&&env.MAIL_FROM&&env.PUBLIC_URL);
 const started=!!(env.SMTP_HOST||env.SMTP_USER||env.SMTP_PASSWORD||env.MAIL_FROM);
 if(!started)return {configured:false};
 if(!configured)return {configured:false,error:'Email requires SMTP_HOST, MAIL_FROM and PUBLIC_URL.'};
 const port=Number(env.SMTP_PORT||587);
 if(!Number.isInteger(port)||port<1||port>65535)return {configured:false,error:'SMTP_PORT must be an integer between 1 and 65535.'};
 if(!!env.SMTP_USER!==!!env.SMTP_PASSWORD)return {configured:false,error:'Set both SMTP_USER and SMTP_PASSWORD, or neither for an authorized relay.'};
 try{const url=new URL(env.PUBLIC_URL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname.endsWith('.example')||(env.NODE_ENV==='production'&&url.protocol!=='https:'))throw new Error();}
 catch{return {configured:false,error:'PUBLIC_URL must be the application origin without credentials, a path, query or fragment; use HTTPS in production.'};}
 return {configured:true};
}
