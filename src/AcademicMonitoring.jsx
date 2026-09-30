import React,{useState,useEffect} from 'react';
import { BookOpen, Plus, Users, CalendarDays, ClipboardList, ShieldCheck } from 'lucide-react';

const percentage=value=>value===null?'No records':`${value}%`;
const completion=value=>value===null?'No syllabus plan':`${value}%`;

export function SyllabusProgress({data,user,api,load,flash,target,consumeTarget,ui}) {
  const {Button,Field,Select,Form,Modal,Badge,Empty}=ui;
  const [assignmentId,setAssignmentId]=useState(''),[facultyId,setFacultyId]=useState(''),[modal,setModal]=useState(null);
  const canEdit=user.role==='FACULTY';
  const faculty=[...new Map(data.map(assignment=>[assignment.faculty_id,{id:assignment.faculty_id,name:assignment.faculty_name}])).values()];
  const rows=data.filter(assignment=>(!assignmentId||assignment.id===assignmentId)&&(!facultyId||assignment.faculty_id===facultyId));
  useEffect(()=>{if(!target?.id)return;const assignment=data.find(row=>row.id===target.assignmentId||row.topics.some(topic=>topic.id===target.id));if(assignment){setAssignmentId(assignment.id);setFacultyId(canEdit?'':assignment.faculty_id);const topic=assignment.topics.find(topic=>topic.id===target.id);if(canEdit&&topic)setModal({topic,assignment})}consumeTarget()},[target?.id,data]);
  const save=async values=>{
    const body={...values,target_date:values.target_date||null};
    if(modal.topic)await api(`/syllabus/topics/${modal.topic.id}`,{method:'PATCH',body});
    else await api('/syllabus/topics',{method:'POST',body});
    setModal(null);flash('Syllabus progress saved');await load();
  };
  return <><div className="info-banner"><BookOpen size={22}/><div><strong>{canEdit?'Plan your syllabus and record actual progress.':'Monitor faculty syllabus plans and completion.'}</strong><p>Completion is the share of planned topic hours marked complete. Courses without a plan remain clearly identified.</p></div></div><div className="workflow-toolbar"><div className="monitoring-filters">{!canEdit&&<Field label="Faculty"><Select value={facultyId} onChange={event=>{setFacultyId(event.target.value);setAssignmentId('')}} options={faculty} placeholder="All faculty"/></Field>}<Field label="Class and subject"><Select value={assignmentId} onChange={event=>setAssignmentId(event.target.value)} options={data.filter(assignment=>!facultyId||assignment.faculty_id===facultyId).map(assignment=>({id:assignment.id,name:`${assignment.class_name} · ${assignment.subject_name}`}))} placeholder="All assigned courses"/></Field></div>{canEdit&&<Button icon={Plus} disabled={!data.length} onClick={()=>setModal({})}>Add syllabus topic</Button>}</div>
    {rows.length?<div className="syllabus-courses">{rows.map(assignment=><section className="panel syllabus-course" key={assignment.id}><header><div><h2>{assignment.class_name} · {assignment.subject_name}</h2><p>{assignment.faculty_name} · {assignment.department_name}</p></div><Badge tone={assignment.completionPercent===100?'green':'neutral'}>{completion(assignment.completionPercent)}</Badge></header>{assignment.completionPercent!==null&&<div className="syllabus-progress"><progress aria-label={`Syllabus completion for ${assignment.class_name} ${assignment.subject_name}`} max="100" value={assignment.completionPercent}/><span>{assignment.completedHours} of {assignment.totalHours} planned hours completed · {assignment.overdueTopics} overdue topics</span></div>}{assignment.topics.length?<div className="syllabus-topics">{assignment.topics.map(topic=><article key={topic.id}><div><strong>{topic.title}</strong><small>{topic.planned_hours} planned hours{topic.target_date?` · Target ${topic.target_date}`:''}</small>{topic.note&&<p>{topic.note}</p>}</div><Badge tone={topic.status==='completed'?'green':topic.target_date&&topic.target_date<new Date().toISOString().slice(0,10)?'orange':'neutral'}>{topic.status==='completed'?'Completed':topic.status==='in_progress'?'In progress':'Planned'}</Badge>{canEdit&&<Button variant="outline" onClick={()=>setModal({topic,assignment})}>Update progress</Button>}</article>)}</div>:<Empty icon={BookOpen} title="No syllabus topics recorded" description={canEdit?'Add the topics, planned hours, and target dates for this course.':'The assigned faculty member has not recorded a plan yet.'}/>}</section>)}</div>:<section className="panel"><Empty icon={BookOpen} title="No teaching assignments in this view" description="Syllabus plans follow the department’s actual faculty assignments."/></section>}
    {modal&&<Modal title={modal.topic?'Update syllabus progress':'Add syllabus topic'} onClose={()=>setModal(null)}><Form submit="Save syllabus progress" onSubmit={save}><div className="form-grid">{!modal.topic&&<Field label="Teaching assignment"><Select name="teaching_assignment_id" defaultValue={assignmentId} options={data.map(assignment=>({id:assignment.id,name:`${assignment.class_name} · ${assignment.subject_name}`}))} required/></Field>}<Field label="Topic"><input name="title" defaultValue={modal.topic?.title||''} required maxLength="300"/></Field><Field label="Planned hours"><input name="planned_hours" type="number" min="0.25" max="1000" step="0.25" defaultValue={modal.topic?.planned_hours||1} required/></Field><Field label="Target date"><input name="target_date" type="date" defaultValue={modal.topic?.target_date||''}/></Field><Field label="Progress"><select name="status" defaultValue={modal.topic?.status||'planned'}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></Field><Field label="Teaching note"><textarea name="note" rows="3" maxLength="3000" defaultValue={modal.topic?.note||''}/></Field></div></Form></Modal>}
  </>;
}

