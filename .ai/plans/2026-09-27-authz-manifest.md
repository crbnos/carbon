# Authz manifest: every policy and RLS helper from one source

This plan is the current design. Branch `feat/authz-manifest`.

The manifest (`packages/database/src/authz/`) is the only place RLS policies and the RLS /
auth helper functions are authored. `authz sync` makes a database match it in one
transaction after migrations; migrations only create tables. CI is not wired (production
connection availability unverified) — local `crbn up/migrate/restore` only. Production gets
changes through `authz migration`; `migration.test.ts` fails CI until it does. Guide:
`.claude/rules/authz-manifest.md`.

## Done

- [x] `rules.ts` builders + Kysely-compiled `render()`; per-action actors, `false` = denied
- [x] `sync.ts` one-transaction sync (scratch-schema normalization, drop-all + recreate)
- [x] `import` (bootstrap, 0 drift) and `convert` (exact custom → pattern) — done, then deleted
- [x] `journal` fixed through the manifest (standalone migration removed), red/green proven
- [x] `crbn up/migrate/restore` run sync after type regen

## Now

- [x] Add `libpg-query` (authz CLI only)
- [x] Pieces API: who (`employee`, `member`, permission, `anyOf`) and predicates
      (`inCompany`, `viaParent`, `exists`, `owner`, `portal.*`, `authenticated`, `isNull`,
      `where`, `or`, `and`); `company()` as sugar; `policies()` for everything else
- [x] Strict SQL: every rendered rule (custom included) must parse to only CREATE POLICY on
      its own table (`assertOnlyPolicies`), checked before anything runs
- [x] Helpers: `helpers/<name>.sql` (20, now 16 after the retirement below) (validated: exactly one CREATE OR REPLACE FUNCTION
      public.<name>), synced first in the same transaction, applied in a savepoint and kept
      only if different; signature change fails loudly; `import-helpers` bootstrap = 0 drift;
      proven: a hand-made VOLATILE flip is detected and healed
- [x] Retired the four deprecated helpers (has_role, has_company_permission,
      get_companies_with_permission, get_permission_companies): manifest moved (generated
      20260927224243), storage policies + is_claims_admin moved and unused create_rfq_* RPCs +
      the helpers dropped (20260927224314). Portal accounts lose document / demand / supply
      reads; API keys scoped to resources_* gain userAttribute* (consistent with every table)
- [x] AST converter (`convert.ts`): 118 of 147 customs → pieces; each round-trips to the
      same canonical meaning; 61 rewritten in text, synced locally; all SQL tests green
      (except `integration-metadata-patch`, stale since #1725 — EXECUTE grants, not policies)
- [x] Bespoke tables: `exists` gained a condition + `sameCompany`; new `through` / `member`;
      converter learned unions of portal/legacy sets, COALESCE, array_agg, owner spellings.
      Manifest (393 tables): mostly `company`, then `policies`, 11 serviceOnly, 4 group, 3 custom
      (each with a real reason). Equivalence rules pinned in `convert.test.ts`.
- [x] Behavior tests per piece: `supabase/tests/authz-pieces.test.sql` (proven red on a broken rule)
- [x] `@carbon/checks` `no-authz-ddl-in-migrations`: new migrations may not CREATE/ALTER
      POLICY or define/alter/drop a managed helper (list read from helpers/, no dependency)

## Self-review fixes

- [x] Production shipping gate: `unshipped()` + `baseline.json` + `migration.test.ts` (CI, no
      DB). New tables, edited rules and edited helpers fail until `authz migration <name>`,
      which now ships exactly the unshipped set. Generated files are allowlist-parsed, so the
      header cannot be borrowed
- [x] `no-authz-ddl-in-migrations` only flags policies on public tables (storage buckets allowed)
- [x] Deleted `import` / `import-helpers` / `convert` (they could overwrite fixes from a stale DB)
- [x] `get_companies_with_employee_permission` STABLE; RPC guard matches any case / trailing `/`
      (both shipped in `20260927172338_authz-security-fixes.sql`, regenerated)
- [x] `maintenanceDispatchComment` behavior test; `allows()` falls back to USING like Postgres

## Later (needs approval — behavior changes)

- [x] Fixed (tests/authz-fixes.test.sql; each fix proven red against its old definition):
      invoiceSettlement EXISTS self-compare; userAttributeValue (self-write of canSelfManage
      attributes in own company); note / tableView / maintenanceDispatchComment owner UPDATE
      WITH CHECK; maintenance_* → resources; userToCompany API INSERT/UPDATE denied (audit M);
      get_company_id_from_foreign_key refused as an RPC; H3: legacy permission helpers drop the
      '0' wildcard and intersect membership, API keys scope-checked. Shipped with journal in
      the generated migration 20260927172338_authz-security-fixes.sql (`authz migration`)
- [x] App drift: the attribute upsert route checked users_update; it and the DB now both use
      resources_update, and users can clear their own self-managed values (the delete route
      offered it; the DB refused silently) — generated 20260927230425
- [ ] Any-employee writes (`trackedEntity`, `riskRegister`, …) → permission?
- [ ] Unscoped API keys reading `employee`-read tables
- [ ] Re-wire CI once every active workspace has a Postgres connection
