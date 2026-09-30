import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {scopes} from './security.js';
import {syllabusAssignments} from './monitoring.js';

const now=()=>new Date().toISOString(),today=()=>now().slice(0,10);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Invalid date');
const text=z.string().trim().min(1).max(500),note=z.string().trim().max(3000).default('');
const addDays=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
const coordinator=user=>['ADMIN','HOD'].includes(user.role);

export function substitutionSessions(db,user) {
  return db.prepare(`SELECT s.*,t.class_id,t.subject_id,t.faculty_id,t.day_of_week,t.start_time,t.end_time,t.room,c.name class_name,c.department_id,subject.name subject_name,u.name substitute_name,o.name original_faculty_name,l.status leave_status,r.period,r.recorded_at,r.recorded_by
    FROM faculty_substitutions s JOIN timetable t ON t.id=s.timetable_id JOIN classes c ON c.id=t.class_id JOIN subjects subject ON subject.id=t.subject_id JOIN users u ON u.id=s.substitute_id JOIN users o ON o.id=t.faculty_id JOIN leave_applications l ON l.id=s.leave_id LEFT JOIN substitution_attendance_sessions r ON r.substitution_id=s.id ORDER BY s.session_date,t.start_time`).all().filter(row=>user.role==='ADMIN'||user.role==='HOD'&&row.department_id===user.department_id||user.role==='FACULTY'&&(row.substitute_id===user.id||row.faculty_id===user.id)||user.role==='STUDENT'&&row.class_id===user.class_id);
}
export function supportPlanRows(db,user) {
  const rows=db.prepare(`SELECT p.*,u.name student_name,u.roll_number,u.department_id,u.class_id,c.name class_name,f.name faculty_name,s.name subject_name FROM support_plans p JOIN users u ON u.id=p.student_id JOIN classes c ON c.id=u.class_id JOIN users f ON f.id=p.faculty_id LEFT JOIN subjects s ON s.id=p.subject_id ORDER BY p.status='active' DESC,p.due_date,p.created_at DESC`).all();
  return rows.filter(plan=>user.role==='ADMIN'||user.role==='HOD'&&plan.department_id===user.department_id||user.role==='FACULTY'&&plan.faculty_id===user.id&&scopes(db,user).canStudent(plan.student_id)||user.role==='STUDENT'&&plan.student_id===user.id).map(plan=>{
    const tasks=db.prepare('SELECT * FROM support_tasks WHERE plan_id=? ORDER BY due_date,created_at').all(plan.id);
    return {...plan,tasks,completedTasks:tasks.filter(task=>task.status==='completed').length,overdueTasks:plan.status==='active'?tasks.filter(task=>task.status!=='completed'&&task.due_date<today()).length:0,awaitingReview:tasks.filter(task=>task.status==='submitted').length,can_manage:plan.status==='active'&&(coordinator(user)||user.role==='FACULTY'&&plan.faculty_id===user.id),can_review:plan.status==='active'&&(user.role==='ADMIN'||user.role==='FACULTY'&&plan.faculty_id===user.id),can_update:plan.status==='active'&&user.role==='STUDENT'&&plan.student_id===user.id};
  });
}

