import { studentAnalytics,analyticsCandidates } from './analytics.js';
import { syllabusAssignments } from './monitoring.js';

export function registerDepartmentOverview({ app, db, roles }) {
  app.get('/api/department-overview', roles('HOD'), (req, res) => {
    const department = db.prepare('SELECT id,name,code FROM departments WHERE id=?').get(req.user.department_id);
    const students = req.scope.students();
    const studentIds = new Set(students.map(student => student.id));
    const classes = req.scope.classes();
    const classIds = new Set(classes.map(classroom => classroom.id));
    const faculty = db.prepare("SELECT id,name,active FROM users WHERE role='FACULTY' AND department_id=?").all(req.user.department_id);
    const assignments = db.prepare('SELECT * FROM teaching_assignments').all().filter(row => classIds.has(row.class_id));
    const attendance = db.prepare("SELECT * FROM attendance WHERE status!='excused'").all().filter(row => studentIds.has(row.student_id) && classIds.has(row.class_id));
    const marks = db.prepare('SELECT * FROM marks').all().filter(row => studentIds.has(row.student_id) && classIds.has(row.class_id));
    const pending = db.prepare("SELECT s.student_id,u.class_id FROM submissions s JOIN users u ON u.id=s.student_id WHERE s.score IS NULL AND s.status IN ('submitted','execution_error')").all().filter(row => studentIds.has(row.student_id) && classIds.has(row.class_id));
    const leaves = db.prepare("SELECT l.id,l.student_id,u.name student_name,u.name applicant_name,u.role applicant_role,u.roll_number,l.start_date,l.end_date,l.reason,l.created_at FROM leave_applications l JOIN users u ON u.id=l.student_id WHERE l.status='pending' AND u.department_id=? ORDER BY u.role='FACULTY' DESC,l.created_at").all(req.user.department_id);
    const syllabus=syllabusAssignments(db,req.user);
    const plannedHours=syllabus.reduce((sum,course)=>sum+course.totalHours,0),completedHours=syllabus.reduce((sum,course)=>sum+course.completedHours,0);
    const support = analyticsCandidates(db,students).map(student => ({ ...student, analytics:studentAnalytics(db,student.id) })).filter(student => student.analytics.suggestions.length);
    const percentage = rows => rows.length ? Math.round(rows.filter(row => row.status==='present').length / rows.length * 100) : null;
    const average = rows => rows.length ? Math.round(rows.reduce((sum,row) => sum + row.score / row.max_marks * 100,0) / rows.length) : null;
    const classOverview = classes.map(classroom => ({
      id:classroom.id, name:classroom.name, semester:classroom.semester,
      students:students.filter(student => student.class_id===classroom.id).length,
      faculty:new Set(assignments.filter(row => row.class_id===classroom.id).map(row => row.faculty_id)).size,
      attendance:percentage(attendance.filter(row => row.class_id===classroom.id)),
      average:average(marks.filter(row => row.class_id===classroom.id)),
      pendingEvaluations:pending.filter(row => row.class_id===classroom.id).length,
    }));
    res.json({ department, students:students.length, faculty:faculty.filter(member=>member.active).length,
      classes:classes.length, attendance:percentage(attendance), average:average(marks),
      pendingEvaluations:pending.length, pendingLeaves:leaves.length, leaveQueue:leaves.slice(0,5),
      supportCount:support.length, attention:support.slice(0,5), classOverview,
      unassignedClasses:classOverview.filter(classroom=>!classroom.faculty).length,
      pendingFacultyLeaves:leaves.filter(leave=>leave.applicant_role==='FACULTY').length,pendingStudentLeaves:leaves.filter(leave=>leave.applicant_role==='STUDENT').length,
      syllabusCompletion:plannedHours?Math.round(completedHours/plannedHours*100):null,
      overdueTopics:syllabus.reduce((sum,course)=>sum+course.overdueTopics,0),coursesWithoutPlan:syllabus.filter(course=>!course.topics.length).length,
    });
  });
}
