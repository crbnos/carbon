# Dataset wipe: delete rows a unique index keys on a foreign key before the FK-nulling pass

## Context

- Re-applying a dataset (Settings → Demo Data, `db:seed:dev`) fails when an item has two or
  more price overrides of any scope.
- The scopes are two customers, a customer and a customer type, or one plus an all-customers
  override.
- The error is
  `duplicate key value violates unique constraint "customerItemPriceOverride_all_item_uq"`.
- `wipeCompanyBusinessData` (`packages/database/src/datasets/wipe.ts`) nulls `customerId` and
  `customerTypeId`. That turns each override into an all-customers override.
- The partial unique index `customerItemPriceOverride_all_item_uq` (migration
  `20260414120001`) allows one all-customers override per item and company, so the second
  row collides.
- `db:check:datasets` did not catch it: each dataset seeds one override.

## Sweep

The table lists every unique index on a wiped table that references a column the nulling
pass nulls. The sweep read the catalog of a database at main d7d4046c55, with the foreign key
query the pass runs. A predicate `fk IS NOT NULL` drops the row from the index when the pass
nulls the FK, so those indexes are safe.

| Index | Verdict |
|---|---|
| `customerItemPriceOverride_all_item_uq` (`fk IS NULL` predicate) | Fixed here |
| `peopleAssignment_person_day_key`, `peopleAbsence_person_day_key` (`COALESCE("shiftId", '')`) | Fixed here: one person on two shifts of one day |
| `jobMaterialScrap_idempotencyKey_key` (`NULLS NOT DISTINCT`, `trackedEntityId`) | Fixed here: one scrap of two lots |
| `planningAction_natural_key_idx` | Already deleted before the pass |
| `inspectionDocument_part_model_key` | Not fixed. It breaks only if the pass nulls `rootInspectionDocumentId` before `modelUploadId`; the catalog order today is the reverse |
| `customerContractLaborRate_key` | Not fixed: `customerContractLaborRate_subject_check` fails first (a CHECK, not an index) |
| `projectBillableItem_ledger_key` | Not fixed: `projectBillableItem_source_check` fails first (a CHECK, not an index) |
| 12 indexes with an `fk IS NOT NULL` predicate | Safe |

No unique index on a preserved table references a nulled column.

## Approach

- `UNIQUE_INDEX_TABLES` beside `PARENT_CHECK_TABLES`, read by the same pre-delete loop.
- `customerItemPriceOverrideBreak` cascades from its override. Nothing references the other
  three tables.
- Satellite seeds a second override on SAT-1000, so `db:check:datasets` re-applies over two.
- Rules: `packages/database/AGENTS.md`, `.claude/rules/conventions-database.md`,
  `.claude/rules/onboarding-company-templates.md`.

## Tasks

- [x] `wipe.ts`: `UNIQUE_INDEX_TABLES` with one-line reasons, read by the pre-delete loop.
- [x] Satellite: a second override on SAT-1000.
- [x] `wipe-unique-tables.test.ts`: one database case per table and override scope, in the
  `metric-company.test.ts` harness (skips without `SUPABASE_DB_URL`).
- [x] Docs.
- [ ] Run the database test, the drift check and `db:seed:dev` against a local database.
