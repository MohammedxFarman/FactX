import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import {studentScope} from './academic-schema.js';
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password, stored) { const [salt, hash] = stored.split(':'); return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64)); }
export const digest = value => createHash('sha256').update(value).digest('hex');
export const publicUser = u => { if (!u) return null; const { password_hash, ...safe } = u; return safe; };
export function scopes(db, user) {
  const classes = () => user.role === 'ADMIN' ? db.prepare('SELECT * FROM classes').all() : user.role === 'HOD' ? db.prepare('SELECT * FROM classes WHERE department_id=?').all(user.department_id) : user.role === 'FACULTY' ? db.prepare('SELECT c.* FROM classes c WHERE c.id IN (SELECT class_id FROM teaching_assignments WHERE faculty_id=?) OR c.id IN (SELECT class_id FROM academic_sections WHERE class_teacher_id=?)').all(user.id,user.id) : db.prepare('SELECT * FROM classes WHERE id=?').all(user.class_id);
  const canClass = id => !!classes().find(c => c.id === id);
  const canStudent = id => { const s = db.prepare("SELECT * FROM users WHERE id=? AND role='STUDENT'").get(id); return !!s && (user.role === 'ADMIN' || (user.role === 'STUDENT' ? id === user.id : user.role === 'HOD' ? s.department_id === user.department_id : canClass(s.class_id))); };
  const canTeach = (classId, subjectId) => user.role === 'ADMIN' ? canClass(classId) : user.role === 'FACULTY' && !!db.prepare('SELECT id FROM teaching_assignments WHERE faculty_id=? AND class_id=? AND subject_id=?').get(user.id, classId, subjectId);
  const students = () => {const scope=studentScope(user);return db.prepare("SELECT u.id,u.name,u.email,u.role,u.department_id,u.class_id,u.roll_number,u.active,u.created_at,c.name class_name,d.name department_name FROM users u LEFT JOIN classes c ON c.id=u.class_id LEFT JOIN departments d ON d.id=u.department_id WHERE u.role='STUDENT' AND ("+scope.sql+") ORDER BY u.name").all(...scope.params);};
  const canActivity = a => {
    const cfg=JSON.parse(a.config);
    if(user.role==='STUDENT' && cfg.startAt && Date.parse(cfg.startAt)>Date.now())return false;
    const targets=db.prepare('SELECT * FROM activity_targets WHERE activity_id=?').all(a.id);
    if(user.role==='STUDENT')return cfg.assignmentMode==='individual'?targets.some(t=>t.student_id===user.id):canClass(a.class_id)||targets.some(t=>t.class_id===user.class_id||t.student_id===user.id);
    return canClass(a.class_id)||targets.some(t=>t.class_id?canClass(t.class_id):t.student_id&&canStudent(t.student_id));
  };
  return { classes, canClass, canStudent, canTeach, students, canActivity };
}
