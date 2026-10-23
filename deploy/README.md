# Shared HTTPS deployment

This package prepares a **single-server Linux Docker deployment**. It has not been
launched on a public host. It does not deploy AI models or student-code runners.
Choose the institution's host/domain and assign an operator before rollout.

## Prerequisites

- A Linux host with Docker Engine and Compose v2, persistent disk, adequate memory
  for the application build, a backup destination, and access to npm/image registries.
- A DNS hostname pointing to this server; inbound TCP 80/443 (UDP 443 optional).
- Private outbound connectivity to separately managed AI/Judge0 services if enabled.
- Do not mount the Docker socket into FactX or run student programs in its container.

## Configuration

Create a private environment file **outside the repository**, owned by the operator
and readable only by authorized administrators. Do not copy placeholder optional
integration URLs into production. Leave unsupported integrations unset.

```dotenv
# Generate a random value; this example must not be used as a real token.
FACTX_SETUP_TOKEN=replace-with-at-least-32-random-characters
# Optional, real integration endpoints and installed model names only:
# OLLAMA_URL=https://your-private-ollama-host
# OLLAMA_CHAT_MODEL=your-installed-chat-model
# OLLAMA_EMBED_MODEL=your-installed-embedding-model
# OLLAMA_VISION_MODEL=your-installed-vision-model
# OLLAMA_API_KEY=your-private-service-secret
# JUDGE_URL=https://your-separate-sandbox-host
# JUDGE_TOKEN=your-private-service-secret
```

The app accepts a secret-file path through `FACTX_ENV_FILE`. Compose mounts the
file read-only at `/run/secrets/factx_environment`; it is not copied into the image.
The operator must protect the source file: Compose secrets do not encrypt it on disk.
Generate a token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
in a private terminal, or omit the token to generate it automatically at first boot.
The initial token appears in private app logs until an administrator exists. Protect
those logs. Do not share `docker inspect`, environment files, or setup logs publicly.

From the repository root on the selected host:

```sh
export FACTX_DOMAIN=your.actual.institution.hostname
export FACTX_ENV_PATH=/absolute/private/path/factx.env
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs app
```

Use the actual HTTPS URL to create the first administrator. Do not expose port 3001;
only Caddy publishes ports. Caddy obtains TLS certificates for the chosen domain.
The app runs without root, with a read-only image, a writable data volume and bounded
temporary storage. Its production startup rejects insecure cookies and example tokens.
The API health check gates proxy startup. It does **not** certify AI or sandbox health.

Images use maintained major-version tags (`node:22-bookworm-slim`, `caddy:2`). After
acceptance, record/pin the resolved image digests for the institution's release and
schedule rebuilds for security updates. This template is not a fully hardened audit.

## Acceptance and recovery

1. Check `https://YOUR_DOMAIN/api/health`, all four roles, private attachments and
   scheduled assessment access. Verify the browser receives a Secure session cookie.
2. Run `docker compose -f deploy/compose.yaml exec app node scripts/check-integrations.mjs --strict`.
   Missing optional features must be recorded as unavailable, not passed.
3. Verify a real cited AI answer, a reviewed PDF/image draft, correct and incorrect
   sandbox submissions, and sandbox resource/network restrictions separately.
4. Install on actual Android/iPhone devices and connect the Windows client to this
   same HTTPS origin. Confirm a save on one device is visible on another.
5. Stop the app before backing up the complete `academic_data` volume, including
   SQLite/WAL and uploads. Restart after a consistent copy. Restore to an isolated
   host/volume and test records and attachments. Never publish backup contents.
6. Preserve the prior image and data backup before upgrades. Do not roll back a
   database blindly after schema changes; validate recovery on an isolated instance.

`docker compose down` keeps named volumes. **Do not use `down -v`** for ordinary
updates: it deletes academic data and TLS storage. Never scale the app above one
replica with this SQLite design. Configure host disk/log monitoring and backup alerts.

## Outstanding external work

Public TLS, real AI model quality, sandbox isolation, restore acceptance, publisher
signing and real-device tests require the selected host/services/devices. Full-stack
disposable web/ML environments still need a separately operated workspace provider;
this compose file intentionally does not grant the app container-control privileges.

References: [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https).
