# FactX deployment acceptance

The current application uses one Express process with SQLite and private disk uploads. A production bundle is available, but no public deployment target is configured by this repository. Choose the target host and domain before provisioning services or publishing institutional records.

## Prepare the target

1. Install the supported Node runtime and dependencies from the lockfile, then run `npm run build`. Run `npm run verify:all` in a test environment with the optional Python dependencies and Playwright Chromium.
2. Configure a private persistent `FACTX_DATA_DIR` outside the web root. Keep it separate from temporary test workspaces. Preserve the database and upload directory together.
3. Configure a private `.env`. Use a real random first-run setup token if setting `FACTX_SETUP_TOKEN`; never use the example placeholder. Create the first administrator through the setup screen and retain the normal administrator-managed account process.
4. Put Express behind the target host's HTTPS reverse proxy. Keep its internal listener restricted, configure `HOST`/`PORT` for that host, and use `COOKIE_SECURE=true` for HTTPS access. Verify sign-in over the actual HTTPS URL.
5. Run one application process with supervised restart and private logs. The current SQLite storage is not a multi-instance deployment design.

## Connect and accept integrations

Follow [Integration setup](INTEGRATIONS.md). Supply actual service URLs and installed model names; example values are placeholders.

- Run `npm run doctor -- --strict`. Resolve missing configuration, unreachable services, missing models, missing supported languages, and absent reviewed models if deploying all optional features.
- Verify a cited document answer through an authorized account and verify that another role cannot access that document.
- Review an actual text-PDF and image timetable, correct a draft, confirm it, and verify the resulting sessions and conflicts.
- Host Judge0 separately from FactX. Verify correct and incorrect code submissions, hidden-test privacy, and the sandbox's resource and network restrictions on that host.
- Train ML only from an approved dataset using `ml/README.md`; record the actual named review before importing the selected version. Record the model version and evaluation results in institutional deployment records.

If optional integrations are intentionally omitted, record that choice and use the existing database lookup, text search, and rule-based support. A partial configuration must not be described as full integration acceptance.

## Verify operation and recovery

- Check `/api/health` and sign in as each role using designated acceptance accounts. Check department/student boundaries, protected document downloads, attendance, leave/substitution flows, reporting, and timetable confirmation through the deployed URL.
- Confirm that application restarts retain authorized records and uploads.
- With the application stopped, back up the complete private data directory to protected storage. Alternatively use an established SQLite-consistent backup process that also preserves corresponding uploads. Do not copy only the live `.sqlite` file while ignoring its WAL.
- Restore the backup to an isolated instance and verify both academic records and private attachments before relying on the backup process. Do not use production records in public demos.
- Record the deployed Git commit, runtime version, environment owner, backup/restore result, and integration acceptance results. Retain a tested prior release and consistent data backup for recovery.

Local automated checks cover application behavior. TLS, host permissions, sandbox isolation, real model quality, operational recovery, and institutional policy need verification on the selected deployment.
