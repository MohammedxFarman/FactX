import { scopes } from './security.js';

export const RISK_TARGETS = ['course_failure', 'attendance_shortage', 'assignment_delay', 'lab_failure'];
export const SUBJECT_TARGETS = new Set(['course_failure', 'lab_failure']);
export const RISK_FEATURES = ['attendance_percent', 'assessment_average', 'assignment_completion', 'lab_average', 'engagement_rate', 'trailing_score_change', 'recent_attendance_percent', 'attendance_change', 'late_submission_percent', 'lab_completion', 'prior_result_average', 'assessments_observed', 'attendance_sessions_observed', 'remaining_sessions'];
export const FEATURE_LIMITATIONS = [
  'These are current record snapshots, not reconstructed historical features. Attendance corrections and score edits have no complete event history.',
  'Save snapshots before an outcome window starts, then join independently observed outcomes after that window ends. Do not create labels from support rules.',
  'Current enrollment determines scope. Remaining teaching sessions are unavailable without an approved term calendar.',
  'Missing measurements remain null. Engagement measures module completion, not motivation or ability.',
];
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const ratio = (numerator, denominator) => denominator ? numerator / denominator * 100 : null;
const presentPercent = rows => ratio(rows.filter(row => row.status === 'present').length, rows.length);
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export function studentRecords(db, student, at = new Date()) {
  const observedAt = at.toISOString(), today = observedAt.slice(0, 10);
  const scope = scopes(db, student), targetsAvailable = hasTable(db, 'activity_targets');
  const activities = db.prepare('SELECT a.*,s.name subject_name FROM activities a JOIN subjects s ON s.id=a.subject_id WHERE a.created_at<=?').all(observedAt).filter(activity => {
    const config = JSON.parse(activity.config);
    if (config.startAt && new Date(config.startAt) > at) return false;
    return targetsAvailable ? scope.canActivity(activity) : activity.class_id === student.class_id && config.assignmentMode !== 'individual';
  });
  const available = new Set(activities.map(activity => activity.id));
  const submissions = db.prepare('SELECT su.*,a.kind,a.subject_id,a.max_marks,a.deadline,a.title,s.name subject_name FROM submissions su JOIN activities a ON a.id=su.activity_id JOIN subjects s ON s.id=a.subject_id WHERE su.student_id=? AND su.created_at<=? ORDER BY su.created_at DESC,su.attempt DESC').all(student.id, observedAt).filter(row => available.has(row.activity_id));
  const latest = [...new Map([...submissions].reverse().map(row => [row.activity_id, row])).values()];
  const attendance = db.prepare("SELECT a.*,s.name subject_name FROM attendance a JOIN subjects s ON s.id=a.subject_id WHERE a.student_id=? AND a.class_id=? AND a.date<=? AND a.status!='excused' ORDER BY a.date,a.period").all(student.id, student.class_id, today);
  const marks = db.prepare('SELECT m.*,s.name subject_name FROM marks m JOIN subjects s ON s.id=m.subject_id WHERE m.student_id=? AND m.created_at<=? ORDER BY m.created_at,m.id').all(student.id, observedAt);
  const learning = db.prepare('SELECT * FROM learning_progress WHERE student_id=?').all(student.id).filter(row => available.has(row.activity_id));
  return { activities, submissions, latest, attendance, marks, learning };
}

