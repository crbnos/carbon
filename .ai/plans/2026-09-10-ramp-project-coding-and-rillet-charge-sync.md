# Ramp project coding → accounting-provider charge sync

**Date:** 2026-09-10 · **Status:** Parts A + B implemented and unit/typecheck-verified (2026-09-10); Part C (sandbox verification) pending — needs a seeded company + Ramp/Rillet sandbox credentials on this worktree, and the OrbStack port-6379 Redis conflict resolved for the app servers · **Branch:** `feat/feat-ramp`

## Context

A customer runs both integrations: Ramp (card spend in) and Rillet (accounting
out). Their sales team charges cards against **projects**, and the project has
to reach Rillet. Two things came out of the 2026-09-10 meeting with Rillet and
the customer:

1. **Does the project actually flow?** Not today. Carbon pushes cost centers to
   Ramp as a custom "Cost Center" field, but the chain Ramp → Carbon → Rillet is
   broken at five independent points (below). Only the **GL account** coding
   round-trips (live-verified 2026-08-28); the cost center silently drops.
2. **Rillet's advice: sync payables as objects, not journal entries.** Bills
   already do (Carbon `purchaseInvoice` → Rillet bill). Card charges reach
   Rillet as an opaque `journal_entry` with no vendor and no receipt; Ramp
   reimbursements reach it as a *bill* to an employee-supplier rather than a
   Rillet *reimbursement*. Every provider Carbon supports has a native object
   for a card charge, and each one derives the same posting Carbon already
   books (debit expense lines, credit the card-liability account), so the
   switch carries no GL-drift risk and recovers the merchant, receipt and
   dimensions.

A third, UX, problem rode in with the first: salespeople tagging in Ramp see the
whole ~300-account chart. Carbon decides what it pushes, so the fix is to push
only what a card holder should ever code to.

The email to the customer is written **after** Part C verifies this end to end.

### Where the cost-center chain breaks (verified in code + Ramp OpenAPI)

| # | Where | Break |
|---|---|---|
| 1 | `packages/ee/src/ramp/lib/service.ts:680-693` `pushCostCenters` | Wrong wire keys. `POST /accounting/fields` wants the ERP id in **`id`** (we send `external_id`); `POST /accounting/field-options` wants **`field_id` = the field's `ramp_id` UUID** (we pass `field.id`, the ERP string) and option ids in **`id`** (we send `external_id`). Options were almost certainly never uploaded. |
| 2 | same | Not idempotent. `POST /field-options` is all-or-nothing and rejects existing options; `convergeRamp` re-runs it on every settings save, the throw is swallowed at `hooks.server.ts:49-56`, so cost centers added after install never reach Ramp; renames never PATCH; deletions never hide. |
| 3 | *(absent)* | No re-push path: not in `ramp-sync` (only `pushChartOfAccounts` at `ramp-sync.ts:1987`), no `costCenter` event trigger, no hook in `upsertCostCenter`. |
| 4 | `packages/jobs/src/inngest/functions/integrations/ramp-sync.ts:161-187` `codeSelections` | Matches `category_info.type === "COST_CENTER"`. The custom-field create body has **no `type`** (`ApiAccountingCustomFieldCreateParamsRequestBody`), so a custom field's selections come back typed `OTHER`. Never matches on the field's `external_id`. → `costCenterId` stays `null`. The `TODO(task-1)` at `:63` already suspected this. Zero tests cover it. |
| 5 | `packages/database/supabase/functions/post-card-transaction/index.ts:363-372` | Needs an active `CostCenter` `dimension` row per **companyGroup**; nothing seeds one for groups created after the `20260228024512` backfill. Missing row ⇒ `costCenterDimensionId = null` ⇒ tags silently skipped, posting succeeds. |

### Provider objects for card spend (verified against each API spec)

