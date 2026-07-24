# Plan: Accounting Cutover & Activation (#1057)

Tracking spec: `.ai/specs/2026-07-04-accounting-cutover-activation.md`
Branch: `feature/accounting-cutover`

## Scope (this PR)

Build the activation machinery. **Flag retirement is explicitly a separate PR**
(Design Decision 7 / §5): this PR sets `accountingEnabled = true` at activation
as the mechanical bridge but does NOT remove any `accountingEnabled` reader.

## Ground rules

- No `pnpm run generate:types` — new `company` columns + enum value read/written
  through `as any` casts, mirroring the existing `accountingPeriod` close-column
  pattern already in `accounting.service.ts`.
- No DB rebuild — migration authored, applied by the user when the stack is up.
- Scope: `apps/erp/app/modules/accounting/` + `x+/accounting+/` routes +
  `seed-company` edge function + one migration.
- `journalLine.amount` is class-normal signed via `toStoredAmount(debit, credit, class)`.

## Tasks

1. **Migration** `accounting-activation.sql`: enum value `'Opening Balance'`;
   `company` columns `accountingActivatedAt/By`, `accountingCutoverDate`;
   `check_accounting_config_locked()` trigger on `company` + `fiscalYearSettings`;
   grandfather backfill UPDATE. Idempotent.
2. **Models** (`accounting.models.ts`): zod validators + types — readiness,
   opening-balance proposal (section), TB import, validate, activate.
3. **Service** (`accounting.service.ts`): `getActivationReadiness`,
   `buildOpeningBalanceProposal`, `importOpeningTrialBalance`,
   `validateOpeningBalance`, `activateAccounting`, `closePreCutoverPeriods`.
4. **Routes**: `x+/accounting+/activation.tsx` (loader + intent action),
   `activation.import.tsx` (CSV TB path).
5. **UI**: activation wizard components under `accounting/ui/Activation/`.
6. **seed-company**: env-gated (`SEED_ACCOUNTING_ACTIVE`) activation block.
7. **Docs**: update accounting `AGENTS.md`; move spec changelog.
8. **Verify**: `pnpm --filter @carbon/erp typecheck`; `pnpm run lint`.

## Verification checkpoints

- After 1–3: erp typecheck green (casts compile).
- After 4–5: erp typecheck + lint green.
- After 6: seed-company references resolve (Deno function — spot check imports).
