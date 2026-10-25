import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {academicCounts,studentScope} from './academic-schema.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const text=z.string().trim().min(1).max(120);
const id=z.string().min(1).max(120);
const transaction=(db,fn)=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
export function registerAcademicManagement({app,db,roles,audit}){
 const admin=roles('ADMIN');
 const program=p=>{const row=db.prepare('SELECT * FROM programs WHERE id=?').get(p);if(!row)fail('Program not found.',404);return row;};
 const department=(d,p)=>{if(!db.prepare('SELECT 1 FROM program_departments WHERE department_id=? AND program_id=?').get(d,p))fail('Department does not belong to this program.');};
 const hod=(uid,d)=>{if(uid&&!db.prepare("SELECT 1 FROM users WHERE id=? AND role='HOD' AND active=1 AND department_id=?").get(uid,d))fail('Choose an active HOD from this department.');};
 const catalog=req=>{
  const all=req.user.role==='ADMIN',pd=db.prepare('SELECT pd.*,d.name,d.code,h.name hod_name FROM program_departments pd JOIN departments d ON d.id=pd.department_id LEFT JOIN users h ON h.id=pd.hod_id').all().filter(r=>all||r.department_id===req.user.department_id);
  const allowed=new Set(pd.map(r=>r.department_id));
  const sections=db.prepare(`SELECT s.*,b.program_id,b.department_id,b.admission_year,b.status,c.name,c.semester,p.name program,d.code department_code,t.name class_teacher,
   (SELECT count(*) FROM users u WHERE u.class_id=c.id AND u.role='STUDENT') students
   FROM academic_sections s JOIN admission_batches b ON b.id=s.batch_id JOIN classes c ON c.id=s.class_id JOIN programs p ON p.id=b.program_id JOIN departments d ON d.id=b.department_id LEFT JOIN users t ON t.id=s.class_teacher_id`).all().filter(r=>req.scope.canClass(r.class_id));
  return {programs:db.prepare('SELECT * FROM programs ORDER BY name').all().filter(p=>all||pd.some(d=>d.program_id===p.id)),departments:pd,
   batches:db.prepare('SELECT * FROM admission_batches ORDER BY admission_year DESC').all().filter(b=>all||allowed.has(b.department_id)),sections,
   faculty:db.prepare("SELECT u.id,u.name,u.email,u.role,u.active,f.program_id,f.department_id FROM faculty_programs f JOIN users u ON u.id=f.user_id WHERE u.role IN ('FACULTY','HOD') ORDER BY u.name").all().filter(r=>all||req.user.role==='HOD'&&allowed.has(r.department_id)||r.id===req.user.id)};
 };
 app.get('/api/academics/catalog',(req,res)=>res.json(catalog(req)));
 app.get('/api/academics/summary',(req,res)=>{
  const c=catalog(req);
  if(req.user.role==='ADMIN')return res.json({programs:c.programs.map(p=>({...p,counts:academicCounts(db,p.id)}))});
  res.json({programs:c.programs.map(p=>{const sections=c.sections.filter(s=>s.program_id===p.id);return {...p,counts:{departments:c.departments.filter(d=>d.program_id===p.id).length,sections:sections.length,students:req.user.role==='STUDENT'?1:sections.reduce((n,s)=>n+s.students,0),faculty:c.faculty.filter(f=>f.program_id===p.id&&f.role==='FACULTY').length,hods:c.departments.filter(d=>d.program_id===p.id&&d.hod_id).length,batches:new Set(sections.map(s=>s.batch_id)).size,academicYears:new Set(sections.map(s=>s.academic_year)).size,classTeachers:sections.filter(s=>s.class_teacher_id).length}};})});
 });
 app.get('/api/academics/people',(req,res)=>{
  const v=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(50),q:z.string().max(120).default(''),role:z.enum(['STUDENT','FACULTY','HOD','ADMIN']).default('STUDENT'),program_id:z.string().optional(),department_id:z.string().optional(),batch_id:z.string().optional(),academic_year:z.coerce.number().int().min(1).max(10).optional(),class_id:z.string().optional()}).parse(req.query);
  if(v.role==='ADMIN'&&req.user.role!=='ADMIN')fail('Administrator access required.',403);
  if(req.user.role==='STUDENT'&&v.role!=='STUDENT')fail('Student records only.',403);
  const scope=studentScope(req.user);const where=['u.role=?'],params=[v.role];
  if(v.role==='STUDENT'){where.push(scope.sql);params.push(...scope.params);}else if(req.user.role==='HOD'){where.push('u.department_id=?');params.push(req.user.department_id);}else if(req.user.role!=='ADMIN'){where.push('u.id=?');params.push(req.user.id);}
  if(v.q){where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.roll_number LIKE ? ESCAPE '\\' OR u.id LIKE ? ESCAPE '\\')");params.push(...Array(4).fill('%'+v.q.replace(/[\\%_]/g,'\\$&')+'%'));}
  for(const [key,column]of Object.entries({program_id:'pd.program_id',department_id:'u.department_id',batch_id:'s.batch_id',academic_year:'s.academic_year',class_id:'u.class_id'}))if(v[key]){where.push(`${column}=?`);params.push(v[key]);}
  const from=`FROM users u LEFT JOIN classes c ON c.id=u.class_id LEFT JOIN academic_sections s ON s.class_id=c.id LEFT JOIN admission_batches b ON b.id=s.batch_id LEFT JOIN program_departments pd ON pd.department_id=u.department_id LEFT JOIN programs p ON p.id=pd.program_id LEFT JOIN departments d ON d.id=u.department_id WHERE ${where.join(' AND ')}`;
  const total=db.prepare('SELECT count(*) total '+from).get(...params).total;
  const rows=db.prepare(`SELECT u.id,u.name,u.email,u.role,u.active,u.roll_number,u.class_id,u.department_id,c.name class_name,p.id program_id,p.name program,d.code department,b.admission_year,s.batch_id,s.academic_year,s.section,EXISTS(SELECT 1 FROM academic_test_accounts t WHERE t.user_id=u.id) test_account ${from} ORDER BY u.name,u.id LIMIT ? OFFSET ?`).all(...params,v.limit,(v.page-1)*v.limit);
  for(const row of rows)if(row.role==='FACULTY')row.assigned_sections=db.prepare('SELECT c.id,c.name FROM academic_sections s JOIN classes c ON c.id=s.class_id WHERE s.class_teacher_id=?').all(row.id);
  res.json({rows,total,page:v.page,limit:v.limit});
 });
 app.post('/api/academics/programs',admin,(req,res)=>{
  const v=z.object({code:text,name:text,duration:z.coerce.number().int().min(1).max(10).nullable(),roll_rule:z.string().max(200).default(''),email_domain:z.string().max(120).default('')}).parse(req.body),uid=randomUUID();
  db.prepare('INSERT INTO programs(id,code,name,duration,roll_rule,email_domain) VALUES(?,?,?,?,?,?)').run(uid,v.code,v.name,v.duration,v.roll_rule,v.email_domain);audit(req.user,'program.created','programs',uid);res.status(201).json({id:uid});
 });
 app.patch('/api/academics/programs/:id',admin,(req,res)=>{
  const v=z.object({name:text,duration:z.coerce.number().int().min(1).max(10),roll_rule:z.string().max(200),email_domain:z.string().max(120),status:z.enum(['active','configuration_required'])}).parse(req.body);program(req.params.id);
  if(db.prepare('SELECT 1 FROM admission_batches WHERE program_id=? AND current_year>?').get(req.params.id,v.duration))fail('Duration cannot exclude existing academic years.');
  if(v.status==='active'&&(!v.roll_rule||!v.email_domain))fail('Configure identifier and email rules before activating the program.');
  db.prepare('UPDATE programs SET name=?,duration=?,roll_rule=?,email_domain=?,status=? WHERE id=?').run(v.name,v.duration,v.roll_rule,v.email_domain,v.status,req.params.id);audit(req.user,'program.updated','programs',req.params.id);res.json({ok:true});
 });
 app.post('/api/academics/departments',admin,(req,res)=>{
  const v=z.object({program_id:id,name:text,code:text}).parse(req.body);program(v.program_id);
  const uid=randomUUID();transaction(db,()=>{db.prepare('INSERT INTO departments VALUES(?,?,?)').run(uid,v.name,v.code);db.prepare('INSERT INTO program_departments(department_id,program_id) VALUES(?,?)').run(uid,v.program_id);});audit(req.user,'department.created','departments',uid);res.status(201).json({id:uid});
 });
 app.patch('/api/academics/departments/:id',admin,(req,res)=>{
  const v=z.object({name:text,code:text,hod_id:id.nullable()}).parse(req.body);if(!db.prepare('SELECT 1 FROM program_departments WHERE department_id=?').get(req.params.id))fail('Department not found.',404);hod(v.hod_id,req.params.id);
  transaction(db,()=>{db.prepare('UPDATE departments SET name=?,code=? WHERE id=?').run(v.name,v.code,req.params.id);db.prepare('UPDATE program_departments SET hod_id=? WHERE department_id=?').run(v.hod_id,req.params.id);});audit(req.user,'department.updated','departments',req.params.id);res.json({ok:true});
 });
 app.post('/api/academics/batches',admin,(req,res)=>{
  const v=z.object({program_id:id,department_id:id,admission_year:z.coerce.number().int().min(1900).max(2200),current_year:z.coerce.number().int().min(1).max(10)}).parse(req.body),p=program(v.program_id);department(v.department_id,p.id);if(!p.duration||v.current_year>p.duration)fail('Configure a duration that includes this year.');
  const uid=randomUUID();db.prepare('INSERT INTO admission_batches(id,program_id,department_id,admission_year,current_year) VALUES(?,?,?,?,?)').run(uid,p.id,v.department_id,v.admission_year,v.current_year);audit(req.user,'batch.created','admission_batches',uid);res.status(201).json({id:uid});
 });
 app.patch('/api/academics/batches/:id',admin,(req,res)=>{
  const v=z.object({current_year:z.coerce.number().int().min(1).max(10),status:z.enum(['active','graduated','archived'])}).parse(req.body),b=db.prepare('SELECT * FROM admission_batches WHERE id=?').get(req.params.id);if(!b)fail('Batch not found.',404);if(v.current_year>program(b.program_id).duration)fail('Year exceeds program duration.');
  transaction(db,()=>{db.prepare('UPDATE admission_batches SET current_year=?,status=? WHERE id=?').run(v.current_year,v.status,b.id);db.prepare('UPDATE academic_sections SET academic_year=? WHERE batch_id=?').run(v.current_year,b.id);db.prepare('UPDATE classes SET semester=? WHERE id IN (SELECT class_id FROM academic_sections WHERE batch_id=?)').run(v.current_year*2-1,b.id);});audit(req.user,'batch.progressed','admission_batches',b.id);res.json({ok:true});
 });
 app.post('/api/academics/sections',admin,(req,res)=>{
  const v=z.object({batch_id:id,section:z.string().trim().min(1).max(20),class_teacher_id:id.nullable().default(null)}).parse(req.body),b=db.prepare('SELECT * FROM admission_batches WHERE id=?').get(v.batch_id);if(!b)fail('Batch not found.',404);const p=program(b.program_id),d=db.prepare('SELECT code FROM departments WHERE id=?').get(b.department_id),uid=randomUUID();
  transaction(db,()=>{db.prepare('INSERT INTO classes VALUES(?,?,?,?,?,?,?)').run(uid,`${p.name} ${d.code} ${b.admission_year} ${v.section}`,b.department_id,p.name,String(b.admission_year),b.current_year*2-1,v.section);db.prepare('INSERT INTO academic_sections VALUES(?,?,?,?,?)').run(uid,b.id,b.current_year,v.section,v.class_teacher_id);});audit(req.user,'section.created','classes',uid);res.status(201).json({id:uid});
 });
 app.patch('/api/academics/sections/:id',admin,(req,res)=>{
  const v=z.object({class_teacher_id:id.nullable()}).parse(req.body);if(!db.prepare('SELECT 1 FROM academic_sections WHERE class_id=?').get(req.params.id))fail('Section not found.',404);
  db.prepare('UPDATE academic_sections SET class_teacher_id=? WHERE class_id=?').run(v.class_teacher_id,req.params.id);audit(req.user,'teacher.assigned','classes',req.params.id);res.json({ok:true});
 });
 app.post('/api/academics/faculty-assignments',admin,(req,res)=>{
  const v=z.object({user_id:id,program_id:id,department_id:id}).parse(req.body);department(v.department_id,v.program_id);
  if(!db.prepare("SELECT 1 FROM users WHERE id=? AND role IN ('FACULTY','HOD') AND active=1").get(v.user_id))fail('Choose an active faculty or HOD account.');
  db.prepare('INSERT OR IGNORE INTO faculty_programs VALUES(?,?,?)').run(v.user_id,v.program_id,v.department_id);audit(req.user,'faculty.program_assigned','users',v.user_id);res.json({ok:true});
 });
 app.get('/api/academics/credentials.csv',admin,(req,res)=>{
  const v=z.object({program:z.enum(['BTECH','BBA','MTECH']),role:z.enum(['STUDENT','FACULTY','HOD'])}).parse(req.query);
  const rows=db.prepare(`SELECT u.name,u.roll_number,u.id faculty_id,u.email,u.role,p.name program,d.code department,CASE u.active WHEN 1 THEN 'active' ELSE 'disabled' END status FROM academic_test_accounts t JOIN users u ON u.id=t.user_id JOIN program_departments pd ON pd.department_id=u.department_id JOIN programs p ON p.id=pd.program_id JOIN departments d ON d.id=u.department_id WHERE p.code=? AND u.role=? ORDER BY u.email`).all(v.program,v.role);
  const fields=['name','roll_number','faculty_id','email','role','program','department','status'];
  const csv=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  audit(req.user,'test_credentials.exported','academic_test_accounts',null,{program:v.program,role:v.role,count:rows.length});
  res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${v.program}-${v.role}-test-accounts.csv"`});res.send([fields.join(','),...rows.map(r=>fields.map(k=>csv(r[k])).join(','))].join('\r\n'));
 });
}