| | Charge | Refund/credit | Dimensions | Void | Receipt |
|---|---|---|---|---|---|
| **Rillet** | `POST /charges` — `vendor_id`, `credit_card_account_code`, `items[].account_code/amount/fields` | negative item amounts not schema-forbidden — **sandbox-gated** | `fields[]` (unlimited, auto-provisioned) | `DELETE /charges/{id}` | `POST /charges/{id}` multipart |
| **QBO** | `Purchase` with `PaymentType: "CreditCard"`, `AccountRef` = credit-card account, `EntityRef` = vendor, `Line[].AccountBasedExpenseLineDetail` | same entity, **`Credit: true`** ("If true, the CreditCard represents a Refund") | `ClassRef`/`DepartmentRef` via the 2-slot system | `?operation=delete` | `Attachable` |
| **Xero** | `BankTransactions` `Type: "SPEND"`, `BankAccount` = the `BankAccountType: CREDITCARD` account, `Contact`, `LineItems[].AccountCode` | `Type: "RECEIVE"` on the card account | `Tracking` (max 2 per line — the slot system) | POST `Status: "DELETED"` | `/BankTransactions/{id}/Attachments` |
| **Rillet reimbursement** | `POST /reimbursements` — `vendor_id` (employee), `items[]`, `reimbursement_date`, **`payable_account_code`** (caller supplies; Rillet does not derive) | — | `fields[]` | `DELETE` | `POST /reimbursements/{id}` multipart |

Rillet publishes **no reimbursement-payment path** (the `ReimbursementPaymentRequest` schema exists in the spec but no endpoint references it), so a Rillet reimbursement cannot be settled through the API today — see D8.

Carbon's outbound Ramp pushes (`pushPurchaseOrder`, `pushInvoiceDraftBill`) carry no GL-account coding, so pushing a reduced account list breaks nothing outbound.

### Decisions (rev 2 — recommendations, veto any)

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | The project field | A Carbon **cost center**, pushed as a custom field (id `carbon-cost-center`) whose `name` **and** `display_name` are the company group's **CostCenter `dimension.name`** (seeded "Cost Center"; this customer's is set to "Project" at setup). Renames re-converge hourly. Two fields, two lists: Ramp's native GL-account field carries expense accounts (D1b); this field carries cost centers. | The dimension name is the one place the customer already names this concept, and Carbon already uses it to create the Rillet Field — so Carbon, Ramp and Rillet show the same word with no new setting. Hard-coding "Project" would be wrong for a customer whose cost centers are departments or plants. |
| D1b | What card holders see in the account picker | **Push only Expense-class accounts + the mapped card-liability account (default).** Ramp's native GL-account field keeps Ramp's own label (not renameable via the API — only custom fields have `display_name`), but it now contains only expense accounts. Setting `codingAccountScope: "expense" \| "all"`, default **`expense`**; `all` for a customer who codes bills in Ramp. Already-pushed non-expense accounts on an existing install are PATCHed `visibility: HIDDEN` once. | Fewer pushed accounts is simpler than push-then-hide; outbound pushes don't need the rest. |
| D2 | Field required on transactions | **Not set from Carbon.** Customer sets it in Ramp. | `is_required_for` is create-only on the API and the field already exists for this customer; Ramp's UI exposes it directly. Goes in the email guidance. |
| D3 | Unknown cost center on read-back | **Fail the item as "uncoded"** (same as an unknown account), never drop the tag. | Silent drops are the bug being fixed; a failed sync surfaces in Ramp so the coder can fix it. |
| D5 | Which `cardTransactionType`s become provider objects | **`Charge` and `Credit`** (the two vendor-facing types that carry lines). `Payment` (bank → card statement payment), `Cashback` (Ramp rebate credited to the card) and `Repayment` (employee pays back personal spend) stay journal entries on every provider. Rillet `Credit` is **sandbox-gated** (negative items); QBO `Credit: true` and Xero `RECEIVE` are native. Policy is **per row**, never a blanket flip. | Charge/Credit are the spend and its reversal — vendor, receipt, dimensions. The other three are money movements with no vendor; a journal entry is their faithful representation and Rillet has no object for them. (QBO `CreditCardPayment` / Xero `BankTransfers` for `Payment` is a possible later phase.) |
| D6 | Vendor for the charge | Add nullable `cardTransaction.supplierId`; `ramp-sync` resolves the merchant to a Carbon **supplier** (mapping by Ramp `merchant_id` → case-insensitive name → auto-create with a "Card Merchant" `supplierType`), then the existing vendor syncers carry it to each provider. | Every provider object needs a vendor/contact; the merchant is the visibility Rillet asked for; it is exactly what the Ramp bill family already does via `resolveRampSupplier`. |
| D7 | Which providers get the charge syncer | **All three** — Rillet, QBO, Xero — one `charge` entity, three adapters cloned from each provider's bill syncer. Additive per-row `DOC_BACKED` carve-out (the `Inventory Adjustment` precedent at `core/posting.ts:173-184`), `charge` entity default **on**. QBO has no sandbox: its adapter ships **VERIFY-flagged** like its payment push. Already-synced journals are never re-planned (`reconcileJournal` skips covered rows). | Completeness; each provider's object is native and posts identically to Carbon's journal. |
| D8 | Rillet Reimbursement object | **In scope.** Route Employee-supplier purchase invoices to `POST /reimbursements` (`payable_account_code` = the AP control account from the posted journal), behind a Rillet provider switch `reimbursementRepresentation: "reimbursement" \| "bill"` defaulting to **`reimbursement`**. **Caveat:** Rillet has no reimbursement-payment endpoint (only `POST /bills/{id}/payments`; a `ReimbursementPaymentRequest` schema exists in their spec with no path), so a Ramp-paid reimbursement stays `UNPAID` in Rillet and Carbon's payment push parks it `Skipped` with a visible reason. The email asks Rillet (a) when that endpoint ships and (b) whether their UI can mark one paid meanwhile; if both are "no", flip the switch to `bill` for this customer. Xero/QBO reimbursements stay bills (that *is* their native shape). | Completeness; the object is what Rillet asked for; the payment gap is in Rillet's API and is surfaced, not hidden. |

