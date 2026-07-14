# Master-Data Change Controls: Supplier Bank Details, Gated Bank Changes, Change Alerts

> Status: in-progress (all open questions resolved pre-writing)
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1051
> Parent: `.ai/specs/2026-07-03-public-company-readiness.md` (finding SD-6)
> Builds on: `.ai/specs/2026-07-04-document-approvals.md` (approvals engine extension, no-self-approval, SoD report)
> Audit coverage: rides `.ai/specs/2026-07-04-record-integrity-audit-hardening.md` (referenced, not duplicated here)

## TLDR

Carbon has **no supplier bank details anywhere** (verified by grep: `supplierPayment` carries payment terms, invoicing party, and currency only; the bank-rec spec adds *company* bank accounts only). When AP payment execution lands, unaudited vendor bank-detail changes become the #1 payment-fraud vector — so the control surface is built **now**, as the prerequisite. This spec adds (1) a **`supplierBankAccount`** table with row-versioned, never-live-edited records — sensitive values (account number, IBAN) stored via the Plaid spec's resolved secret-storage pattern (Vault, AES-GCM fallback) with plaintext last-four display columns; (2) a dedicated **`supplierBankChange`** approval document type on the existing engine (resolved, Brad 2026-07-04): every create/update/deactivate produces a *pending proposed-change row* that only goes live on approval by a different user whenever an enabled rule exists — no seeding, opt-in per program posture, with the SoD report flagging companies that have payments but no bank-change rule; (3) **change alerts** — notifications to accounting owners on any change to `accountDefault`, payment terms, tax configuration, or bank details, even where no approval rule gates them; and (4) a **verification-callback record** (`verifiedBy/At/method/notes`) — the call-back-the-vendor control is procedural, but the system records who verified and how, and resets verification on every detail change. Audit-log coverage for all these tables ships in the parallel record-integrity spec.

## Problem Statement

Readiness finding SD-6: `accountDefault` (the entire GL resolution layer), `paymentTerm`, tax codes/components, and counterparty tax data are editable by anyone with module update permission, silently. And the highest-risk master data doesn't exist yet: there is no place to store supplier bank details, which means the first AP-payment-execution feature would otherwise bolt them onto `supplierPayment` as live-editable columns — exactly the shape every BEC/vendor-impersonation fraud exploits (attacker phishes an AP clerk, edits the vendor's account number, next payment run pays the attacker). Controls that must exist *before* the data does:

- **Segregated change flow**: the person who keys a bank-detail change cannot be the person who approves it (extends the document-approvals engine and inherits its `enforceNoSelfApproval`).
- **No live edits**: an unapproved change must never be visible to any surface that selects a payment destination.
- **Verification trail**: banks and auditors expect a callback-to-known-number control; the system records the who/when/how.
- **Visibility without gates**: even companies that configure no rules get change alerts to accounting owners — detective where preventive is opt-in.

## Resolved Questions (answered before writing, 2026-07-04)

