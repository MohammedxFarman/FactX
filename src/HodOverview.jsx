import React from 'react';
import { Users, BookOpen, CalendarDays, ClipboardList, ShieldCheck, ArrowUpRight, Bell, GraduationCap } from 'lucide-react';

export const HOD_LABELS = {
  inbox:'Workflow inbox',support:'Support plans',overview:'Department overview', academics:'Classes & faculty assignments', attendance:'Attendance review',
  assessments:'Assessment overview', analytics:'Student support', grades:'Results & SGPA',
  reports:'Department reports', leave:'Leave approvals', feedback:'Student guidance',
  monitoring:'Branch monitoring',syllabus:'Faculty syllabus progress',substitutions:'Teaching substitutions',
};
export const HOD_GROUPS = [
  {group:'DEPARTMENT',ids:['overview','inbox','students','academics','timetable']},
  {group:'ACADEMIC OVERSIGHT',ids:['monitoring','syllabus','workload','attendance','assessments','grades','analytics','support','reports']},
  {group:'COORDINATION',ids:['leave','substitutions','announcements','feedback','documents','knowledge']},
];

export function HodOverview({data,navigate,openReport,reviewLeave,ui}) {
  const {Stat,PanelHeading,Table,Empty,Badge,Person,Button} = ui;
  const metrics = [
    ['Department students',data.students,`${data.classes} ${data.classes===1?'class':'classes'}`,Users,'green'],
    ['Active faculty',data.faculty,'Within your department',GraduationCap,'blue'],
    ['Leave approvals',data.pendingLeaves,`${data.pendingFacultyLeaves||0} faculty · ${data.pendingStudentLeaves||0} student requests`,CalendarDays,'orange'],
    ['Evaluation follow-up',data.pendingEvaluations,'Awaiting faculty action',ClipboardList,'purple'],
  ];
  return <>
    <section className="panel hod-intro"><div><span className="collection-label">DEPARTMENT LEADERSHIP</span><h2>{data.department?.name || 'Your department'}</h2><p>Coordinate teaching, review academic progress, and support your department.</p></div><Button variant="outline" onClick={()=>navigate('announcements')} icon={Bell}>Department announcements</Button></section>
    <div className="stats-grid">{metrics.map(([title,value,caption,icon,color])=><Stat key={title} {...{title,value,caption,icon,color}}/>)}</div>
    <section className="panel hod-monitoring-snapshot"><div><h2>Faculty and branch monitoring</h2><p>{data.syllabusCompletion===null?'No syllabus plans recorded':`${data.syllabusCompletion}% of planned syllabus hours complete`} · {data.overdueTopics||0} overdue topics · {data.coursesWithoutPlan||0} courses without a plan</p></div><div className="leave-actions"><Button variant="outline" onClick={()=>navigate('monitoring')}>Open branch monitoring</Button><Button variant="outline" onClick={()=>navigate('syllabus')}>View faculty syllabus</Button><Button variant="outline" onClick={()=>navigate('substitutions')}>Teaching cover</Button></div></section>
    <section className="panel hod-priorities"><PanelHeading title="Department priorities" subtitle="Follow up on the work that needs your attention."/><div className="hod-priority-grid">{[
      ['leave',CalendarDays,`${data.pendingLeaves} pending leave requests`,'Review faculty leave and coordinate cover'],
      ['workload',ClipboardList,`${data.pendingEvaluations} evaluations pending`,'Follow up with the responsible faculty'],
      ['analytics',ShieldCheck,`${data.supportCount} students need support`,'Review attendance and academic guidance'],
      ['academics',BookOpen,`${data.unassignedClasses} ${data.unassignedClasses===1?'class':'classes'} without faculty assignments`,'Coordinate teaching responsibilities'],
    ].map(([target,Icon,title,description])=><button key={target} onClick={()=>navigate(target)}><Icon size={21}/><span><strong>{title}</strong><small>{description}</small></span><ArrowUpRight size={16}/></button>)}</div></section>
    <section className="panel hod-class-summary"><PanelHeading title="Class performance" subtitle="Department attendance, recorded marks, and evaluation progress." action={<Button variant="ghost" onClick={()=>navigate('reports')}>Open reports <ArrowUpRight size={15}/></Button>}/><Table rows={data.classOverview} columns={[
      {key:'name',label:'CLASS'},{key:'students',label:'STUDENTS'},{key:'faculty',label:'FACULTY'},
      {key:'attendance',label:'ATTENDANCE',render:row=>row.attendance===null?'No records':`${row.attendance}%`},
      {key:'average',label:'AVG. MARKS',render:row=>row.average===null?'No records':`${row.average}%`},
      {key:'pendingEvaluations',label:'PENDING EVALUATIONS'},
    ]} empty={{icon:BookOpen,title:'Your department at a glance',description:'Classes created by your administrator will appear here.'}}/></section>
    <div className="hod-review-grid"><section className="panel"><PanelHeading title="Awaiting your approval" subtitle="Oldest pending student leave requests first."/>{data.leaveQueue.length?<div className="hod-review-list">{data.leaveQueue.map(leave=><div key={leave.id}><Person name={leave.student_name} sub={`${leave.start_date} to ${leave.end_date}`}/><Button variant="outline" onClick={()=>reviewLeave(leave)}>Review leave</Button></div>)}</div>:<Empty icon={CalendarDays} title="No pending leave requests" description="New department requests will appear here for your review."/>}</section>
    <section className="panel"><PanelHeading title="Student support" subtitle="Recorded signals for a supportive follow-up."/>{data.attention.length?<div className="hod-review-list">{data.attention.map(student=><button key={student.id} onClick={()=>openReport(student)}><Person name={student.name} sub={student.roll_number}/><span>{student.analytics.suggestions[0].title}</span><ArrowUpRight size={16}/></button>)}</div>:<Empty icon={ShieldCheck} title="No support signals recorded" description="Suggestions appear when department records indicate a need for support."/>}</section></div>
    <div className="workspace-note"><ShieldCheck size={20}/><div><strong>Focused on your department.</strong><span>Faculty record attendance, publish activities, and evaluate work. You coordinate and review progress.</span></div><Badge tone="green">Database connected</Badge></div>
  </>;
}
