---
paths: ["packages/database/src/client.ts"]
triggers: ["toPostingDateString", "BaseEntitySyncer", "setTypeParser"]
promoted: null
---
# Kysely returns `date` columns as JS `Date`s; PostgREST returns strings

**Context:** Porting Ramp's outbound draft-bill push from a Supabase-client job into a
`BaseEntitySyncer` (which uses Kysely) — `.ai/plans/implemented/2026-09-23-spend-outbound-event-engine.md`.

**Problem:** `purchaseInvoice.dateIssued` / `dateDue` are `date` columns. Read through
PostgREST they arrive as `"2026-09-15"` strings; read through Kysely's pg driver they
arrive as JS `Date` objects, which `JSON.stringify` renders as a full ISO timestamp.
Ramp rejected every draft bill with `422 DEVELOPER_7001 "Not a valid date"`. Typecheck
did not catch it — the syncer's local type declared `string | null` and the Kysely row
was assigned straight in. Unit tests did not catch it either; only a live push did.

**Rule:** FIXED AT THE SOURCE for `date` columns — node-postgres now decodes OID 1082 to
the raw `YYYY-MM-DD` string, so a Kysely row matches the generated types
(`packages/database/src/client.ts`, pinned by
`packages/database/src/postgres-type-parsers.test.ts`). `timestamp`/`timestamptz`
(1114 / 1184) are deliberately still `Date`s — Postgres' wire text for those differs in
SHAPE from PostgREST's (`… 16:36:52.677+00` vs `…T16:36:52.677+00:00`), so identity
would make the two clients disagree. So: when moving a query from the Supabase client to
Kysely, treat every TIMESTAMP column as a value whose runtime type just changed, and
normalize with `toPostingDateString` before it reaches a wire payload or a `.slice`.

**The deeper rule:** a runtime/type mismatch that the GENERATED types already paper over
is invisible to typecheck by construction. Fix it at the driver, not with a helper at
every call site — the helper is what 34 call sites and ~16 `instanceof Date` guards were.

**Applies to:** any `packages/ee` syncer or `packages/jobs` function reading timestamp
columns through Kysely and sending them to a provider API.
