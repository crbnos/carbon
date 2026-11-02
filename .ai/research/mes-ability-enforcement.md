# Research: MES ability enforcement

Internal/mechanical change; no external domain research needed — the codebase already
has the ability model, the training→ability bridge, and a precedent warn/error policy.

## What exists today (verified)

- **Ability requirement** comes from the operation's process: `process.requiresAbility`
  (bool, `20260720121629_capacity-planning.sql:6`) + the 1:1 `ability.processId`.
- **Qualification** = an `employeeAbility` row, subject to `expiresAt`
  (`20260812153418_simplify-employee-ability.sql`).
- **Training grants it**: trigger `grant_ability_on_training_completion` (AFTER INSERT ON
  `trainingCompletion`) upserts `employeeAbility` via `training.grantsAbilityId`
  (`20260812153418_simplify-employee-ability.sql:14-51`).
- **MES already hard-blocks** (no setting, no warn mode):
  - `getOperationEligibility` — `apps/mes/app/services/operations.service.ts:1588-1686`.
    Fails open on query errors. Reasons: "Requires X — not qualified" /
    "Requires X — qualification expired <date>". No mention of training.
  - Called from the Start action `apps/mes/app/routes/x+/event.tsx:93-102` (flash error,
    refused) and the QR/link start loader `apps/mes/app/routes/x+/start.$operationId.tsx:165-180`
    (redirect + flash error).
  - Added in 7f5f1d2145 (finite-capacity scheduling, #1151).
  - Operation page loader (`operation.$operationId.tsx`) does not compute eligibility;
    the UI cannot pre-warn.
- **Scheduler** also uses abilities to pick eligible operators
  (`packages/planning/src/scheduling/operator-eligibility.ts`) — out of scope.

## Precedent for a 2-mode company setting

- `companySettings.incompletePickingListPolicy` TEXT NOT NULL DEFAULT 'warn'
  CHECK IN ('warn','error') — `20260728120100_incomplete-picking-list-policy.sql:12-14`.
- Validator/const in `apps/erp/app/modules/settings/settings.models.ts:378-386`.
- UI: `ChoiceSelect` "Warn but allow" / "Block with an error" in
  `apps/erp/app/routes/x+/settings+/inventory.tsx:535-565`.
- MES read with ack flow: `apps/mes/app/routes/x+/picking.$pickingListId.status.tsx:68-111`.
- Natural home in ERP: production settings "Shop Floor" card,
  `apps/erp/app/routes/x+/settings+/production.tsx:315-391`, saved via
  `updateProductionSettings` (`settings.server.ts:380-420`).
- MES operation page already loads company settings (`operation.$operationId.tsx:258`).
