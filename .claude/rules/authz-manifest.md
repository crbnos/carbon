---
paths:
  - "packages/database/src/authz/**"
  - "packages/database/src/event-system/**"
  - "packages/database/supabase/migrations/**"
  - "packages/database/supabase/tests/authz-*.test.sql"
  - "packages/checks/src/conformance/no-authz-ddl-in-migrations.ts"
  - "packages/dev/src/services/migrations.ts"
---

# Authz manifest: RLS policies and helpers

Every RLS policy on a `public` table, and the 16 RLS/auth helper functions, are authored in
`packages/database/src/authz/` and nowhere else. Migrations create tables; they never write
`CREATE POLICY` / `ALTER POLICY` on a public table or define a managed helper
(`no-authz-ddl-in-migrations` in `@carbon/checks` fails them, from `20260927000000` on).
`storage.objects` (bucket) policies are not in the manifest and stay in migrations.

The same machinery owns the event system's 37 functions — see
[Event-system functions](#event-system-functions) below.

| File | What it is |
|---|---|
| `manifest.ts` | one rule per public table, typed by table name (`satisfies Manifest`) |
| `rules.ts` | the pieces and builders; `render()` compiles a rule to `CREATE POLICY` SQL with Kysely |
| `helpers/<name>.sql` | one `CREATE OR REPLACE FUNCTION public.<name>` per file (validated with Postgres's parser) |
| `../event-system/functions/<name>.sql` | the event system's functions, same format; `util.<name>.sql` for one in the `util` schema |
| `sync.ts` | `authz sync` / `check`: make a database match, in one transaction |
| `migration.ts` | `authz migration`: ship changes to databases that do not sync; `unshipped()` |
| `baseline.json` | what production had when the manifest took over — written once, never regenerated |

## Writing a rule

```ts
widget: company("inventory"),                       // the four standard policies
widgetLine: parent("widget", "widgetId", "inventory"),
maintenanceDispatchItemTrackedEntity: company("resources", { create: "employee" }),
userToCompany: company("users", { create: false, update: false }),   // no API writes
note: policies({
  select: inCompany("companyId", "employee"),
  update: { using: owner("createdBy"), check: and(owner("createdBy"), inCompany("companyId", "employee")) }
}),
```

- `company(module, overrides)` — SELECT any employee, writes `<module>_<action>`; an actor is
  `"employee"`, a permission, `anyOf(...)`, a predicate, or `false` (denied). `where` narrows a
  write (`journal` edits only Draft/Posted rows).
- `group(module)` — group-shared rows by `companyGroupId`.
- Pieces for `policies({...})`: `inCompany`, `inGroup`, `viaParent`, `exists` (optionally
  `sameCompany`), `through`, `member`, `owner`, `portal.customer/supplier`, `authenticated`,
  `isNull`/`isNotNull`, `where<"table">(eb => …)`, `or`, `and`.
- An UPDATE that can change `companyId` needs a `check` that pins the company — without it
  Postgres reuses USING, and an owner-only USING lets the author move the row to any company.
- `serviceOnly()` — RLS on, no policy: only the service role reaches it.
- `custom(reason, sql)` — last resort (3 today). The rendered SQL must parse to only
  `CREATE POLICY` on its own table.

## Shipping a change

1. Migration creates the table (no policies).
2. Add its rule to `manifest.ts` (or edit a rule / helper file).
3. `pnpm db:migrate` — `crbn migrate` (and `crbn up` / `crbn restore`) run `authz sync` last, so
   the local database gets the rule. A public table with no rule fails the sync.
4. `pnpm --filter @carbon/database authz migration <name>` — writes a generated migration with
   every rule and helper production does not have yet. Production does NOT run sync (CI is
   not wired: a Postgres connection is only guaranteed for some workspaces), so this migration
   is the only way the change deploys.

`migration.test.ts` (runs in CI, no database) fails until step 4 is done: every table's latest
generated block, or else its `baseline.json` hash, must equal what the manifest renders now —
so a new table cannot deploy without policies and an edited rule cannot silently not deploy.
It also refuses a generated file containing anything `authz migration` does not write, so the
header exemption cannot be borrowed by a hand-written file. Never edit a generated migration
or `baseline.json` by hand.

## Event-system functions

`packages/database/src/event-system/functions/` holds one file per function for dispatch,
subscriptions, the queue wake-up, the audit log, the search index and embeddings (37:
31 in `public`, 6 in `util`). They are loaded, synced, shipped and guarded exactly like the
RLS helpers — `loadHelpers()` reads both directories, and a `Helper` carries its `schema`.

- **File name is the function**: `dispatch_event_batch.sql` defines
  `public.dispatch_event_batch`; `util.wake_event_queue.sql` defines
  `util.wake_event_queue`. A file whose function is in another schema, or named
  differently, fails `validateHelper`. Everywhere a helper is reported (sync output,
  `unshipped()`, the generated migration's name list) it is `name` or `schema.name`.
- **Changing one**: edit the file, `pnpm db:migrate` (syncs it locally), then
  `authz migration <name>`. Never fork the definition into a hand-written migration —
  that is how `create_audit_log_table` came to run `CREATE TRIGGER` on every audit write
  and how `dispatch_event_batch` lost its composite-key pairing once.
- **Cutoff**: `no-authz-ddl-in-migrations` checks these from `20261002114954` (the
  takeover migration, `EVENT_SYSTEM_SINCE`), the RLS helpers from `20260927000000`. Each
  directory has its own cutoff in `MANAGED_FUNCTION_SETS`.
- **Not in `baseline.json`**: the takeover migration ships all 39, so every one has a
  generated block for `unshipped()` to compare against.
- **Signature changes and new functions** still need a hand-written migration for the
  `DROP FUNCTION` (sync refuses a file that would create an overload); the new definition
  goes in the file.
- **Not managed**: the per-table interceptors (`sync_*`) stay in their table's migration,
  as do `util.send_inngest_event` and `public.set_inngest_event_url`
  (`20261002170250`).
- **Retired**: `util.anon_key`, `util.invoke_edge_function` and `util.process_embeddings`
  (`RETIRED_HELPERS`, dropped by `20261002170619`) — Postgres no longer calls an edge
  function; `util.sweep_embedding_queue` replaced the last.

## Commands

```bash
pnpm --filter @carbon/database authz check            # what sync would change (exit 3 = drift)
pnpm --filter @carbon/database authz sync             # make the local database match
pnpm --filter @carbon/database authz migration <name> # ship unshipped rules/helpers
pnpm --filter @carbon/database authz migration <name> --tables=a,b  # also re-ship these tables
pnpm --filter @carbon/database exec vitest run src/authz
```

Behaviour tests (run against a local database, each rolls back):
`supabase/tests/authz-pieces.test.sql` (one case per piece),
`authz-fixes.test.sql`, `journal-update-tenant-check.test.sql`.

A table still on its `baseline.json` hash keeps the policy TEXT production had at takeover.
The meaning equals its rule; the wording may not — production's `agentThread` policies called
`auth.uid()` bare, which Postgres re-evaluates per row, while the manifest renders
`(SELECT auth.uid())`. `--tables` re-lands a named table's rule as rendered
(`20261003223948_rls-caller-lookup-once.sql`).

## Gotchas

- A filtered `UPDATE … WHERE` also checks the new row against the SELECT policy, so a test of
  a missing WITH CHECK passes vacuously; test with an unfiltered UPDATE or `pg_temp.allows`.
- Policy subqueries run under the caller's RLS: an `exists` over a table the caller cannot
  read is always false.
- `REVOKE EXECUTE` segfaults this image; `get_company_id_from_foreign_key` refuses a direct
  `/rpc/` call by checking `request.path` instead.
- Retiring a helper is not automated. Move every caller (manifest rules via `authz
  migration`; storage policies and function bodies in a hand-written migration), delete its
  `helpers/<name>.sql`, map it in `RETIRED_HELPERS` (`helpers.ts`) to the generated migration
  that last defined it (only that file may still define it), and `DROP FUNCTION` it in a migration AFTER the one that
  moved the callers, without CASCADE so a missed dependent fails loudly. Done this way for
  `has_role`, `has_company_permission`, `get_companies_with_permission`,
  `get_permission_companies` (`20260927224243` + `20260927224314`).
