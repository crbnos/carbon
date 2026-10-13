# Memo External-GL Representation — Credit Memos & Vendor Credits Reach the Ledger

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-09-23
> Research:
> - `.ai/research/2026-09-22-sap-grade-ap-ar-document-model.md` (SAP / NetSuite / Oracle
>   Fusion / Dynamics 365 AP-AR document model, employee payables, GR-IR, spend-tool pattern)
> - Xero, QBO and Rillet API surveys to primary sources (2026-09-23)
> - **Rillet sandbox probe (2026-09-23)** — empirical, see "Provider capability evidence"
> Extends: `.ai/specs/implemented/2026-08-05-accounting-document-representation.md`
> ("a provider document reproduces its Carbon posting journal").
> Builds on: `.ai/specs/implemented/memo-refactor-plan.md` (the `memo` table, four
> party x direction combos).
> Related rules: `.claude/rules/accounting-sync-handlers.md`.
> Sibling specs (separate, planned): first-class **Reimbursements**; credit **Allocation UX**.

## TLDR

Carbon authors credit/debit memos as first-class documents (`memo` table, posted by
`post-memo`), and the financial credit of a **purchase return or RMA is one of those memos**
(`purchaseReturnOrderCreditLine.memoId -> memo`). But `Credit Memo` and `Debit Memo` carry
`backingEntityType: null` in `POSTING_POLICY`, so their journals park as `DOC_SYNC_DISABLED`
and **their amounts never reach Xero, QBO or Rillet at all**. Because Carbon is the system of
record for inventory, a return's inventory leg and its credit leg must reach the ledger
together or nothing ties out — so this is a tie-out requirement, not a convenience. This spec
pushes memos as **native provider credit documents on all three providers, both sides**,
plus their applications, behind two new party-scoped posting-sync families. It also fixes a
latent family-misclassification bug that would otherwise ship live.

## Problem Statement

### 1. Memo amounts never reach the external ledger

`post-memo-transaction.ts:379` posts a journal with `sourceType` `Credit Memo` or
`Debit Memo`. Both `POSTING_POLICY` rows (`packages/ee/src/accounting/core/models.ts`) are
`representation: "document"` with **`backingEntityType: null`**, so `decideDocumentFamily`
(`core/posting.ts`) returns `DOC_SYNC_DISABLED` — *"has no document representation yet …
so its amounts have NOT reached the external GL."* Every customer credit and vendor credit
Carbon posts is **silently absent from the customer's books of record**.

### 2. Returns and RMAs make this a tie-out requirement

A purchase return's credit is issued as **one AP memo plus per-line
`purchaseReturnOrderCreditLine` rows** (`purchasing.service.ts:4020` — *"Issue supplier
credit: one AP memo + per-line purchaseReturnOrderCreditLine"*), FK'd to `memo("id")`; sales
returns / RMAs mirror it via `salesReturnOrderCreditLine`.

**Carbon is the system of record for inventory.** A return moves inventory *and* creates the
party credit. The inventory leg is unambiguously Carbon's and already reaches the GL (the
`Purchase Return Shipment` / `Sales Return Receipt` journals). If the credit leg is instead
raised by hand in the provider, the two legs are disconnected and the inventory / GR-IR
clearing never ties — the same class of defect as an unpushed bill leaving GR-IR uncleared.
So return-originated credits **must** push. This is what rules out "manage credits in your
accounting provider" as the answer, and it is what makes the AR side load-bearing (RMAs
create customer credit memos).

(The `Purchase Return` / `Sales Return` `POSTING_POLICY` rows are **vestigial** — nothing
posts them; the physical movements post as `Purchase Return Shipment` / `Sales Return
Receipt`, both `representation: "journal"`.)

### 3. A latent family-misclassification bug

`post-memo-transaction.ts:379` derives the source type from **direction alone**:

```ts
sourceType: memo.direction === "Credit" ? "Credit Memo" : "Debit Memo"
```

`POSTING_POLICY` maps `Credit Memo -> family "ar"` and `Debit Memo -> family "ap"`, but `memo`
supports all four combos (`customerId` XOR `supplierId`, CHECK-enforced, x `direction`):

