import {randomUUID,scrypt,randomBytes} from 'node:crypto';
import {promisify} from 'node:util';
import {academicCounts} from './academic-schema.js';
const derive=promisify(scrypt);
export const ANITS_SEED='anits-controlled-test-v1';
export const anitsConfiguration={
 departments:['CSE','CSM','CSD','MECH','IT','CHEM','CIVIL','CSC','ECE','EEE'],
 cohorts:[{admission:2026,year:1,prefix:'A261'},{admission:2025,year:2,prefix:'A251'},{admission:2024,year:3,prefix:'241'},{admission:2023,year:4,prefix:'A231'}],
 sections:['A','B','C','D'],studentsPerSection:60,facultyPerDepartment:10,
};
export function rollNumber(code,cohort,sequence){
 if(!/^[A-Z]+$/.test(code)||!/^A?\d{3}$/.test(cohort.prefix)||!Number.isInteger(sequence)||sequence<1||sequence>999)throw new Error('Invalid B.Tech roll number configuration');
 return `${cohort.prefix}${code}${String(sequence).padStart(3,'0')}`;
}
export async function seedAnits(db,{password,config=anitsConfiguration,onProgress=()=>{}}){
 if(process.env.NODE_ENV==='production')throw new Error('Test accounts cannot be generated in production.');
 if(!password||password.length<8)throw new Error('Provide an explicit temporary test password of at least 8 characters.');
 const stamp=new Date().toISOString(),plans=[];
 const departments=[...config.departments.map(code=>({code,program:'BTECH',name:`B.Tech ${code}`,cohorts:config.cohorts})),{code:'BBA',program:'BBA',name:'BBA Test Administrative Unit',cohorts:config.cohorts.slice(0,3)}];
 for(const d of departments){
  plans.push({key:`${d.code}-hod`,name:`${d.code} Test HOD`,email:`${d.code.toLowerCase()}.hod@anits.edu.in`,role:'HOD',dept:d.code});
  for(let n=1;n<=config.facultyPerDepartment;n++)plans.push({key:`${d.code}-faculty-${n}`,name:`${d.code} Faculty ${String(n).padStart(2,'0')}`,email:`${d.code.toLowerCase()}.faculty${String(n).padStart(2,'0')}@anits.edu.in`,role:'FACULTY',dept:d.code});
  for(const cohort of d.cohorts)for(const [sectionIndex,section]of config.sections.entries())for(let n=1;n<=config.studentsPerSection;n++){
   const sequence=sectionIndex*config.studentsPerSection+n;
   const roll=d.program==='BTECH'?rollNumber(d.code,cohort,sequence):`TEST-BBA-${cohort.admission}-${String(sequence).padStart(3,'0')}`;
   plans.push({key:roll,name:`${d.code} Test Student ${roll}`,email:roll.toLowerCase()+'@anits.edu.in',role:'STUDENT',roll,dept:d.code,batch:cohort.admission,section});
  }
 }
 if(new Set(plans.map(p=>p.email)).size!==plans.length)throw new Error('Duplicate planned account identifiers.');
 for(const p of plans){
  const existing=db.prepare('SELECT u.*,t.seed FROM users u LEFT JOIN academic_test_accounts t ON t.user_id=u.id WHERE u.email=? OR (u.roll_number IS NOT NULL AND u.roll_number=?)').all(p.email,p.roll||null);
  if(existing.length>1||existing[0]&&(existing[0].seed!==ANITS_SEED||existing[0].role!==p.role||existing[0].email.toLowerCase()!==p.email||existing[0].roll_number!==(p.roll||null)))throw new Error(`Conflicting existing record for planned identifier ${p.key}; no existing account was changed.`);
  p.uid=existing[0]?.id||randomUUID();p.exists=!!existing[0];
 }
 let cursor=0,done=0;
 const missing=plans.filter(p=>!p.exists);
 await Promise.all(Array.from({length:4},async()=>{while(cursor<missing.length){const p=missing[cursor++],salt=randomBytes(16).toString('hex');p.hash=salt+':'+(await derive(password,salt,64)).toString('hex');done++;if(done%1000===0)onProgress({hashed:done,total:missing.length});}}));
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const [code,name,duration,rule]of [['BTECH','B.Tech',4,'cohort prefix + department + 001..240'],['BBA','BBA',3,'TEST-BBA-{admission_year}-{sequence:3}'],['MTECH','M.Tech',null,'']]){
   if(!db.prepare('SELECT 1 FROM programs WHERE code=?').get(code))db.prepare('INSERT INTO programs VALUES(?,?,?,?,?,?,?)').run(code,code,name,duration,rule,code==='MTECH'?'':'anits.edu.in',code==='MTECH'?'configuration_required':'active');
  }
  for(const d of departments){
   const p=db.prepare('SELECT * FROM programs WHERE code=?').get(d.program);
   let dept=db.prepare('SELECT * FROM departments WHERE code=?').get(d.code);
   if(!dept){dept={id:randomUUID()};db.prepare('INSERT INTO departments VALUES(?,?,?)').run(dept.id,d.name,d.code);}
   const mapping=db.prepare('SELECT * FROM program_departments WHERE department_id=?').get(dept.id);
   if(mapping&&mapping.program_id!==p.id)throw new Error('Existing department belongs to a different program.');
   if(!mapping)db.prepare('INSERT INTO program_departments(department_id,program_id) VALUES(?,?)').run(dept.id,p.id);
   const people=plans.filter(a=>a.dept===d.code),faculty=people.filter(a=>a.role==='FACULTY'),head=people.find(a=>a.role==='HOD');
   const insert=(a,cid=null)=>{
    if(!a.exists){db.prepare('INSERT INTO users(id,name,email,password_hash,role,department_id,class_id,roll_number,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(a.uid,a.name,a.email,a.hash,a.role,dept.id,cid,a.roll||null,stamp);db.prepare('INSERT INTO academic_test_accounts VALUES(?,?,?)').run(a.uid,ANITS_SEED,stamp);}
    else{const old=db.prepare('SELECT department_id,class_id FROM users WHERE id=?').get(a.uid);if(old.department_id!==dept.id||old.class_id!==cid)throw new Error('Existing test account placement differs. Preserve it and review the seed configuration.');}
   };
   for(const a of [...faculty,head]){insert(a);db.prepare('INSERT OR IGNORE INTO faculty_programs VALUES(?,?,?)').run(a.uid,p.id,dept.id);}
   if(!mapping?.hod_id)db.prepare('UPDATE program_departments SET hod_id=? WHERE department_id=?').run(head.uid,dept.id);
   for(const cohort of d.cohorts){
    let batch=db.prepare('SELECT * FROM admission_batches WHERE program_id=? AND department_id=? AND admission_year=?').get(p.id,dept.id,cohort.admission);
    if(!batch){batch={id:randomUUID(),current_year:cohort.year};db.prepare('INSERT INTO admission_batches(id,program_id,department_id,admission_year,current_year) VALUES(?,?,?,?,?)').run(batch.id,p.id,dept.id,cohort.admission,cohort.year);}
    for(const [si,section]of config.sections.entries()){
     let s=db.prepare('SELECT * FROM academic_sections WHERE batch_id=? AND section=?').get(batch.id,section);
     if(!s){s={class_id:randomUUID()};db.prepare('INSERT INTO classes VALUES(?,?,?,?,?,?,?)').run(s.class_id,`${p.name} ${d.code} ${cohort.admission} ${section}`,dept.id,p.name,String(cohort.admission),batch.current_year*2-1,section);db.prepare('INSERT INTO academic_sections VALUES(?,?,?,?,?)').run(s.class_id,batch.id,batch.current_year,section,faculty[((cohort.year-1)*config.sections.length+si)%faculty.length].uid);}
     for(const a of people.filter(a=>a.batch===cohort.admission&&a.section===section))insert(a,s.class_id);
    }
   }
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Foreign key validation failed.');
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {created:missing.length,reused:plans.length-missing.length,programs:db.prepare('SELECT * FROM programs').all().map(p=>({code:p.code,...academicCounts(db,p.id)}))};
}
