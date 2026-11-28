# UI audit and implementation map

The baseline audit and page/data map are preserved here. The redesign keeps the existing role-scoped APIs, SQLite models, route identifiers and operational screens, while adding a summary-led task shell around them.

## Baseline audit

FactX is React 19 + Vite on the frontend and Express + SQLite on the backend. Navigation was a local `page` state in `src/main.jsx`, with no URL router or query cache. The UI used custom JavaScript components (`Button`, `Modal`, `Table`, `Field`, `Badge`, `Stat`), Lucide icons and a large `styles.css`; TypeScript, linting, charting, virtualization and route-level lazy loading were absent. Existing pages were overview, inbox, students, academics, attendance, timetable, assessments, labs, learning, analytics, support, reports, grades, documents, feedback, leave, substitutions, syllabus, monitoring, users, announcements, knowledge, workload, configuration, audit and settings.

The existing data contracts are: `users` for student/faculty/admin/HOD identity and role scope; `departments`, `classes`, `subjects` and `teaching_assignments` for the academic catalogue; `attendance` for dated class records; `activities` for assignment, quiz, lab and module content; `submissions`, `assessment_sessions` and `assessment_events` for work and timed assessment state; `timetable` for weekly sessions; modules, documents and attachments for study material; and analytics/risk tables for evidence-based support. Authorization is enforced in the API and was retained.

## Page map and files

The implementation sequence was shared shell/design tokens, Home, Timetable, Attendance, Study Materials, Assessments, Labs, Analytics, then landing and verification. New typed pages are in `src/pages`, reusable UI in `src/ui`, API/cache and subject/motion helpers in `src/lib`, with `src/redesign.css`, `src/academic-pages.css`, `src/lab.css` and `src/landing.css` providing the visual system. `src/main.jsx` owns public routes, login and session restoration. It lazy-loads `src/Workspace.jsx`, which keeps the existing page identifiers, management tools, hash navigation and shell. `server/lab-practice.js` adds sandbox-backed practice runs without consuming attempts. `tests/redesign-browser.mjs`, `tests/lab-practice.test.js` and `tests/performance.mjs` cover the new behavior.

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

The public entry now defers `Workspace.jsx` until authentication. The browser suite asserts that the workspace bundle is absent before sign-in, requested after sign-in, and works after a session reload. Shared styles retain their existing order. The build wrapper also forces production React before Vite loads, preventing inherited development settings from inflating release assets. The original Lighthouse results above are historical; see the follow-up measurements below for this change.

No institutional records, testimonials, holidays, plagiarism scores, AI insights, or similarity results were fabricated. Similarity analysis is clearly marked unavailable. Practice runs use the configured isolated sandbox and do not consume submissions; final lab submissions continue to use hidden test cases.

## Public entry follow-up (2026-11-28)

- Production bundles: public entry 46.08 kB plus React 223.22 kB; authenticated workspace 182.25 kB, requested only after authentication. Sizes are minified and uncompressed; shared CSS remains eager.
- The inherited development environment previously produced a 430.35 kB React chunk. `scripts/build-frontend.mjs` sets production mode before loading Vite.
- Lighthouse: desktop 99 performance, 0.80s LCP; mobile 87 performance, 3.31s LCP. Both report 0 CLS, 96 accessibility, 100 best practices and 100 SEO. Mobile TBT was 4ms. These are local simulated measurements, not field guarantees; the mobile 90 target remains unmet.
- Validation: 81 API tests, production build, lint, type checking, responsive UI suite and seven workflow browser suites. Public bundle deferral and session restoration are checked in the responsive suite. Test artifacts stay in ignored `test-results/`.

Lighthouse wrote both reports, but its process did not exit during teardown and was stopped afterward. The responsive browser suite and seven workflow suites completed their assertions; the combined `test:ui` command is not claimed to have exited successfully.
