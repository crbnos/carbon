---
paths: ["packages/dev/src/commands/reload.ts", "packages/dev/src/commands/up.ts", "packages/dev/src/env.ts"]
triggers: ["loadEnvFiles", "docker compose", "force-recreate"]
promoted: null
---
# `crbn reload` must load root `.env` — compose-substituted secrets silently reset

**Context:** Enabling GoTrue SAML via `${SAML_ENABLED:-false}` / `${SAML_PRIVATE_KEY:-}` in docker-compose.dev.yml, values kept in root `.env`.

**Problem:** `crbn reload <service>` invoked `docker compose up -d --force-recreate` with only `--env-file .env.local` and no dotenv preload. Root `.env` vars referenced by compose substitution resolved to their defaults, and — worse — recreating ANY service also reconciles other services whose definition changed, so a `crbn reload kong` recreated gotrue with SAML silently OFF even though the user's earlier `crbn up` had it on. (`crbn up` was immune only because it loads `.env.local` then `.env` into process.env first, and shell env wins compose interpolation.)

**Rule:** Any crbn command that invokes docker compose must preload BOTH env files into process.env the way `up.ts` does (`loadDotenv(.env.local)` then `loadDotenv(.env)`, both `override: false`). `reload.ts` now does this. After any reload, still verify the dependent feature's health endpoint (e.g. `curl .../sso/saml/metadata` → 200), not just container status.

**Applies to:** packages/dev reload/compose commands; any GoTrue/Kong/storage env sourced from root `.env`.
