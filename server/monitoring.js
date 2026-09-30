import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { studentAnalytics } from './analytics.js';

const now=()=>new Date().toISOString(),today=()=>now().slice(0,10);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Invalid date');
const topicSchema=z.object({title:z.string().trim().min(1).max(300),planned_hours:z.coerce.number().positive().max(1000),target_date:date.nullable().optional(),status:z.enum(['planned','in_progress','completed']).default('planned'),note:z.string().trim().max(3000).default('')});

export function syllabusAssignments(db,user) {
  const rows=db.prepare(`SELECT t.*,u.name faculty_name,u.active faculty_active,c.name class_name,c.department_id,c.semester,s.name subject_name,d.name department_name FROM teaching_assignments t JOIN users u ON u.id=t.faculty_id JOIN classes c ON c.id=t.class_id JOIN subjects s ON s.id=t.subject_id JOIN departments d ON d.id=c.department_id ORDER BY u.name,c.name,s.name`).all().filter(row=>user.role==='ADMIN'||user.role==='HOD'&&row.department_id===user.department_id||user.role==='FACULTY'&&row.faculty_id===user.id);
  return rows.map(row=>{
    const topics=db.prepare('SELECT * FROM syllabus_topics WHERE teaching_assignment_id=? ORDER BY target_date IS NULL,target_date,updated_at').all(row.id);
    const totalHours=topics.reduce((sum,topic)=>sum+topic.planned_hours,0),completedHours=topics.filter(topic=>topic.status==='completed').reduce((sum,topic)=>sum+topic.planned_hours,0);
    return {...row,topics,totalHours,completedHours,completionPercent:totalHours?Math.round(completedHours/totalHours*100):null,overdueTopics:topics.filter(topic=>topic.status!=='completed'&&topic.target_date&&topic.target_date<today()).length,lastUpdated:topics.length?topics.map(topic=>topic.updated_at).sort().at(-1):null};
  });
}

export function academicMonitoring(db,req) {
  const students=req.scope.students(),studentIds=new Set(students.map(student=>student.id));
  const classes=req.scope.classes(),classIds=new Set(classes.map(classroom=>classroom.id));
  const assignments=syllabusAssignments(db,req.user);
  const allowedCourse=row=>req.user.role!=='FACULTY'||assignments.some(assignment=>assignment.class_id===row.class_id&&assignment.subject_id===row.subject_id);
  const attendance=db.prepare("SELECT * FROM attendance WHERE status!='excused'").all().filter(row=>studentIds.has(row.student_id)&&classIds.has(row.class_id)&&allowedCourse(row));
  const marks=db.prepare('SELECT * FROM marks').all().filter(row=>studentIds.has(row.student_id)&&classIds.has(row.class_id)&&allowedCourse(row));
  const submissions=db.prepare('SELECT s.*,u.class_id,a.subject_id,a.max_marks,a.created_by faculty_id FROM submissions s JOIN activities a ON a.id=s.activity_id JOIN users u ON u.id=s.student_id').all().filter(row=>studentIds.has(row.student_id)&&classIds.has(row.class_id)&&allowedCourse(row));
  const percent=rows=>rows.length?Math.round(rows.filter(row=>row.status==='present').length/rows.length*100):null;
  const average=rows=>rows.length?Math.round(rows.reduce((sum,row)=>sum+row.score/row.max_marks*100,0)/rows.length):null;
  const pending=rows=>rows.filter(row=>row.score===null&&['submitted','execution_error'].includes(row.status)).length;
  const courseRows=assignments.map(assignment=>{
    const course=row=>row.class_id===assignment.class_id&&row.subject_id===assignment.subject_id;
    const facultySubmissions=submissions.filter(row=>course(row)&&row.faculty_id===assignment.faculty_id);
    return {...assignment,students:students.filter(student=>student.class_id===assignment.class_id).length,attendance:percent(attendance.filter(course)),averageMarks:average(marks.filter(course)),assessmentAverage:average(facultySubmissions.filter(row=>row.score!==null)),submissions:facultySubmissions.length,pendingEvaluations:pending(facultySubmissions)};
  });
  const faculty=db.prepare("SELECT id,name,email,department_id,active FROM users WHERE role='FACULTY'").all().filter(member=>req.user.role==='ADMIN'||req.user.role==='HOD'&&member.department_id===req.user.department_id||req.user.role==='FACULTY'&&member.id===req.user.id).map(member=>{
    const courses=courseRows.filter(course=>course.faculty_id===member.id);
    const totalHours=courses.reduce((sum,course)=>sum+course.totalHours,0),completedHours=courses.reduce((sum,course)=>sum+course.completedHours,0);
    return {...member,courses,classes:new Set(courses.map(course=>course.class_id)).size,syllabusCompletion:totalHours?Math.round(completedHours/totalHours*100):null,plannedHours:totalHours,completedHours,overdueTopics:courses.reduce((sum,course)=>sum+course.overdueTopics,0),pendingEvaluations:courses.reduce((sum,course)=>sum+course.pendingEvaluations,0),weeklySessions:db.prepare('SELECT COUNT(*) n FROM timetable WHERE faculty_id=?').get(member.id).n};
  });
  const classPerformance=classes.map(classroom=>{
    const course=row=>row.class_id===classroom.id;
    const classStudents=students.filter(student=>student.class_id===classroom.id);
    return {...classroom,students:classStudents.length,attendance:percent(attendance.filter(course)),averageMarks:average(marks.filter(course)),assessmentAverage:average(submissions.filter(row=>course(row)&&row.score!==null)),pendingEvaluations:pending(submissions.filter(course)),supportCount:classStudents.filter(student=>studentAnalytics(db,student.id).suggestions.length).length};
  });
  const totalHours=assignments.reduce((sum,row)=>sum+row.totalHours,0),completedHours=assignments.reduce((sum,row)=>sum+row.completedHours,0);
  return {faculty,courses:courseRows,classPerformance,summary:{students:students.length,classes:classes.length,faculty:faculty.filter(member=>member.active).length,attendance:percent(attendance),averageMarks:average(marks),assessmentAverage:average(submissions.filter(row=>row.score!==null)),pendingEvaluations:pending(submissions),syllabusCompletion:totalHours?Math.round(completedHours/totalHours*100):null,overdueTopics:assignments.reduce((sum,row)=>sum+row.overdueTopics,0),coursesWithoutPlan:assignments.filter(row=>!row.topics.length).length},scope:req.user.role==='FACULTY'?'Assigned classes and subjects':req.user.role==='HOD'?'Your entire department':'All departments'};
}

