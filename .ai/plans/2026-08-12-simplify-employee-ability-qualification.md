# Simplify employee-ability qualification

**Date:** 2026-08-12
**Branch:** naveen/capacity-planning
**Approved decisions:** A=keep expiry/recert · B=delete `active=false` rows then drop cols · C=trim AbilityForm now, drop curve columns in a follow-up · D=keep ability soft-delete, remove dead "Active" column

## Goal

Qualification becomes **presence-based**: an `employeeAbility` row means the person is
qualified, subject only to optional expiry. Remove the `active` + `trainingCompleted`
premise and the dead `trainingDays`/"In Training" state.

New rule (defined once per build context):
`qualified = row exists AND (expiresAt IS NULL OR expiresAt >= today)`

Training remains a *path* to qualification (the `grantsAbilityId` trigger inserts the
row) — not a requirement baked into the model.

## Schema (migration)

`employeeAbility`: `DELETE WHERE active = false`, then `DROP COLUMN active,
trainingCompleted, trainingDays`. Keep `lastTrainingDate`, `expiresAt`.
Redefine `grant_ability_on_training_completion()` to insert without the two booleans.
`ability.active` (soft-delete) unchanged. Curve columns (`curve`, `shadowWeeks`)
left in place; dropped in a follow-up.

## Tasks

- [x] 1. Migration: delete soft-deleted rows, drop 3 columns, redefine grant trigger fn
- [x] 2. `pnpm db:migrate` (applied + regenerated types; `generate:swagger` sub-step failed on a network timeout — unrelated, `types.ts` regenerated clean)
- [x] 3. Scheduler edge fn: `operator-eligibility.ts` gate → expiry only; dropped `active`/`trainingCompleted` from `master-data-provider.ts` load + `scheduling-engine.ts` PoolEmployee + `QualifiedEmployeeRow` (+ Deno test updated)
- [x] 4. MES `getOperationEligibility`: dropped `!active` + `!trainingCompleted` checks, keep expiry
- [x] 5. ERP production: `getActiveEmployeeAbilities` (dropped `.eq(active)` + trainingCompleted); `PeopleBoard.tsx` gate → expiry only
- [x] 6. ERP resources service: `deleteEmployeeAbility` → hard delete; dropped boolean writes/reads in `getAbilities`, `getAbility`, `getEmployeeAbilities`, `upsertEmployeeAbilityCell`; deleted dead `insertEmployeeAbilities`/`upsertEmployeeAbility`
- [x] 7. Validators: `employeeAbilityCellValidator` dropped `active`/`trainingCompleted`; `abilityValidator` → name + recertifyEveryDays
- [x] 8. Forms: `EmployeeAbilityForm` dropped the two toggles; `AbilityForm` dropped weeks/shadowWeeks/startingPoint; ability create/edit routes rely on DB defaults for curve/shadowWeeks
- [x] 9. UI status: `EmployeeAbilityStatus` → 3 states; `types.ts` dropped `getTrainingStatus`/`AbilityEmployeeStatus`; `AbilitiesTable` dropped "Active" column + simplified count; `AbilityEmployeesTable` status filter → 3 options
- [x] 10. Write routes: `ability.$id.employee.new/$id`, `person.$personId.ability.new` dropped boolean handling
- [x] 11. Docs: `resources/AGENTS.md`, `production/AGENTS.md` updated
- [x] 12. Verify: typecheck `erp` ✓ + `mes` ✓; Deno scheduler tests ✓ (6/6); Biome ✓ (only pre-existing noConsole warnings). Browser check still pending (needs running stack).

## Notes

- "One shared helper" is per-build-context: 1 ERP helper (`isEmployeeAbilityQualified`)
  reused by status/count/board; scheduler + MES simplify inline (separate Deno/MES builds).
- Data semantics change: existing rows with `trainingCompleted=false` become qualified
  (intended). Soft-deleted rows are purged so they don't resurrect.