| Party + direction | Meaning | sourceType | Family today | Correct? |
|---|---|---|---|---|
| Customer + Credit | customer credit memo | Credit Memo | ar | yes |
| Supplier + Debit | vendor credit | Debit Memo | ap | yes |
| **Supplier + Credit** | we owe the supplier more | Credit Memo | **ar** | **no** |
| **Customer + Debit** | customer owes more | Debit Memo | **ap** | **no** |

Invisible today only because nothing syncs. Giving memos a representation makes it live, so it
must be fixed in the same change.

## Provider capability evidence

Verified against primary sources on 2026-09-23; the Rillet rows are **empirically probed**
against `sandbox.api.rillet.com`.

| | Customer credit (AR) | Vendor credit (AP) | Journal to AR/AP control account |
|---|---|---|---|
| **Xero** | `CreditNotes` `ACCRECCREDIT` — `AccountCode` + `Quantity: 1` + `UnitAmount`, **no ItemCode needed** (Xero's own canonical example) | `CreditNotes` `ACCPAYCREDIT`, same shape | **REJECTED (400)** — system accounts (AR, AP, retained earnings) and bank accounts cannot be used in manual journals; `ManualJournalLine` has **no Contact field** |
| **QBO** | `CreditMemo` accepts **only** `SalesItemLine`/`GroupLine`; an item-less line has its **`Amount` silently ignored** → requires an `ItemRef`, and `ItemAccountRef` is invoice-only so the GL account comes from the item | `VendorCredit` + `AccountBasedExpenseLineDetail.AccountRef` — clean | Supported and properly attributed (`Entity` **required** on an AR line), applyable via `Payment.Line.LinkedTxn` |
| **Rillet** | `/credit-memos` requires `product_id` + `quantity` + `amount_per_unit`; no account-coded AR line variant exists anywhere in the API | `/vendor-credits` + `line_items[].account_code` — clean | **Accepted (200) but `related_entity` is SILENTLY DROPPED** — see probe below |

### Rillet sandbox probe (empirical, 2026-09-23)

Two journal entries were posted and then deleted (`204`):

- `POST /journal-entries` crediting **AR control `11200`** with
  `related_entity: {type: "CUSTOMER"}` → **200 OK**.
- `POST /journal-entries` debiting **AP control `21200`** with
  `related_entity: {type: "VENDOR"}` → **200 OK**.
- **`GET` on both returned NO `related_entity` field** — and the `JournalEntry` *response*
  schema **does** declare `related_entity`. So Rillet accepts the field and discards it.

**Consequence:** a Rillet memo-as-journal is GL-correct but **attributed to nobody** and not
applyable, which means Rillet's AR subledger would stop reconciling to its own control
account (the control balance moves with no corresponding subledger document). That is an
accounting break, not a limitation — so **Rillet AR must be a document**, which forces the
synthetic-product path.

Incidental finding, recorded for the Reimbursements spec: Rillet's default chart of accounts
already contains **`21340` "Employee Reimbursements Payable"** — the segregated employee
control account the research says every surveyed ERP maintains.

## Proposed Solution

### Native credit documents on all three providers, both sides

| | Customer credit (`creditMemo`) | Vendor credit (`vendorCredit`) |
|---|---|---|
| **Xero** | `CreditNotes` `ACCRECCREDIT`, account-coded line | `CreditNotes` `ACCPAYCREDIT`, account-coded line |
| **QBO** | `CreditMemo` + **credit-reason item** | `VendorCredit` + `AccountRef` |
| **Rillet** | `/credit-memos` + **credit-reason item** | `/vendor-credits` + `account_code` |

Every cell is a native credit document the customer's accountant recognises, and every one is
applyable in the provider. Journals are **not** used: impossible on Xero, and reconciliation-
breaking on Rillet.

### The credit-reason item resolver (QBO + Rillet)

QBO and Rillet both refuse an account-coded AR credit line, and both bind the GL account to a
product/item instead. One shared resolver serves both:

- Keyed by the Carbon **`account.id`** of the memo's `reasonAccount`.
- Lazily creates a provider-side **QBO `Service` item** (`IncomeAccountRef` = the mapped
  account) or **Rillet product** (`account_code` = the mapped account; `account_code` is a
  *required* field on `ProductRequest`, so a Rillet product *is* a GL binding).
- Tracked in `externalIntegrationMapping` under `entityType: "creditReasonItem"` — one row
  per (company, provider, account).

**This is a provider-side artifact only.** There is no new Carbon `itemType`, no Carbon `item`
row, and nothing visible in Carbon's UI — GL-mapping placeholders must never leak into item
lists, BOMs, inventory or MRP. This is the same pattern the Ramp integration already uses,
where `pushChartOfAccounts` and `pushCostCenters` create provider-side coding objects keyed
by `account.id` and tracked in `externalIntegrationMapping` with no Carbon-side entity.

The only place it is visible is the customer's own Products & Services list (QBO) / product
list (Rillet); items are named after their reason account and marked Carbon-managed.

### Families, resolution and scope

1. **Two new party-scoped posting-sync families** — `creditMemo` (any **customer** memo) and
   `vendorCredit` (any **supplier** memo), each `documents | journals | none`. This decouples
   memo sync from the invoice/bill gate: a company can run `ap: none` (bills handed to a spend
   tool) while still sending vendor credits to the GL from Carbon.
2. **Per-record family resolution** — the journal's `sourceType` does not encode party, so the
   family is resolved per record from the memo's party, reusing the mechanism `Payment` already
   uses (`policy.family === "per-line" ? args.paymentFamily : policy.family`,
   `core/posting.ts:299`). No `journalEntrySourceType` enum migration.
3. **Two accounting entity types** — `creditMemo` and `vendorCredit`, 1:1 with the families, so
   one party resolver yields both and Sync Activity reads per side.
4. **Applications are pushed** — all three providers expose allocation mechanisms; Carbon owns
   `invoiceSettlement` and therefore owns the application.
5. **Default both families to `none`** — opt-in, go-forward.
6. **v1 covers the two reducer combos** (customer + Credit, supplier + Debit) — the RMA and
   purchase-return cases. The two **increasers** remain parked with an explicit reason: they
   have no safe representation (QBO's `TotalAmt` is read-only and system-calculated, Rillet
   floors quantities non-negative, Xero negatives are UNVERIFIED) and they are the rare combos.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Whether to sync at all | **Yes — required** | Carbon is the system of record for inventory; a return's inventory leg already reaches the GL, so its credit leg must too or nothing ties out. "Manage credits in your provider" was considered and rejected for exactly this. |
| Representation | **Native credit documents, all three providers, both sides** | Journals are impossible on Xero (400 on AR/AP system accounts) and reconciliation-breaking on Rillet (`related_entity` silently dropped, empirically proven). Documents are the only representation correct everywhere. |
| QBO AR line | `CreditMemo` + credit-reason **Service item** | `CreditMemo` cannot carry an account-coded line and an item-less line's `Amount` is *silently ignored*. A `JournalEntry` would work on QBO, but the resolver is needed for Rillet anyway, so a real credit document everywhere is worth the marginal cost. |
| Rillet AR line | `/credit-memos` + credit-reason **product** | No account-coded AR line exists anywhere in Rillet's API; `ProductRequest.account_code` is required, so a product is a GL binding. The journal alternative breaks subledger reconciliation. |
| Credit-reason item | **Provider-side artifact only**, keyed by `account.id`, tracked as `externalIntegrationMapping` `entityType: "creditReasonItem"` | No new Carbon `itemType` and no Carbon `item` row — GL placeholders must not leak into item lists, BOMs, inventory or MRP. Mirrors the Ramp coding-object pattern. |
| Family model | Two **party-scoped** families: `creditMemo`, `vendorCredit` | Decouples memo sync from the invoice/bill gate — `ap: none` no longer silently kills vendor credits. Party-scoped leaves no combo orphaned. |
| Family resolution | Per-record by party, reusing the `per-line` mechanism | `sourceType` cannot encode party; `Payment` already generalized exactly this. Avoids an enum migration on a production-critical table. |
| Accounting entity types | **Two**: `creditMemo`, `vendorCredit` | 1:1 with the families, so one party resolver yields both; Sync Activity reads per side. |
| Applications | Pushed, mirroring `payment`'s constraints (single settlement; multi-settlement and cross-currency park with a reason) | An unapplied credit leaves provider aging wrong and double-apply reachable from the provider UI. Reuses payment's rule set rather than forking a second settlement dialect. |
| Increasers | **Deferred from v1**, parked with an explicit reason | No safe representation: QBO `TotalAmt` read-only, Rillet non-negative quantities, Xero negatives UNVERIFIED. Rare combos; the families/resolver built here are what a later implementation extends. |
| Rollout default | Both families default to **`none`** (opt-in; `syncFromDate` on first enable) | A never-synced family has no correct backlog: accountants have already hand-booked those credits, so pushing history would double-count. |
| Returns | No return-specific code path | A return's credit *is* a memo; returns inherit the fix. |
| Vestigial `Purchase Return` / `Sales Return` rows | Retain, mark non-syncable, document as superseded | Nothing posts them. Removing a Postgres enum value requires recreating the type — not worth the risk. |
| Multi-tenancy (heuristic 1) | No new tables | Mapping rides `externalIntegrationMapping`. Noted: `memo`'s PK is single-column `id` with `UNIQUE ("memoId","companyId")` — same deviation as `item`; do not add a composite FK to it. |
| Service shape (heuristic 2) | Syncers extend `BaseEntitySyncer`; no new `*.service.ts` | Existing accounting-sync architecture; all work in `packages/ee/src/accounting`. |
| RLS (heuristic 3) | N/A — no new tables | Nothing beyond existing `memo` RLS. |
| Permission scoping (heuristic 4) | `settings_update` for the family selectors | Matches the existing integration settings route. |
| Form pattern (heuristic 5) | Extend `PostingSyncSettings.tsx` via the existing `ValidatedForm` + `postingSyncSettingsValidator` | No new form pattern. |
| Module layout (heuristic 6) | `providers/{xero,quickbooks-online,rillet}/entities/{credit-memo,vendor-credit}.ts` (6 files) + a shared credit-reason-item resolver | Mirrors `payment.ts` / `bill.ts`; kebab-case per convention. |
| Backward compatibility (heuristic 7) | Additive settings keys with `.default("none")`; additive enum values | Stored fragments lacking the keys resolve to `none`, so no existing install changes behaviour on upgrade. |

## Data Model Changes

**No new tables and no SQL migration.** All changes are TypeScript-level schema and policy.

1. `PostingSyncStoredSchema.families` (`core/models.ts`) gains two keys:

```ts
families: z
  .object({
    ar: PostingSyncFamilyModeSchema.default("documents"),
    ap: PostingSyncFamilyModeSchema.default("documents"),
    creditMemo: PostingSyncFamilyModeSchema.default("none"),
    vendorCredit: PostingSyncFamilyModeSchema.default("none")
  })
  .default({ ar: "documents", ap: "documents", creditMemo: "none", vendorCredit: "none" })
```

2. `POSTING_POLICY` — `Credit Memo` and `Debit Memo` become per-party resolved:

```ts
"Credit Memo": {
  representation: "document",
  family: "per-party",             // resolves to creditMemo | vendorCredit by the memo's party
  backingEntityType: "per-party",  // resolves to the matching entity type
  defaultEnabled: false,
  defaultGranularity: "individual"
},
"Debit Memo": { /* identical */ }
```

3. `AccountingEntityType` gains `"creditMemo"` and `"vendorCredit"`, each with an
   `ENTITY_DEFINITIONS` entry (labels "Credit Memos" / "Vendor Credits"; `creditMemo`
   `dependsOn: ['customer','invoice']`, `vendorCredit` `dependsOn: ['vendor','bill']`; both
   `push-to-accounting`, `owner: "carbon"`), added to each provider's carbon-owned/push-only
   list (`RILLET_PUSH_ONLY_ENTITIES`, `XERO_CARBON_OWNED_ENTITIES`, `QBO_CARBON_OWNED_ENTITIES`).

4. `PostingSyncDocumentSyncFlags` gains `creditMemoEnabled` / `vendorCreditEnabled` so
   `decideDocumentFamily` can mark a memo journal `DOC_BACKED` once its side's document sync
   is on.

5. `externalIntegrationMapping` gains a new `entityType` value **`creditReasonItem`** (no
   schema change — the column is free-form): Carbon `account.id` → provider item/product id.

6. Event subscriptions: the `memo` table added to `REQUIRED_SYNC_SUBSCRIPTIONS` for all three
   providers (INSERT/UPDATE). **Wrinkle:** `TABLE_TO_ENTITY_MAP` (`events/sync-tables.ts`)
   maps a table to exactly ONE entity type, but `memo` now serves two — the entry must resolve
   per row by party. `subscriptions-mapping.test.ts` must be extended accordingly.

## API / Service Changes

- **`core/posting.ts`** — `getJournalPostingPolicyDecision` gains a
  `memoParty?: "customer" | "supplier" | null` input (mirroring `paymentFamily`);
  `decideDocumentFamily` resolves the per-party family and backing entity type.
- **`core/models.ts`** — schema, policy and entity definitions above.
- **Shared credit-reason-item resolver** (`core/credit-reason-item.ts`) —
  `resolveCreditReasonItem(provider, companyId, accountId)`: mapping-first, else create
  provider-side, else fail the item with a clear reason. Used by the QBO and Rillet
  credit-memo syncers only; Xero does not need it.
- **Provider clients** —
  Xero: credit-note create (`POST`/`PUT /CreditNotes`, created directly as `AUTHORISED` so it
  is allocatable) + `PUT /CreditNotes/{id}/Allocations`.
  QBO: `CreditMemo` + `VendorCredit` create, `Item` create (Service), and application via
  `Payment.Line.LinkedTxn` / `BillPayment.Line.LinkedTxn`.
  Rillet: `createCreditMemo` / `createVendorCredit` / `createProduct` +
  `POST /{credit-memos|vendor-credits}/{id}/applications`.
- **Six syncers** — extend `BaseEntitySyncer`; `mapToRemote` builds the credit from the memo
  header plus its `reasonAccount`; a second step pushes `invoiceSettlement` applications. Each
  syncer's `shouldSync` asserts its own party.
- **Reconciliation** — the outbound sweep's candidate query gains posted memos (subject to the
  family's `syncFromDate`), so a lost event becomes staleness, not permanent loss.

### Provider-specific implementation notes (from the API surveys)

- **Xero:** create and allocate are **two separate calls** — Xero explicitly forbids both in
  one. Allocation is `PUT` and **additive** (per-allocation `DELETE` to unallocate); the credit
  note must be `AUTHORISED` to be allocatable. `Contact` must send **only** `ContactID` —
  other contact fields mutate the contact record and delete `ContactPersons`. `ACCPAYCREDIT`
  has no `Reference` field; carry the Carbon id in `CreditNoteNumber`. `Idempotency-Key`
  expires after **6 minutes** — a transient-network guard only; job-level idempotency remains
  the mapping row.
- **QBO:** `?requestid=` (≤50 chars) is the idempotency mechanism; `minorversion=75` is the
  only supported version. `BillPayment` requires `PayType` **and a bank account even for a
  zero-cash credit application**. `ExchangeRate` is **home-per-foreign — the inverse of
  Carbon's convention** (`.claude/rules/numeric-precision.md`); invert at the boundary. The
  `AutoApplyCredit` company preference can apply credits without us asking.
- **Rillet:** AR apply is a **full reconcile** (send the complete application set or omitted
  entries are deleted); AP apply takes **no `application_date`**. `fields` (dimensions) are
  `{field_id, field_value_id}` **UUID pairs** from `GET /fields`. `GET /products` cannot filter
  on `external_references`, so the credit-reason-item mapping must be read from
  `externalIntegrationMapping`, never by querying Rillet. **`related_entity` on a journal entry
  is silently dropped** — never rely on it.

## UI Changes

- **`PostingSyncSettings.tsx`** — two new family selectors ("Credit Memos", "Vendor Credits"),
  each `documents | journals | none`, defaulting to `none`, with copy stating that enabling
  pushes credits **from the enable date forward** and that history needs an explicit backfill.
- **Sync Activity** — rows appear under `entityType: "creditMemo"` / `"vendorCredit"`, so the
  tab groups the two sides separately.
- No changes to the memo authoring UI (`ui/Memo/`, `x+/credits+/`) — the credit **allocation
  UX** is a separate spec.

## Acceptance Criteria

- [ ] With both families at their `none` default, posting any memo records an `Excluded` /
      `FAMILY_OFF` operation and pushes nothing — an existing install upgrading changes no
      external ledger.
- [ ] With `vendorCredit: "documents"` on a **Rillet** sandbox, posting a supplier+Debit memo
      (amount 100, mapped reason account) issues one `POST /vendor-credits` whose single line
      carries `account_code` = the mapped account and `amount` = 100; the operation closes
      `Completed` with the Rillet id in `externalId`.
- [ ] That supplier memo applied to one open bill issues
      `POST /vendor-credits/{id}/applications` with `{bill_id, amount}` matching the
      `invoiceSettlement` row, and `remaining_amount` drops accordingly.
- [ ] With `creditMemo: "documents"` on **Rillet**, posting a customer+Credit memo lazily
      creates ONE credit-reason product bound to the reason account's `account_code`, records
      it in `externalIntegrationMapping` as `creditReasonItem`, and issues a
      `POST /credit-memos` referencing it with `quantity: 1`. A second memo on the same reason
      account **reuses** the mapped product (no duplicate created).
- [ ] With `creditMemo: "documents"` on **QBO**, the same memo creates a Service `Item` whose
      `IncomeAccountRef` is the mapped account and a `CreditMemo` line referencing it whose
      `Amount` is non-zero in the provider (proving the ItemRef trap is avoided).
- [ ] With either family on **Xero**, the credit note is created directly as `AUTHORISED` with
      an `AccountCode` line and `Quantity: 1`, followed by a **separate** `PUT .../Allocations`
      call, and `Contact` carries `ContactID` only.
- [ ] A customer memo is gated by `creditMemo` and a supplier memo by `vendorCredit`
      **regardless of direction** — specifically a supplier+Credit memo is NOT gated by
      `families.ar`; covered by a unit test over `getJournalPostingPolicyDecision` for all four
      combos.
- [ ] A memo whose document sync is enabled has its own journal marked `DOC_BACKED` and NOT
      pushed — no double-post.
- [ ] Posting a supplier memo while `ap: "none"` and `vendorCredit: "documents"` still pushes
      the vendor credit — proving the families are decoupled from the invoice/bill gate.
- [ ] An **increaser** memo records a terminal operation with an explicit "not supported in v1"
      reason — never a silent drop and never a malformed push.
- [ ] Issuing a supplier credit from a **purchase return order**, and a customer credit from a
      **sales return / RMA**, each produce the corresponding provider credit document with no
      return-specific code path.
- [ ] `subscriptions-mapping.test.ts` passes with the `memo` table subscribed and both entity
      types mapped and registered, including the party-resolved table mapping.
- [ ] `pnpm --filter @carbon/ee test` and `pnpm exec turbo run typecheck --filter=@carbon/ee`
      are green.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Credit-reason items pollute the customer's QBO/Rillet product list | Med | Accepted and deliberate. Bounded (one per reason account actually used — typically 3–10, not one per memo), created lazily, named after the reason account and marked Carbon-managed. |
| A reason account's mapping is missing, so the resolver creates a duplicate or fails mid-push | Med | Resolver is mapping-first and idempotent; `GET /products` cannot filter by `external_references`, so `externalIntegrationMapping` is the ONLY lookup. Covered by the reuse acceptance test. |
| Xero's 6-minute idempotency window mistaken for durable dedupe | Med | Job-level idempotency stays the `externalIntegrationMapping` row, as for every other entity. |
| QBO `ExchangeRate` inversion silently corrupts FX | Med | Invert at the boundary; unit-test a non-base-currency memo in both directions. |
| Xero `Contact` over-posting mutates the contact record and deletes ContactPersons | Med | Send `ContactID` only; assert in the syncer test. |
| Rillet AR apply is a full reconcile — an additive POST deletes omitted applications | Med | Always send the complete application set derived from `invoiceSettlement`; assert with a two-invoice test. |
| QBO `AutoApplyCredit` applies credits behind our back, diverging from Carbon | Med | Read the preference during converge and surface a warning when it is on. |
| Enabling a family pushes an unexpected backlog into a live ledger | Med | Default `none`; `syncFromDate` on first enable; UI copy states the go-forward rule. |
| QBO `BillPayment` requires a bank account even for a zero-cash application | Low | Resolve from the company's configured AP bank account; fail with a clear reason if unset. |
| `memo`'s single-column PK tempts a composite FK | Low | Recorded above; mapping is by `id` only. |

## Open Questions

> Resolved with the user on 2026-09-23 **before** this spec was written. This section is the
> audit trail, not a to-do list. Several were revised as API evidence arrived — the reversals
> are recorded deliberately.

- [x] **How should a memo journal resolve its AR/AP family?** — **Answer:** Two new
      party-scoped families, `creditMemo` (any customer memo) and `vendorCredit` (any supplier
      memo). Separate families give **independent control**, so `ap: "none"` no longer silently
      kills vendor credits. Family selected per record by party — no enum migration.
- [x] **Do the families cover the whole party, or only the credit direction?** — **Answer:**
      Whole party. Anything supplier is `vendorCredit`; anything customer is `creditMemo`.
- [x] **One `memo` entity type, or two?** — **Answer (revised):** Two — `creditMemo` and
      `vendorCredit`, 1:1 with the families, so Sync Activity reads per side.
- [x] **Do we push a memo's applications, or just the credit document?** — **Answer:** Push
      applications; all three providers expose allocation mechanisms. Mirror `payment`'s
      constraints.
- [x] **How are the increaser combos represented?** — **Answer (revised):** Initially "use
      negatives"; the API surveys **refuted** that (QBO `TotalAmt` read-only/system-calculated,
      Rillet non-negative quantities, Xero UNVERIFIED). Final: **deferred from v1**, parked
      with an explicit reason.