Ask-first items inside these: new `AccountingEntityType` member (public contract), `cardTransaction` schema change, a new integration setting with a behaviour-changing default, supplier auto-creation for merchants.

---

## Part A — Make the project (cost center) round-trip

### A1. Pure coding module + read-back fix

- [x] Create `packages/ee/src/ramp/lib/coding.ts` (pure, browser-safe): `RAMP_COST_CENTER_FIELD_ID = "carbon-cost-center"`, `codeSelections(selections)` moved out of `ramp-sync.ts:161-187`. Match order per selection: `category_info.external_id === RAMP_COST_CENTER_FIELD_ID` → costCenterId; `type === "GL_ACCOUNT"` → accountId (keep the `category_info.type ?? type` read). Delete the `COST_CENTER` enum match and the `TODO(task-1)` at `ramp-sync.ts:63`.
- [x] Export from the `@carbon/ee/ramp.server` barrel and import in `ramp-sync.ts` at the four call sites (`:515`, `:532`, `:826`, `:1601`).
- [x] `buildTransactionLines` (`ramp-sync.ts:500-572`): after the account `.in()` check, verify every non-null `costCenterId` exists via one `.from("costCenter").select("id").in("id", ids).eq("companyId", …)`; unknown → `{ error: "Line is coded to a cost center Carbon doesn't recognize — recode the transaction" }` (D3). Same in the bill (`:779+`) and reimbursement (`:1601+`) builders.
- [x] Tests: `packages/ee/src/ramp/lib/__tests__/coding.test.ts` — custom field typed `OTHER` with `category_info.external_id = carbon-cost-center` resolves; native `COST_CENTER` selection without the Carbon external id does **not**; GL account still resolves; first-wins ordering.

Verify: `pnpm --filter @carbon/ee test -- coding`; `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs`.

### A2. Idempotent cost-center converge (fix breaks 1–2, D1)

- [x] `packages/ee/src/ramp/lib/client.ts`: add `listAccountingFields({ remote_id })` (`GET /developer/v1/accounting/fields`), `listAccountingFieldOptions({ field_remote_id })` (`GET /developer/v1/accounting/field-options`, paginated via `listPaginated`, schema `{ id, ramp_id, value, display_name, is_active, visibility }`), `patchAccountingField(rampId, body)`. Keep `postAccountingFields` / `postAccountingFieldOptions` / `patchAccountingFieldOption`.
- [x] Rewrite `pushCostCenters` (`service.ts:654-696`) as a converge:
  1. `ensureCostCenterField`: read the group's CostCenter `dimension.name` (A3 guarantees the row); list by `remote_id`; if absent `POST` with `{ id: RAMP_COST_CENTER_FIELD_ID, name: <dimension.name>, display_name: <dimension.name>, input_type: "SINGLE_CHOICE", is_splittable: true }` (POST is idempotent by `id`); if present and the name differs from the fingerprinted one Carbon last pushed, PATCH `name` + `display_name` (a Ramp-side rename by the customer survives until the Carbon dimension is renamed). Resolve `ramp_id`.
  2. Load Carbon `costCenter` rows (`id, name`) and existing `externalIntegrationMapping` rows `entityType: "costCenter"` (with `metadata.fingerprint`, mirror `upsertAccountMappings` at `service.ts:555-575`).
  3. Pure `diffCostCenterOptions(desired, remoteOptions, mappings)` → `{ toCreate, toRename, toHide, toShow }` (clone the shape of `diffChartOfAccounts`).
  4. Create new options in ≤500 batches with `{ id: costCenter.id, value: name }` against `field_id: ramp_id`; PATCH renames with `display_name` (the "available to all" key); PATCH `visibility: "HIDDEN"` for cost centers no longer in Carbon, `"VISIBLE"` for ones that reappear. Upsert mappings with fingerprint after each success.