export function workflowInbox(db,user,at=new Date()) {
  const day=at.toISOString().slice(0,10),scope=scopes(db,user),items=[];
  const put=(key,category,title,detail,page,target,dueDate,actionable=true,actionLabel='Open')=>items.push({key,category,title,detail,page,target,dueDate,actionable,actionLabel,overdue:!!dueDate&&dueDate<day});
  const leaves=db.prepare("SELECT l.*,u.name applicant_name,u.role applicant_role,u.department_id FROM leave_applications l JOIN users u ON u.id=l.student_id WHERE l.status IN ('pending','approved')").all();
  for(const leave of leaves) {
    const own=leave.student_id===user.id;
    const reviewer=!own&&(user.role==='ADMIN'||user.role==='HOD'&&leave.department_id===user.department_id||user.role==='FACULTY'&&leave.applicant_role==='STUDENT'&&scope.canStudent(leave.student_id));
    if(leave.status==='pending'&&(own||reviewer))put(`leave:${leave.id}`,'Leave',own?'Your leave is awaiting review':`Review ${leave.applicant_role.toLowerCase()} leave`,`${leave.applicant_name} · ${leave.start_date} to ${leave.end_date}`,'leave',{id:leave.id},addDays(leave.created_at.slice(0,10),2),reviewer,reviewer?'Review request':'View request');
    if(leave.status==='approved'&&leave.applicant_role==='FACULTY'&&(own||coordinator(user)&&reviewer)) {
      const slots=db.prepare('SELECT t.*,c.name class_name,s.name subject_name FROM timetable t JOIN classes c ON c.id=t.class_id JOIN subjects s ON s.id=t.subject_id WHERE t.faculty_id=? AND c.department_id=?').all(leave.student_id,leave.department_id);
      for(let value=Math.max(Date.parse(day),Date.parse(leave.start_date));value<=Math.min(Date.parse(leave.end_date),Date.parse(addDays(day,7)));value+=86400000) {
        const sessionDate=new Date(value).toISOString().slice(0,10),weekday=new Date(sessionDate+'T12:00:00Z').getUTCDay();
        for(const slot of slots.filter(slot=>slot.day_of_week===weekday))if(!db.prepare('SELECT id FROM faculty_substitutions WHERE timetable_id=? AND session_date=?').get(slot.id,sessionDate))put(`cover:${slot.id}:${sessionDate}`,'Teaching cover','Scheduled class needs a substitute',`${slot.class_name} · ${slot.subject_name} · ${sessionDate} ${slot.start_time}`,'leave',{id:leave.id,coverage:true},sessionDate,coordinator(user),'Arrange cover');
      }
    }
  }
  for(const session of substitutionSessions(db,user)) {
    if(session.session_date<addDays(day,-7)||session.session_date>addDays(day,7))continue;
    if(user.role==='STUDENT') {
      if(session.session_date>=day)put(`class-change:${session.id}`,'Class change',`${session.subject_name}: ${session.substitute_name}`,`${session.session_date} · ${session.start_time}–${session.end_time} · ${session.room||'Room not recorded'}`,'substitutions',{id:session.id},session.session_date,false,'View class change');
    } else if(!session.recorded_at&&(coordinator(user)||session.substitute_id===user.id))put(`attendance:${session.id}`,'Attendance',session.session_date<=day?'Substitution attendance is due':'Upcoming substitution duty',`${session.class_name} · ${session.subject_name} · ${session.session_date} ${session.start_time}`,'substitutions',{id:session.id},session.session_date,session.substitute_id===user.id||user.role==='ADMIN',session.substitute_id===user.id||user.role==='ADMIN'?'Open attendance':'Review cover');
  }
  if(['ADMIN','HOD','FACULTY'].includes(user.role))for(const assignment of syllabusAssignments(db,user))for(const topic of assignment.topics.filter(topic=>topic.status!=='completed'&&topic.target_date&&topic.target_date<=day))put(`syllabus:${topic.id}`,'Syllabus','Syllabus topic needs follow-up',`${assignment.faculty_name} · ${assignment.class_name} · ${topic.title}`,'syllabus',{id:topic.id,assignmentId:assignment.id},topic.target_date,user.role==='FACULTY',user.role==='FACULTY'?'Update progress':'View syllabus');
  for(const plan of supportPlanRows(db,user).filter(plan=>plan.status==='active')) {
    for(const task of plan.tasks.filter(task=>task.status!=='completed')) {
      const student=user.role==='STUDENT',review=task.status==='submitted'&&plan.can_review;
      const action=student&&task.status!=='submitted'||review||plan.can_review&&task.due_date<day;
      put(`support:${task.id}`,'Support',review?'Student progress awaits your review':student?'Your support plan task':task.status==='submitted'?'Student progress awaiting faculty review':'Support plan follow-up',`${plan.student_name} · ${plan.title} · ${task.title}`,'support',{id:plan.id,taskId:task.id},task.due_date,action,review?'Review progress':student?'Update progress':'View plan');
    }
  }
  items.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||Number(b.actionable)-Number(a.actionable)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.key.localeCompare(b.key));
  return {items,summary:{total:items.length,actionable:items.filter(item=>item.actionable).length,overdue:items.filter(item=>item.overdue).length},generatedAt:at.toISOString()};
}

