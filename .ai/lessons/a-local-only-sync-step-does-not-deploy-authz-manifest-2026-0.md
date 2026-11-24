---
paths: ["packages/database/src/authz/**", "packages/database/supabase/tests/authz-*.sql"]
triggers: ["WITH CHECK", "authz sync"]
promoted: null
---
# A local-only sync step does not deploy (authz manifest, 2026-09-27)

**Context:** RLS policies moved from migrations into `packages/database/src/authz/manifest.ts`,
applied by `authz sync` after `crbn migrate`. Production runs migrations only.

**Problem:** With policies forbidden in migrations, a new table would be correct locally and
ship to production with no policies and RLS off — open to the anon key, since Supabase grants
public tables to `anon`/`authenticated` by default. Edited rules would silently never deploy.
Separately, a test of a missing UPDATE `WITH CHECK` passed against the broken policy: a
filtered `UPDATE … WHERE` checks the new row against the SELECT policy too.

**Rule:** Anything applied outside migrations needs a CI gate that proves the deploy path
carries it (`migration.test.ts` → `authz migration`). Test a WITH CHECK with an unfiltered
UPDATE or by evaluating the policy expression directly, and prove the test red first.

**Applies to:** `packages/database/src/authz/**`, `packages/database/supabase/tests/authz-*.sql`.
