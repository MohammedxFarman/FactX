import {randomBytes} from 'node:crypto';
import nodemailer from 'nodemailer';
import {z} from 'zod';
import {digest,hashPassword,verifyPassword} from './security.js';
import {atomicWrite,rateLimit} from './write-safety.js';
import {emailConfiguration} from './runtime-config.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const tokenSchema=z.string().regex(/^[a-f0-9]{64}$/);
export function createAccounts({db,sendMail}){
 db.exec(`CREATE TABLE IF NOT EXISTS account_state(user_id TEXT PRIMARY KEY REFERENCES users(id),verified_at TEXT,onboarded_at TEXT,deleted_at TEXT);
 CREATE TABLE IF NOT EXISTS account_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS account_tokens_owner ON account_tokens(user_id,purpose);`);
 const mailReady=()=>!!sendMail||emailConfiguration(process.env).configured;
 const deliver=sendMail||(async(message)=>{
  const port=Number(process.env.SMTP_PORT||587);
  const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,requireTLS:port!==465,
   ...(process.env.SMTP_USER?{auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}:{}),connectionTimeout:10000,socketTimeout:15000});
  try{await transport.sendMail({from:process.env.MAIL_FROM,...message});}finally{transport.close();}
 });
 const issue=async(user,purpose)=>{
  const token=randomBytes(32).toString('hex');
  // Never derive links from the request Host header.
  const base=new URL(process.env.PUBLIC_URL||'http://localhost:3001');
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password)fail(503,'Account email service is not configured correctly.');
  base.pathname='/';base.search='';base.hash=`${purpose==='reset'?'reset-password':'verify-email'}?token=${token}`;
  db.prepare('DELETE FROM account_tokens WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO account_tokens VALUES(?,?,?,?)').run(digest(token),user.id,purpose,Date.now()+(purpose==='reset'?30:1440)*60000);
  try{await deliver({to:user.email,subject:purpose==='reset'?'Reset your FactX password':'Verify your FactX email',text:`${purpose==='reset'?'Reset your password':'Verify your email address'} using this single-use link:\n${base.href}\n\nThis link expires in ${purpose==='reset'?'30 minutes':'24 hours'}. If you did not request it, ignore this email.`});}
  catch{db.prepare('DELETE FROM account_tokens WHERE token_hash=?').run(digest(token));throw new Error('Account email delivery failed');}
 };
 const publicRoutes=app=>{
  app.get('/api/public/info',(_req,res)=>res.json({institution:process.env.INSTITUTION_NAME||'Your institution',contact:process.env.SUPPORT_EMAIL||null,mailConfigured:mailReady(),requireVerification:process.env.REQUIRE_EMAIL_VERIFICATION==='true'}));
  app.post('/api/auth/forgot-password',rateLimit(db,{name:'recovery-email',max:5,windowMs:3600000,key:req=>digest(String(req.body?.email||'').trim().toLowerCase())}),async(req,res)=>{
   const {email}=z.object({email:z.string().trim().email().max(254)}).strict().parse(req.body);
   if(!mailReady())fail(503,'Email recovery is not configured. Contact your institution administrator.');
   const user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email.toLowerCase());
   if(user){try{await issue(user,'reset');}catch{recordDeliveryFailure();}}
   res.json({message:'If an active account matches that address, a reset link will be sent. Contact your administrator if it does not arrive.'});
  });
  app.post('/api/auth/reset-password',atomicWrite(db,(req,res)=>{
   const {token,password}=z.object({token:tokenSchema,password:z.string().min(12).max(128)}).strict().parse(req.body);
   const record=db.prepare("SELECT t.*,u.active FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND purpose='reset' AND expires_at>?").get(digest(token),Date.now());
   if(!record?.active)fail(400,'This reset link is invalid or expired. Request a new link.');
   db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),record.user_id);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.user_id);
   db.prepare('DELETE FROM account_tokens WHERE user_id=?').run(record.user_id);
   res.json({message:'Password updated. Sign in with your new password.'});
  }));
  app.post('/api/auth/verify-email',atomicWrite(db,(req,res)=>{
   const {token}=z.object({token:tokenSchema}).strict().parse(req.body);
   const record=db.prepare("SELECT t.*,u.active FROM account_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND purpose='verify' AND expires_at>?").get(digest(token),Date.now());
   if(!record?.active)fail(400,'This verification link is invalid or expired. Request a new link from your account.');
   db.prepare('INSERT INTO account_state(user_id,verified_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET verified_at=excluded.verified_at').run(record.user_id,new Date().toISOString());
   db.prepare("DELETE FROM account_tokens WHERE user_id=? AND purpose='verify'").run(record.user_id);
   res.json({message:'Email verified. You can return to your workspace.'});
  }));
 };
 const recordDeliveryFailure=()=>{db.prepare("INSERT INTO operational_errors(id,kind,route,created_at) VALUES(?,?,?,?)").run(randomBytes(16).toString('hex'),'email_delivery','account-email',new Date().toISOString());};
 const protectedRoutes=app=>{
  app.post('/api/account/password',rateLimit(db,{name:'password-change',max:5,windowMs:15*60000}),atomicWrite(db,(req,res)=>{
   const {currentPassword,password}=z.object({currentPassword:z.string().max(128),password:z.string().min(12).max(128)}).strict().parse(req.body);
   if(!verifyPassword(currentPassword,req.user.password_hash))fail(403,'Your current password is incorrect.');
   db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),req.user.id);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
   db.prepare('DELETE FROM account_tokens WHERE user_id=?').run(req.user.id);
   res.clearCookie('factx_session',{path:'/'});
   res.json({message:'Password updated. Sign in with your new password.'});
  }));
  app.get('/api/account',(req,res)=>res.json({...db.prepare('SELECT verified_at,onboarded_at FROM account_state WHERE user_id=?').get(req.user.id),email:req.user.email,mailConfigured:mailReady()}));
  app.post('/api/account/send-verification',rateLimit(db,{name:'verification',max:3,windowMs:3600000}),async(req,res)=>{
   if(!mailReady())fail(503,'Email verification is not configured. Contact your institution administrator.');
   if(db.prepare('SELECT verified_at FROM account_state WHERE user_id=?').get(req.user.id)?.verified_at)return res.json({message:'Your email is already verified.'});
   try{await issue(req.user,'verify');}catch{recordDeliveryFailure();fail(503,'The verification email could not be delivered. Please try again later.');}
   res.json({message:'Verification email sent. Check your inbox.'});
  });
  app.post('/api/account/onboarding',atomicWrite(db,(req,res)=>{
   z.object({completed:z.literal(true)}).strict().parse(req.body);
   db.prepare('INSERT INTO account_state(user_id,onboarded_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET onboarded_at=excluded.onboarded_at').run(req.user.id,new Date().toISOString());res.json({ok:true});
  }));
  app.delete('/api/account',atomicWrite(db,(req,res)=>{
   const {password,confirmation}=z.object({password:z.string().max(128),confirmation:z.literal('DELETE')}).strict().parse(req.body);void confirmation;
   if(!verifyPassword(password,req.user.password_hash))fail(403,'Enter your current password to delete your account.');
   if(req.user.role==='ADMIN'&&db.prepare("SELECT COUNT(*) n FROM users WHERE role='ADMIN' AND active=1").get().n<=1)fail(409,'Assign another active administrator before deleting this account.');
   const uid=req.user.id;
   db.prepare("UPDATE users SET name='Deleted account',email=?,password_hash=?,roll_number=NULL,active=0 WHERE id=?").run(`deleted-${uid}@account.invalid`,hashPassword(randomBytes(32).toString('hex')),uid);
   for(const [table,column] of [['sessions','user_id'],['account_tokens','user_id'],['student_profile','user_id'],['ai_conversations','user_id'],['notifications','user_id'],['activity_work','student_id'],['request_receipts','user_id']])db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(uid);
   db.prepare('INSERT INTO account_state(user_id,deleted_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET verified_at=NULL,deleted_at=excluded.deleted_at').run(uid,new Date().toISOString());
   res.clearCookie('factx_session',{path:'/'});res.json({ok:true,message:'Your login and personal profile have been deleted. Institution-held academic records remain under institutional retention rules.'});
  }));
 };
 const verificationGate=(req,res,next)=>{
  if(process.env.REQUIRE_EMAIL_VERIFICATION==='true'&&!/^\/(auth|account)(\/|$)/.test(req.path)&&!db.prepare('SELECT verified_at FROM account_state WHERE user_id=?').get(req.user.id)?.verified_at)return res.status(403).json({error:'Verify your email from your account before accessing institutional records.',code:'EMAIL_VERIFICATION_REQUIRED'});
  next();
 };
 const verificationRequired=user=>process.env.REQUIRE_EMAIL_VERIFICATION==='true'&&!db.prepare('SELECT verified_at FROM account_state WHERE user_id=?').get(user.id)?.verified_at;
 return {publicRoutes,protectedRoutes,verificationGate,verificationRequired};
}