export function AcademicMonitoring({data,user,navigate,ui}) {
  const {Stat,Field,Select,Table,PanelHeading,Button,Badge}=ui;
  const [facultyId,setFacultyId]=useState(''),[classId,setClassId]=useState('');
  const courses=data.courses.filter(course=>(!facultyId||course.faculty_id===facultyId)&&(!classId||course.class_id===classId));
  const classes=data.classPerformance.filter(classroom=>!classId||classroom.id===classId);
  const faculty=data.faculty.filter(member=>!facultyId||member.id===facultyId);
  const summary=data.summary;
  return <><div className="info-banner"><ShieldCheck size={22}/><div><strong>{data.scope}</strong><p>Attendance and performance use recorded academic data. Syllabus completion uses faculty-updated topics and planned hours; missing records stay visible.</p></div></div><div className="stats-grid">{[
    ['Students',summary.students,`${summary.classes} classes`,Users,'green'],
    ['Attendance',percentage(summary.attendance),'Present / recorded sessions, excluding excused',CalendarDays,'blue'],
    ['Recorded marks',percentage(summary.averageMarks),'Average percentage across recorded marks',ClipboardList,'purple'],
    ['Syllabus completion',summary.syllabusCompletion===null?'No plan':`${summary.syllabusCompletion}%`,`${summary.overdueTopics} overdue topics · ${summary.coursesWithoutPlan} courses without a plan`,BookOpen,'orange'],
  ].map(([title,value,caption,icon,color])=><Stat key={title} {...{title,value,caption,icon,color}}/>)}</div><div className="workflow-toolbar"><div className="monitoring-filters">{user.role!=='FACULTY'&&<Field label="Faculty"><Select value={facultyId} onChange={event=>setFacultyId(event.target.value)} options={data.faculty} placeholder="All department faculty"/></Field>}<Field label="Class"><Select value={classId} onChange={event=>setClassId(event.target.value)} options={data.classPerformance} placeholder="All classes"/></Field></div><Button variant="outline" onClick={()=>navigate('syllabus')}>View syllabus details</Button></div>
    <section className="panel monitoring-panel"><PanelHeading title="Faculty teaching overview" subtitle="Teaching workload, syllabus progress, and evaluation follow-up."/><Table rows={faculty} columns={[
      {key:'name',label:'FACULTY'},{key:'classes',label:'CLASSES'},{key:'weeklySessions',label:'WEEKLY SESSIONS'},
      {key:'syllabusCompletion',label:'SYLLABUS',render:member=>completion(member.syllabusCompletion)},
      {key:'overdueTopics',label:'OVERDUE TOPICS'},{key:'pendingEvaluations',label:'PENDING EVALUATIONS'},
    ]} empty={{icon:Users,title:'No faculty in this view',description:'Active department records will appear here.'}}/></section>
    <section className="panel monitoring-panel"><PanelHeading title="Course and class performance" subtitle="Filter a faculty member or class to inspect the assigned subjects."/><Table rows={courses} columns={[
      {key:'faculty_name',label:'FACULTY'},{key:'class_name',label:'CLASS'},{key:'subject_name',label:'SUBJECT'},
      {key:'students',label:'STUDENTS'},{key:'completionPercent',label:'SYLLABUS',render:course=>completion(course.completionPercent)},
      {key:'attendance',label:'ATTENDANCE',render:course=>percentage(course.attendance)},
      {key:'averageMarks',label:'MARKS',render:course=>percentage(course.averageMarks)},
      {key:'assessmentAverage',label:'ASSESSMENTS',render:course=>percentage(course.assessmentAverage)},
      {key:'pendingEvaluations',label:'PENDING EVALUATIONS'},
    ]} empty={{icon:BookOpen,title:'No courses in this view',description:'Create actual teaching assignments to connect faculty, classes, and subjects.'}}/></section>
    <section className="panel monitoring-panel"><PanelHeading title="Branch class summary" subtitle="Class-wide academic records across the authorized branch."/><Table rows={classes} columns={[
      {key:'name',label:'CLASS'},{key:'students',label:'STUDENTS'},
      {key:'attendance',label:'ATTENDANCE',render:classroom=>percentage(classroom.attendance)},
      {key:'averageMarks',label:'MARKS',render:classroom=>percentage(classroom.averageMarks)},
      {key:'assessmentAverage',label:'ASSESSMENTS',render:classroom=>percentage(classroom.assessmentAverage)},
      {key:'supportCount',label:'STUDENTS NEEDING SUPPORT',render:classroom=><Badge tone={classroom.supportCount?'orange':'neutral'}>{classroom.supportCount}</Badge>},
      {key:'pendingEvaluations',label:'PENDING EVALUATIONS'},
    ]} empty={{icon:Users,title:'No classes in this view',description:'Department classes will appear as they are configured.'}}/></section>
  </>;
}
