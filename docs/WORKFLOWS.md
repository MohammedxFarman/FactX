# Connected academic workflows

These workflows use existing accounts, department/class/subject assignments, and timetable sessions. New workflow tables are created automatically when the server starts; existing records and credentials are retained.

## Leave and teaching cover

| Portal | Controls |
| --- | --- |
| Admin | Review all faculty/student requests; coordinate teaching cover; inspect institution-wide monitoring. |
| HOD | Review faculty/student requests in their own department; arrange teaching cover; monitor faculty syllabus and branch performance. |
| Faculty | Apply for personal leave; approve or decline student leave in assigned classes; see original and covering teaching duties. |
| Student | Apply for personal leave; see their decision/reviewer/note, supporting documents, and class teaching changes. |

Faculty use **Leave & student approvals → My leave → Apply for leave**. HOD use **Leave approvals → Faculty requests → Review request**. Approval opens **Teaching cover**; each affected timetable session has its own substitute selection. Approved requests can also be reopened with **Arrange substitution**.

Substitutes must be another active faculty member in the same department. A scheduled class, another substitution at the same time, or approved leave makes the candidate unavailable. Existing substitution duties must be reassigned before approving overlapping leave for the covering faculty member. Cover applies to a particular date and timetable slot, preserving the permanent teaching assignment. Colleagues see **Substitution duties**; students see **Class changes**. If the leave has no existing timetable sessions, the cover dialog explains that no sessions need substitution.

Students submit requests through **Leave requests**. Assigned faculty use **Leave & student approvals → Student requests** and choose Approve or Decline. HOD/Admin retain review access. The first saved decision is final; a second reviewer cannot overwrite it. Applicants cannot review their own leave. Overlapping pending/approved requests are rejected.

Applicants can attach supporting documents to pending requests through **Details**. Reviewers can read authorized documents. Uploads lock after a decision. Faculty leave reasons and documents are never exposed in students' class-change views.

## Syllabus and performance monitoring

Faculty use **Syllabus progress** to add topics to actual teaching assignments, set planned hours and target dates, and record Planned, In progress, or Completed. **Update progress** edits a recorded topic. Only the assigned faculty member can change its syllabus.

Removing a timetable session removes its dated cover entries. Removing a teaching assignment removes its associated syllabus plan; existing timetable sessions must be removed first, following the application's existing assignment-removal rule.

Completion is completed topic hours divided by all planned topic hours. In-progress topics are not counted as completed. A course without topics displays **No syllabus plan**, rather than an invented percentage. Past target dates on unfinished topics count as overdue.

HOD use **Faculty syllabus progress** for read-only faculty/course details and **Branch monitoring** for all authorized department faculty and classes. The overview links directly to these pages. Admin have institution-wide visibility, and Faculty have **My teaching analysis** for their assigned classes and subjects.

Attendance uses present sessions divided by recorded sessions, excluding excused records. Recorded marks and evaluated assessments use each score as a percentage of its maximum, averaged across recorded entries. Assessment submissions assigned to multiple classes are attributed to the submitting student's current class. Missing data displays **No records**. Pending evaluations, weekly teaching sessions, syllabus gaps, and students needing support are based on stored records.

Faculty/class filters refine the detail tables; the summary cards retain the full authorized scope. Current enrollment determines access and class attribution, consistent with the rest of the application.

## Workflow inbox and reminders

Every portal has **Workflow inbox** in its sidebar. The item count follows the current user's authorized work. The inbox connects pending leave decisions, unassigned cover for the next seven days, substitution attendance, overdue syllabus topics, and active support tasks. **My actions**, **Overdue**, and category filters narrow the list. An item opens its existing request, session, topic, or support plan. Resolved work disappears automatically.

Daily reminders appear in the existing notification bell when institution notifications are enabled. The application checks due work at startup, every fifteen minutes while running, and when an inbox is loaded. A durable per-user/item timestamp prevents repeated reminders within twenty-four hours, including across server restarts. Unrelated departments and students' private records never enter another user's inbox. These are in-app reminders.

## Attendance during substitution

Assigned substitutes open **Substitution duties** or their inbox attendance item. **Substitution attendance** fixes the class, subject, date, and period to the assigned timetable session. Attendance cannot be saved before that date. Each current active student must appear exactly once. The substitute gains access only to that session roster; permanent teaching assignments, broader student reports, marks, and other dates remain protected.

Saving updates the same attendance records used by student reports and branch monitoring. Saving again corrects those records without duplicates. HOD/Admin and regular faculty receive a completion notification on the first save; HOD can inspect completion but cannot record attendance. A cover assignment with saved attendance cannot be removed or reassigned to a different faculty member. Removing a timetable session retains historical attendance under the application's existing attendance model.

## Student support plans

Faculty create **Support plans** for students in their assigned classes. HOD/Admin can coordinate a plan by choosing a real active faculty member assigned to that student's class and optional subject. A plan has a goal, focus, deadline, and one or more dated tasks; it requires no fabricated prediction or automatic assessment assignment.

Students use **My support plans** or their inbox to report progress as Working on it or Ready for faculty review. The responsible faculty reviews submitted progress, accepts it as Completed, or requests further work with feedback. Once every task is reviewed and complete, the responsible faculty or Admin can complete the plan. HOD monitor progress and can cancel a plan but cannot mark student tasks complete. Authorized staff can cancel active plans; completed/cancelled plans retain their history and reject further updates.

Only the student, responsible assigned faculty, their department HOD, and Admin can see a plan. A classmate or another teacher cannot open it by changing its ID. Summaries show active/overdue/completed plans and submitted progress awaiting review. Each plan retains student updates, faculty feedback, author names, and history after closure.

## Upgrade verification

API tests additionally cover inbox boundaries, persistent reminder deduplication, exact-session attendance and roster validation, support ownership, student/faculty review transitions, and final-state locks. Browser tests exercise inbox links, substitute attendance reaching student/branch records, and support creation → student progress → faculty review → HOD/Admin visibility, including mobile layouts.

`npm test` checks role/department boundaries, leave decision locking, availability conflicts, notifications, syllabus calculations, real academic totals, supporting documents, and persistence using temporary databases. `npm run test:browser` checks the existing shared navigation and the connected leave, teaching-cover, syllabus, and monitoring screens across portals, including mobile layouts. Screenshots are saved under `test-results/`; tests never change the main or preview databases.