export function sendWorkflowReminders(db,notify,at=new Date(),onlyUserId) {
  if(db.prepare("SELECT value FROM institution_settings WHERE key='notificationsEnabled'").get()?.value==='false')return 0;
  const users=db.prepare('SELECT * FROM users WHERE active=1').all().filter(user=>!onlyUserId||user.id===onlyUserId);
  let sent=0;const day=at.toISOString().slice(0,10);
  for(const user of users)for(const item of workflowInbox(db,user,at).items.filter(item=>item.dueDate<=day&&(item.actionable||['Teaching cover','Attendance','Syllabus','Support'].includes(item.category)&&coordinator(user)))) {
    const previous=db.prepare('SELECT last_sent_at FROM workflow_reminders WHERE user_id=? AND item_key=?').get(user.id,item.key);
    if(previous&&at.getTime()-Date.parse(previous.last_sent_at)<86400000)continue;
    db.exec('BEGIN');try {
      notify(user.id,`Workflow reminder: ${item.title}`,item.detail);
      db.prepare('INSERT INTO workflow_reminders VALUES(?,?,?) ON CONFLICT(user_id,item_key) DO UPDATE SET last_sent_at=excluded.last_sent_at').run(user.id,item.key,at.toISOString());
      db.exec('COMMIT');sent++;
    }catch(error){db.exec('ROLLBACK');throw error}
  }
  return sent;
}
export function startWorkflowReminders(run) {
  const sweep=()=>{try{run()}catch(error){console.error('Workflow reminder sweep failed:',error.message)}};
  sweep();const timer=setInterval(sweep,15*60*1000);timer.unref();return ()=>clearInterval(timer);
}