- [x] Tests: `service.test.ts` — `diffCostCenterOptions` (new / renamed / removed / unchanged); `client.test.ts` pins the exact POST bodies (`id` not `external_id`; `field_id` = `ramp_id`; `display_name: "Project"`).

Verify: `pnpm --filter @carbon/ee test -- service client`.

### A3. Converge every sync + ensure the dimension exists (fix breaks 3, 5)

- [x] `service.ts`: `ensureCostCenterDimension(serviceRole, companyId)` — resolve `company.companyGroupId`; if no active `dimension` with `entityType = 'CostCenter'` exists for the group, insert `{ name: "Cost Center", entityType: "CostCenter", companyGroupId, createdBy: "system" }` (reuse on the `(name, companyGroupId)` conflict). Call it from `convergeRamp` before `pushCostCenters`.
- [x] `ramp-sync.ts`: add `step.run("ramp-cost-centers", …)` immediately after `ramp-chart-of-accounts` (`:1987`) calling `ensureCostCenterDimension` + `pushCostCenters`, wrapped in the same family-failure isolation. The hourly sweep now converges projects (≤1 h latency for a new project — the same guarantee accounts have).

### A4. Never drop a tag at posting (fix break 5, fail loudly)

- [x] `post-card-transaction/index.ts:363-372`: select the dimension with `.order("createdAt").limit(1)` instead of `.maybeSingle()` (two active rows currently throw). If any built line carries a `costCenterId` and no dimension resolved, **throw** `"Company group has no active Cost Center dimension — create one under Accounting → Dimensions"` (the sync reports it to Ramp as a failed sync; A3 makes it unreachable for installed integrations).
- [ ] ~~`post-card-transaction.test.ts`: add the missing-dimension case.~~ Not written: that file is a golden-master test of the pure journal builder only; the `serve` handler has no unit harness. The case is covered in Part C on the sandbox instead. `deno check` shows the same 11 pre-existing errors before and after the edit (none in the edited region).

### A5. Push only codable accounts (D1b)

- [x] `packages/ee/src/ramp/config.tsx` `RampSettingsSchema`: `codingAccountScope: z.enum(["expense", "all"]).default("expense")`, rendered as a select — "Expense accounts only (recommended for card coding)" / "All accounts (needed if you code bills in Ramp)". Add to `RampIntegrationMetadataSchema` in `lib/models.ts`.
- [x] `service.ts` `pushChartOfAccounts` (`:491-647`): pure `isCodableAccount(account, { scope, cardLiabilityAccountId })` → the desired set is `active && !isGroup && (scope === "all" || class === "Expense" || id === cardLiabilityAccountId)`. Accounts **outside** the desired set that already have a Ramp mapping are PATCHed `visibility: "HIDDEN"` (using the resolved `ramp_id`), accounts re-entering the set `"VISIBLE"`; visibility is part of the fingerprint so each PATCH happens once and a Ramp-side manual change survives until Carbon's rule changes.
- [x] Tests: `service.test.ts` — the pure rule (Expense in; Asset/Liability/Equity/Revenue out; card-liability always in; `"all"` → everything) and the hide/show diff.

Verify: `pnpm --filter @carbon/ee test -- service`; `pnpm exec turbo run typecheck --filter=erp` (settings form renders the new select).

### A6. Docs

- [x] `.claude/rules/ramp-integration.md`: rewrite the "Coding" paragraph (external-id match, cost-center validation), the converge section (idempotent field/options diff, `display_name: Project`, `ramp-cost-centers` sync step, dimension ensure), the settings list (`codingAccountScope`), and drop the `TODO(task-1)` bullet about cost-center type.
- [x] `.ai/lessons.md`: "A Ramp custom accounting field has no `type`; selections come back `OTHER` — match custom fields by `category_info.external_id`, never by the native type enum."

