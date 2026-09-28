# Rename card transactions to charges

Date: 2026-09-22. Branch: `rillet-ramp-accounting-provider`.

The Ramp-fed `cardTransaction` / `cardTransactionLine` subsystem is renamed to
`charge` / `chargeLine` across the database, the edge function, the ERP module,
the EE accounting-sync engine, the jobs, and the docs. The accounting-sync
engine already names this entity `charge` (`TABLE_TO_ENTITY_MAP`,
`reconcile-executor`, the provider `charge.ts` adapters), so this converges the
storage and UI on the name the engine already uses.

Assumption (from Brad): the two tables hold no rows anywhere. The migration
refuses to run if that is ever false.

## Naming map

| Before | After |
|---|---|
| table `cardTransaction` / `cardTransactionLine` | `charge` / `chargeLine` |
| `cardTransaction.cardTransactionId` (readable id) | `charge.chargeId` |
| `cardTransactionLine.cardTransactionId` (FK) | `chargeLine.chargeId` |
| enums `cardTransactionType` / `cardTransactionStatus` | `chargeType` / `chargeStatus` (values unchanged) |
| enum label `'Card Transaction'` on `journalEntrySourceType`, `journalLineDocumentType` | `'Charge'` |
| sequence `table = 'cardTransaction'`, name `Card Transaction`, prefix `CARD-` | `'charge'`, `Charge`, `CHG-` |
| trigger fns `check_card_transaction_*`, `lock_card_transaction_line_parent` | `check_charge_*`, `lock_charge_line_parent` |
| `externalIntegrationMapping.entityType = 'cardTransaction'` (Ramp) | `'charge'` |
| `eventSystemSubscription.table = 'cardTransaction'` | `'charge'` |
| edge fn `post-card-transaction` | `post-charge` |
| routes `/x/invoicing/card-transactions[/:id[/void]]` | `/x/invoicing/charges[/:id[/void]]` |
| `path.to.cardTransaction(s)` / `cardTransactionVoid` | `path.to.charge(s)` / `chargeVoid` |
| UI `CardTransactionsTable`, `CardTransactionStatus` | `ChargesTable`, `ChargeStatus` |
| `getCardTransaction(s)` | `getCharge(s)` |
| `isChargeBackedCardTransaction` | `isDocBackedCharge` |
| `normalizeRampCardTransactionAmount` | `normalizeRampTransactionAmount` (Ramp's wire object is still a transaction) |
| every other `*CardTransaction*` identifier | `*Charge*` |

Kept as-is: `RampTransaction` and the other Ramp wire types (Ramp's own
vocabulary), the `ramp-sync-card*.ts` file names, `card-charge-source.ts`,
column names `cardAccountId` / `cardHolderName` / `cardLast4` (they describe the
card, not the document), permission scope `invoicing_*`, the Ramp metadata key
`pullTransactions`. Historical records under `.ai/runs`, `.ai/research`,
`.ai/specs`, `.ai/plans` and the two applied migrations are not edited.

## Tasks

- [x] 1. Migration `20260922195151_rename-card-transactions-to-charges.sql`: emptiness guard, drop the old tables/functions/enums, recreate as `charge`/`chargeLine` from zero, rename the two journal enum labels, rewrite the sequence / mapping / subscription rows, re-attach the event trigger.
- [x] 2. `git mv` the edge function dir + files, the ERP UI dir + files, the four route files, the service test, and the SQL integrity test.
- [x] 3. Mechanical rename over every non-generated tracked file (code, config.toml, rules, AGENTS.md, lessons, `.ai/docs`), then the three post-fixes (`normalizeRampTransactionAmount`, `isDocBackedCharge`, `CHG-` prefix).
- [x] 4. Boot the DB (`crbn migrate`), `pnpm run generate:types`, `pnpm run generate:swagger`, `pnpm run generate:mcp`, `pnpm db:check:backups -- --stage` for the manifest.
- [x] 5. `pnpm lingui:extract`, then `/translate` for the new msgids.
- [x] 6. Verify: typecheck `erp`, `@carbon/ee`, `@carbon/jobs`, `@carbon/database`; biome; vitest for ee/jobs/erp scoped to the touched files; `deno task test` in `functions/`; the SQL integrity test via `run-local-accounting-check.ts`.
- [x] 7. Hand-review every user-visible string the rename touched (lesson: word-boundary renames corrupt copy), then browser-check `/x/invoicing/charges`.
- [x] 8. Update `.claude/rules/ramp-integration.md`, `accounting-sync-handlers.md`, `AGENTS.md`, `packages/ee/AGENTS.md` wording where the rename left a sentence wrong.
