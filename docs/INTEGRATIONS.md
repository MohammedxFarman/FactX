# FactX integration setup

## Local verification

From `D:\Finalyr`, run `npm run verify`. This uses temporary databases for API and browser checks, then saves browser screenshots in `test-results/`. Run `npm run doctor` for the current integration configuration; `npm run doctor -- --strict` fails if any integration is missing or unreachable. The checker never prints credentials and does not generate answers, submit code, or activate models.

Copy `.env.example` to `.env` if it does not already exist. Keep `.env` and `data/` private. Restart `npm start` after changing configuration. Test runners do not load `.env`; run them without externally injected production service variables.

## Document AI

Use an institution-managed Ollama-compatible service with an installed chat model and embedding model. Add a vision model when faculty will upload image or scanned-PDF timetables. Set these values in `.env` to match that service:

```dotenv
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=your-installed-embedding-model
OLLAMA_CHAT_MODEL=your-installed-chat-model
OLLAMA_VISION_MODEL=your-installed-vision-model
# OLLAMA_API_KEY=your-service-secret-if-required
```

The model names above are placeholders, not installed models. The app uses `/api/embed` and `/api/chat`; the readiness checker uses `/api/tags` to verify model availability. Embeddings are stored in SQLite alongside document passages. Changing the embedding model requires re-indexing documents. The normal assistant uses authorized RAG and requires the chat and embedding settings; timetable image/scanned-PDF extraction additionally requires the vision setting.

After `npm run doctor` reports the models available:

1. Restart the application.
2. As Admin, upload an authorized PDF containing selectable text or a plain-text document in Documents.
3. Open Knowledge library and index the document. Confirm that passages and vectors are present.
4. Ask the assistant a question answered in the document and inspect its cited sources.
5. Sign in with an account outside that document's scope and confirm that the document cannot be found or downloaded.

Scanned PDFs require the timetable vision workflow; the knowledge-library indexer currently accepts selectable-text PDFs and plain text. Permission filtering is tested with a controlled service, but live answer quality and model behavior require checking against your institution's documents. Without the AI configuration, record lookup and text search remain usable.

## Timetable assistant

Faculty, HOD, and Admin can open the assistant and choose **Upload timetable**. The LangGraph workflow extracts sessions from a PDF, PNG, or JPEG, matches names only to the caller's authorized teaching assignments, checks existing and draft conflicts, and saves a private draft. The caller can correct unresolved fields in the review table. Nothing is written to `timetable` until the caller presses **Confirm and add sessions**; retries are idempotent and notifications go to the affected faculty.

The workflow accepts files up to 10 MB and eight PDF pages, bounds decoded image pixels, rejects mismatched file content, ignores document instructions, and never lets model output call tools. A Faculty account can add only its own assigned sessions; HOD is limited to its department. Text PDFs use `OLLAMA_CHAT_MODEL`; images and scanned pages use `OLLAMA_VISION_MODEL`. If either service is unavailable, no timetable records are changed.

## Programming execution

Deploy or obtain access to a Judge0-compatible service on a separate host from FactX. Set:

```dotenv
JUDGE_URL=https://your-institution-sandbox.example
# JUDGE_TOKEN=your-service-secret-if-required
```

The URL is a placeholder. The adapter discovers `/languages`, submits base64-encoded code and hidden tests to `/submissions`, then polls for status. It requests network-disabled execution and CPU, wall-time, memory, and file-size limits. Those requests depend on the sandbox enforcing them.

1. Run `npm run doctor` and check which application languages are available.
2. Restart FactX so the execution worker starts.
3. Create a lab with a small known-answer test. Submit a correct solution and then an incorrect solution through an authorized student account.
4. Verify actual scores, submission history, and faculty feedback. Confirm hidden test inputs and outputs are absent from student responses.
5. Validate resource limits and network isolation on the separate sandbox host. The adapter's controlled-service tests do not certify these properties.

If no service is configured, submission is rejected without consuming an attempt. If an already queued job encounters a service failure, it receives `execution_error` with no score; faculty must review it. Interrupted running jobs are not automatically executed again.

## Reviewed ML predictions

Follow [ml/README.md](../ml/README.md) for the exact CSV contract and commands. Supply an approved dataset with feature measurements before the outcome observation window. No dataset is bundled and no student data is fabricated.

Install the optional Python requirements, train a uniquely versioned candidate, inspect the evaluation metrics, and complete a named institutional review. Only then generate prediction artifacts and explicitly import the reviewed version with `server/import-predictions.js`. The checker reports whether a reviewed version is active; it does not assess model quality.

Rule-based academic support remains available without a model. LSTM/GRU and clustering require a suitable longitudinal dataset and an evaluated use case and remain deferred.

## Deployment

Use HTTPS with `COOKIE_SECURE=true`, institution-specific access policies, and a consistent backup of the SQLite database and private uploads. Keep a single application process for the current SQLite architecture. Complete a real deployment/security review before public access; local tests and successful compilation do not establish production readiness.
