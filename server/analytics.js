import { scopes } from './security.js';
export function studentAnalytics(db, studentId) {
  const attendance = db.prepare('SELECT * FROM attendance WHERE student_id=? ORDER BY date').all(studentId);
  const marks = db.prepare('SELECT m.*,s.name subject_name FROM marks m JOIN subjects s ON s.id=m.subject_id WHERE student_id=? ORDER BY created_at').all(studentId);
  const considered = attendance.filter(a => a.status !== 'excused');
  const attendancePercent = considered.length ? Math.round(considered.filter(a => a.status === 'present').length / considered.length * 100) : null;
  const average = marks.length ? Math.round(marks.reduce((sum, m) => sum + m.score / m.max_marks * 100, 0) / marks.length) : null;
  const suggestions = [];
  const settings=Object.fromEntries(db.prepare('SELECT * FROM institution_settings').all().map(s=>[s.key,JSON.parse(s.value)]));
  const attendanceThreshold=settings.attendanceThreshold??75,marksThreshold=settings.marksThreshold??50;
  if (attendancePercent !== null && attendancePercent < attendanceThreshold) suggestions.push({ title: 'Build a consistent attendance routine', detail: `Your recorded attendance is ${attendancePercent}%. Review missed topics with your faculty and plan your next classes.`, source: `${considered.length} recorded sessions · Institutional support threshold: ${attendanceThreshold}%` });
  const bySubject = Object.groupBy(marks, m => m.subject_id);
  for (const rows of Object.values(bySubject)) { const avg = rows.reduce((n, r) => n + r.score / r.max_marks * 100, 0) / rows.length; if (avg < marksThreshold) suggestions.push({ title: `Revisit ${rows[0].subject_name}`, detail: `Your average across recorded marks is ${Math.round(avg)}%. Ask your faculty for targeted practice and feedback.`, source: `${rows.length} recorded evaluation(s) · Institutional support threshold: ${marksThreshold}%` }); }
  const student=db.prepare('SELECT * FROM users WHERE id=?').get(studentId),scope=scopes(db,student);
  const pending = db.prepare("SELECT a.* FROM activities a WHERE a.kind!='module' AND a.deadline IS NOT NULL AND a.deadline < ? AND NOT EXISTS(SELECT 1 FROM submissions s WHERE s.activity_id=a.id AND s.student_id=?)").all(new Date().toISOString(),studentId).filter(a=>scope.canActivity(a));
  if (pending.length) suggestions.push({ title: 'Discuss overdue work with your faculty', detail: `${pending.length} assessment(s) have passed their deadline without a submission. Contact the relevant faculty to agree on next steps.`, source: 'Assessment deadlines and submission records' });
  const prediction = db.prepare('SELECT r.*,m.version model_version FROM risk_predictions r JOIN model_versions m ON m.id=r.model_id WHERE student_id=? AND m.validated=1 AND m.active=1 ORDER BY r.created_at DESC LIMIT 1').get(studentId);
  return { attendance: attendancePercent, average, sessions: considered.length, evaluations: marks.length, suggestions, prediction: prediction ? { ...prediction, factors: JSON.parse(prediction.factors) } : null, riskMessage: 'Risk analysis unavailable until sufficient validated data is available.', suggestionMethod: `Transparent academic support rules, not ML predictions. Attendance below ${attendanceThreshold}%, marks below ${marksThreshold}%, and overdue work identify opportunities for support.` };
}
