import React, {useEffect, useState} from 'react';
import {ExtraPage} from './Extensions.jsx';
import {summarizeResults} from './lib/results.js';
import './results.css';

const kinds = {mid_term:'Mid-term',internal:'Internal',external:'External',exam:'Exam',viva:'Viva',record:'Record'};

export default function Results({grades,catalog,students,user,api,load,flash,ui}) {
  const {Button,Field,Select,Modal,Form,Table}=ui;
  const [marks,setMarks]=useState(null),[error,setError]=useState(''),[modal,setModal]=useState(false);
  const [studentId,setStudentId]=useState(user.role==='STUDENT'?user.id:''),[year,setYear]=useState(''),[semester,setSemester]=useState('');
  const [entryStudent,setEntryStudent]=useState('');
  useEffect(()=>{let active=true;api('/marks').then(rows=>{if(active){setMarks(rows);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api,grades]);
  const canWrite=['ADMIN','FACULTY'].includes(user.role);
  const selected=students.find(s=>s.id===entryStudent);
  const subjects=user.role==='ADMIN'?catalog.subjects:catalog.subjects.filter(s=>catalog.teachingAssignments.some(a=>a.faculty_id===user.id&&a.class_id===selected?.class_id&&a.subject_id===s.id));
  const matches=r=>(!studentId||r.student_id===studentId)&&(!year||Math.ceil(r.semester/2)===Number(year))&&(!semester||r.semester===Number(semester));
  const visibleMarks=(marks||[]).filter(matches),visibleGrades=grades.filter(matches);
  const maxSemester=Math.max(8,...(marks||[]).map(r=>r.semester),...grades.map(r=>r.semester));
  const summary=summarizeResults(visibleMarks,visibleGrades);
  return <div className="results-page">
    <div className="extension-heading"><h2>Evaluation history</h2>{canWrite&&<Button onClick={()=>{setEntryStudent('');setModal(true);}}>Enter mid-term / internal marks</Button>}</div>
    <section className="panel padded"><div className="form-grid">
      {user.role!=='STUDENT'&&<Field label="Student results"><Select value={studentId} onChange={e=>setStudentId(e.target.value)} options={students.map(s=>({...s,name:`${s.roll_number} · ${s.name}`}))} placeholder="All authorized students"/></Field>}
      <Field label="Academic year"><Select value={year} onChange={e=>{setYear(e.target.value);setSemester('');}} options={Array.from({length:Math.ceil(maxSemester/2)},(_,i)=>({value:String(i+1),label:`Year ${i+1}`}))} placeholder="All years"/></Field>
      <Field label="Result semester"><Select value={semester} onChange={e=>setSemester(e.target.value)} options={Array.from({length:maxSemester},(_,i)=>i+1).filter(s=>!year||Math.ceil(s/2)===Number(year)).map(s=>({value:String(s),label:`Semester ${s}`}))} placeholder="All semesters"/></Field>
    </div><p>Year 1: semesters 1–2 · Year 2: 3–4 · Year 3: 5–6 · Year 4: 7–8.</p></section>
    {error?<div className="error" role="alert">{error}</div>:marks===null?<p role="status">Loading marks…</p>:<>
      {studentId&&<div className="stats-grid"><section className="stat-card"><span>Recorded marks total</span><strong>{summary.total} / {summary.maximum}</strong><p>{summary.percentage===null?'No marks recorded':`${summary.percentage.toFixed(2)}% of recorded maximum`}</p></section><section className="stat-card"><span>Credit-weighted GPA · selected period</span><strong>{summary.gpa===null?'—':summary.gpa.toFixed(2)}</strong><p>{summary.credits} recorded credits</p></section></div>}
      <p className="muted">Totals add the recorded evaluations only. Mid-term and internal totals may overlap under your institution’s grading rules; these totals are not an official final result. Missing results are not counted as zero. GPA uses official grades and credits only.</p>
      {studentId&&summary.semesters.map(s=><section className="panel padded" key={s.semester}><h3>Year {Math.ceil(s.semester/2)} · Semester {s.semester}</h3><p>Recorded total: {s.total} / {s.maximum} · SGPA: {s.gpa===null?'Not recorded':s.gpa.toFixed(2)}</p></section>)}
      <section className="panel"><h3>Evaluation marks</h3><Table rows={visibleMarks} columns={[{key:'student_name',label:'STUDENT'},{key:'semester',label:'SEMESTER'},{key:'subject_name',label:'SUBJECT'},{key:'title',label:'EVALUATION'},{key:'kind',label:'TYPE',render:r=>kinds[r.kind]||r.kind},{key:'score',label:'MARKS',render:r=>`${r.score} / ${r.max_marks}`}]} empty={{title:'No marks recorded for this period',description:'Published mid-term, internal and exam marks will appear here.'}}/></section>
    </>}
    <ExtraPage page="grades" data={visibleGrades} catalog={catalog} students={students} people={[]} user={user} api={api} load={load} flash={flash} ui={ui}/>
    {modal&&<Modal title="Enter academic marks" onClose={()=>setModal(false)}><Form submit="Publish marks" onSubmit={async v=>{await api('/marks',{method:'POST',body:v});setModal(false);flash('Marks published to the student’s results');await load();}}><div className="form-grid">
      <Field label="Student"><Select name="student_id" value={entryStudent} onChange={e=>setEntryStudent(e.target.value)} options={students.map(s=>({...s,name:`${s.roll_number} · ${s.name}`}))} required/></Field>
      <Field label="Subject"><Select key={entryStudent} name="subject_id" options={subjects} required/></Field>
      <Field label="Evaluation type"><Select name="kind" options={Object.entries(kinds).map(([value,label])=>({value,label}))} required/></Field>
      <Field label="Evaluation title"><input name="title" placeholder="e.g. Mid-term 1 or Internal total" required maxLength="200"/></Field>
      <Field label="Semester"><input key={entryStudent} name="semester" type="number" min="1" max="20" defaultValue={catalog.classes.find(c=>c.id===selected?.class_id)?.semester||1} required/></Field>
      <Field label="Score"><input name="score" type="number" min="0" step="0.01" required/></Field>
      <Field label="Maximum marks"><input name="max_marks" type="number" min="0.01" max="10000" step="0.01" required/></Field>
    </div><p>Publishing makes this evaluation immediately visible to the student. Use a distinct title for each evaluation.</p></Form></Modal>}
  </div>;
}
