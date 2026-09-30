# Project instructions

FactX is a React/Vite application with an Express API and SQLite storage.

## GitHub workflow

The project's GitHub owner is `MohammedxFarman`. Verify this owner when creating
the repository or changing its remote. Use this project's repository-local Git
identity rather than another account's global Git identity.

The owner has authorized normal commits and pushes for completed work in this
project. After each completed coding task:

1. Review `git status` and the diff. Preserve unrelated work and check that the
   changes contain no credentials, personal records, or generated files.
2. Run checks appropriate to the change. For application changes, normally run
   `npm test` and `npm run build`; use browser tests when relevant to UI behavior.
3. Stage the reviewed files and make a descriptive commit for the completed task.
4. Push the current branch to its configured upstream on `origin`. Ordinary
   commits and pushes do not require another user confirmation, unless the
   environment itself requires permission. Explicit later user instructions
   take precedence.
5. Confirm whether the push succeeded and report the short commit ID. If a push
   fails, preserve the local commit and explain the actual blocker.

Do not force-push, rewrite shared history, discard unrelated changes, or commit
unfinished work solely to synchronize files. Synchronization happens at completed
task boundaries, not on every file save.

## Private and generated files

Keep runtime `data/`, student uploads, `.env` variants, credentials, databases,
`node_modules/`, `dist/`, logs, and test output out of Git. `.env.example` must
contain placeholders only. Use isolated temporary data for tests.
