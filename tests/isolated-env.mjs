// Tests use explicit synthetic services, never inherited institutional endpoints.
for(const key of Object.keys(process.env)){if(/^(OLLAMA_|JUDGE_|SMTP_|MAIL_FROM$|PUBLIC_URL$|REQUIRE_EMAIL_VERIFICATION$|FACTX_BACKUP_DIR$|FACTX_ENV_FILE$|COOKIE_SECURE$)/.test(key))delete process.env[key];}
