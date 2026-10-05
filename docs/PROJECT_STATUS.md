# FactX verification report

Verified on 5 October 2026 against the local application and isolated test workspaces.

The application changes are complete and pass the checks below. Live AI, code execution, reviewed ML predictions, and public deployment still depend on external services, approved data, and a deployment target. Passing local tests does not activate those integrations.

## Completed changes

- Finished the timetable assistant as a separate React component with saved drafts, resume, session addition/removal/correction, unsaved-change protection, keyboard focus handling, and responsive layouts.
- Kept timetable writes behind explicit confirmation. Imported sessions become read-only and refresh the timetable. Stale revisions and newly introduced conflicts are reported without overwriting newer changes.
- Shared room-conflict validation between manual scheduling and timetable imports. Room comparison ignores letter case and repeated whitespace; adjacent sessions remain allowed.
- Corrected the timetable browser regression: the room is displayed together with the faculty name, so an exact standalone room-text selector was incorrect. The replacement checks the rendered subject, class, time, faculty, room, and total session count without reloading the page.
- Completed ML input validation for missing dates, malformed/nonfinite measurements, count ranges, and both training outcomes. Predictions abstain before calling the estimator when evidence coverage is insufficient. Subject-specific outcomes require a subject.
- Corrected risk snapshot ordering and duplicate detection across timezone offsets.
- Improved integration diagnostics to verify installed chat/embedding/vision models and all five advertised Judge0 languages. Configuration values alone no longer mark timetable extraction ready.
- Added regression coverage for integration availability and `npm run verify:all` to run application tests, the build, all browser suites, and Python ML tests together.

## Verification results

| Check | Result |
| --- | --- |
| Application/API/readiness tests | 53 passed, 0 failed |
| Python ML regression tests | 8 passed |
| Production frontend build | Passed |
| General browser suite | Passed: setup, navigation, records, desktop/mobile |
| Academic workflow browser suite | Passed: leave, cover, attendance, syllabus, support, role boundaries |
| Timetable browser suite | Passed: review, corrections, resume, stale revisions, conflicts, confirmed writes, refresh, desktop/mobile |
| Production dependency audit | `npm audit --omit=dev --audit-level=high`: 0 reported vulnerabilities |
| Integration readiness | Strict check correctly reports missing live integrations |

Browser screenshots were also inspected for timetable review on desktop and mobile. Test databases and synthetic fixtures are isolated from the application's real records. Screenshots, dependencies, build output, and runtime data are excluded from Git.

The dependency audit covers production npm packages and the advisory database at the time of this check. It is not a penetration test or a Python dependency audit. Browser AI and sandbox tests use controlled services; they do not establish the quality or isolation of a live deployment.

## Implemented application scope

FactX contains Admin, HOD, Faculty, and Student portals; departments/classes/subjects and teaching assignments; attendance; assignments and quizzes; programming-lab submission workflows; marks, grades, SGPA and reports; private documents and attachments; leave and substitutions; syllabus and academic monitoring; workflow inbox/reminders; support plans; announcements; workload; and audit records.

Permission-scoped database lookup, text search, and rule-based academic support remain usable without AI or a trained model. The full module list and role boundaries are documented in [README](../README.md) and [Workflows](WORKFLOWS.md).

## Remaining external dependencies

| Capability | Observed state | Needed to complete live acceptance |
| --- | --- | --- |
| Document AI | No Ollama configuration | Reachable Ollama URL, installed chat/embedding models, then an authorized document and cited-answer check |
| Timetable extraction | No chat/vision configuration | Installed chat/vision models, then real text-PDF and image extraction review |
| Programming execution | No Judge0 configuration | Separate Judge0 service URL, credentials if required, correct/incorrect submission checks, and resource/network isolation validation |
| Reviewed ML predictions | No reviewed active model | Approved labeled dataset, training/evaluation, named institutional review, then explicit version activation |
| Public deployment | No host/domain supplied | Target host, HTTPS, environment configuration, persistent private storage, backup/restore verification, and live role/workflow acceptance |

No Ollama executable was found on PATH or at its expected per-user installation location. Docker CLI is installed, but its daemon was not running. No local service responded at the default Ollama/Judge0 ports checked. No live model or prediction artifact was fabricated or activated.

Service configuration belongs in the private `.env` file, using [.env.example](../.env.example) as a placeholder reference. Do not put API keys or student records into Git or chat. Follow [Integration setup](INTEGRATIONS.md) and [Deployment](DEPLOYMENT.md). The ML data contract and review requirements are in [ml/README.md](../ml/README.md).

Historical enrollment snapshots, email-based password recovery, automatic institution-specific grade conversion, question-bank sampling, formal proctoring, and longitudinal LSTM/GRU/clustering work remain documented future extensions. They are not part of the completed fixes above.

## Reproduce the checks

```powershell
npm run verify:all
npm audit --omit=dev --audit-level=high
npm run doctor -- --strict
```

`verify:all` needs the installed Node and optional Python dependencies plus Playwright Chromium. The final command is expected to exit with status 1 until all live integrations are configured. Use `npm start` after building to run the local workspace at `http://127.0.0.1:3001`.

Completed source and documentation changes are committed on `main` and synchronized through the project's `origin` remote, `MohammedxFarman/FactX`. The delivery message records the final commit ID and push result. Private runtime records require a separate backup.