export function featureSnapshot(db, student, { subjectId = null, target = 'attendance_shortage', horizonDays = 30, at = new Date(), records = studentRecords(db, student, at) } = {}) {
  const filter = rows => rows.filter(row => !subjectId || row.subject_id === subjectId);
  const classroom = db.prepare('SELECT * FROM classes WHERE id=?').get(student.class_id);
  const attendance = filter(records.attendance), allMarks = filter(records.marks);
  const marks = allMarks.filter(row => row.class_id === student.class_id && row.semester === classroom?.semester);
  const latest = filter(records.latest), activities = filter(records.activities);
  const recentDate = new Date(at.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  const previousDate = new Date(at.getTime() - 56 * 86400000).toISOString().slice(0, 10);
  const recent = attendance.filter(row => row.date >= recentDate);
  const previous = attendance.filter(row => row.date >= previousDate && row.date < recentDate);
  const recentPercent = presentPercent(recent), previousPercent = presentPercent(previous);
  const due = activities.filter(row => row.kind !== 'module' && row.deadline && new Date(row.deadline) <= at);
  const successful = new Set(records.submissions.filter(row => !['queued', 'running', 'execution_error'].includes(row.status)).map(row => row.activity_id));
  const assignments = due.filter(row => row.kind === 'assignment'), labs = due.filter(row => row.kind === 'lab');
  const submittedDue = due.filter(row => successful.has(row.id));
  const late = submittedDue.filter(activity => {
    const first = records.submissions.filter(row => row.activity_id === activity.id && !['queued', 'running', 'execution_error'].includes(row.status)).sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return first && new Date(first.created_at) > new Date(activity.deadline);
  });
  const normalizedMarks = marks.map(row => row.score / row.max_marks * 100);
  const assessed = latest.filter(row => row.score !== null && row.kind !== 'lab');
  const labScores = latest.filter(row => row.kind === 'lab' && row.score !== null);
  const modules = activities.filter(row => row.kind === 'module');
  const completed = new Set(records.learning.filter(row => row.completed_at && new Date(row.completed_at) <= at).map(row => row.activity_id));
  const midpoint = Math.floor(normalizedMarks.length / 2);
  const values = {
    attendance_percent: presentPercent(attendance),
    assessment_average: mean(normalizedMarks.length ? normalizedMarks : assessed.map(row => row.score / row.max_marks * 100)),
    assignment_completion: ratio(assignments.filter(row => successful.has(row.id)).length, assignments.length),
    lab_average: mean(labScores.map(row => row.score / row.max_marks * 100)),
    engagement_rate: ratio(modules.filter(row => completed.has(row.id)).length, modules.length),
    trailing_score_change: normalizedMarks.length >= 4 ? mean(normalizedMarks.slice(midpoint)) - mean(normalizedMarks.slice(0, midpoint)) : null,
    recent_attendance_percent: recentPercent,
    attendance_change: recentPercent !== null && previousPercent !== null ? recentPercent - previousPercent : null,
    late_submission_percent: ratio(late.length, submittedDue.length),
    lab_completion: ratio(labs.filter(row => successful.has(row.id)).length, labs.length),
    prior_result_average: mean(allMarks.filter(row => row.semester < classroom?.semester).map(row => row.score / row.max_marks * 100)),
    assessments_observed: normalizedMarks.length || assessed.length,
    attendance_sessions_observed: attendance.length,
    remaining_sessions: null,
  };
  return { student_id: student.id, subject_id: subjectId, department_id: student.department_id, class_id: student.class_id, cohort: classroom?.batch || null, observed_at: at.toISOString(), feature_cutoff_at: at.toISOString(), target, horizon_days: horizonDays, ...values };
}

export function featureRows(db, students, options = {}) {
  const target = options.target || 'attendance_shortage';
  return students.flatMap(student => {
    const records = studentRecords(db, student, options.at);
    if (!SUBJECT_TARGETS.has(target)) return [featureSnapshot(db, student, { ...options, target, records })];
    const subjects = new Set(db.prepare('SELECT subject_id FROM teaching_assignments WHERE class_id=?').all(student.class_id).map(row => row.subject_id));
    for (const row of [...records.activities, ...records.attendance, ...records.marks.filter(mark => mark.class_id === student.class_id)]) subjects.add(row.subject_id);
    return [...subjects].sort().map(subjectId => featureSnapshot(db, student, { ...options, target, subjectId, records }));
  });
}
