import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CalendarDays, Check, CheckCircle2, LoaderCircle, Plus, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import './timetable-assistant.css';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const emptyRow = () => ({ class_id: null, subject_id: null, faculty_id: null, day_of_week: null, start_time: null, end_time: null, room: '', source_text: '', class_label: '', subject_label: '', faculty_label: '' });
const defaultInstruction = 'Read this timetable and tell me what to do.';

export function TimetableAssistant({ api, ui, onClose, onSaved }) {
  const { Button, Field, Badge, Empty } = ui;
  const [file, setFile] = useState(null), [instruction, setInstruction] = useState(defaultInstruction);
  const [draft, setDraft] = useState(null), [drafts, setDrafts] = useState([]), [status, setStatus] = useState(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState('loading'), [error, setError] = useState('');
  const dialog = useRef(null), operation = useRef(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([api('/assistant/timetable/status'), api('/assistant/timetable/drafts')])
      .then(([configuration, saved]) => { if (mounted) { setStatus(configuration); setDrafts(saved); } })
      .catch(e => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setBusy(''); });
    const previousFocus = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { mounted = false; document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, [api]);

  const close = () => {
    if (busy) return;
    if (dirty) { setError('Save your corrections before closing, or reload the saved draft to discard them.'); return; }
    onClose();
  };
  const acceptDraft = saved => {
    setDraft(saved); setDirty(false);
    setDrafts(current => [saved, ...current.filter(item => item.id !== saved.id)]);
  };
  const run = async (name, action) => {
    if (operation.current) return;
    operation.current = true; setBusy(name); setError('');
    try { await action(); }
    catch (e) {
      if (name === 'commit' && e.details?.draft) acceptDraft(e.details.draft);
      setError(e.message);
    } finally { operation.current = false; setBusy(''); }
  };
  const editRows = rows => {
    if (busy || draft.status !== 'draft') return;
    setDraft(current => ({ ...current, rows, issues: [], canCommit: false })); setDirty(true);
  };
  const updateRow = (index, patch) => editRows(draft.rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const openDraft = id => run('reload', async () => acceptDraft(await api('/assistant/timetable/drafts/' + id)));
  const upload = event => {
    event.preventDefault();
    if (!file) return;
    if (file.size > (status?.limits.bytes || 10 * 1024 * 1024)) { setError('File exceeds the 10 MB limit.'); return; }
    return run('upload', async () => {
      const body = new FormData(); body.append('file', file); body.append('instruction', instruction.trim() || defaultInstruction);
      acceptDraft(await api('/assistant/timetable/drafts', { method: 'POST', body }));
    });
  };
  const save = () => run('save', async () => acceptDraft(await api('/assistant/timetable/drafts/' + draft.id, {
    method: 'PATCH', body: { rows: draft.rows, revision: draft.revision },
  })));
  const commit = () => run('commit', async () => {
    acceptDraft(await api('/assistant/timetable/drafts/' + draft.id + '/commit', { method: 'POST', body: { confirm: true, revision: draft.revision } }));
    onSaved?.();
  });
  const startUpload = () => { setDraft(null); setFile(null); setError(''); };
  const issueFor = (index, field) => draft.issues.filter(issue => issue.index === index && issue.field === field).map(issue => issue.message).join(' ');
  const locked = !!busy || draft?.status === 'committed';

  return <div className="timetable-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialog} tabIndex={-1} className="timetable-agent" role="dialog" aria-modal="true" aria-label="Timetable assistant" aria-busy={!!busy}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')].filter(node => !node.matches(':disabled'));
          const first = controls[0], last = controls.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header><div><span className="eyebrow">TIMETABLE REVIEW</span><h2>Upload a timetable</h2><p>Review the extracted sessions, correct any issues, then confirm to add them to your timetable.</p></div>
        <button className="icon-button" aria-label="Close timetable assistant" disabled={!!busy} onClick={close}><X size={20}/></button></header>
      {error && <div className="error timetable-error" role="alert"><AlertCircle size={17}/>{error}</div>}
      {!draft ? <>
        {busy === 'loading' && <p className="timetable-status" role="status">Loading your saved drafts…</p>}
        {status && (!status.textConfigured || !status.visionConfigured) && <p className="timetable-status">{!status.textConfigured && !status.visionConfigured
          ? 'Timetable extraction is not configured. Ask your administrator to connect the timetable AI service. You can still review saved drafts.'
          : status.textConfigured ? 'Text PDFs are available. Image and scanned PDF extraction needs a configured vision model.' : 'Image extraction is available. Text PDF extraction needs a configured chat model.'}</p>}
        <form onSubmit={upload} className="timetable-upload-form"><div className="upload-zone"><Upload size={26}/><strong>Choose a timetable image or PDF</strong>
          <input aria-label="Timetable file" type="file" disabled={!!busy} accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={event => setFile(event.target.files?.[0] || null)} required/>
          <p>{file ? file.name : 'Maximum 10 MB · up to 8 PDF pages'}</p></div>
          <Field label="What should the agent do?"><textarea disabled={!!busy} value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={2000} rows={3} placeholder="Extract Monday’s timetable for my assigned classes."/></Field>
          <div className="timetable-agent-actions"><Button type="submit" disabled={!!busy || !file} icon={busy === 'upload' ? LoaderCircle : Sparkles}>{busy === 'upload' ? 'Reading timetable…' : 'Read and prepare draft'}</Button></div>
        </form>
        {drafts.length > 0 && <section className="timetable-saved" aria-label="Saved timetable drafts"><h3>Saved drafts and imports</h3><p>Continue a saved review or inspect sessions already added.</p>
          {drafts.map(saved => <div key={saved.id}><span>{saved.filename}<small>{saved.rows.length} session(s) · {new Date(saved.updated_at).toLocaleString()}</small></span>
            <Button variant="outline" disabled={!!busy} onClick={() => openDraft(saved.id)}>{saved.status === 'committed' ? 'View' : 'Resume'} {saved.filename}</Button></div>)}
        </section>}
      </> : <div className="timetable-draft">
        <div className="timetable-draft-summary"><div><Badge tone={draft.status === 'committed' ? 'green' : 'orange'}>{draft.status === 'committed' ? 'Added to timetable' : dirty ? 'Unsaved corrections' : 'Review required'}</Badge>
          <h3>{dirty ? 'Save your corrections to check assignments, times, and conflicts.' : draft.summary}</h3><p>{draft.filename} · {draft.extractionMode === 'vision' ? 'Image extraction' : 'Text PDF extraction'} · {draft.pages || 1} page(s)</p></div>
          <Button variant="ghost" disabled={!!busy || dirty} onClick={startUpload}>Back to uploads</Button></div>
        <div className="timetable-review-note"><ShieldCheck size={17}/><span>Check every session against your original document. Only sessions matching your authorized teaching assignments can be added.</span></div>
        <div className="timetable-rows">{draft.rows.map((row, index) => <article className="timetable-row" key={index} aria-label={`Session ${index + 1}`}>
          <div className="timetable-row-heading"><strong>Session {index + 1}</strong>{row.source_text && <small>{row.source_text}</small>}
            {draft.status === 'draft' && <button className="icon-button" aria-label={`Remove session ${index + 1}`} disabled={!!busy} onClick={() => editRows(draft.rows.filter((_, i) => i !== index))}><Trash2 size={16}/></button>}</div>
          <fieldset className="timetable-row-fields" disabled={locked}>
            {[['class_id', 'classes', 'Class', 'class_label'], ['subject_id', 'subjects', 'Subject', 'subject_label'], ['faculty_id', 'faculty', 'Faculty', 'faculty_label']].map(([field, list, label, source]) =>
              <label key={field}>{label}<select aria-label={label} value={row[field] || ''} onChange={event => updateRow(index, { [field]: event.target.value || null })}><option value="">Select {label.toLowerCase()}</option>{draft.catalog[list].map(option => <option value={option.id} key={option.id}>{option.name}{option.code ? ' · ' + option.code : ''}</option>)}</select>
                {row[source] && !row[field] && <small>Extracted: {row[source]}</small>}{issueFor(index, field) && <em>{issueFor(index, field)}</em>}</label>)}
            <label>Day<select aria-label="Day" value={row.day_of_week ?? ''} onChange={event => updateRow(index, { day_of_week: event.target.value === '' ? null : Number(event.target.value) })}><option value="">Select day</option>{days.map((day, i) => <option value={i} key={day}>{day}</option>)}</select>{issueFor(index, 'day_of_week') && <em>{issueFor(index, 'day_of_week')}</em>}</label>
            {[['start_time', 'Start'], ['end_time', 'End']].map(([field, label]) => <label key={field}>{label}<input aria-label={label} type="time" value={row[field] || ''} onChange={event => updateRow(index, { [field]: event.target.value || null })}/>{issueFor(index, field) && <em>{issueFor(index, field)}</em>}</label>)}
            <label>Room<input aria-label="Room" value={row.room || ''} maxLength={100} onChange={event => updateRow(index, { room: event.target.value })}/></label>
          </fieldset>
          {draft.issues.filter(issue => issue.index === index && ['assignment', 'session'].includes(issue.field)).map(issue => <p className="timetable-row-error" key={issue.code + issue.message}><AlertCircle size={15}/>{issue.message}</p>)}
        </article>)}</div>
        {!draft.rows.length && <Empty icon={CalendarDays} title="No sessions in this draft" description="Add a session for review or return to uploads to try another document."/>}
        {draft.issues.filter(issue => issue.index === null).map(issue => <p className="timetable-row-error" key={issue.code}>{issue.message}</p>)}
        <footer className="timetable-agent-actions">
          {draft.status === 'draft' && <>
            <Button variant="ghost" onClick={() => editRows([...draft.rows, emptyRow()])} disabled={!!busy || draft.rows.length >= (status?.limits.rows || 150)} icon={Plus}>Add session</Button>
            <Button variant="ghost" onClick={() => openDraft(draft.id)} disabled={!!busy}>Reload saved draft</Button>
            <Button variant="outline" onClick={save} disabled={!!busy || !dirty} icon={busy === 'save' ? LoaderCircle : Check}>{busy === 'save' ? 'Saving…' : 'Save corrections'}</Button>
            <Button onClick={commit} disabled={!!busy || dirty || !draft.canCommit} icon={busy === 'commit' ? LoaderCircle : CheckCircle2}>{busy === 'commit' ? 'Adding…' : 'Confirm and add sessions'}</Button>
          </>}
          {draft.status === 'committed' && <Button onClick={close}>Done</Button>}
        </footer>
      </div>}
    </section>
  </div>;
}