export function registerMonitoring({app,db,roles,audit}) {
  const canEdit=(req,assignment)=>req.user.role==='FACULTY'&&assignment.faculty_id===req.user.id;
  const needAssignment=(req,id)=>{const assignment=syllabusAssignments(db,req.user).find(row=>row.id===id);if(!assignment)fail(404,'Teaching assignment not found.');return assignment};
  app.get('/api/syllabus',roles('ADMIN','HOD','FACULTY'),(req,res)=>res.json(syllabusAssignments(db,req.user)));
  app.post('/api/syllabus/topics',roles('FACULTY'),(req,res)=>{
    const value=topicSchema.extend({teaching_assignment_id:z.string()}).parse(req.body);
    const assignment=needAssignment(req,value.teaching_assignment_id);
    if(!canEdit(req,assignment))fail(403,'Only the assigned faculty member can update this syllabus.');
    const id=randomUUID();
    db.prepare('INSERT INTO syllabus_topics VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,assignment.id,value.title,value.planned_hours,value.target_date||null,value.status,value.status==='completed'?now():null,value.note,req.user.id,now());
    audit(req.user,'syllabus.topic_added','syllabus_topics',id,{assignmentId:assignment.id});res.status(201).json({id});
  });
  app.patch('/api/syllabus/topics/:id',roles('FACULTY'),(req,res)=>{
    const topic=db.prepare('SELECT * FROM syllabus_topics WHERE id=?').get(req.params.id);if(!topic)fail(404,'Topic not found.');
    const assignment=needAssignment(req,topic.teaching_assignment_id);if(!canEdit(req,assignment))fail(403,'Only the assigned faculty member can update this syllabus.');
    const value=topicSchema.parse(req.body);
    db.prepare('UPDATE syllabus_topics SET title=?,planned_hours=?,target_date=?,status=?,completed_at=?,note=?,updated_by=?,updated_at=? WHERE id=?').run(value.title,value.planned_hours,value.target_date||null,value.status,value.status==='completed'?(topic.completed_at||now()):null,value.note,req.user.id,now(),topic.id);
    audit(req.user,'syllabus.progress_updated','syllabus_topics',topic.id,{previousStatus:topic.status,status:value.status});
    res.json({ok:true});
  });
  app.delete('/api/syllabus/topics/:id',roles('FACULTY'),(req,res)=>{
    const topic=db.prepare('SELECT * FROM syllabus_topics WHERE id=?').get(req.params.id);if(!topic)fail(404,'Topic not found.');
    const assignment=needAssignment(req,topic.teaching_assignment_id);if(!canEdit(req,assignment))fail(403,'Only the assigned faculty member can update this syllabus.');
    db.prepare('DELETE FROM syllabus_topics WHERE id=?').run(topic.id);audit(req.user,'syllabus.topic_removed','syllabus_topics',topic.id);res.json({ok:true});
  });
  app.get('/api/academic-monitoring',roles('ADMIN','HOD','FACULTY'),(req,res)=>res.json(academicMonitoring(db,req)));
}