- [x] **Gate mechanism?** — **Dedicated `supplierBankChange` approval document type** on the existing engine (Brad, 2026-07-04). Not a generic "master-data change" type: bank details are the fraud surface that justifies a held-pending flow; `accountDefault`/terms/tax get alerts + audit only in v1.
- [x] **Seed a default enabled rule at migration?** — **No.** Program posture is opt-in (matches document-approvals resolution #3). Instead, the SoD conflict report gains a row: *company has payment activity and no enabled `supplierBankChange` rule*.
- [x] **Store full account numbers before payment execution exists?** — **Yes, from day one**, via the Plaid spec's resolved secret-storage interface (Vault-backed; app-layer AES-256-GCM fallback where Vault is absent). Re-collecting details from every supplier when payment execution lands is the expensive path, and the callback-verification control needs the full value at entry time. Full values are never returned to the client — masked last-four only.
- [x] **Are reads of decrypted values in scope?** — Only a server-side `getSupplierBankAccountSecret` exists (service role, no route exposes it); its first real consumer is the future payment-execution spec.

## Proposed Solution

### 1. `supplierBankAccount` — row-versioned, never live-edited

Every create, update, or deactivate produces a **new row** (`changeType` = `Create` / `Update` / `Deactivate`, `replacesId` → prior version). The row starts in `Pending Approval` when an enabled `supplierBankChange` rule exists, otherwise it activates immediately (opt-in posture). On approval: the pending row becomes `Active` (or executes the deactivation), the replaced row becomes `Inactive` with `effectiveTo` stamped — a complete effective-dated history with no UPDATE of business fields, ever. Rejection marks the row `Rejected`; the Active predecessor is untouched. Business-field immutability is structural: the table has **no UPDATE/DELETE RLS policies** (approvalRequest posture) — all status transitions run through service-role Kysely inside `approveRequest`/`rejectRequest`, and inserts are RLS-checked.

Sensitive-field storage (bank-rec `accountNumberLastFour` + Plaid `tokenRef` precedents):

| Field | Storage |
|---|---|
| Bank name, account holder name, country, currency | Plaintext columns |
| SWIFT/BIC, routing number (ABA/sort code) | Plaintext (public identifiers) |
| Account number, IBAN | `secretRef` JSONB (`{kind:"vault", secretId}` or `{kind:"aes", ciphertext, iv, tag}`) + plaintext `...LastFour` display column; shared `packages/ee`-adjacent secret helper reused from the Plaid token interface |

Verification is a record, not a gate: `verifiedBy`/`verifiedAt`/`verificationMethod` (`Callback` / `Bank Letter` / `Micro-deposit` / `Supplier Portal` / `Other`) + `verificationNotes`, settable post-activation by a user *other than the row's creator*, and **always null on a new version** — changing any detail resets verification. Payment surfaces can later distinguish verified from unverified destinations; v1 shows the badge.

### 2. `supplierBankChange` on the approvals engine

New `approvalDocumentType` value. Amount-less — matches the base tier exactly like the existing `supplier` and `qualityDocument` types (`shared.service.ts:167`). `approvalRequest.documentId` = the pending `supplierBankAccount` row id. The document-approvals spec's machinery applies wholesale: `createApprovalRequest` on propose, `ApprovalRequested` notification, approve/reject from the supplier page, requester withdraw (`canCancelRequest` → row `Rejected`), **no-self-approval enforced server-side** (`canApproveRequest` + `enforceNoSelfApproval`), escalation reminders via the daily cron. `approveRequest`/`rejectRequest` gain a `supplierBankChange` case with the guarded-transition pattern (`WHERE status = 'Pending Approval'`, throw → rollback).

### 3. Change alerts (detective, always on)

New `NotificationEvent.MasterDataChanged = "master-data-changed"` (topic: `General` — additive, no topic rename), dispatched via `trigger("notify", ...)` from the **service functions** that mutate: `accountDefault` (updateDefaultAccounts), `paymentTerm` upsert/delete, `supplierPayment` (terms/currency/invoicing-party changes), tax configuration (`taxCode`/`taxCodeComponent`, `supplierTax`/`customerTax` — post-tax-spec names per the multi-jurisdiction-tax spec), and every `supplierBankAccount` transition (proposed, approved, rejected, auto-activated-no-rule). Recipients — "accounting owners" resolved in order: (1) approvers + `defaultApproverId` of enabled `supplierBankChange` rules; (2) else approvers of enabled `journalEntry` rules; (3) else no notification — and that absence is exactly what the SoD report row surfaces. Payload names the actor, table, entity, and changed-field list (names only — never old/new values for masked fields). Service-layer dispatch means direct PostgREST edits bypass alerts; the backstop is the record-integrity spec's audit coverage of these same tables (its scope, not duplicated here).

### 4. SoD report + audit (deltas to sibling specs)

- Document-approvals SoD matrix (typed constant) gains two rows: **payment activity exists ∧ no enabled `supplierBankChange` rule** (payment activity = any `payment` row for the company); **supplier bank proposer permission (`purchasing_update`) ∧ `supplierBankChange` approver membership** — informational when `enforceNoSelfApproval` is on (runtime block is the mitigating control), violation when off.
- Record-integrity spec: `supplierBankAccount` joins its audit-coverage table list under the `supplier` entity (extension-style child, `entityIdColumn: supplierId`); `secretRef` joins `skipFields`. One-line addition there, referenced here.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Pending-change shape | Row versioning in `supplierBankAccount` itself (`status` + `changeType` + `replacesId`), not a separate staging table | One table = one history; effective dating falls out; payment surfaces filter `status='Active'` and are structurally incapable of seeing pending rows |
| 2 | Gate | Dedicated `supplierBankChange` document type, amount-less base tier | Resolved (Brad 2026-07-04); reuses tiers/groups/notifications/no-self-approval; `supplier` type is the exact precedent |
| 3 | Rule seeding | None; SoD report row instead | Resolved — program-wide opt-in posture (document-approvals #3); visibility over coercion |
| 4 | Sensitive storage | Full value in Vault/AES `secretRef` + plaintext last-four; SWIFT/routing plaintext | Plaid spec's resolved storage decision reused verbatim; bank-rec's `accountNumberLastFour` display precedent; masked-only storage would force supplier re-collection when payment execution lands |
| 5 | Immutability enforcement | No UPDATE/DELETE RLS policies; transitions via service-role Kysely only | "Never live-edited" must hold against PostgREST, not just the UI; `approvalRequest` already ships this posture |
| 6 | Verification | Recorded (`verifiedBy/At/method/notes`), not gating; reset on every new version; verifier ≠ creator | Callback control is procedural — the system's job is the trail (SD-6); reset prevents verified-status laundering through edits |
| 7 | Alerts transport | `trigger("notify")` from service functions, not a new DB-event handler type | Smallest change; MCP flows through services; PostgREST bypass is covered by audit (record-integrity spec), and a queue-side alert handler can be added later without contract change |
| 8 | Alert recipients | bank-change rule approvers → JE rule approvers → none (reported) | "Accounting owners" without a new settings surface; degradation is itself a reportable finding |
| 9 | No-rule behavior | Change auto-activates through the same versioned path, alert still fires | Byte-identical control data model whether gated or not; turning a rule on later gates the *next* change with zero migration |
| 10 | Multi-tenancy (H1) | Composite PK (`id`,`companyId`), `companyId` scoping everywhere, `id('sba')` | House convention |
| 11 | Service shape (H2) | New functions in `purchasing.service.ts` / models in `purchasing.models.ts` (supplier module owns supplier children); engine cases in `shared.service.ts`; `(client, ...) → {data, error}` | One service/models file per module — no new files |
| 12 | RLS (H3) | SELECT `purchasing_view`, INSERT `purchasing_update` via `has_company_permission`; no UPDATE/DELETE policies | See #5; matches engine posture |
| 13 | Permissions (H4) | Propose = `update: purchasing`; approve = `canApproveRequest` (engine); verification record = `update: purchasing` + verifier ≠ creator check | PO/supplier-approval precedent |
| 14 | Forms (H5) | `ValidatedForm` + zod `supplierBankAccountValidator`; masked inputs render last-four placeholders on update | House convention |
| 15 | Module layout (H6) | UI in `apps/erp/app/modules/purchasing/ui/Supplier/` (`SupplierBankAccounts.tsx`, `SupplierBankAccountForm.tsx`) alongside `SupplierPaymentForm` | Existing folder |
| 16 | Backward compat (H7) | Purely additive: new table, new enum value, new event; no rule ⇒ no behavior change to any existing flow | Nothing existing reads bank details (they don't exist) |

## Data Model Changes

One idempotent migration (`pnpm db:migrate:new supplier-bank-accounts`; enum ADD VALUE guarded, not consumed in-transaction per the `20260630093809` pattern), then `pnpm run generate:types`:

```sql
ALTER TYPE "approvalDocumentType" ADD VALUE IF NOT EXISTS 'supplierBankChange';

CREATE TYPE "supplierBankAccountStatus" AS ENUM ('Pending Approval', 'Active', 'Rejected', 'Inactive');
CREATE TYPE "supplierBankChangeType"    AS ENUM ('Create', 'Update', 'Deactivate');
CREATE TYPE "bankVerificationMethod"    AS ENUM ('Callback', 'Bank Letter', 'Micro-deposit', 'Supplier Portal', 'Other');

CREATE TABLE "supplierBankAccount" (
  "id" TEXT NOT NULL DEFAULT id('sba'),
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "status" "supplierBankAccountStatus" NOT NULL DEFAULT 'Pending Approval',
  "changeType" "supplierBankChangeType" NOT NULL DEFAULT 'Create',
  "replacesId" TEXT,                       -- prior version this row supersedes
  -- Non-sensitive details
  "bankName" TEXT NOT NULL,
  "accountHolderName" TEXT NOT NULL,
  "countryCode" TEXT,
  "currencyCode" TEXT,
  "swiftBic" TEXT,
  "routingNumber" TEXT,                    -- ABA / sort code: public identifiers
  -- Sensitive: secret refs (vault | aes per Plaid-spec storage decision) + masked display
  "accountNumberRef" JSONB,
  "accountNumberLastFour" TEXT,
  "ibanRef" JSONB,
  "ibanLastFour" TEXT,
  -- Effective dating (stamped by activation/supersession, service-role only)
  "effectiveFrom" TIMESTAMP WITH TIME ZONE,
  "effectiveTo" TIMESTAMP WITH TIME ZONE,
  -- Verification record (procedural callback control; reset = new version starts NULL)
  "verifiedBy" TEXT REFERENCES "user"("id"),
  "verifiedAt" TIMESTAMP WITH TIME ZONE,
  "verificationMethod" "bankVerificationMethod",
  "verificationNotes" TEXT,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "customFields" JSONB,
  CONSTRAINT "supplierBankAccount_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "supplierBankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplierBankAccount_replacesId_fkey" FOREIGN KEY ("replacesId", "companyId") REFERENCES "supplierBankAccount"("id", "companyId"),
  CONSTRAINT "supplierBankAccount_details_check" CHECK ("accountNumberRef" IS NOT NULL OR "ibanRef" IS NOT NULL OR "changeType" = 'Deactivate')
);

CREATE INDEX "supplierBankAccount_supplierId_idx" ON "supplierBankAccount" ("supplierId", "companyId");
CREATE INDEX "supplierBankAccount_status_idx" ON "supplierBankAccount" ("companyId", "status");
-- At most one in-flight pending change per supplier (serialize competing edits)
CREATE UNIQUE INDEX "supplierBankAccount_pending_idx" ON "supplierBankAccount" ("supplierId", "companyId")
  WHERE "status" = 'Pending Approval';

ALTER TABLE "supplierBankAccount" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplierBankAccount_SELECT" ON "supplierBankAccount" FOR SELECT
  USING (has_company_permission('purchasing_view', "companyId"));
CREATE POLICY "supplierBankAccount_INSERT" ON "supplierBankAccount" FOR INSERT
  WITH CHECK (has_company_permission('purchasing_update', "companyId"));
-- Deliberately NO UPDATE or DELETE policies: business fields are immutable via PostgREST;
-- status transitions + verification stamps run through service-role Kysely only.
```

## API / Service Changes

- `purchasing.service.ts`: `getSupplierBankAccounts(supplierId)` (all versions, history view); `getActiveSupplierBankAccounts(supplierId)` (**the only reader future payment surfaces may use** — `status = 'Active'`); `proposeSupplierBankChange(...)` — encrypts sensitive values via the shared secret helper, inserts the versioned row, checks `isApprovalRequired('supplierBankChange', companyId)`, then either parks + `createApprovalRequest` + `ApprovalRequested`, or activates immediately (service-role transition) + fires `MasterDataChanged`; `recordBankVerification(...)` (verifier ≠ `createdBy`, Active rows only); `getSupplierBankAccountSecret(...)` (server-only, service role; no route consumer in v1).
- `shared.service.ts`: `approveRequest`/`rejectRequest` gain the `supplierBankChange` case — approve: pending row → `Active` + `effectiveFrom`, `replacesId` target → `Inactive` + `effectiveTo` (Deactivate rows: target → `Inactive`, the change row itself → `Active` as the deactivation record), guarded `WHERE status = 'Pending Approval'`; reject/withdraw: row → `Rejected`. `isApprovalRequired` already handles amount-less types.
- Alert dispatch: `notifyMasterDataChange(...)` helper called from `updateDefaultAccounts`, payment-term upsert/delete, `supplierPayment` update, tax-config services, and the bank flows above; recipient resolution per Design Decision 8.
- `packages/notifications`: `MasterDataChanged` event → `General` topic; `notify.ts` description + `api+/link.ts` deep links (supplier payment tab / accounting settings).
- Document-approvals deliverables extended: SoD matrix rows (§4), settings Approval Rules page gains a `supplierBankChange` card (amount-less, like `supplier`).

## UI Changes

- Supplier detail → new **Bank Accounts** section (`SupplierBankAccounts.tsx`): active account(s) with masked numbers (`•••• 1234`), verification badge, pending-change banner with Approve/Reject (eligible approvers, notes) and Withdraw (requester); version history list.
- `SupplierBankAccountForm.tsx`: full-value inputs on create/update (submitted once, stored as secretRef, never echoed back); Deactivate action with confirm.
- Verification modal: method, notes; disabled for the row's creator.
- Settings → Approval Rules: `supplierBankChange` card. SoD report: two new finding rows.

## Acceptance Criteria

- [ ] With an enabled `supplierBankChange` rule: user A proposing a create/update/deactivate parks a `Pending Approval` row + approval request and notifies approvers; **user A cannot approve it** (server-rejected via `canApproveRequest`); user B can; approval activates the new version and inactivates the replaced one with effective dates stamped.
- [ ] An unapproved (pending or rejected) bank row is **never returned by `getActiveSupplierBankAccounts`** and never appears in any Active-filtered surface; rejecting/withdrawing leaves the prior Active row in force.
- [ ] `supplierBankAccount` business fields cannot be updated via PostgREST as any authenticated user (no UPDATE policy — verified by attempted direct PATCH); every change is a new row; a second concurrent pending change for the same supplier is rejected by the partial unique index.
- [ ] Full account number/IBAN appear in no API response, loader payload, or notification — only last-four; secretRef decrypts server-side only (Vault or AES fallback, matching the Plaid token interface).
- [ ] With **no** rule: the same propose call activates immediately through the identical versioned path, and a `MasterDataChanged` notification still reaches resolved accounting owners.
- [ ] Changing `accountDefault`, a payment term, `supplierPayment`, or tax config fires `MasterDataChanged` (field names, no values) to rule-approver recipients per the fallback chain.
- [ ] Recording verification stamps `verifiedBy/At/method`; the row's creator is rejected as verifier; a subsequent approved change produces a new version with verification NULL.
- [ ] SoD report flags a company with `payment` rows and no enabled `supplierBankChange` rule.
- [ ] `pnpm run generate:types`, scoped typecheck, lint pass; migration applies idempotently twice.

## Out of Scope (owned by sibling specs)

| Concern | Owner |
|---|---|
| Audit-log rows for `supplierBankAccount`, `accountDefault`, `paymentTerm`, tax config (entity config, `skipFields` for `secretRef`/`accountNumberRef`/`ibanRef`) | `.ai/specs/2026-07-04-record-integrity-audit-hardening.md` |
| Engine mechanics: `canApproveRequest` self-approval block, escalation cron, SoD report chassis, access report | `.ai/specs/2026-07-04-document-approvals.md` (this spec only adds the `supplierBankChange` case + two matrix rows) |
| Actually paying suppliers (payment execution, file formats, `getSupplierBankAccountSecret` consumption, verified-only payment policy) | Future payment-execution spec — must read via `getActiveSupplierBankAccounts` only |
| Approval gates on `accountDefault`/terms/tax edits (alerts + audit only in v1) | Revisit post-v1 if audit feedback demands |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Vault absent on self-hosted (unverified there) | Med | Same probe + AES-GCM fallback the Plaid spec resolved; shared helper, swappable backend |
| Sole-proprietor deadlock (only user proposes, nobody can approve) | Med | Same escape as document-approvals: rules are opt-in; `enforceNoSelfApproval` off is an audited standing exception |
| Alert bypass via direct PostgREST edits to `accountDefault`/terms/tax | Med | Known limitation of service-layer dispatch; audit coverage (record-integrity spec) is the detective backstop; queue-side handler is a compatible later upgrade |
| Enum ADD VALUE used in same migration | Med | Guarded pattern; table creation references the *new type*, not the new enum value — no in-transaction consumption |
| Pending row blocks urgent bank correction | Low | Requester withdraw + re-propose; escalation reminders + `defaultApproverId` from the engine |
| Future payment execution reads the table directly, bypassing the Active filter | Med | Contract stated here + in `getActiveSupplierBankAccounts` docstring; acceptance test in the payment-execution spec must cite it |

## Open Questions

> All resolved before writing (see Resolved Questions) — none blocking.

- [x] Dedicated `supplierBankChange` document type (Brad, 2026-07-04)
- [x] No rule seeding; SoD report row instead (program posture)
- [x] Full-value storage from day one via Vault/AES secretRef
- Non-blocking future note: customer bank details (AR direct debit) should reuse this exact model when needed — out of scope here.

## Changelog

- 2026-07-04: Created. Fieldwork verified: no bank fields exist anywhere in the schema (`supplierPayment` = terms/invoicing-party/currency only); masking precedent `bankAccount.accountNumberLastFour` (bank-rec spec); secret storage resolution inherited from the Plaid spec; `supplier` amount-less approval type is the engine precedent. Resolutions from Brad baked in. Ready for `/plan`.
