# Reimbursements as a First-Class Carbon Document

> Status: draft
> Author: Brad Barbin + Claude
> Date: 2026-09-23
> Research: `.ai/research/2026-09-22-sap-grade-ap-ar-document-model.md` (§ employee expense /
> reimbursement across SAP, NetSuite, Oracle Fusion, Dynamics 365) + the Rillet API survey and
> sandbox probe of 2026-09-23.
> Sibling spec: `.ai/specs/2026-09-23-memo-external-gl-representation.md` (credit documents).
> Related rules: `.claude/rules/ramp-integration.md`, `.claude/rules/accounting-sync-handlers.md`.

> **Open questions in this spec were resolved AUTONOMOUSLY** (codebase precedent → research
> consensus → recommendation) because the spec was requested as part of a batch. Every such
> resolution is marked **Autonomous** in Open Questions and is awaiting veto. Several touch
> Ask-First territory (new table, new module surface, new edge function) — those are flagged
> explicitly and must be confirmed before implementation begins.

## TLDR

Carbon has no reimbursement document. An employee reimbursement arrives from Ramp and is
stored as a **`purchaseInvoice` with a synthetic "Employee" supplier**
(`resolveEmployeeSupplier`, `packages/ee/src/ramp/lib/suppliers.ts:235`) — overloading the
vendor-bill document and the AP trade control account for something that is neither. Every ERP
surveyed models this as a **distinct document settling to a segregated employee-payable
control account**. This spec makes `reimbursement` a first-class Carbon document with its own
lines, posting path, control account, and provider representation — and closes the payout gap,
which is now closeable because Rillet shipped `POST /reimbursements/{id}/payments`.

## Problem Statement

### 1. The document is overloaded

`ramp-sync-reimbursement.ts` resolves an employee to a **supplier** named
`"<First> <Last> (<email>)"`, tagged with an auto-created `"Employee"` `supplierType`, then
writes an ordinary `purchaseInvoice`. Consequences:

- **The vendor master is polluted** with one supplier row per employee.
- **AP aging and vendor reporting are wrong** — employee payables are commingled with trade
  payables in the same control account, so "what we owe suppliers" is overstated.
- The reimbursement's semantics (who incurred it, which expense lines, approval, payout rail)
  are not modelled at all — only an invoice with a strange vendor.
- There is no reimbursement UI; it appears in the purchase-invoice list.

### 2. Every surveyed ERP segregates this

From the research: SAP and D365 both map a worker to a vendor **but post to a separate
reconciliation/control account**; NetSuite and Oracle Fusion use a distinct expense-report
document. The consistent pattern is *distinct document + segregated employee-payable
population*. Carbon has **neither**: the `employee` `AccountingEntityType` is declared but
unimplemented, and there is no employee-payable account default.

Corroborating evidence from the provider side: **Rillet's default chart of accounts already
ships `21340 "Employee Reimbursements Payable"`** (observed in the sandbox on 2026-09-23), and
Rillet models reimbursements as a first-class object (`/reimbursements`) distinct from
`/bills`. Carbon's Rillet bill syncer already special-cases employee-supplier bills to route
them there (`providers/rillet/entities/bill.ts:611,664`) — a workaround that exists precisely
because the Carbon-side document is the wrong shape.

### 3. The payout could not be recorded — but now can

Carbon's Rillet payment syncer parks a reimbursement payout as
`UNSUPPORTED_REIMBURSEMENT_PAYMENT` (`providers/rillet/entities/payment.ts:444-452`) on the
grounds that *"Rillet has no reimbursement-payment endpoint yet."* **That is now stale.** The
2026-09-23 API survey confirmed `POST /reimbursements/{id}/payments`
(`{amount, date, account_code}`) exists, with `GET` and `DELETE` siblings. The gap is closeable
in this work.

## Proposed Solution

A first-class `reimbursement` document, its own posting path to a segregated control account,
and per-provider representation.

### Imported, then editable — never hand-created

**Carbon never *creates* a reimbursement by hand** — it records something that happened in the
spend tool, so hand-entering one would invent a transaction with no counterpart. There is no
create form and no `new` route.

