import {createHash} from 'node:crypto';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function initWriteSafety(db){
 db.exec(`CREATE TABLE IF NOT EXISTS request_receipts(
  user_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL, response TEXT NOT NULL, expires_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,request_key));`);
}
// Synchronous handlers only: never keep a SQLite transaction open across an await.
// The mutation, audit entries and replay receipt commit before sending the response.
export function atomicWrite(db,handler){
 return (req,res,next)=>{
  const key=req.get('Idempotency-Key');
  if(key&&!/^[A-Za-z0-9_-]{16,128}$/.test(key))return next(Object.assign(new Error('Use a valid Idempotency-Key (16–128 letters, numbers, underscores or hyphens).'),{status:400}));
  const owner=req.user?.id||'setup';
  const fingerprint=createHash('sha256').update(JSON.stringify([req.method,req.originalUrl,req.body])).digest('hex');
  const original=res.json;let body,responded=false,forwarded=false;
  db.exec('SAVEPOINT atomic_write');
  try{
   db.prepare('DELETE FROM request_receipts WHERE expires_at < ?').run(Date.now());
   const receipt=key&&db.prepare('SELECT * FROM request_receipts WHERE user_id=? AND request_key=?').get(owner,key);
   if(receipt){
    if(receipt.fingerprint!==fingerprint)fail(409,'This request key was already used with different data.');
    db.exec('RELEASE atomic_write');res.set('Idempotency-Replayed','true');return res.status(receipt.status).json(JSON.parse(receipt.response));
   }
   res.json=value=>{body=value;responded=true;return res;};
   const result=handler(req,res,error=>{forwarded=true;if(error)throw error;});
   if(result&&typeof result.then==='function')throw new Error('Atomic writes must be synchronous');
   if(key&&responded&&res.statusCode<400)db.prepare('INSERT INTO request_receipts VALUES(?,?,?,?,?,?)').run(owner,key,fingerprint,res.statusCode,JSON.stringify(body),Date.now()+86400000);
   db.exec('RELEASE atomic_write');res.json=original;
   if(responded)return res.json(body);
   if(forwarded)return next();
  }catch(error){db.exec('ROLLBACK TO atomic_write; RELEASE atomic_write');res.json=original;next(error);}
 };
}

export function rateLimit(db,{name,max,windowMs,key=req=>req.user?.id||req.ip}){
 db.exec('CREATE TABLE IF NOT EXISTS rate_windows(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,until_ms INTEGER NOT NULL)');
 return(req,res,next)=>{
  const now=Date.now(),bucket=name+':'+key(req);
  db.prepare('DELETE FROM rate_windows WHERE until_ms < ?').run(now);
  const row=db.prepare(`INSERT INTO rate_windows VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count,until_ms`).get(bucket,now+windowMs);
  if(row.count>max){res.set('Retry-After',String(Math.max(1,Math.ceil((row.until_ms-now)/1000))));return next(Object.assign(new Error('Too many requests. Please wait and try again.'),{status:429}));}
  next();
 };
}