---

## Part B — Sync card charges (and Rillet reimbursements) as provider objects

### B1. Schema

- [x] `pnpm db:migrate:new ramp-card-transaction-supplier-and-event-trigger` (randomised HHMMSS): `ALTER TABLE "cardTransaction" ADD COLUMN IF NOT EXISTS "supplierId" TEXT REFERENCES "supplier"("id") ON DELETE SET NULL;` + index on `(companyId, supplierId)`; `SELECT attach_event_trigger('cardTransaction', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);` (copy of `20260807152238_payment-event-trigger.sql`; **no subscription backfill** — convergence owns it). Every statement guarded/idempotent.
- [x] `pnpm db:migrate` then `pnpm run generate:types`; commit `packages/database/src/types.ts`.

Verify: `pnpm db:check:datasets && pnpm db:check:backups` pass.

### B2. Resolve the merchant to a supplier (D6)

- [x] `service.ts`: add an `entityType` parameter to `resolveRampSupplier` (`:858-908`, default `"vendor"`), and a thin `resolveMerchantSupplier(serviceRole, db, companyId, merchant)` that calls it with `"merchant"` (Ramp `merchant_id`; distinct id space from bill vendors) and ensures/assigns a `"Card Merchant"` `supplierType` on create — mirror of `resolveEmployeeSupplier` (`:920+`).
- [x] `ramp-sync.ts` card family (`:2021-2101`): call it with `{ id: tx.merchant_id, name: tx.merchant_name }` when `merchant_name` is present; pass `supplierId` into `createAndPostTransaction` and the insert at `:616-637`. A missing merchant name leaves `supplierId` null (the charge syncers skip such rows with a visible reason — B5).
- [ ] ~~Tests: `service.test.ts` — merchant mapping precedence with a stubbed client.~~ Not written — needs Supabase + Kysely stubs for `resolveRampSupplier`; the precedence is exercised on the Ramp sandbox in Part C.

### B3. Engine: new `charge` entity with a per-row DOC_BACKED carve-out (D5, D7)

- [x] `packages/ee/src/accounting/core/types.ts:228-239`: add `"charge"` to `AccountingEntityType`. Follow the compiler through every `Record<AccountingEntityType, …>`.
- [x] `core/models.ts`: `ENTITY_DEFINITIONS.charge = { label: "Card Charges", type: "transaction", dependsOn: ["vendor"], supportedDirections: ["push-to-accounting"] }`; `DEFAULT_SYNC_CONFIG.entities.charge = { enabled: true, direction: "push-to-accounting", owner: "carbon" }`; add `charge` to **`SyncConfigSchema`** (`:695-713`, silent if missed). Leave `POSTING_POLICY["Card Transaction"]` as `representation: "journal"`.
- [x] `core/posting.ts`: extend `PostingSyncDocumentSyncFlags` with `chargeEnabled`; add `cardTransactionType?: "Charge" | "Credit" | "Payment" | "Cashback" | "Repayment" | null` to the policy input; in `getJournalPostingPolicyDecision` add, beside the inventory-adjustment carve-out (`:173-184`): `sourceType === "Card Transaction" && docSync.chargeEnabled && (cardTransactionType === "Charge" || cardTransactionType === "Credit")` → `{ kind: "exclude", reason: "DOC_BACKED", backingDocument: { entityType: "charge" } }`. The drain-time backstop `getPostingSyncSourceTypeSkipReason` (`:351-370`) must **not** skip `Card Transaction` wholesale — the decision core owns the per-row split.
- [x] `packages/jobs/.../integrations/reconcile-executor.ts`: `SNAPSHOT_TABLES.charge = { table: "cardTransaction", columns: "id, status, type, updatedAt" }`; add to `MAPPED_TYPES`; for `journalEntry` refs whose snapshot `sourceType = 'Card Transaction'`, one extra query `cardTransaction.select("journalId, type").in("journalId", ids)` to populate `cardTransactionType`; `docSync.chargeEnabled = syncConfig.entities.charge.enabled`. Mirror in `planJournalPostingOperation` (manual backfill) and `reconcile.ts` `ReconcileContext.docSync`.
- [x] `reconcile.ts`: `ReconcileEntityType += "charge"`; `case "charge": return reconcileDocument(input)` with `SWEPT_CHARGE_STATUSES = ["Posted"] as const` (+ `"Voided"` where the provider supports native void) added to `accounting-sync-operations.ts:1390-1404`; no `UNMAPPED_ACCOUNTS` re-drive in v1.
- [x] `accounting-outbound-sweep.ts`: widen `pageIds.table` (`:85`), `scanned.charges`, and a candidate block after `:312` copying the payment two-page (`createdAt` + `voidedAt`) pattern, gated on `provider.getSyncConfig("charge")?.enabled` and `type IN ('Charge','Credit')`.
- [x] `events/sync-tables.ts`: `cardTransaction: "charge"`. `core/subscriptions.ts`: `{ table: "cardTransaction", operations: ["INSERT", "UPDATE"] }` added to the common set (all three providers).
- [x] Tests: `core/posting-policy.test.ts` — Charge/Credit rows excluded DOC_BACKED, Payment row still pushes, charge sync off → pushes; `reconcile-golden.test.ts` — `describe("golden: charges")` cloned from the documents block (`:249-429`); `subscriptions-mapping.test.ts` passes once B5/B7 register all three syncers.