**But an imported reimbursement IS editable in Carbon while it is Draft**, header and coding
lines both, including adding and removing lines. The full model — import as Draft instead of
auto-posting, the two-mode detail/edit surface, the line editor, the running total, and
first-class provider attribution (the Ramp **logo**, the external id, and an "imported from
RAMP" Activity entry) — is specified once in
**`.ai/specs/2026-09-23-editable-imported-spend-documents.md`** and applies here identically.
This spec owns the reimbursement data model; that one owns the shared shape.

`reimbursementLine` must therefore mirror `chargeLine` exactly (`accountId`, `costCenterId`,
`projectId`, `description`, `amount`, `sequence`) so one line-editor component serves both.

### Data model

Two new tables, following Carbon conventions (composite PK, `companyId`, audit columns,
`id('prefix')`), modelled on `charge` / `chargeLine` — which is the closest existing shape
(a party-less, account-coded, line-carrying document posted by an edge function).

```sql
CREATE TABLE "reimbursement" (
    "id" TEXT NOT NULL DEFAULT id('reimb'),
    "reimbursementId" TEXT NOT NULL,              -- readable, per-company sequence REIMB-%{yyyy}-%{mm}-
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,                   -- the payee (employee.id)
    "status" "reimbursementStatus" NOT NULL DEFAULT 'Draft',  -- Draft|Posted|Voided
    "reimbursementDate" DATE NOT NULL,
    "postingDate" DATE,
    "currencyCode" TEXT NOT NULL,
    "exchangeRate" NUMERIC NOT NULL DEFAULT 1,
    "amount" NUMERIC NOT NULL CHECK ("amount" > 0),
    "payableAccountId" TEXT,                      -- resolved at posting; null while Draft
    "reference" TEXT,
    "notes" TEXT,
    "journalId" TEXT,
    "postedAt" TIMESTAMP WITH TIME ZONE,
    "postedBy" TEXT REFERENCES "user"("id"),
    "voidedAt" TIMESTAMP WITH TIME ZONE,
    "voidedBy" TEXT REFERENCES "user"("id"),
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "reimbursement_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "reimbursement_reimbursementId_key" UNIQUE ("reimbursementId", "companyId"),
    CONSTRAINT "reimbursement_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "reimbursementLine" (
    "id" TEXT NOT NULL DEFAULT id('reimbl'),
    "reimbursementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "amount" NUMERIC NOT NULL,
    "description" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "reimbursementLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "reimbursementLine_parent_fkey" FOREIGN KEY ("reimbursementId", "companyId")
      REFERENCES "reimbursement"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
```

Plus one account default, following the newest precedent
(`20260908142501_returns-module.sql`: `TEXT REFERENCES "account"("id")`, **nullable by
design** with a runtime fallback):

```sql
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "employeeReimbursementsPayableAccount" TEXT
  REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Runtime falls back to the AP trade account when unset, so an upgrading company keeps working;
seeding an "Employee Reimbursements Payable" account for existing company groups follows the
`salesReturnsAccount` seeding precedent in the same migration.

### Posting

A new `post-reimbursement` edge function, modelled directly on `post-charge`
(one Kysely transaction, tenant-scoped `FOR UPDATE` first read, period resolution with
lock-shift, `Draft → Posted` with `journalId`, `Posted → Voided` reversal):

| Type | Journal |
|---|---|
| **Post** | each line's `accountId` **debited** (its class); **employee-payable credited** for the total |
| **Void** | mirror reversal, dimensions copied |

New `journalEntrySourceType` value `Reimbursement`, with `POSTING_POLICY`
`representation: "document"`, `family: "ap"`, `backingEntityType: "reimbursement"`,
`defaultEnabled: false`. Cost-center and project dimensions write `journalLineDimension` rows
exactly as `post-charge` does.

### Payout

A reimbursement is settled by the existing **payment** machinery rather than a bespoke payout:
`invoiceSettlement` already generalises its target (`targetSalesInvoiceId` XOR
`targetPurchaseInvoiceId` XOR `targetMemoId`) and gains `targetReimbursementId`. This reuses
posting, FX, and void handling rather than forking a second settlement dialect.

### Provider representation (per-provider, as with credits)

| Provider | Reimbursement | Payout |
|---|---|---|
| **Rillet** | native `POST /reimbursements` (already wired — the bill syncer's employee special-case moves here and becomes the primary path) | **`POST /reimbursements/{id}/payments`** — closes `UNSUPPORTED_REIMBURSEMENT_PAYMENT` |
| **QBO** | `Bill` against an employee **Vendor** (QBO has no native reimbursement object) | `BillPayment` |
| **Xero** | `ACCPAY` invoice against an employee **Contact** | `Payment` |

QBO and Xero keep an employee-as-vendor representation **on the provider side only** — which
is what SAP and D365 also do — but Carbon's own document and control account stay segregated,
which is the part that is wrong today.

### Ramp inbound

`ramp-sync-reimbursement.ts` creates a **`reimbursement`** (resolving Ramp's user to a Carbon
`employee`) instead of a purchaseInvoice + synthetic supplier. `resolveEmployeeSupplier` is
retained only for the provider-side vendor mapping on QBO/Xero.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Document shape | New `reimbursement` + `reimbursementLine` tables | Research consensus: a distinct document everywhere. Overloading `purchaseInvoice` is the defect. Modelled on `charge`/`chargeLine`, the closest existing shape. |
| Payee | Carbon **`employee`**, not a synthetic supplier | Removes vendor-master pollution. Employee-as-vendor survives only as a provider-side mapping for QBO/Xero. |
| Control account | New `accountDefault.employeeReimbursementsPayableAccount`, **nullable with AP fallback** | Segregates employee payables from trade AP (the research's core point). Nullable-with-fallback matches the newest precedent so upgrades don't break. |
| Account FK | `REFERENCES "account"("id")` | Current convention (`salesReturnsAccount`, 2026-09-08); `accountNumber` is legacy. |
| Posting | New `post-reimbursement` edge function | Mirrors `post-charge` exactly; keeps posting in the privileged edge path with the rest. |
| Payout | Reuse `payment` + `invoiceSettlement` with a new `targetReimbursementId` | Avoids forking a second settlement dialect; inherits FX, void and period handling. |
| Provider representation | Per-provider: Rillet native; QBO/Xero employee-vendor bill | Only Rillet has a native object. Mirrors the credit spec's per-provider reality. |
| Rillet payout | Implement `POST /reimbursements/{id}/payments` | The endpoint now exists; `UNSUPPORTED_REIMBURSEMENT_PAYMENT` is stale. |
| Authoring | **Never created by hand; editable after import.** No create form and no `new` route, but header + lines ARE editable while Draft | A reimbursement records something that happened in Ramp, so creating one would invent a transaction. Editing an imported one is a different thing: it is how Carbon improves coding it owns (cost centers, projects). Shared model: `2026-09-23-editable-imported-spend-documents.md`. |
| Line shape | Mirror `chargeLine` exactly | One line-editor component serves charges and reimbursements; divergence would fork it. |
| Approval workflow | **Out of scope v1** | Ramp (or the provider) owns approval today; Carbon's `document-approvals` spec is the right home if it moves in-house later. |
| Existing employee-supplier invoices | **No backfill** — left as purchaseInvoices | A backfill would rewrite posted history. New reimbursements use the new document; the old rows remain readable. |
| Multi-tenancy (heuristic 1) | Composite PK `("id","companyId")`, `id('reimb')` default, `companyId` FK | Carbon convention. |
| RLS (heuristic 3) | SELECT/INSERT/UPDATE/DELETE gated on **invoicing** permissions, mirroring `charge` | Reimbursements live in the invoicing module. |
| Permission scoping (heuristic 4) | `invoicing_view` / `invoicing_update` | Same as `charge`. |
| Form pattern (heuristic 5) | `ValidatedForm` + zod validator + route action | Carbon convention. |
| Module layout (heuristic 6) | `apps/erp/app/modules/invoicing/` — `ui/Reimbursement/`, functions in the existing `invoicing.service.ts` / `.models.ts` | A reimbursement is an invoicing document, not a new domain; no new module. |
| Backward compatibility (heuristic 7) | Additive tables, additive nullable account default, additive enum values | No existing behaviour changes until the entity is enabled. |

## API / Service Changes

- `invoicing.service.ts` / `invoicing.models.ts` — `getReimbursement(s)` readers, plus
  `updateReimbursement` (header) and `upsertReimbursementLines` / `deleteReimbursementLine`,
  all refusing a non-Draft parent. **No create validator and no `new` route** — the Ramp sync
  is the only thing that brings a reimbursement into existence. Line writes are multi-row, so
  the Kysely client is built in a `.server` helper and passed in from the route action.
- `post-reimbursement` edge function + `config.toml` entry (`verify_jwt = true`), with a pure
  `build-reimbursement-journal.ts` mirroring `build-charge-journal.ts`.
- `packages/ee/src/accounting` — `reimbursement` `AccountingEntityType`, syncers for the three
  providers, and the Rillet payout call.
- `ramp-sync-reimbursement.ts` — creates a `reimbursement`, resolving Ramp's user to an
  `employee`.

## UI Changes

- **Navigation: a `Reimbursements` entry under Accounts Payable**, after `Charges`
  (`ui/useInvoicingSubmodules.tsx`). The AP section is Payables / Purchase Invoices /
  Vendor Credits / Charges; a reimbursement is an employee payable, so AP is where a user
  looks for it.
  This is also the visible symptom of the overload being fixed: until the object exists there
  is nothing to link to, and reimbursements sit **inside the Purchase Invoices list** mixed
  with real vendor bills.
- `apps/erp/app/modules/invoicing/ui/Reimbursement/` — `ReimbursementsTable`,
  `ReimbursementStatus`, and the **shared line editor** (the same component charges use).
  No create form. Cloned from the `Charge` components per the copy-precedent convention.
- Routes `x+/invoicing+/reimbursements*.tsx` — list, a detail surface with read and edit
  modes, a **Post** action for Draft rows and a **Void** action for Posted rows. No `new`
  route. The detail header carries the **SOURCE** badge (Ramp logo + external id) and an
  Activity entry. `path.to.reimbursements` / `path.to.reimbursement(id)` follow the `charges`
  precedent, which gains the same treatment.
- Accounting settings gains the Employee Reimbursements Payable account picker.

## Acceptance Criteria

- [ ] Creating a reimbursement for an employee with two expense lines (500 travel, 120 meals)
      and posting it produces ONE journal: debits 500 and 120 to the line accounts, credits 620
      to the employee-payable account; the row flips to `Posted` with `journalId` set.
- [ ] With `employeeReimbursementsPayableAccount` unset, the same post falls back to the AP
      trade account and still balances — an upgrading company is never blocked.
- [ ] Posting with a line carrying a `costCenterId` writes the matching `journalLineDimension`
      rows; a cost center with no active dimension refuses to post (mirroring `post-charge`).
- [ ] Voiding a Posted reimbursement writes a balanced reversal and flips it to `Voided`;
      re-voiding returns the stored journal id without a second reversal.
- [ ] A Ramp reimbursement syncs into Carbon as a **`reimbursement`** row (not a
      `purchaseInvoice`) with no synthetic "Employee" supplier created, and lands **Draft**.
- [ ] Its detail page shows a SOURCE field with the **Ramp logo**, the provider name and the
      external id, plus an Activity entry "Reimbursement imported from Ramp".
- [ ] An imported Draft reimbursement can be edited: header fields, an existing line's
      account/amount/description/cost center/project, and `+ Add line item` adds a second
      coding line with the running total updating as amounts change.
- [ ] A **Posted** reimbursement is not editable.
- [ ] With Rillet connected, a posted reimbursement creates a Rillet `/reimbursements` record,
      and paying it in Carbon issues `POST /reimbursements/{id}/payments` — the operation closes
      `Completed`, **not** `UNSUPPORTED_REIMBURSEMENT_PAYMENT`.
- [ ] With QBO connected, the same reimbursement creates a `Bill` against the employee vendor.
- [ ] A `Reimbursements` entry appears under **Accounts Payable** in the invoicing nav
      (after Vendor Credits) and opens the reimbursements list.
- [ ] A reimbursement no longer appears in the **Purchase Invoices** list — the two documents
      are separate everywhere in the UI.
- [ ] An employee's reimbursements do **not** appear in supplier/AP aging reports.
- [ ] Existing employee-supplier `purchaseInvoice` rows still load and post unchanged.
- [ ] `pnpm run generate:types` after the migration, then
      `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee` and
      `pnpm run test` are green; `pnpm db:check:datasets` and `pnpm db:check:backups` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **New table + new edge function + Ramp rework is Ask-First territory** | High | Autonomous resolutions are flagged; implementation must not start before explicit confirmation. |
| Two representations of reimbursement coexist during rollout (old employee-supplier bills, new reimbursements) | Med | Deliberate — no backfill. Old rows stay valid; reporting must union them until they age out. Documented in the rule. |
| Segregating the control account changes AP balances for companies that already reimburse via employee-suppliers | Med | Only affects NEW reimbursements; the account default is nullable with an AP fallback so nothing moves unless the customer sets it. |
| QBO/Xero still need an employee vendor, so vendor-master pollution persists provider-side | Low | Accepted — SAP and D365 do the same; the Carbon-side master stays clean, which is the part we control. |
| Rillet's reimbursement-payment endpoint is documented but unexercised by Carbon | Med | Probe it on the sandbox (the same key/flow used for the 2026-09-23 journal probe) before shipping the payout path. |
| `employee` vs `user` identity confusion when resolving a Ramp user | Med | Resolve through the existing employee/user relationship (`.claude/rules/user-employee-job-relationships.md`); fail visibly when no employee exists rather than inventing one. |

## Open Questions

> Resolved **autonomously** (batch request). Each awaits veto; the Ask-First ones must be
> confirmed before implementation.

- [x] **New document, or keep overloading `purchaseInvoice`?** — **Autonomous:** New
      `reimbursement` + `reimbursementLine`. Research consensus is a distinct document; the
      overload is the defect being fixed. **(Ask-First: new tables.)**
- [x] **Who is the payee — employee or supplier?** — **Autonomous:** The Carbon `employee`.
      Employee-as-vendor survives only as a provider-side mapping for QBO/Xero, which is what
      SAP and D365 do.
- [x] **Segregated control account?** — **Autonomous:** Yes —
      `accountDefault.employeeReimbursementsPayableAccount`, nullable with AP fallback. Every
      surveyed ERP segregates; Rillet's own default CoA ships `21340 Employee Reimbursements
      Payable`.
- [x] **How is the payout modelled?** — **Autonomous:** Reuse `payment` + `invoiceSettlement`
      with a new `targetReimbursementId`, rather than a bespoke payout document.
- [x] **Provider representation?** — **Autonomous:** Per-provider — Rillet native
      `/reimbursements` (+ its new payments endpoint); QBO/Xero an employee-vendor bill. Only
      Rillet has a native object.
- [x] **Backfill existing employee-supplier invoices?** — **Autonomous:** No. A backfill would
      rewrite posted history; old rows remain readable and new ones use the new document.
- [x] **Approval workflow in scope?** — **Autonomous:** No, out of scope for v1 — Ramp or the
      provider owns approval today.
- [x] **New module?** — **Autonomous:** No. Reimbursements live in the existing `invoicing`
      module (`ui/Reimbursement/`, functions in `invoicing.service.ts`), per the "a feature is
      not automatically a module" convention.

## Changelog

- 2026-09-23: Reversed the "read and sync only" narrowing after reviewing Rillet's UI.
  Reimbursements are still never hand-created, but an imported one IS editable while Draft —
  header and lines. The shared editing model, line editor and provider attribution moved to
  `.ai/specs/2026-09-23-editable-imported-spend-documents.md`; `reimbursementLine` must mirror
  `chargeLine` so one editor serves both.
- 2026-09-23: Created. Open questions resolved autonomously as part of a batch spec request;
  awaiting veto. Grounded in the 2026-09-22 ERP research plus the 2026-09-23 Rillet API survey
  and sandbox probe (which refuted Carbon's "no reimbursement-payment endpoint" assertion and
  found `21340 Employee Reimbursements Payable` in Rillet's default chart of accounts).
