---
paths: []
triggers: ["CREATE OR REPLACE VIEW", "CREATE VIEW", "security_invoker"]
promoted: null
---
# `CREATE OR REPLACE VIEW` without `WITH (...)` silently drops `security_invoker`

**Context:** `openJobMaterialLines` served every company's open job material lines to the anon
key (reported against production, 2026-09-26). The clause had been added, audited back in, and
then dropped by four separate migrations that recreated the view from an older copy.

**Problem:** `CREATE OR REPLACE VIEW` REPLACES the view's options with whatever the statement
states, so a recreation that omits `WITH (security_invoker = true)` turns an invoker view back
into an owner-rights one. Owner rights bypass RLS on every table underneath, and every `public`
view is a PostgREST endpoint. Nothing failed: the app filters by `companyId` itself, so every
screen still looked right.

**Rule:** Every `CREATE [OR REPLACE] VIEW` states `security_invoker` — copy a view's definition
from its NEWEST migration, and re-check the `WITH` clause when you do. Test a view the way an
attacker reads it: `SET LOCAL ROLE anon; SELECT count(*) FROM "view";` must be 0. Join on
`companyId` too, so a view is tenant-consistent on its own.

**Applies to:** `packages/database/supabase/migrations/**`; enforced by the
`no-view-without-invoker` conformance check and the `view-without-security-invoker` invariant.