Verify: `pnpm --filter @carbon/ee test -- posting`, `pnpm --filter @carbon/jobs test -- reconcile subscriptions`, `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs`.

### B4. Shared costing loader

- [x] `core/document-costing.ts`: `loadCardTransactionCostingLines(db, { companyId, cardTransactionId })` cloned from `loadBillCostingLines` (`:91-295`): header from `cardTransaction` (`type`, `currencyCode`, `exchangeRate`, `postingDate ?? transactionDate`, `cardAccountId`, `amount`, `supplierId`, `merchantName`, `memo`), journal rows where `journalLine.documentType = 'Card Transaction'`, `documentId = cardTransactionId`, `journal.sourceType = 'Card Transaction'`, `status = 'Posted'`; drop the card-liability line by `accountId === cardAccountId` (not description sniffing); no `sourceItem`; dimensions via `loadJournalLineDimensions`; `toTransactionCurrencyLines` reused unchanged (same foreign-per-base convention). A `Credit` row's costing lines are credit-signed — the loader returns them debit-signed and the adapters decide the object shape.
- [x] Tests alongside the bill loader's.

### B5. Rillet adapter

- [x] `providers/rillet/models.ts`: `Rillet.ChargeItem` (`account_code`, `amount: MonetaryAmount`, `description?`, `fields?: ItemFieldRef[]`), `Rillet.Charge` (`id`, `vendor_id`, `items.min(1)`, `charge_date`, `credit_card_account_code`, `impact_date?`, `subsidiary_id?`, `external_references?`, `exchange_rate?`, `status?: UNPAID|PAID|PARTIALLY_PAID`, `updated_at?`), `RilletChargeCreate`.
- [x] `providers/rillet/provider.ts`: `createCharge(payload, idempotencyKey)` (`writeEntity`, `/charges`, envelope `charge`), `getCharge`, `deleteCharge` (404-tolerant), `uploadChargeDocument(id, file)` (multipart — confirm on sandbox); add `"charge"` to `RILLET_PUSH_ONLY_ENTITIES` (`:237`).
- [x] `providers/rillet/entities/charge.ts`: `RilletChargeSyncer extends RilletTransactionSyncer` cloned from `bill.ts`. `shouldSync`: push-only; `status === "Posted"`; `type IN ('Charge','Credit')`; `supplierId` present (else a **skip reason** "Card charge has no merchant supplier — stays a journal entry"). `isVoided` = `status === "Voided"`, `deleteRemote` = `deleteCharge`. `mapToRemote`: vendor via `supplierExternalId ?? ensureDependencySynced("vendor", supplierId)`, costing lines, `resolveLineDimensions`, `getAccountCodesById`; pure `mapCardTransactionToRilletCharge` → `{ vendor_id, credit_card_account_code: codes.get(cardAccountId), charge_date: transactionDate, impact_date: postingDate, items (negative amounts for Credit), subsidiary_id?, exchange_rate: toRilletExchangeRate(...), external_references: [carbon, carbon-company] }`; unmapped card or line account → structured `UNMAPPED_ACCOUNTS` Warning. `upsertRemote` create-only with `buildRilletIdempotencyKey({ operation: "charge", localId })`; then best-effort receipt upload from the `document` rows with `sourceDocumentId = cardTransaction.id` (never fails the op). **Credit rows are gated by a `RILLET_CHARGE_SUPPORTS_NEGATIVE_ITEMS` flag, flipped only after the sandbox accepts one** (otherwise Credit falls through to the journal entry — the policy carve-out reads the same flag).
- [x] `providers/rillet/index.ts`: `export * from "./entities/charge"` + `charge: RilletChargeSyncer` in the registry.
- [x] Tests (mapper + void tuple done; the `provider.test.ts` POST-body/Idempotency-Key case is NOT written — the create path is the same `writeEntity` the bill uses): `entities/__tests__/charge.test.ts` (pattern A — exact wire payload incl. FX, dimensions, unmapped warning, non-Charge type skipped, Credit sign); add `["charge", RilletChargeSyncer]` to the `describe.each` in `document-void.test.ts`; `provider.test.ts` POST body + `Idempotency-Key`.

