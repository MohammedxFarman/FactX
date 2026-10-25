# ANITS controlled test environment

## Verified counts

| Record | B.Tech expected / actual | BBA expected / actual | M.Tech actual |
|---|---:|---:|---:|
| Programs | 1 / 1 | 1 / 1 | 1, configuration required |
| Departments/units | 10 / 10 | 1 / 1 | 0 |
| HODs | 10 / 10 | 1 / 1 | 0 |
| Faculty | 100 / 100 | 10 / 10 | 0 |
| Admission cohorts | 40 / 40 | 3 / 3 | 0 |
| Distinct current study years | 4 / 4 | 3 / 3 | 0 |
| Sections | 160 / 160 | 12 / 12 | 0 |
| Students | 9,600 / 9,600 | 720 / 720 | 0 |
| Class-teacher assignments | 160 / 160 | 12 / 12 | 0 |

There are 10,320 students and 10,441 generated accounts, plus one isolated test administrator. Every section has 60 students; every B.Tech department has 960 students and 16 sections. B.Tech prefixes remain exactly A261, A251, 241, A231, with sequences 001–240 per department/cohort. BBA identifiers use TEST-BBA-{admission year}-{sequence} and are temporary. A second seed run created zero accounts and reused all generated accounts.

## Errors and fixes

The original Vite error was `Cannot read directory "../../..": Access is denied`, followed by failure to resolve vite.config.js. This was an external filesystem sandbox restriction. Current permissions allow startup and building. Application code cannot grant access through an external tool sandbox.

A separate startup defect was reproduced: an occupied backend port caused Express to pass an error to its callback while the entry point printed success. server/listen.js and server/index.js now reject failed binds and report the occupied port. The isolated launcher uses backend 3101 and frontend 5175.

The shared client previously called response.json() unconditionally. Empty error responses reproduce `Unexpected end of JSON input`; HTML errors also fail parsing. vite.config.js now returns JSON HTTP 503 for refused API connections; src/lib/response.js handles invalid and empty responses explicitly. The startup regression test exercises the real Vite proxy against an unavailable backend. Tested dashboard requests returned valid JSON. Without the original failing request or screenshot, the historical dashboard incident cannot be uniquely attributed beyond this reproduced failure path.

## Architecture and administration

React/Vite, Express, SQLite and existing session/password authentication are retained. Additive tables represent programs, program departments, admission cohorts, sections, faculty memberships and generated-account ownership. Existing normal runtime data is preserved; synthetic records are isolated in ignored data/anits-test.

Programs & batches provides configuration, counts, departments/HODs, cohorts, progression, sections, class teachers and account exports. Students and People & access provide server-paginated search/filtering. Progression changes current academic year while preserving admission year and roll number. Faculty access includes teaching and class-teacher assignments. Student and HOD permissions remain scoped. Cross-program teacher assignment requires explicit faculty membership.

Generated names are synthetic and email addresses are not verified mailboxes. Each generated account uses the existing scrypt mechanism with a unique random salt. Passwords are supplied privately at seed time and never embedded in source or exports. Existing accounts/passwords are not reset. First-login password-change enforcement is not implemented by the existing flow; this environment is not for production.

## Commands (PowerShell)

```powershell
# Only when dependencies are missing:
npm.cmd ci

# Supply the requested temporary test password privately:
$seedSecret = Read-Host 'Temporary test-account password' -AsSecureString
$env:ANITS_TEST_PASSWORD = [System.Net.NetworkCredential]::new('', $seedSecret).Password
node scripts/seed-anits.mjs
node scripts/verify-anits.mjs
Remove-Item Env:ANITS_TEST_PASSWORD

# Starts both test servers:
node scripts/anits-environment.mjs
# Frontend http://127.0.0.1:5175
# Backend  http://127.0.0.1:3101
```

Initialization/migrations run automatically when opening the database and registering the app. No separate migration command is needed. The seed refuses an unmarked database and conflicting identifiers. Existing test databases are backed up under ignored data/anits-backups.

Separate terminals can use:

```powershell
# Backend
$env:FACTX_DATA_DIR = "$PWD/data/anits-test"
$env:PORT = '3101'
npm.cmd start

# Frontend, in another terminal
$env:FACTX_API_URL = 'http://127.0.0.1:3101'
npx.cmd vite --host 127.0.0.1 --port 5175 --strictPort
```

Normal npm.cmd run dev uses the normal database and ports 3001/5173. Stop servers with Ctrl+C. Do not run two backends against one data directory. The isolated launcher disables email verification for synthetic addresses without changing production policy.

## Private credentials and exports

The random test administrator bootstrap login is in ignored data/anits-test/administrator-login.json. Keep this local file private. Generated accounts use the temporary password supplied by the administrator. Examples:

- a261csm001@anits.edu.in
- csm.faculty01@anits.edu.in
- csm.hod@anits.edu.in
- test-bba-2026-001@anits.edu.in
- bba.faculty01@anits.edu.in
- bba.hod@anits.edu.in

Emails are case-insensitive; profile roll numbers retain their specified case. In Programs & batches, authenticated administrators download separate CSVs using /api/academics/credentials.csv?program=BTECH&role=STUDENT and corresponding BBA/MTECH and FACULTY/HOD combinations. M.Tech exports contain headers until accounts exist. Exports include account name, ID, email, role, program, department and status with formula escaping, but no passwords, hashes or tokens. Non-admin access is rejected. Runtime files are ignored by Git and not publicly served.

Controlled cleanup disables generated accounts, revokes sessions and clears their HOD/class-teacher duties, preserving academic records:

```powershell
node scripts/anits-environment.mjs --disable-accounts
```

## Verification and limits

Passed: automated API/workflow suite (68 tests before the additional live proxy regression), academic seed/authorization/progression test, startup/JSON checks, production build, lint, existing browser smoke test, and seven-account full-data browser checks. Full-data API verification covered ten logins, invalid-password rejection, same-class student privacy, cross-department denial, exact counts, unique emails/rolls/hashes, foreign keys and integrity. The slowest measured endpoint was 225 ms, a local observation rather than a production load benchmark.

Browser checks cover role dashboards, program configuration, teacher assignment, pagination/search/filtering, profiles and mobile layout without page errors. Local evidence is in data/anits-test/seed-result.json, data/anits-test/verification-result.json and ignored test-results/anits-*.log/screenshots. Large existing Monaco chunks still produce a non-fatal build warning.

The directory returns 50 rows per page. The legacy student endpoint caps responses at 100, and attendance fetches the selected class roster. Sections larger than 100 students need further legacy-roster pagination. Some legacy report/support operations still scan complete server-side datasets; no production-scale load test is claimed.

Judge0 is missing: configure JUDGE_URL and optional JUDGE_TOKEN for a separately hosted service. Ollama document/timetable AI needs its URL and model variables. No reviewed risk model is active. Existing sandbox tests use controlled mocks and do not establish live Judge0 availability.

M.Tech requires actual specializations, duration, admission cohorts, section/student counts, identifier/email rules and coordinator/faculty assignments. The program and administration structure exist; no accounts or official institutional information were invented. Bulk M.Tech generation awaits those details. BBA's official identifier format is also pending. Future cohort rules are defined in server/anits-seed.js and need review before another admission year.

## Faculty PDF

Once supplied, extract department/faculty details and match them to existing temporary faculty IDs. Update names/details through account management, preserving user IDs, memberships and class-teacher references. Report ambiguous matches instead of guessing or duplicating accounts. No PDF has yet been supplied or processed.
