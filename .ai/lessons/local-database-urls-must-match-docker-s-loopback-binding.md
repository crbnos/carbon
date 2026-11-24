---
paths: ["packages/dev/src/stack.ts"]
triggers: ["localhost:54322", "127.0.0.1:54322", "SUPABASE_DB_PORT", "--db-url"]
promoted: null
---
# Local database URLs must match Docker's loopback binding

**Context:** The database types workflow runs `crbn migrate` against a fresh shared
Postgres container on GitHub Actions.

**Problem:** Compose publishes port 54322 on `127.0.0.1`, but `dbUrl()` emitted
`localhost`. The Supabase CLI resolved that to `::1` and failed to connect after
the migrations had already succeeded. Changing the URL to `127.0.0.1` exposed
another CLI behavior: it treats that host and port as its own `supabase start`
database and refuses to generate types without that container.

**Rule:** Use `127.0.0.1` in generated host database URLs when the corresponding
Docker port is bound to IPv4 loopback. For `supabase gen types --db-url`, set
the CLI's `SUPABASE_DB_PORT` to a different port in that process so it honors
the explicit URL as a direct connection. Keep URL expectations in the dev
tests aligned with the binding.

**Applies to:** `packages/dev/src/stack.ts`, database and pooler URLs from
`renderEnv()`, and local CLI consumers such as database type generation.
