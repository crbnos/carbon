---
paths: []
triggers: []
promoted: null
---
# Appending SQL to an already-applied migration silently does nothing

**Context:** A migration adding `companySettings.requireMfa` was written and applied. Later, a `users_with_verified_mfa` RPC was appended to that SAME file and `pnpm db:migrate` was re-run. The function was never created. The employees page then showed "Not set up" for every user — including one with a verified factor — because the missing RPC returned an error that the loader discarded as an empty result.

**Problem:** Supabase tracks applied migrations by FILENAME. Once a file has run it is never re-read, so statements appended to it are invisible on every existing database while still applying to a fresh one. The two diverge silently, and there is no error at migrate time to notice.

**Rule:** Never append to a migration file that may already have been applied — a file is immutable the moment it runs anywhere. New statements go in a NEW timestamped file, even a one-line `CREATE OR REPLACE`. Corollary: a migration that adds an RPC also needs a PostgREST schema reload (`NOTIFY pgrst, 'reload schema'`) or the function stays invisible to the app; and a service call whose failure is indistinguishable from an empty result must check `error` explicitly rather than `data ?? []`.

**Applies to:** `packages/database/supabase/migrations/**`, any `client.rpc(...)` call site.
