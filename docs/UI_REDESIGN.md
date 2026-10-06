# UI audit and implementation map

The baseline audit and page/data map are preserved here. The redesign keeps the existing role-scoped APIs, SQLite models, route identifiers and operational screens, while adding a summary-led task shell around them.

## Baseline audit

FactX is React 19 + Vite on the frontend and Express + SQLite on the backend. Navigation was a local `page` state in `src/main.jsx`, with no URL router or query cache. The UI used custom JavaScript components (`Button`, `Modal`, `Table`, `Field`, `Badge`, `Stat`), Lucide icons and a large `styles.css`; TypeScript, linting, charting, virtualization and route-level lazy loading were absent. Existing pages were overview, inbox, students, academics, attendance, timetable, assessments, labs, learning, analytics, support, reports, grades, documents, feedback, leave, substitutions, syllabus, monitoring, users, announcements, knowledge, workload, configuration, audit and settings.

The existing data contracts are: `users` for student/faculty/admin/HOD identity and role scope; `departments`, `classes`, `subjects` and `teaching_assignments` for the academic catalogue; `attendance` for dated class records; `activities` for assignment, quiz, lab and module content; `submissions`, `assessment_sessions` and `assessment_events` for work and timed assessment state; `timetable` for weekly sessions; modules, documents and attachments for study material; and analytics/risk tables for evidence-based support. Authorization is enforced in the API and was retained.

## Page map and files

The implementation sequence was shared shell/design tokens, Home, Timetable, Attendance, Study Materials, Assessments, Labs, Analytics, then landing and verification. New typed pages are in `src/pages`, reusable UI in `src/ui`, API/cache and subject/motion helpers in `src/lib`, with `src/redesign.css`, `src/academic-pages.css`, `src/lab.css` and `src/landing.css` providing the visual system. `src/main.jsx` keeps the existing page identifiers and management tools, adds hash navigation, lazy page loading, the shell and error boundaries. `server/lab-practice.js` adds sandbox-backed practice runs without consuming attempts. `tests/redesign-browser.mjs`, `tests/lab-practice.test.js` and `tests/performance.mjs` cover the new behavior.

The design system uses DM Sans, semantic light/dark tokens, 8px spacing units, 16–24px radius, layered soft shadows, subject-derived colours and transform/opacity-only entrance motion. Desktop uses a detached sidebar and blurred top bar; mobile uses a safe-area-aware bottom dock and draggable sheets. Charts and Monaco are lazy loaded. The initial shell uses CSS transitions for low-jank startup; shared motion tokens and the View Transitions API remain available for route/subject transitions.

## Current verification

- `npm run build`: passed with lazy chunks for pages, charts and Monaco.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Existing API suite: passed (53 tests).
- New lab practice test: passed.
- New browser smoke: passed at 320, 360, 768, 1440 and 2560px, including landing, login, sections, command palette, sheets, theme toggle and controlled lab run/submit.
- Lighthouse: desktop 99 performance / 96 accessibility / 100 best practices / 91 SEO; mobile 80 performance / 96 accessibility / 100 best practices / 91 SEO. Desktop LCP 0.81s; mobile LCP 3.95s; CLS 0 in both. Navigation Lighthouse does not measure field INP.
- Performance trace: `test-results/lab-performance-trace.json`; summary reports zero >50ms `RunTask` entries in the controlled lab flow. This is a trace of the local browser path, not a cross-device FPS guarantee.

Mobile performance remains below the requested 90 target because the current legacy application entry and React bundle load before authentication. The next performance step is a separate static landing/auth entry that loads the authenticated app only after sign-in. This is a known risk and is not represented as a passing target.

No institutional records, testimonials, holidays, plagiarism scores, AI insights, or similarity results were fabricated. Similarity analysis is clearly marked unavailable. Practice runs use the configured isolated sandbox and do not consume submissions; final lab submissions continue to use hidden test cases.