### B6. Rillet reimbursement (D8)

- [x] `providers/rillet/models.ts` + `provider.ts`: `Rillet.Reimbursement` (`vendor_id`, `items`, `reimbursement_date`, `payable_account_code`, `impact_date?`, `subsidiary_id?`, `external_references?`, `exchange_rate?`, `status?`), `createReimbursement` / `getReimbursement` / `deleteReimbursement` / `uploadReimbursementDocument`.
- [x] `core/document-costing.ts` `loadBillCostingLines`: also return `payablesAccountId` (the AP control line it already identifies via `classifyAccountingPostingRole === "Payables"` and currently discards).
- [x] `providers/rillet/entities/bill.ts`: detect a reimbursement — the supplier's `supplierType.name === "Employee"` (set by `resolveEmployeeSupplier`) — and, when the provider setting `reimbursementRepresentation` (default `"reimbursement"`; `"bill"` keeps today's behaviour) says so, route `upsertRemote` to `createReimbursement` with `payable_account_code = codes.get(payablesAccountId)`; stamp the mapping `metadata.remoteKind = "reimbursement"` so `deleteRemote` calls `deleteReimbursement` and `fetchRemote` reads `/reimbursements/{id}`. Everything else (costing lines, dimensions, FX, idempotency key with `operation: "reimbursement"`) is shared.
- [x] `providers/rillet/entities/payment.ts` (parks as Warning `UNSUPPORTED_REIMBURSEMENT_PAYMENT` — a new sync error code — rather than Skipped: `pushRemotePayment` can only throw) `pushRemotePayment`: when the settled bill's mapping has `remoteKind === "reimbursement"`, park the op **Skipped** with reason "Rillet has no reimbursement-payment endpoint yet — the reimbursement stays UNPAID in Rillet" (and `listBillPaymentsUpdatedSince` ignores it). Revisit when Rillet ships the endpoint (`ReimbursementPaymentRequest` already exists in their spec).
- [ ] Tests: `bill.test.ts` `toRilletReimbursement` written; ~~`payment-push.test.ts` skip case, `document-void.test.ts` reimbursement delete~~ NOT written (both need the mapping-service stub extended for `getByEntity` metadata) — covered on the Rillet sandbox in Part C.

### B7. QBO and Xero adapters (D7)

