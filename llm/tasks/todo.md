# Merge pick/place into item rules; remove storageUnit; rebrand item→Storage rules under Inventory

## Part A — Merge pick/place, remove storageUnit target
- [x] A1. customRules.ts: TARGET_TYPES, SURFACES_BY_TARGET_TYPE. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A2. field-registry.ts: targetType ["item","storageUnit"]→"item". Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A3. server.ts: drop storageUnit target branches, keep storageType cascade. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A4. service.ts: drop storageUnit cases. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A5. customRules.models.ts validator. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A6. Call sites: receipt/shipment/adjustment swap; transfers delete pass. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A7. Delete 3 storage-units rules routes. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A8. path.ts + RuleAssignmentsList + StorageUnitForm + getRuleAssignmentCounts + type unions. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A9. Migration file. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] A10. Tests. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Part B — Rebrand item→Storage rules, move to Inventory
- [x] B1. Relocate 4 admin routes settings→inventory. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] B2. path.ts rename customRules*→storageRules*. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] B3. Nav: remove settings entry, add inventory entry. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] B4. CustomRulesGroups relabel. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.
- [x] B5. CustomRulesTable + CustomRuleForm label maps. Spawn subtasks to query the cache folder any time I need to learn something about the codebase. NEVER update the cache with plans or information about code that is not yet committed.

## Review

**Done.** All 15 items complete. `packages/utils`, `packages/ee`, `apps/erp`
typecheck clean (tsgo --noEmit, exit 0). Unit tests pass: utils customRules
(51) + ee context anti-drift (23).

Key decisions:
- pick/place merged into item rules by adding them to `SURFACES_BY_TARGET_TYPE.item`
  and swapping the storageUnit eval pass → item at receipt/shipment/adjustment
  call sites; transfer call sites just dropped the redundant storageUnit pass.
- storageUnit target fully removed (TARGET_TYPES, field-registry, evaluator,
  service, validator, UI unions, 3 assignment routes, path helpers, nav button).
  Storage-type ancestor cascade KEPT in the evaluator — item rules referencing
  `storageUnit.storageTypeId` on place/pick still get the unioned value.
- Migration `20260603120000_remove-storage-unit-rules.sql`: DELETEs storageUnit
  rules (cascades assignments), DROPs the assignment table, recreates the enum
  without 'storageUnit'.
- Item rules rebranded "Storage rules"; admin library relocated settings →
  `/x/inventory/storage-rules` + Inventory > Configure nav. Pages still gated on
  `settings` permission (matches `customRule` RLS); switching to inventory perms
  would need an RLS migration (out of scope).

## Part C — Full rename customRule → storageRule (incl. DB), perms → inventory

Done. Migrations applied + types regenerated by user. ee/erp typecheck exit 0;
utils/ee tests green.
- Code: blanket rename `customRule*`/`CustomRule*`/`custom-rules`/`CUSTOM_RULES`
  → `storageRule*`/`StorageRule*`/`storage-rules`/`STORAGE_RULES` (60 files);
  `git mv` of utils `storageRules.ts(.test)`, ee `storageRules/` dir, erp
  `modules/storageRules/` + `StorageRule*` component files; EE export
  `@carbon/ee/storage-rules(.server)`.
- DB: migration 130000 renames tables (`storageRule`, `storageRuleItemAssignment`,
  `storageRuleWorkCenterAssignment`), enum `storageRuleTargetType`, customFieldTable
  row. Migration 140000 moves `storageRule` RLS → inventory_* (SELECT any-employee).
  Admin route gates + library UI perms swapped settings → inventory.
- Left legacy constraint/index names (`customRule_*`) — internal labels only,
  surface as `foreignKeyName` strings in generated types; never referenced by code.

Manual verification still pending (create a storage rule; receipt/ship to fire
place/pick; confirm Inventory→Storage Rules nav).
