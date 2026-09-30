import React,{useState,useEffect} from 'react';
import {Users,CalendarDays} from 'lucide-react';
import {SubstitutionAttendance} from './Coordination.jsx';

export function SubstitutionSchedule({data,user,api,load,flash,target,consumeTarget,ui}) {
  const {Table,Button,Badge,Modal}=ui;
  const [view,setView]=useState('upcoming'),[sessionId,setSessionId]=useState(null);
  useEffect(()=>{if(target?.id){setView('all');setSessionId(target.id);consumeTarget()}},[target?.id]);
  const rows=data.filter(session=>view==='all'||session.session_date>=new Date().toISOString().slice(0,10));
  const selected=data.find(session=>session.id===sessionId);
  return <><div className="info-banner"><Users size={22}/><div><strong>{user.role==='STUDENT'?'Your scheduled class changes.':user.role==='FACULTY'?'Your teaching cover and substitution duties.':'Department teaching substitutions.'}</strong><p>Assignments identify the date, class, subject, and faculty covering each scheduled session. Substitutes can save attendance only for their assigned session.</p></div></div><div className="tabs"><button className={view==='upcoming'?'selected':''} onClick={()=>setView('upcoming')}>Upcoming</button><button className={view==='all'?'selected':''} onClick={()=>setView('all')}>All dates</button></div><section className="panel"><Table rows={rows} columns={[
    {key:'session_date',label:'DATE'},{key:'time',label:'TIME',render:session=>`${session.start_time}–${session.end_time}`},{key:'class_name',label:'CLASS'},{key:'subject_name',label:'SUBJECT'},{key:'original_faculty_name',label:'REGULAR FACULTY'},{key:'substitute_name',label:'COVERING FACULTY'},{key:'room',label:'ROOM'},
    ...(user.role==='STUDENT'?[]:[{key:'attendance_recorded_at',label:'ATTENDANCE',render:session=><Badge tone={session.attendance_recorded_at?'green':'neutral'}>{session.attendance_recorded_at?'Recorded':'Not recorded'}</Badge>}]),
    {key:'actions',label:'',render:session=><Button variant="outline" onClick={()=>setSessionId(session.id)}>{user.role==='STUDENT'?'View session':session.can_record_attendance?'Record attendance':'View attendance'}</Button>},
  ]} empty={{icon:CalendarDays,title:'No teaching substitutions scheduled',description:'HOD-assigned cover will appear here and in your notifications.'}}/></section>{sessionId&&(user.role==='STUDENT'?selected&&<Modal title="Class teaching change" onClose={()=>setSessionId(null)}><h3>{selected.class_name} · {selected.subject_name}</h3><p className="small muted">{selected.session_date} · {selected.start_time}–{selected.end_time} · {selected.room||'Room not recorded'}</p><p>Covering faculty: {selected.substitute_name}</p></Modal>:<SubstitutionAttendance id={sessionId} api={api} load={load} flash={flash} onClose={()=>setSessionId(null)} ui={ui}/>)}</>;
}
