import { scopes } from './security.js';
import { studentRisk } from './risk-models.js';
import { featureSnapshot } from './risk-features.js';
export function analyticsCandidates(db,students){
  // Empty synthetic cohorts have no support signals. Avoid thousands of detailed
  // risk/feature queries when only a few students have recorded academic data.
  if(db.prepare('SELECT 1 FROM activities LIMIT 1').get()||db.prepare('SELECT 1 FROM risk_predictions LIMIT 1').get()||db.prepare('SELECT 1 FROM model_versions WHERE active=1 LIMIT 1').get())return students;
  const ids=new Set(db.prepare('SELECT student_id FROM attendance UNION SELECT student_id FROM marks').all().map(r=>r.student_id));
  return students.filter(s=>ids.has(s.id));
}

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
  const riskStudent = db.prepare("SELECT * FROM users WHERE id=? AND role='STUDENT'").get(studentId);
  let risk = { status: 'not_configured', predictions: [], abstentions: [], active_models: 0, coverage: null, limitations: ['No reviewed risk model is active.'] };
  if (riskStudent && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='risk_model_contracts'").get()) risk = studentRisk(db, studentId);
  const prediction = risk.predictions[0] || db.prepare('SELECT r.*,m.version model_version FROM risk_predictions r JOIN model_versions m ON m.id=r.model_id WHERE student_id=? AND m.validated=1 AND m.active=1 ORDER BY r.created_at DESC LIMIT 1').get(studentId);
  const normalizedPrediction = prediction && prediction.probability !== undefined ? prediction : prediction ? { ...prediction, factors: JSON.parse(prediction.factors), status: 'available', target: 'legacy' } : null;
  if (risk.predictions.length) {
    for (const item of risk.predictions.filter(item => item.category === 'medium' || item.category === 'high').slice(0, 4)) {
      const factor = item.factors?.find(value => value.contribution > 0);
      suggestions.push({ title: `Review ${item.target.replaceAll('_', ' ')}`, detail: factor ? `The reviewed model associates ${factor.feature.replaceAll('_', ' ')} with this support review. Discuss a specific plan with the student and faculty; the factor is an association, not a cause.` : 'The reviewed model flagged this support review. Inspect the contributing factors with the student and faculty; factors are associations, not causes.', source: `Reviewed model ${item.model_version} · ${item.category} band · observed ${item.observed_at}` });
    }
  }
  const snapshot = riskStudent ? featureSnapshot(db, riskStudent, { target: 'attendance_shortage' }) : null;
  return { attendance: attendancePercent, average, sessions: considered.length, evaluations: marks.length, suggestions, prediction: normalizedPrediction, risk, featureSnapshot: snapshot, riskMessage: risk.status === 'available' ? 'Reviewed model estimates are available for faculty support review.' : 'Risk analysis unavailable until sufficient validated data is available.', suggestionMethod: `Transparent academic support rules, plus reviewed model estimates when active. Attendance below ${attendanceThreshold}%, marks below ${marksThreshold}%, and overdue work identify opportunities for support.` };
}