- [x] **QBO** (void = Skipped + `TODO(charge-void)`; `DepartmentRef` header-level; `TxnDate` = posting date; `VERIFY`-flagged, no sandbox) `providers/quickbooks-online/entities/charge.ts` cloned from its bill syncer: `Purchase` with `PaymentType: "CreditCard"`, `AccountRef` = the card-liability account ref (`loadQboAccountRefsById`), `EntityRef: { value: vendorId, type: "Vendor" }`, `TxnDate`, `PrivateNote` = memo, `DocNumber` = `cardTransactionId`, `Line[].AccountBasedExpenseLineDetail` via the existing bill-only line builder (`buildQboBillLines`) + `ClassRef`/`DepartmentRef` from the dimension slots; **`Credit: true` for `Credit` rows**; `CurrencyRef` + reciprocal `ExchangeRate` as bills do; void = `?operation=delete`; attachment via `Attachable` best-effort. **VERIFY-flagged** (no QBO sandbox), same as its payment push. Register in the QBO registry.
- [x] **Xero** (`BankAccount: { Code }`; BANK-type preflight; void = `Status: DELETED` `VERIFY`-flagged; 22 tests) `providers/xero/entities/charge.ts` cloned from its bill syncer: `PUT /BankTransactions` with `Type: "SPEND"` (`"RECEIVE"` for `Credit`), `BankAccount: { AccountID }` = the card-liability account (**must be a Xero account of `BankAccountType: CREDITCARD`** — resolve via the account mapping and refuse with a structured Warning if the mapped account is not a bank-type account), `Contact` = the synced vendor, `Reference` = `cardTransactionId`, `LineItems[]` via `buildXeroBillLineItems` (`AccountCode`, `TaxType: "NONE"`, `Tracking` ≤2 from the slot system), `CurrencyRate` for FX, `LineAmountTypes: "NoTax"`; void = POST `Status: "DELETED"`; attachment via `/BankTransactions/{id}/Attachments` best-effort. Register in the Xero registry.
- [x] Both: `isVoided` / `deleteRemote` on the shared void path; `shouldSync` identical to Rillet's; `provider.ts` sync-config builders keep `charge` enabled (no longer force-disabled).
- [x] Tests: pattern-A mapper tests per provider (`Credit` flag / `RECEIVE`, dimension slots, FX); Xero `provider.test.ts` PUT body.

### B8. UI + docs

- [x] `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx:166-193`: `ENTITY_LABELS.charge = "Card Charges"`, `ENTITY_PATHS.charge` → `path.to.cardTransaction(id)`.
- [x] `.claude/rules/accounting-sync-handlers.md`: entity list, the per-row DOC_BACKED carve-out, `SWEPT_CHARGE_STATUSES`, the three charge adapters, the Rillet reimbursement routing + payment gap. `.claude/rules/ramp-integration.md`: `supplierId`, merchant resolution, event trigger. `.ai/specs/2026-08-20-ramp-transaction-sync.md`: note the representation change.

---

## Part C — Verification (before the email)

Unit/typecheck gates per task above, then:

- [ ] `pnpm run lint`; `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp --filter=@carbon/database`.
- [ ] **Ramp sandbox (client-credentials, `environment: sandbox`)**: rename the CostCenter dimension to "Project", save settings → `GET /accounting/fields?remote_id=carbon-cost-center` returns the field with `name`/`display_name: "Project"`; `GET /accounting/field-options?field_remote_id=carbon-cost-center` lists every Carbon cost center with `id` = Carbon id. Add a cost center in Carbon → fire `ramp-sync` → it appears. Rename → `display_name` updates. `GET /accounting/accounts` shows only Expense accounts + the card liability `VISIBLE`, the rest `HIDDEN`.
- [ ] Code a sandbox transaction to an expense account + a project, mark ready to sync, fire `ramp-sync`: `cardTransactionLine.costCenterId` set, `journalLineDimension` row present, `cardTransaction.supplierId` set to a "Card Merchant" supplier.
- [ ] **Rillet sandbox**: the drain creates `POST /charges` with `vendor_id`, `credit_card_account_code`, one item per line carrying `fields[]`, receipt attached; the `journalEntry` op for that journal records `Excluded / DOC_BACKED / backingDocument.entityType = charge`; Rillet's `/reports/journal-entries` for the day shows the charge posting on the expense account with the Field value; tie-out cell buckets it as `docBacked`. Void the card transaction → `DELETE /charges/{id}`, mapping `metadata.voided = true`. Attempt a `Credit` with negative items → record the result and set the flag accordingly. A Ramp reimbursement → `POST /reimbursements` with `payable_account_code`; its payment parks `Skipped` with the documented reason.
- [ ] **Xero sandbox**: `PUT /BankTransactions` SPEND against the CREDITCARD account with Tracking; `RECEIVE` for a Credit; DELETED on void.
- [ ] `Payment`/`Cashback`/`Repayment` card transactions still sync as journal entries (regression).
- [ ] Only then: write the customer/Rillet email from the verified flow (and raise the reimbursement-payment endpoint with Rillet).

## Out of scope / follow-ups

- `Payment`-type card transactions as QBO `CreditCardPayment` / Xero `BankTransfers` (a later phase; journal entries are faithful today); per-account visibility override; backfilling `supplierId` on historical card transactions (they stay as already-synced journal entries); a `costCenter` event trigger (hourly converge is the same guarantee accounts get); Rillet reimbursement payments (blocked on Rillet).