export function registerCoordination({app,db,roles,audit,notify}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS substitution_attendance_sessions(substitution_id TEXT PRIMARY KEY REFERENCES faculty_substitutions(id) ON DELETE CASCADE,period INTEGER NOT NULL,recorded_by TEXT REFERENCES users(id),recorded_at TEXT);
    CREATE TABLE IF NOT EXISTS workflow_reminders(user_id TEXT NOT NULL REFERENCES users(id),item_key TEXT NOT NULL,last_sent_at TEXT NOT NULL,PRIMARY KEY(user_id,item_key));
    CREATE TABLE IF NOT EXISTS support_plans(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES users(id),faculty_id TEXT NOT NULL REFERENCES users(id),subject_id TEXT REFERENCES subjects(id),title TEXT NOT NULL,goal TEXT NOT NULL,category TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS support_tasks(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES support_plans(id) ON DELETE CASCADE,title TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',student_note TEXT NOT NULL DEFAULT '',faculty_feedback TEXT NOT NULL DEFAULT '',submitted_at TEXT,reviewed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS support_updates(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES support_plans(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_support_student ON support_plans(student_id,status);
    CREATE INDEX IF NOT EXISTS idx_support_faculty ON support_plans(faculty_id,status);
  `);
  const needSession=(req,id)=>{const session=substitutionSessions(db,req.user).find(row=>row.id===id);if(!session||req.user.role==='STUDENT')fail(404,'Substitution session not found.');return session};
  const periodFor=session=>session.period||db.prepare('SELECT id FROM timetable WHERE class_id=? AND day_of_week=? ORDER BY start_time,end_time,id').all(session.class_id,session.day_of_week).findIndex(slot=>slot.id===session.timetable_id)+1;
  app.get('/api/substitutions/:id/attendance',roles('ADMIN','HOD','FACULTY'),(req,res)=>{
    const session=needSession(req,req.params.id),period=periodFor(session);
    const students=db.prepare("SELECT u.id,u.name,u.roll_number,a.status FROM users u LEFT JOIN attendance a ON a.student_id=u.id AND a.class_id=? AND a.subject_id=? AND a.date=? AND a.period=? WHERE u.role='STUDENT' AND u.active=1 AND u.class_id=? ORDER BY u.name").all(session.class_id,session.subject_id,session.session_date,period,session.class_id);
    res.json({session:{...session,period},students,can_record:(req.user.role==='ADMIN'||session.substitute_id===req.user.id)&&session.leave_status==='approved'&&session.session_date<=today()});
  });
  app.post('/api/substitutions/:id/attendance',roles('ADMIN','FACULTY'),(req,res)=>{
    const session=needSession(req,req.params.id);
    if(req.user.role!=='ADMIN'&&session.substitute_id!==req.user.id)fail(403,'Only the assigned substitute can record this session.');
    if(session.leave_status!=='approved')fail(409,'The faculty leave is no longer approved.');
    if(session.session_date>today())fail(400,'Attendance cannot be recorded before the assigned date.');
    if(db.prepare("SELECT id FROM leave_applications WHERE student_id=? AND status='approved' AND start_date<=? AND end_date>=?").get(session.substitute_id,session.session_date,session.session_date))fail(409,'The assigned substitute is on approved leave.');
    const value=z.object({records:z.array(z.object({student_id:z.string(),status:z.enum(['present','absent','excused'])}).strict()).min(1).max(500)}).strict().parse(req.body);
    const roster=db.prepare("SELECT id FROM users WHERE role='STUDENT' AND active=1 AND class_id=?").all(session.class_id);
    const ids=new Set(value.records.map(row=>row.student_id));
    if(ids.size!==value.records.length||ids.size!==roster.length||roster.some(student=>!ids.has(student.id)))fail(400,'Record each currently enrolled student exactly once.');
    const period=periodFor(session);if(period<1||period>20)fail(409,'This timetable period is outside the supported attendance range.');
    db.exec('BEGIN');try {
      for(const row of value.records)db.prepare('INSERT INTO attendance VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(student_id,class_id,subject_id,date,period) DO UPDATE SET status=excluded.status,recorded_by=excluded.recorded_by').run(randomUUID(),row.student_id,session.class_id,session.subject_id,session.session_date,period,row.status,req.user.id);
      db.prepare('INSERT INTO substitution_attendance_sessions VALUES(?,?,?,?) ON CONFLICT(substitution_id) DO UPDATE SET recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at').run(session.id,period,req.user.id,now());
      audit(req.user,'substitution.attendance_saved','faculty_substitutions',session.id,{date:session.session_date,period,records:value.records.length});
      if(!session.recorded_at) {
        const recipients=new Set(db.prepare("SELECT id FROM users WHERE active=1 AND (role='ADMIN' OR role='HOD' AND department_id=?)").all(session.department_id).map(user=>user.id));recipients.add(session.faculty_id);
        for(const recipient of recipients)if(recipient!==req.user.id)notify(recipient,'Substitution attendance recorded',`${session.class_name} · ${session.subject_name} · ${session.session_date}`);
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
    res.json({ok:true,period});
  });

  const needPlan=(req,id)=>{const plan=supportPlanRows(db,req.user).find(row=>row.id===id);if(!plan)fail(404,'Support plan not found.');return plan};
  const update=(req,plan,kind,body)=>{db.prepare('INSERT INTO support_updates VALUES(?,?,?,?,?,?)').run(randomUUID(),plan.id,req.user.id,kind,body,now());db.prepare('UPDATE support_plans SET updated_at=? WHERE id=?').run(now(),plan.id);audit(req.user,`support.${kind}`,'support_plans',plan.id)};
  const hodNotify=(plan,title)=>{const student=db.prepare('SELECT department_id FROM users WHERE id=?').get(plan.student_id);for(const hod of db.prepare("SELECT id FROM users WHERE role='HOD' AND active=1 AND department_id=?").all(student.department_id))notify(hod.id,title,plan.title)};
  app.get('/api/support-options',roles('ADMIN','HOD','FACULTY'),(req,res)=>{
    const students=req.scope.students().filter(student=>student.active),studentClasses=new Set(students.map(student=>student.class_id));
    const assignments=db.prepare('SELECT t.*,u.name faculty_name,s.name subject_name FROM teaching_assignments t JOIN users u ON u.id=t.faculty_id JOIN subjects s ON s.id=t.subject_id WHERE u.active=1').all().filter(assignment=>studentClasses.has(assignment.class_id)&&(req.user.role!=='FACULTY'||assignment.faculty_id===req.user.id));
    res.json({students,assignments});
  });
  app.get('/api/support-plans',(req,res)=>{
    const plans=supportPlanRows(db,req.user);res.json({plans,summary:{active:plans.filter(plan=>plan.status==='active').length,completed:plans.filter(plan=>plan.status==='completed').length,overdue:plans.filter(plan=>plan.status==='active'&&(plan.due_date<today()||plan.overdueTasks)).length,awaitingReview:plans.filter(plan=>plan.status==='active').reduce((sum,plan)=>sum+plan.awaitingReview,0)}});
  });
  app.get('/api/support-plans/:id',(req,res)=>{
    const plan=needPlan(req,req.params.id);res.json({...plan,updates:db.prepare('SELECT p.*,u.name author_name FROM support_updates p JOIN users u ON u.id=p.user_id WHERE plan_id=? ORDER BY p.created_at DESC,p.rowid DESC LIMIT 100').all(plan.id)});
  });
  app.post('/api/support-plans',roles('ADMIN','HOD','FACULTY'),(req,res)=>{
    const value=z.object({student_id:z.string(),faculty_id:z.string(),subject_id:z.string().nullable().optional(),title:text,goal:z.string().trim().min(5).max(3000),category:z.enum(['attendance','subject','study','performance','other']),due_date:date,tasks:z.array(z.object({title:text,due_date:date})).min(1).max(20)}).parse(req.body);
    if(!req.scope.canStudent(value.student_id))fail(404,'Student not found.');
    const student=db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND role='STUDENT'").get(value.student_id);
    const faculty=db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND role='FACULTY'").get(value.faculty_id);
    if(!student||!faculty||faculty.department_id!==student.department_id||req.user.role==='FACULTY'&&faculty.id!==req.user.id)fail(400,'Choose an active assigned faculty member in the student department.');
    if(!db.prepare('SELECT id FROM teaching_assignments WHERE faculty_id=? AND class_id=? AND (? IS NULL OR subject_id=?)').get(faculty.id,student.class_id,value.subject_id||null,value.subject_id||null))fail(400,'The faculty member must teach this student class and subject.');
    if(value.tasks.some(task=>task.due_date>value.due_date))fail(400,'Task deadlines must fall on or before the plan deadline.');
    const id=randomUUID(),timestamp=now();
    db.exec('BEGIN');try {
      db.prepare('INSERT INTO support_plans VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,student.id,faculty.id,value.subject_id||null,value.title,value.goal,value.category,value.due_date,'active',req.user.id,timestamp,timestamp);
      for(const task of value.tasks)db.prepare('INSERT INTO support_tasks(id,plan_id,title,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,task.title,task.due_date,timestamp,timestamp);
      update(req,{id},'created',value.goal);notify(student.id,'New student support plan',value.title);if(faculty.id!==req.user.id)notify(faculty.id,'Student support plan assigned',`${student.name}: ${value.title}`);hodNotify({student_id:student.id,title:value.title},'Student support plan created');db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
    res.status(201).json({id});
  });
  app.post('/api/support-plans/:id/tasks',roles('ADMIN','FACULTY'),(req,res)=>{
    const plan=needPlan(req,req.params.id);if(!plan.can_review)fail(403,'Only the responsible faculty member can manage plan tasks.');
    const value=z.object({title:text,due_date:date}).parse(req.body);if(value.due_date>plan.due_date)fail(400,'Task deadline must fall on or before the plan deadline.');if(plan.tasks.length>=20)fail(400,'A support plan supports at most 20 tasks.');
    const id=randomUUID();db.prepare('INSERT INTO support_tasks(id,plan_id,title,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,plan.id,value.title,value.due_date,now(),now());update(req,plan,'task_added',value.title);notify(plan.student_id,'Support plan task added',value.title);res.status(201).json({id});
  });
  app.post('/api/support-tasks/:id/progress',roles('STUDENT'),(req,res)=>{
    const task=db.prepare('SELECT * FROM support_tasks WHERE id=?').get(req.params.id);if(!task)fail(404,'Support task not found.');const plan=needPlan(req,task.plan_id);if(!plan.can_update||task.status==='completed')fail(409,'This task is no longer open for student updates.');
    const value=z.object({status:z.enum(['in_progress','submitted']),student_note:z.string().trim().min(1).max(3000)}).parse(req.body);
    db.prepare('UPDATE support_tasks SET status=?,student_note=?,submitted_at=?,reviewed_at=NULL,updated_at=? WHERE id=?').run(value.status,value.student_note,value.status==='submitted'?now():null,now(),task.id);
    update(req,plan,'student_progress',`${task.title}: ${value.student_note}`);notify(plan.faculty_id,value.status==='submitted'?'Student support progress ready for review':'Student support progress updated',`${plan.student_name}: ${task.title}`);res.json({ok:true});
  });
  app.post('/api/support-tasks/:id/review',roles('ADMIN','FACULTY'),(req,res)=>{
    const task=db.prepare('SELECT * FROM support_tasks WHERE id=?').get(req.params.id);if(!task)fail(404,'Support task not found.');const plan=needPlan(req,task.plan_id);if(!plan.can_review)fail(403,'Only the responsible faculty member can review this progress.');if(task.status!=='submitted')fail(409,'The student must submit progress before faculty review.');
    const value=z.object({status:z.enum(['completed','in_progress']),faculty_feedback:note}).parse(req.body);
    db.prepare('UPDATE support_tasks SET status=?,faculty_feedback=?,reviewed_at=?,updated_at=? WHERE id=?').run(value.status,value.faculty_feedback,now(),now(),task.id);
    update(req,plan,'faculty_review',`${task.title}: ${value.status==='completed'?'Completed':'Further work requested'}. ${value.faculty_feedback}`);notify(plan.student_id,'Support progress reviewed',`${task.title}: ${value.faculty_feedback||value.status}`);res.json({ok:true});
  });
  app.patch('/api/support-plans/:id',roles('ADMIN','HOD','FACULTY'),(req,res)=>{
    const plan=needPlan(req,req.params.id);if(!plan.can_manage)fail(409,'This support plan is no longer active.');
    const value=z.object({status:z.enum(['completed','cancelled']),note}).parse(req.body);
    if(value.status==='completed'&&(!plan.can_review||!plan.tasks.length||plan.tasks.some(task=>task.status!=='completed')))fail(409,'The responsible faculty must review all tasks before completing the plan.');
    db.prepare('UPDATE support_plans SET status=?,updated_at=? WHERE id=?').run(value.status,now(),plan.id);update(req,plan,value.status,value.note||`Plan ${value.status}`);notify(plan.student_id,`Support plan ${value.status}`,plan.title);hodNotify(plan,`Student support plan ${value.status}`);res.json({ok:true});
  });
  app.get('/api/inbox',(req,res)=>{sendWorkflowReminders(db,notify,new Date(),req.user.id);res.json(workflowInbox(db,req.user))});
  return ()=>sendWorkflowReminders(db,notify);
}
