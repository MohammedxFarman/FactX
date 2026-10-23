# Assessment Studio and learning modules

Implemented 22 October 2026. This is the first assessment-authoring release; it is not a claim that the complete Coursera-style hosting platform or mobile/Windows installers are finished.

## Faculty workflow

Open the existing assistant and choose **Create assessment or module**. Requests containing a creation verb and assessment/lab/quiz/module terminology also open the studio with the request filled in. The Create buttons on Assessments, Labs and Study Materials open the same studio.

1. **Instructions:** type the subject, objectives, task count, marks, level and requested format. Optionally upload a reference. Generate or revise using the configured Ollama service. Without that service, choose **Edit draft** to author manually.
2. **Edit draft:** edit instructions, task marks and visible success criteria. Coding labs include hidden checks linked to task numbers and optional public samples. Quizzes have one question per task. Modules have ordered lessons with text and optional HTTP(S) resource links. Private notes and solutions are separate. Save, resume or duplicate private drafts.
3. **Preview & schedule:** inspect the student view. Quiz demos calculate task marks; coding demos run through the separate configured Judge0 service. Demonstrations never create student submissions. Assign a permitted class/subject, opening time, optional closing time, attempts and optional timed duration. Explicit approval creates the activity. A draft edit invalidates its preview, and stale revisions cannot publish.

Published drafts are immutable and can be duplicated for another assessment. At present a published schedule cannot be changed in Studio; confirm the timing before approval.

Faculty can author only for their assigned class/subject combinations; Admin can author within its authorized catalog. HOD retains oversight but cannot author or grade. Drafts belong to their creator; even another administrator cannot read a private draft through these endpoints.

## Uploads and AI

Supported source formats: PDF (up to eight pages), PNG, JPEG, UTF-8 TXT/Markdown/CSV/JSON and common source-code extensions shown in the upload picker. Maximum file size is 10 MB; extracted text is limited to 60,000 characters. Export Word and PowerPoint to PDF first. Image/scanned PDF processing uses the existing bounded document reader and requires a vision model. Uploaded source material is used for the draft request, not automatically attached to the student activity. Draft history keeps the faculty request and source filename, not the raw source file.

Configure `OLLAMA_URL` and `OLLAMA_CHAT_MODEL` privately; image requests also need `OLLAMA_VISION_MODEL`. The assistant validates structured model output and cannot publish on the model's authority. A missing or invalid AI response returns an error and preserves saved work. No fallback content is presented as an AI-generated assessment. Generated instructions and checks still need faculty review.

## Students, scoring and learning

- Scheduled activities are filtered on the server before their opening instant, including direct activity access. Existing assessment start times now receive this protection as well. Active Home, Assessments, Labs and Study Materials pages refresh every 30 seconds and when the tab becomes visible. Release times use ISO timestamps; the faculty form displays local time.
- Assignment/quiz work and code are saved to the student's private server record. Revision checks prevent another window from silently overwriting work. Unsaved or failed saves are indicated; this is not offline synchronization.
- Written/API/project submissions receive task-level faculty scores and feedback. Submission receipts and history remain available.
- Quiz questions preserve their task weights through personalized question/option ordering. Each correct answer earns its task's marks.
- Coding labs use one submitted program with a defined input protocol. Each task earns its marks only when every hidden check assigned to that task passes. Hidden input/output and private faculty notes are omitted from student activity responses. Sandbox service failures do not produce a score.
- Learning modules retain per-lesson completion on the server and enforce completion in order. The final lesson completes the module; the old completion endpoint cannot bypass the lessons.

The sidebar shows five primary destinations and collapsible secondary groups. The duplicate seven-card dashboard navigation has been removed. Existing operational destinations remain reachable.

## Verification and remaining work

Run `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`, and `npm run test:browser`. `npm run test:studio` runs focused API and browser coverage. Tests use temporary databases and controlled AI/sandbox services; they do not certify live models or an actual sandbox deployment. Screenshots are generated under ignored `test-results/`.

Remaining infrastructure and product work:

- Connect and accept real chat/vision and isolated code-execution services. Current integration diagnostics report them missing.
- Provision disposable hosted web applications, API/Postman environments and ML notebooks for interactive full-stack/ML labs. This release can author their instructions and faculty-reviewed rubrics, but does not host these environments or automatically grade arbitrary websites.
- Rich course-level prerequisites, embedded video tracking, full course sequencing, direct Office ingestion, and assessments spanning multiple hosted services are future extensions. Existing manual activity authoring APIs retain their previous targeting capabilities; Studio currently publishes to one class per draft.
- Mobile PWA support and an unsigned Windows portable client are now implemented; see [installation](INSTALLATION.md). Shared HTTPS hosting, real-device acceptance and signed production distribution remain outstanding.

## Continuity report

Core implementation files are `server/assessment-studio.js`, `server/studio-demo.js`, `src/AssessmentStudio.jsx`, and `src/StudioActivity.jsx`. Integration changes are in the application routes, authorization scope, grading worker, lab workspace and navigation. Persistent new tables are `assessment_drafts`, `activity_work`, and `lesson_progress`; they are created additively. Existing records are not deleted or seeded.

Account usage percentage is not exposed to the coding agent, so a reliable 10% remaining alert cannot be promised. This report preserves the delivered scope, boundaries and next work for continuation.
