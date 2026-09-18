# Bugfix run: Abilities should be process-backed, not free-form by name

- Date: 2026-09-17
- Mode: fully-autonomous (adopting recommended resolutions; hard stops still surface)
- Request: Abilities can currently be created free-form by name and can collide with a process name. Abilities should only be creatable from a process (modal picks a process without an ability yet), and should not store a name — name derives from the linked process (rename process -> rename ability).
- Phase plan: root-cause [run, light — structural cause already proven] · instrument [skip — HIGH confidence, not runtime] · fix [run] · test [run — validator regression + note stack-gated browser verify] · commit [skip — not explicitly requested]

## Decisions
- Orphaned abilities (processId IS NULL): **DELETE** (revised 2026-09-18 at user's request — was backfill). Cascades employeeAbility + contractorAbility, NULLs training.grantsAbilityId; detaches workCenter.requiredAbilityId (nullable, else CASCADE would delete the work center) and removes partner rows (NOT NULL + NO ACTION would block) FIRST. Proven with synthetic orphan data in a rolled-back psql txn: orphan gone, qualification cascaded, work center survived with requiredAbilityId nulled.
- ability.processId: NOT NULL + ON DELETE CASCADE (1:1 identity link) — 2026-09-17
- name storage: DROP ability.name; add `abilities` view exposing process.name — 2026-09-17
- creation path: New Ability modal becomes a Process picker (processes without an ability); action sets process.requiresAbility=true + ensureProcessAbility — reuses existing invariant — 2026-09-17

## Phase log
- root-cause: HIGH — two creation paths (manual insertAbility via abilityValidator.name + abilities.new.tsx) plus a stored ability.name column allow free-form abilities that can duplicate/collide with processes. Fix removes the free-form path and the stored name.

## Phase log (fix)
- Regression test `resources.models.test.ts`: RED before (validator had `name`, no `processId`), GREEN after (3/3).
- Files changed: migration `20260917161742_abilities-from-process.sql`; resources.models.ts (validators), resources.service.ts (getAbilities/getAbility/getAbilitiesList via `abilities` view + employeeAbility stitch; ensureProcessAbility no name +recertify; getProcessesWithoutAbility; insertAbility removed; updateAbility recertify-only); AbilityForm.tsx (process picker / read-only name); abilities.new.tsx (loader + process-backed create); ability.$id.details.tsx (recertify-only validator); processes.$processId.tsx (ensureProcessAbility call); MES operations.service.ts (name from process); datasets/tiers/01-foundation.ts (process-backed seed); resources AGENTS.md.
- Gates run here: biome PASS (9 files), unit test PASS (3/3).
- Gates BLOCKED on environment: this worktree has no `crbn` stack (no `.env.local`), so `generate:types`, scoped `typecheck`, `db:check:datasets`, `db:check:backups`, and browser verify could not run. They need `crbn up` + `pnpm db:migrate` first.

## Risks to verify once the stack is up
- `db:check:backups`: dropping `ability.name` (a column, not a table) — confirm old customer backups still restore (TABLE_RENAMES is table-level only).
- Generated MCP manifests reference the removed `resources_insertAbility` tool — regenerate.
- Browser: New Ability → process picker (only processes w/o an ability); rename a process → ability name follows on the abilities list + person panel.

## Migration fix (after user's `crbn up` surfaced it)
- `crbn up` failed on the migration: `partners`/`trainings` views read `ability.name`, and the copied `partners` def used `a.state` (renamed to `stateProvince` by 20240928155702; Postgres had auto-rewritten the live view) and `CREATE OR REPLACE` can't reconcile the frozen `p.*` expansion. Fixed: `a."stateProvince" AS "state"`, `DROP VIEW IF EXISTS "partners"` + CREATE, `DROP COLUMN IF EXISTS "name"`. Validated in a rolled-back psql txn, then applied via `supabase migration up`.
- Follow-on typecheck error: `audit.config.ts` displayed `ability` FKs by `name`; moved it to `fkDisplayHops` (ability.processId → process.name).

## Gates (all green, stack up)
- generate:types PASS · biome PASS · typecheck(erp, mes, @carbon/database) PASS · db:check:datasets PASS (4/4) · db:check:backups PASS (restorable — dropped column does not break restore) · unit test PASS (3/3, red→green).

## Outcome
- READY, all gates green. Browser verify still pending (optional). Not committed (no explicit request).
