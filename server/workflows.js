import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const now=()=>new Date().toISOString();
const today=()=>now().slice(0,10);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Invalid date');
const overlap=(a,b,c,d)=>a<d&&b>c;
const weekdays=value=>new Date(value+'T12:00:00Z').getUTCDay();

export function registerWorkflows({app,db,roles,audit,notify}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS faculty_substitutions(id TEXT PRIMARY KEY,leave_id TEXT NOT NULL REFERENCES leave_applications(id),timetable_id TEXT NOT NULL REFERENCES timetable(id) ON DELETE CASCADE,session_date TEXT NOT NULL,substitute_id TEXT NOT NULL REFERENCES users(id),assigned_by TEXT NOT NULL REFERENCES users(id),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,UNIQUE(timetable_id,session_date));
    CREATE TABLE IF NOT EXISTS syllabus_topics(id TEXT PRIMARY KEY,teaching_assignment_id TEXT NOT NULL REFERENCES teaching_assignments(id) ON DELETE CASCADE,title TEXT NOT NULL,planned_hours REAL NOT NULL,target_date TEXT,status TEXT NOT NULL DEFAULT 'planned',completed_at TEXT,note TEXT NOT NULL DEFAULT '',updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_substitution_date ON faculty_substitutions(session_date,substitute_id);
    CREATE INDEX IF NOT EXISTS idx_syllabus_assignment ON syllabus_topics(teaching_assignment_id);
  `);
  const leaveById=id=>db.prepare('SELECT l.*,u.name applicant_name,u.name student_name,u.role applicant_role,u.department_id,u.class_id,u.roll_number,r.name reviewer_name FROM leave_applications l JOIN users u ON u.id=l.student_id LEFT JOIN users r ON r.id=l.reviewed_by WHERE l.id=?').get(id);
  const canSeeLeave=(req,leave)=>req.user.role==='ADMIN'||leave.student_id===req.user.id||req.user.role==='HOD'&&leave.department_id===req.user.department_id||req.user.role==='FACULTY'&&leave.applicant_role==='STUDENT'&&req.scope.canStudent(leave.student_id);
  const canReviewLeave=(req,leave)=>leave.student_id!==req.user.id&&(req.user.role==='ADMIN'||req.user.role==='HOD'&&leave.department_id===req.user.department_id||req.user.role==='FACULTY'&&leave.applicant_role==='STUDENT'&&req.scope.canStudent(leave.student_id));
  const needLeave=(req,id)=>{const leave=leaveById(id);if(!leave||!canSeeLeave(req,leave))fail(404,'Leave request not found.');return leave};
  const needCoordinator=(req,leave)=>{if(!['ADMIN','HOD'].includes(req.user.role)||!canReviewLeave(req,leave)||leave.applicant_role!=='FACULTY')fail(403,'Only the department HOD or administrator can coordinate faculty cover.')};
  const substitutionRows=()=>db.prepare(`SELECT s.*,t.class_id,t.subject_id,t.faculty_id,t.start_time,t.end_time,t.day_of_week,t.room,c.name class_name,c.department_id,sub.name substitute_name,original.name original_faculty_name,subject.name subject_name
    FROM faculty_substitutions s JOIN timetable t ON t.id=s.timetable_id JOIN classes c ON c.id=t.class_id JOIN users sub ON sub.id=s.substitute_id JOIN users original ON original.id=t.faculty_id JOIN subjects subject ON subject.id=t.subject_id ORDER BY s.session_date,t.start_time`).all();
  function availability(faculty,slot,sessionDate,currentId) {
    if(!faculty.active)return 'Account is disabled';
    if(db.prepare("SELECT id FROM leave_applications WHERE student_id=? AND status='approved' AND start_date<=? AND end_date>=?").get(faculty.id,sessionDate,sessionDate))return 'On approved leave';
    if(db.prepare('SELECT id FROM timetable WHERE faculty_id=? AND day_of_week=? AND start_time<? AND end_time>?').get(faculty.id,weekdays(sessionDate),slot.end_time,slot.start_time))return 'Has a scheduled class';
    if(substitutionRows().some(row=>row.id!==currentId&&row.substitute_id===faculty.id&&row.session_date===sessionDate&&overlap(row.start_time,row.end_time,slot.start_time,slot.end_time)))return 'Has another substitution';
    return null;
  }
  function coverage(req,leave) {
    const slots=db.prepare('SELECT t.*,c.name class_name,s.name subject_name FROM timetable t JOIN classes c ON c.id=t.class_id JOIN subjects s ON s.id=t.subject_id WHERE t.faculty_id=? AND c.department_id=? ORDER BY t.start_time').all(leave.student_id,leave.department_id);
    const assignments=substitutionRows().filter(row=>row.leave_id===leave.id);
    const candidates=['ADMIN','HOD'].includes(req.user.role)?db.prepare("SELECT id,name,active FROM users WHERE role='FACULTY' AND department_id=? AND id!=? ORDER BY name").all(leave.department_id,leave.student_id):[];
    const sessions=[];
    for(let timestamp=Date.parse(leave.start_date);timestamp<=Date.parse(leave.end_date);timestamp+=86400000) {
      const sessionDate=new Date(timestamp).toISOString().slice(0,10);
      for(const slot of slots.filter(slot=>slot.day_of_week===weekdays(sessionDate))) {
        const assigned=assignments.find(row=>row.timetable_id===slot.id&&row.session_date===sessionDate)||null;
        sessions.push({...slot,session_date:sessionDate,assigned,candidates:candidates.map(faculty=>{const reason=availability(faculty,slot,sessionDate,assigned?.id);return {id:faculty.id,name:faculty.name,available:!reason,reason}})});
      }
    }
    return sessions;
  }

  app.get('/api/leave',(req,res)=>{
    const leaves=db.prepare('SELECT id FROM leave_applications ORDER BY created_at DESC').all().map(row=>leaveById(row.id)).filter(leave=>canSeeLeave(req,leave));
    res.json(leaves.map(leave=>({...leave,can_review:canReviewLeave(req,leave)&&leave.status==='pending',substitution_count:db.prepare('SELECT COUNT(*) n FROM faculty_substitutions WHERE leave_id=?').get(leave.id).n})));
  });
  app.post('/api/leave',roles('STUDENT','FACULTY'),(req,res)=>{
    const value=z.object({start_date:date,end_date:date,reason:z.string().trim().min(5).max(3000)}).parse(req.body);
    if(value.end_date<value.start_date)fail(400,'End date must follow start date.');
    if(Date.parse(value.end_date)-Date.parse(value.start_date)>180*86400000)fail(400,'Request at most 181 days at a time.');
    if(db.prepare("SELECT id FROM leave_applications WHERE student_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?").get(req.user.id,value.end_date,value.start_date))fail(409,'An overlapping leave request already exists.');
    const id=randomUUID();
    db.prepare('INSERT INTO leave_applications(id,student_id,start_date,end_date,reason,created_at) VALUES(?,?,?,?,?,?)').run(id,req.user.id,value.start_date,value.end_date,value.reason,now());
    const recipients=new Set(db.prepare("SELECT id FROM users WHERE active=1 AND (role='ADMIN' OR (role='HOD' AND department_id=?))").all(req.user.department_id).map(user=>user.id));
    if(req.user.role==='STUDENT')for(const faculty of db.prepare('SELECT DISTINCT u.id FROM teaching_assignments t JOIN users u ON u.id=t.faculty_id WHERE t.class_id=? AND u.active=1').all(req.user.class_id))recipients.add(faculty.id);
    for(const recipient of recipients)notify(recipient,`New ${req.user.role.toLowerCase()} leave request`,req.user.name);
    audit(req.user,'leave.requested','leave_applications',id,{applicantRole:req.user.role});
    res.status(201).json({id});
  });
  app.patch('/api/leave/:id',roles('ADMIN','HOD','FACULTY'),(req,res)=>{
    const leave=needLeave(req,req.params.id);
    if(!canReviewLeave(req,leave))fail(403,'You cannot review this leave request.');
    if(leave.status!=='pending')fail(409,'This request has already been reviewed.');
    const value=z.object({status:z.enum(['approved','rejected']),review_note:z.string().trim().max(3000).default('')}).parse(req.body);
    if(value.status==='approved'&&leave.applicant_role==='FACULTY'&&db.prepare('SELECT id FROM faculty_substitutions WHERE substitute_id=? AND session_date BETWEEN ? AND ? AND session_date>=?').get(leave.student_id,leave.start_date,leave.end_date,today()))fail(409,'Reassign this faculty member\'s existing substitution duties before approving their leave.');
    const result=db.prepare("UPDATE leave_applications SET status=?,review_note=?,reviewed_by=? WHERE id=? AND status='pending'").run(value.status,value.review_note,req.user.id,leave.id);
    if(!result.changes)fail(409,'This request has already been reviewed.');
    notify(leave.student_id,`Leave request ${value.status}`,value.review_note);
    audit(req.user,`leave.${value.status}`,'leave_applications',leave.id,{applicantRole:leave.applicant_role});
    res.json({ok:true,...leaveById(leave.id)});
  });
  app.get('/api/leave/:id/coverage',(req,res)=>{
    const leave=needLeave(req,req.params.id);
    if(leave.applicant_role!=='FACULTY')fail(400,'Only faculty leave needs teaching cover.');
    res.json({leave,sessions:coverage(req,leave),can_manage:['ADMIN','HOD'].includes(req.user.role)&&canReviewLeave(req,leave)});
  });
  app.post('/api/leave/:id/substitutions',roles('ADMIN','HOD'),(req,res)=>{
    const leave=needLeave(req,req.params.id);needCoordinator(req,leave);
    if(leave.status!=='approved')fail(409,'Approve the faculty leave before assigning cover.');
    const value=z.object({timetable_id:z.string(),session_date:date,substitute_id:z.string(),note:z.string().trim().max(1000).default('')}).parse(req.body);
    if(value.session_date<today())fail(400,'Assign cover for today or a future date.');
    const slot=coverage(req,leave).find(row=>row.id===value.timetable_id&&row.session_date===value.session_date);
    if(!slot)fail(400,'Choose a scheduled session within this faculty leave.');
    const faculty=db.prepare("SELECT id,name,active FROM users WHERE id=? AND role='FACULTY' AND department_id=? AND id!=?").get(value.substitute_id,leave.department_id,leave.student_id);
    if(!faculty)fail(400,'Choose another faculty member from this department.');
    const reason=availability(faculty,slot,value.session_date,slot.assigned?.id);
    if(reason)fail(409,`${faculty.name} is unavailable: ${reason.toLowerCase()}.`);
    if(slot.assigned&&slot.assigned.substitute_id!==faculty.id&&db.prepare('SELECT recorded_at FROM substitution_attendance_sessions WHERE substitution_id=?').get(slot.assigned.id)?.recorded_at)fail(409,'Attendance is already recorded for this cover. Keep its recorded faculty assignment.');
    const id=slot.assigned?.id||randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO faculty_substitutions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(timetable_id,session_date) DO UPDATE SET substitute_id=excluded.substitute_id,assigned_by=excluded.assigned_by,note=excluded.note,created_at=excluded.created_at').run(id,leave.id,slot.id,value.session_date,faculty.id,req.user.id,value.note,now());
      const detail=`${slot.class_name} · ${slot.subject_name} · ${value.session_date} ${slot.start_time}–${slot.end_time}`;
      notify(faculty.id,'Teaching substitution assigned',detail);
      notify(leave.student_id,'Teaching cover arranged',`${faculty.name}: ${detail}`);
      if(slot.assigned&&slot.assigned.substitute_id!==faculty.id)notify(slot.assigned.substitute_id,'Teaching substitution reassigned',detail);
      for(const student of db.prepare("SELECT id FROM users WHERE role='STUDENT' AND active=1 AND class_id=?").all(slot.class_id))notify(student.id,'Class teaching cover updated',`${faculty.name}: ${detail}`);
      audit(req.user,'substitution.assigned','faculty_substitutions',id,{leaveId:leave.id,substituteId:faculty.id,date:value.session_date});
      db.exec('COMMIT');
    } catch(error){db.exec('ROLLBACK');throw error}
    res.status(201).json({id});
  });
  app.delete('/api/substitutions/:id',roles('ADMIN','HOD'),(req,res)=>{
    const row=substitutionRows().find(row=>row.id===req.params.id);
    if(!row)fail(404,'Substitution not found.');
    const leave=needLeave(req,row.leave_id);needCoordinator(req,leave);
    if(db.prepare('SELECT recorded_at FROM substitution_attendance_sessions WHERE substitution_id=?').get(row.id)?.recorded_at)fail(409,'Attendance is already recorded for this cover. Its teaching record must be retained.');
    db.prepare('DELETE FROM faculty_substitutions WHERE id=?').run(row.id);
    notify(row.substitute_id,'Teaching substitution removed',`${row.class_name} · ${row.session_date} ${row.start_time}`);
    notify(leave.student_id,'Teaching cover removed',`${row.class_name} · ${row.session_date} ${row.start_time}`);
    for(const student of db.prepare("SELECT id FROM users WHERE role='STUDENT' AND active=1 AND class_id=?").all(row.class_id))notify(student.id,'Class teaching cover removed',`${row.subject_name} · ${row.session_date} ${row.start_time}`);
    audit(req.user,'substitution.removed','faculty_substitutions',row.id);res.json({ok:true});
  });
  app.get('/api/substitutions',(req,res)=>res.json(substitutionRows().filter(row=>req.user.role==='ADMIN'||req.user.role==='HOD'&&row.department_id===req.user.department_id||req.user.role==='FACULTY'&&(row.substitute_id===req.user.id||row.faculty_id===req.user.id)||req.user.role==='STUDENT'&&row.class_id===req.user.class_id).map(row=>req.user.role==='STUDENT'?{id:row.id,class_name:row.class_name,subject_name:row.subject_name,session_date:row.session_date,start_time:row.start_time,end_time:row.end_time,room:row.room,original_faculty_name:row.original_faculty_name,substitute_name:row.substitute_name}:{...row,attendance_recorded_at:db.prepare('SELECT recorded_at FROM substitution_attendance_sessions WHERE substitution_id=?').get(row.id)?.recorded_at||null,can_record_attendance:(req.user.role==='ADMIN'||row.substitute_id===req.user.id)&&row.session_date<=today()})));
}
