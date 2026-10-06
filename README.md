# FactX

A responsive, database-backed academic workspace with Admin, HOD, Faculty, and Student access. The interface uses forest green, warm ivory, lime accents, locally bundled typefaces, and Lucide icons. No demo users, student records, marks, dashboard activity, or predictions are inserted into the application database.

## Run locally

Requires Node.js 22.16 or later and npm. SQLite is built into Node; no separate database installation is needed for local use. Node 22 currently labels its SQLite API experimental.

```powershell
cd D:\Finalyr
npm install
npm run build
npm start
```

Open **http://127.0.0.1:3001**. On first startup, the terminal prints a private setup token. Use it to create your administrator account. There are no default login credentials. The token cannot create another administrator after setup is complete.

For development, use `npm run dev` and open **http://127.0.0.1:5173**. The API runs on port 3001. Both processes bind to loopback by default.

Optional: copy `.env.example` to `.env` and configure the values before starting. `.env` is loaded by the production server. Never commit secrets.

## First real records

1. In **Academics**, add your departments, subjects, and classes.
2. In **People & access**, create actual HOD, faculty, and student accounts. Students require a department, class, and unique roll number.
3. In **Academics → Faculty assignments**, connect faculty to classes and subjects.
4. Faculty can record attendance, publish assignments/quizzes/labs/resources, record marks, evaluate submissions, and share feedback.
5. Students see only their own records and assigned activities. HODs have department access. Administrators configure the whole workspace.

## Working modules

- Four roles, password hashing with scrypt, opaque server-side sessions, account disabling, password reset, and session revocation.
- Department/class/subject management and faculty assignments.
- Student search by name or roll number and consolidated student reports.
- Attendance with date/period/subject uniqueness, correction by upsert, and real percentages.
- Assignments with text submissions, attempts, deadlines, faculty evaluation, and feedback.
- Quizzes with private answer keys and server-side automatic grading.
- Programming editor, hidden test cases, submission history, event logging, and an optional isolated Judge0 execution adapter.
- Learning resources, module opening and completion tracking.
- Internal/external/exam/viva/record marks, semester history, student timeline, and PDF export.
- Private student and departmental documents, certificates, type/signature validation, and authorization on every download.
- Faculty leave reviewed by department HOD/Admin, student leave reviewed by assigned faculty, and dated teaching substitutions with availability checks and notifications.
- Faculty-owned syllabus plans and progress, with scoped faculty/course/class and whole-branch monitoring.
- Shared role-scoped workflow inbox with direct links, open-item counts, and durable daily in-app reminders.
- Substitution attendance limited to the assigned session, using the same student-report and branch-monitoring records.
- Student support plans with dated tasks, student progress, responsible faculty review, HOD/Admin oversight, and retained history.
- Feedback and real event notifications.
- Academic dashboards and attendance charts built only from stored data.
- Transparent student support suggestions with record-based explanations.
- Permission-scoped academic record lookup assistant. It explicitly identifies itself as a database lookup, not generative AI.
- Audit records for account changes, academic writes, file access, reports, and assistant use.
- Timetables with conflict checks, scoped announcements, faculty workload, and academic reference configuration.
- Official subject grades, credit-weighted SGPA, and scoped group PDF/CSV exports.
- Visual quiz and hidden-test-case authoring, personalized question/option ordering, server-enforced timed attempts, and individual/multiple-class assessment targeting.
- Private activity, assignment-submission, and leave attachments with ownership and review locks.
- Institution preferences for support thresholds, profile editing, notifications; administrative account-access changes revoke existing sessions.
- Permission-filtered PDF/text indexing and search, optional Ollama document RAG with embeddings and citations, and private assistant history.
- LangGraph timetable assistant for Faculty/HOD/Admin PDF or image uploads, authorized assignment matching, resumable drafts, session corrections/additions/removal, conflict validation, human review, and confirmed writes. Completed imports are read-only and refresh the timetable immediately.
- Optional versioned ML training, evaluation, calibration, abstention, prediction, and SHAP explanation pipeline in `ml/` for four independently labeled risk outcomes.

## Security boundaries

The HOD portal focuses on department leadership: faculty assignments, timetables, announcements, student guidance, leave approvals, workload, attendance/results review, and scoped reports. Its dashboard shows real department priorities, faculty/student leave queues, syllabus completion, and class performance. Faculty submit their own leave to HOD/Admin and review students in their assigned classes. HOD/Admin arrange cover for actual timetable sessions; affected colleagues and students receive notifications. Faculty update syllabus topics, while HOD/Admin monitor progress and recorded performance. See [the linked workflow guide](docs/WORKFLOWS.md). Assessment and lab creation, attendance recording, marks/grade entry, and submission evaluation belong to Admin/Faculty; the HOD interface and API prohibit those writes. HOD teaching assignments are restricted to their own department. Account administration and institution configuration remain with Admin.

Backend authorization applies to every protected API. Students cannot obtain other students' reports, marks, documents, or submissions by changing IDs. HOD access is department-scoped. Faculty record access follows assigned classes, and write permissions additionally check the subject assignment. Files are stored outside the public web root with randomized filenames. Secret keys and execution credentials never enter the frontend bundle.

For an internet deployment, place the app behind HTTPS, set `COOKIE_SECURE=true`, back up the SQLite database and private upload directory, restrict host access, configure institution-specific policies, and conduct a deployment/security review. This repository is a working local application, not a claim of certified production readiness. The single-process SQLite design should be migrated before multi-instance deployment.

## Isolated lab execution

Set `JUDGE_URL` to your institution-managed Judge0-compatible service and `JUDGE_TOKEN` where authentication is required. The server worker discovers the supported language, submits code and private test cases, requests network-disabled execution with CPU/wall/memory/file-size limits, and stores returned status, time, memory, and scores. Actual isolation depends on the separate sandbox deployment. **Do not run that sandbox on the application host.**