- [x] **Should we sync as journal entries instead of documents?** — **Answer:** Considered and
      **rejected**. Xero returns 400 for any manual journal to AR/AP system accounts, and a
      sandbox probe proved Rillet **silently drops `related_entity`**, which would break
      AR-subledger-to-control-account reconciliation. Documents everywhere.
- [x] **Should customers just manage credits in their accounting provider instead?** —
      **Answer:** No. Carbon is the **system of record for inventory**, and a purchase return /
      RMA creates both the inventory movement and the credit. Splitting the legs across systems
      means nothing ties out. Return-originated credits must push, which makes the AR side
      load-bearing too.
- [x] **Uniform representation, or per-provider?** — **Answer (revised):** Uniform **documents**
      everywhere. A per-provider mix (journals on QBO/Rillet AR) was the interim answer until
      the Rillet probe showed its journal path is reconciliation-breaking.
- [x] **QBO AR — Service item or JournalEntry?** — **Answer:** Service item, via the shared
      credit-reason-item resolver. A JournalEntry would work on QBO, but the resolver is needed
      for Rillet regardless, and a real credit document is what the accountant expects.
- [x] **Is the credit-reason item a new class of Carbon item?** — **Answer:** No. It is a
      **provider-side artifact only**, keyed by `account.id` and tracked in
      `externalIntegrationMapping` as `creditReasonItem`. No new `itemType`, no Carbon `item`
      row — GL placeholders must never leak into item lists, BOMs, inventory or MRP. Mirrors the
      Ramp coding-object pattern.
- [x] **What happens to existing memos when this ships?** — **Answer:** Both families default
      to `none` (opt-in, go-forward via `syncFromDate`). Pushing history would double-count
      credits accountants have already hand-booked.
- [x] **Scope boundary** — **Answer:** This spec is the memo → external-GL representation.
      Returns and RMAs are covered for free via their `*CreditLine.memoId`. **Reimbursements as
      a first-class Carbon object** and **credit allocation UX** are separate specs.

## Changelog

- 2026-09-23: Rewritten around **native credit documents on all three providers** after a
  Rillet sandbox probe proved the journal path drops `related_entity`. Adds the shared
  credit-reason-item resolver (provider-side artifact only), and records the returns/RMA
  inventory-SoR argument as the reason syncing is required rather than optional.
- 2026-09-23: Interim per-provider journal/document matrix (superseded by the above).
- 2026-09-23: Journals-only rejected (Xero 400s on AR/AP system accounts); negatives rejected;
  increasers deferred; entity-type decision revised from one to two.
- 2026-09-23: Created. Open questions resolved with Brad before writing.
