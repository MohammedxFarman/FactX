# Product readiness checks — 24 October 2026

Scope: current working tree, isolated synthetic SQLite fixtures, controlled AI/sandbox failures, and local Chromium browser checks. This is an audit, not implementation of missing features or certification of a live deployment. Pre-existing application edits were preserved.

| # | Check | Result | Evidence / remaining work |
| --- | --- | --- | --- |
| 1 | Real login and logout | API passed; browser partial | `tests/readiness.test.js` verifies real sessions, HttpOnly/SameSite cookies, logout and rejection of reused cookies. Redesigned login passes. General smoke suite timed out at a later role login; investigate separately. HTTPS Secure-cookie acceptance still needs the deployed host. |
| 2 | Password reset | Partial | Administrator reset works, rejects short passwords, revokes sessions and invalidates the old password. Self-service email recovery is absent. |
| 3 | Email verification | Missing | No verification token, email delivery or verification flow found. Email-format validation is not ownership verification. |
| 4 | Loading states | Implemented | Skeletons, Suspense fallbacks, login busy state and operation progress exist in `src/main.jsx`, `src/ui/Primitives.tsx` and task pages. No exhaustive slow-network audit of every action. |
| 5 | Empty states | Implemented | Shared Empty/EmptyState components and page-specific fallbacks exist. Browser setup covers an empty institution. |
| 6 | Clear error messages | Partial | Validation errors, authentication errors, safe generic server errors, retry UI and error boundaries exist. Some validation exposes technical field paths; wording has not been reviewed for every endpoint. |
| 7 | Form validation | Passed covered cases | Browser constraints plus server Zod schemas. API tests exercise invalid marks, assessment options, role scope, scheduling and passwords. This does not imply every possible input was exhaustively tested. |
| 8 | Rate limiting | Existing limits passed; coverage partial | New tests verify auth threshold/expiry, same-user rejection, global concurrency and recovery after service failure. See details below; other expensive routes lack equivalent limits. |
| 9 | Database backups | Operationally unverified | Consistent SQLite plus uploads backup/restore procedure documented in `docs/DEPLOYMENT.md` and `deploy/README.md`. No automated backup job or demonstrated restore found. Persistence tests are not backup tests. |
| 10 | Row-level security | Application enforcement passed covered cases | SQLite has no PostgreSQL-style RLS policies here. `server/security.js` and route guards enforce row scope; cross-student/department/document tests pass. Direct database access bypasses application authorization. |
| 11 | API keys off frontend | Review passed | Service credentials read server-side. No credential values found in reviewed frontend configuration; generated bundle's `JUDGE_TOKEN` occurrence is explanatory settings text, not a token. `.env.example` is the only tracked env file. This was not a full Git-history secret scan. |
| 12 | Mobile layout | Passed automated coverage | Redesigned seven-section UI passed at 320, 360, 768, 1440 and 2560px; workflow/timetable mobile checks passed. Physical device acceptance remains separate. |
| 13 | Custom 404 page | Missing | Unknown API paths return JSON 404 (tested). Unknown browser paths serve the SPA; invalid hashes fall back to overview. No custom not-found screen. |
| 14 | Analytics installed | Missing usage analytics | Academic analytics exist. No product usage analytics SDK/event pipeline found in dependencies, frontend or HTML. |
| 15 | Error tracking | Partial | Console logging, audit records and React error boundaries exist. No centralized exception ingestion, alerting or monitoring SDK found. |
| 16 | Privacy policy page | Missing | No public policy page or navigation link found. |
| 17 | Terms page | Missing | No public terms page or navigation link found. |
| 18 | Delete account button | Missing | Administrator disabling exists. No self-service account deletion UI or corresponding deletion endpoint found. |
| 19 | Onboarding flow | Partial | Token-protected first-admin setup and department/class setup prompts exist; ordinary accounts are institution-managed. No guided first-login flow for each role. |

## Rate-limit checks

`tests/rate-limits.test.js` adds five integration cases:

- Authentication: 30 non-GET requests per IP in a 15-minute window, shared across auth paths. Setup and invalid payloads count. The 31st write is rejected; GET status remains available; spoofed X-Forwarded-For does not bypass the default direct-server configuration; expiry allows requests again.
- Assessment generation: one active operation per user and four globally.
- Lab demos: share generation capacity; tests verify both directions of exclusion.
- Timetable extraction: one per user and two globally.
- Lab practice: one per user and eight globally.

Concurrency tests hold upstream operations open, verify rejection without releasing another request's slot, then return controlled upstream failures and verify capacity is reusable. These are concurrency guards, not requests-per-minute quotas. Success paths also run in existing application/browser suites.

Remaining concerns: in-memory counters reset on process restart and are not shared across replicas; no general API/assistant/indexing/final-submission rate quota found; no Retry-After header; expired authentication IP entries have no periodic cleanup; reverse-proxy IP behavior needs deployment verification. Disconnect/cancellation behavior and multi-process limits were not tested. Generation releases its guard on HTTP response close, which needs additional review if an upstream operation continues after client disconnect.

## Verification results

- `npm test`: 64 tests passed, including the five new limiter cases.
- `node --test tests/readiness.test.js`: one additional test passed after the full suite, covering auth/reset/validation/API 404.
- `npm run build`: passed; existing large Monaco chunk warning remains.
- `npm run typecheck`: passed.
- Lint of the two new test files: passed.
- `npm run lint`: failed at existing `tests/device-test-browser.mjs:110` (`no-unsafe-finally`).
- `npm run test:browser`: stopped in general smoke at `tests/browser-smoke.mjs:164`, timeout locating Institutional email in a fresh role context. Earlier setup/navigation checks ran; do not treat the whole suite as passing.
- `node tests/workflow-browser.mjs`: passed when run separately.
- `node tests/timetable-browser.mjs`: passed when run separately.
- `node tests/redesign-browser.mjs`: passed, including login, responsive widths, themes, sheets and controlled lab run/submission.
- `node tests/studio-browser.mjs`: passed, including draft preview/publication, mobile layout, restored student work, grading and ordered lessons.

Missing features above remain open work. Email delivery, production analytics/error collection, live backup scheduling/restore and actual deployment acceptance require operational setup beyond this local audit.