Without a configured sandbox, lab submission returns a clear unavailable error and does not consume an attempt. Service failures do not generate a score. Hidden inputs, expected outputs, and program stdout are not returned to students. The adapter follows the [Judge0 API documentation](https://ce.judge0.com/). Live execution requires your actual sandbox service and has not been certified by the local tests.

## ML and academic support

Support rules (attendance below 75%, recorded subject marks below 50%, and overdue work) are clearly labeled as guidance, not ML risk predictions. They can operate on real records immediately. A blank workspace shows no invented risks.

See `ml/README.md` for the real-data training contract. Models are versioned, evaluated, calibrated, and inactive until an explicit named review. To import a reviewed prediction artifact, run:

```powershell
node server/import-predictions.js data/predictions-for-review.json --activate-reviewed-version YOUR_REVIEWED_VERSION
```

This command explicitly activates the named version and retains earlier model records. Do not run it with fabricated predictions or unreviewed data. The scoped `/api/risk/features` and `/api/risk/monitoring` endpoints expose cutoff snapshots and model coverage to authorized Admin/HOD accounts. LSTM/GRU and clustering remain deferred until appropriate longitudinal data and evaluation exist.

## Integration setup and remaining dependencies

Run `npm run doctor` to check the production bundle, configured AI models, Judge0 language availability, and the active reviewed risk-model version. It does not alter application records or submit code. Use `npm run doctor -- --strict` to return a nonzero exit status when any integration is missing. Reachability alone does not verify generation quality or sandbox isolation.

See [the integration setup guide](docs/INTEGRATIONS.md) for configuration and acceptance checks.

- Document RAG is implemented, including stored embeddings. It requires your running Ollama service and installed chat/embedding models. Timetable image or scanned-PDF uploads additionally require a vision model. Without those settings, the assistant uses academic record lookup and knowledge search uses text matching.
- Programming execution requires a separate Judge0 service. Controlled local tests cover the adapter, but a real sandbox deployment and actual language execution still need validation.
- ML needs an approved real dataset, training/evaluation, and a named institutional review before activation. Python syntax checks are complete; no model has been trained or activated by this verification work.
- Historical enrollment snapshots, email-based password recovery, automated institution-specific grade conversion, question-bank sampling, and formal proctoring remain future extensions. Current password resets are administrator-managed; grades/points/credits are entered explicitly, and current enrollment determines access. These are separate from the external integrations above.

## Verification

## Interface redesign

The academic workspace now uses a responsive task-based shell with a detached desktop sidebar, mobile dock, command palette (`Ctrl/Cmd+K`), light/dark themes, subject colour tokens, skeleton/error/empty states, mobile sheets, and context actions. Home groups today’s classes, deadlines, attendance and quick links. Timetable, attendance, study materials, assessments, labs and analytics each have a dedicated summary-led page. The lab workspace lazy-loads Monaco, supports custom and public sample runs through the separate sandbox, preserves hidden tests, and records secure-mode review signals.

The design tokens and page map are documented in [the UI redesign audit](docs/UI_REDESIGN.md). Add a section by creating a typed page under `src/pages`, loading it with `React.lazy`, adding its page identifier to `NAV`, and composing `Section`, `Metric`, `EmptyState`, `Skeleton`, and `SubjectChip` from `src/ui`. Keep writes behind the existing role-scoped API and add a browser smoke test for a new task flow.

Verification includes `npm run typecheck`, `npm run lint`, `npm run test:ui`, and the existing API/workflow/browser suites. The current Lighthouse measurements are recorded in `test-results/performance-summary.json`: desktop 99 performance / 0.81s LCP / 0 CLS; mobile 80 performance / 3.95s LCP / 0 CLS. The mobile target remains below 90 because the legacy institutional bundle is loaded before authentication; a follow-up should split the public landing/auth entry from the authenticated application entry. INP requires field telemetry or interaction-mode Lighthouse runs and is not claimed from navigation-only Lighthouse.

See the [project verification report](docs/PROJECT_STATUS.md) for completed changes, current results, and remaining live-service dependencies. The [deployment acceptance guide](docs/DEPLOYMENT.md) covers host setup, integration checks, and recovery verification.

```powershell
npm test
npm run build
npm run test:browser
npm run doctor
```

`npm run verify` runs integration tests, builds the frontend, and runs all three browser suites in sequence, including timetable review and refresh. `npm run verify:all` also runs the Python ML regression checks and requires the optional Python dependencies. API tests include controlled Ollama and Judge0 services, permission boundaries, attachment ownership/review locks, and unavailable-service behavior. These fixtures are test-only and are not real AI models or code sandboxes.

Integration tests create temporary databases only. Browser tests create separate temporary workspaces, verify navigation and linked leave/substitution/syllabus/monitoring flows on desktop/mobile, and save screenshots in `test-results/`. They do not seed or change your real database. Tests require a local Playwright-compatible Chromium installation.

Runtime data lives in `data/` by default. Back it up with the service stopped or using a SQLite-consistent backup strategy. Never publish `data/`, `.env`, or student uploads.

## GitHub updates

The project instructions in [AGENTS.md](AGENTS.md) ask coding agents to review,
check, commit, and push completed changes to the current branch's upstream on
`origin`. This runs at the end of a coding task; it is not a background file-save
watcher.

For changes made manually, review and check them, then run:

```powershell
git status
git diff
git add <reviewed-file-paths>
git commit -m "Describe the completed change"
git push
```

Only committed project files are synchronized. Private runtime records and
uploads in `data/`, environment secrets, dependencies, build output, and test
artifacts remain local and need their own backup.
