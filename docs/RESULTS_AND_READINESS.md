# Marks, semester results and remaining setup

## Using results

Open **Marks & results** in the sidebar. Faculty and administrators can use
**Enter mid-term / internal marks** to select a student, assigned subject,
evaluation type, title, semester, score and maximum. Published marks appear
immediately in the student's results. HODs can review but cannot enter marks.
Official grades and credits still use **Record grade**.

Students see their own records, with year and semester filters (semesters 1–8
are always selectable; later recorded semesters also appear). Staff can select
an authorized student. Year 1 groups semesters 1–2, year 2 groups 3–4, and so on.
The selected period shows recorded mark totals and credit-weighted GPA, with
individual semester totals and SGPA. Empty periods remain empty, not failures.

Recorded totals add evaluation rows; they are not automatic university result
conversion. If both mid-term components and a derived internal total are entered,
those rows overlap. Official grading rules, weighting, pass criteria, and
retake/replacement policies must be specified before calculating final results.
The current mark-entry flow publishes individual evaluations; bulk marks entry
and editing published evaluations remain follow-up work. Existing grade entry
can replace an official grade for the same student, subject and semester.

## Local verification (26 October 2026)

Tests use temporary databases and synthetic accounts. No real student records
are seeded or modified. Results coverage includes faculty mid-term publishing,
student year/semester filters, weighted totals, absent periods, blocked student
writes, and desktop/mobile display. Run `node tests/results-browser.mjs` or
`npm run test:browser`; calculation checks are included in `npm test`.

The broader check also found and fixed response handling that rejected JSON
`null` for a not-yet-started assessment session, leaving **Begin assignment**
disabled. Truly empty HTTP 200 responses still report an error.

Verification passed: 70 Node tests, production build, lint, type checking,
10 Python ML regression tests, installation tests, and the browser suites for
navigation, workflows, timetables, Assessment Studio, results and the redesigned
lab workspace. The Studio suite was rerun successfully after the session fix.
The marks/results commit was also tested in an isolated checkout without the
pre-existing unfinished changes (70 tests, build and results browser flow).
Vite still reports a large-chunk warning; further bundle splitting remains a
performance improvement rather than a failed build.

The local sandbox adapter was checked using the controlled test service in
`tests/redesign-browser.mjs`: Monaco editing, sample/custom runs, and hidden-test
submission. This validates the application workflow, not real execution or
security isolation of a deployed sandbox.

## External setup still required

`npm run doctor` currently reports:

- No Judge0 URL: provide a separately hosted sandbox and optional authentication,
  then validate actual supported-language execution and isolation limits.
- No Ollama service/chat/embedding configuration: connect these for document AI.
  Timetable image extraction additionally requires a vision model.
- No reviewed active risk model: use approved data, train/evaluate, and explicitly
  review a model before activation.

Public deployment also needs a chosen host/domain, HTTPS, private persistent
storage, and backup/restore acceptance. See [integrations](INTEGRATIONS.md) and
[deployment](DEPLOYMENT.md). External setup can follow local acceptance.

The workspace also contains pre-existing uncommitted account, backup, readiness,
telemetry and assessment changes. Those changes are preserved separately and
are not included in the marks/results commit. They need their own review and
completion before treating the entire workspace as a release. Historical
enrollment access and formal proctoring also remain separate product work.
