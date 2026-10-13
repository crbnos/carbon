# Supplier & Customer Documents and Bank Details

> Status: draft
> Author: Claude (with Aashu)
> Date: 2026-09-16
> Research notes: `.ai/research/supplier-customer-bank-details.md`
> Branch: `feat/supplier-customer-docs`

## TLDR

Two capabilities are missing from the supplier and customer **master records**, and they are unrelated to each other except that both were asked for together.

1. **Documents** — there is nowhere to file an NDA, a W-9, an ISO certificate or an insurance certificate against a supplier or customer as a company. Every transactional record in Carbon already has a Documents tab; the two master records do not. This half is pure reuse: a new route + sidebar entry per side, two new `documentSourceType` enum values, and two new storage prefixes. No new table.

2. **Bank account details** — Carbon cannot store the bank account it pays a supplier into, or refunds a customer to. Nothing exists to extend. This half adds two new tables, `supplierBankAccount` and `customerBankAccount`, gated on the **accounting** permission module rather than purchasing/sales, supporting many accounts per party with one primary.

## Problem Statement

**Documents.** A buyer onboarding "Unique Shoes'" motor supplier receives a signed NDA, a W-9, and an ISO 9001 certificate. There is no place in Carbon to put any of them. The supplier detail page has tabs for Details, Contacts, Locations, Payment, Tax, Shipping, Processes, Risks, Accounting and Default Attachments — none of which accepts an arbitrary file about the supplier. The two near-misses are actively misleading:

- `/x/supplier/:id/default-attachments` (`apps/erp/app/routes/x+/supplier+/$supplierId.default-attachments.tsx`) stores files that ride *outbound* on every purchase order email to that supplier. That is the opposite direction — files we send them, not files about them.
- `supplier-interaction` documents (`apps/erp/app/modules/purchasing/purchasing.service.ts:674`) are scoped to one RFQ or PO thread, not to the supplier as a company.

So the documents live in somebody's email, and when that buyer leaves, the certificate expiry is nobody's job.

**Bank details.** When AP pays that supplier, the account number is on a PDF in a shared drive or in an email — exactly the artifact that Business Email Compromise attacks target. Carbon has no field for it. The Payment tab (`SupplierPaymentForm.tsx`) holds only payment *terms* (Net 30), a currency, and bill-to pointers. The single `bankAccount` column anywhere in the schema (`20260630093809_ar-ap-payments.sql:206`) is a foreign key to `account(id)` — the company's own GL chart of accounts, an internal ledger reference, and not reusable for a counterparty bank.

## Goals

- File arbitrary documents against a supplier or customer master record, searchable alongside every other document in Carbon.
- Store one or more counterparty bank accounts per supplier and per customer, with the fields needed for US ACH and international wire/SEPA.
- Restrict bank detail access to finance staff rather than everyone who can browse the supplier list.
- Full change-tracking on bank details via the existing audit log.

## Non-Goals

- **Bank detail change-approval workflow.** Deferred to its own spec (see Design Decisions D6). The research (`.ai/research/supplier-customer-bank-details.md` §5) identifies D365 Finance's change-proposal flow as the primary anti-BEC control, and it is a real subsystem: a pending-state model, approver routing, side-by-side diff UI, a new approver permission, and it must gate the API and CSV-import paths too, or it is not a control at all. Building it inside this spec would roughly double the scope.
- **Encryption at rest for account numbers.** Explicitly declined — see D4 and the Accepted Risks section.
- **Payment file generation** (NACHA ACH files, SEPA XML). Storing the details is a prerequisite; generating payment files is a separate feature.
- **Document expiry tracking / reminders** on certificates. The files are stored; nothing watches their expiry dates.
- **Supplier portal upload.** Suppliers cannot upload their own documents through the portal in v1; this is employee-facing only.

## Design

### Part 1 — Documents

#### Storage

Files go to the existing `private` bucket (`20230123004514_buckets.sql:1-5`, non-public), under two new prefixes following the established `${companyId}/<recordType>/<recordId>` convention:

```
${companyId}/supplier/${supplierId}/<filename>
${companyId}/customer/${customerId}/<filename>
```

Singular `supplier` / `customer`, matching the nearest neighbours `opportunity`, `quality` and `supplier-interaction`. (`parts` is plural; the prefixes are already inconsistent, so the rule is match-the-neighbour.) `companyId` stays the first segment — the storage RLS policies key off it for tenant isolation.

#### Metadata

Each upload also writes one row to the existing `document` table (`20230423023136_documents.sql:14`), linked to its parent by `sourceDocument` + `sourceDocumentId` (`20240330181457_document-types.sql:17-18`). No schema change to the table itself.

The `documentSourceType` enum currently holds 21 values (verified against the live DB), every one a transaction or an item — no master records. Two values are added:

```sql
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Supplier';
ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Customer';
```

Precedent: `20260202000000_supplier_quote_document_type.sql:2` is exactly this, one line.

The TypeScript mirror `documentSourceTypes` in `apps/erp/app/modules/documents/documents.models.ts:9` must gain both values in the same change — it is a hand-maintained array, not generated, and `DocumentsTable.tsx` derives its source-type filter from it.

#### Behaviour inherited at no cost

Because these are ordinary `document` rows:

- `documentTransaction` records Upload / Download / Edit / Favorite / Unfavorite / Label (`20230423023136_documents.sql:125`), cascading from `document.id`.
- `documentLabel` and `documentFavorite` work per-user.
- Files appear in the global Documents module at `/x/documents`, searchable and filterable by source type (D5).
- Access control already exists: `readGroups` / `writeGroups` default to `[userId]` (`apps/erp/app/routes/x+/documents+/new.tsx:37-38`) and are user-editable through the document drawer's "View Permissions" / "Edit Permissions" pickers (`DocumentForm.tsx:66-76`). No new design needed.

### Part 2 — Bank Details

#### Data model

Two new mirrored tables. `supplierBankAccount` shown; `customerBankAccount` is identical with `customerId` → `customer`.

```sql
CREATE TABLE "supplierBankAccount" (
    "id" TEXT NOT NULL DEFAULT id('sba'),
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,

    -- Identification
    "name" TEXT NOT NULL,                 -- user label, e.g. "USD Operating"
    "accountHolderName" TEXT,             -- when it differs from the supplier name
    "bankName" TEXT,
    "countryCode" CHAR(2),                -- FK -> country(alpha2)
    "currencyCode" TEXT,

    -- Generic by design. `accountNumber` holds an IBAN in SEPA and a plain
    -- account number elsewhere; `bankCode` holds an ABA / sort code / BSB /
    -- IFSC / transit. countryCode decides labels and validation, so a new
    -- country is a config entry rather than a migration. `bankDetails` is the
    -- long tail nothing queries (accountType, branchName, purposeCode).
    "accountNumber" TEXT,
    "bankCode" TEXT,
    "swiftBic" TEXT,
    "bankDetails" JSONB,

    "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "notes" TEXT,

    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    "tags" TEXT[],

    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    FOREIGN KEY ("supplierId", "companyId")
        REFERENCES "supplier"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY ("countryCode") REFERENCES "country"("alpha2")
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX "supplierBankAccount_companyId_idx" ON "supplierBankAccount" ("companyId");
CREATE INDEX "supplierBankAccount_supplierId_idx" ON "supplierBankAccount" ("supplierId");
CREATE INDEX "supplierBankAccount_createdBy_idx" ON "supplierBankAccount" ("createdBy");

-- At most one primary per supplier, among active rows only
CREATE UNIQUE INDEX "supplierBankAccount_primary_idx"
    ON "supplierBankAccount" ("supplierId", "companyId")
    WHERE "isPrimary" AND "active";
```

Notes on the shape:

- `countryCode` is `CHAR(2)` referencing `country("alpha2")`. Verified against the live DB — `country`'s primary key is `alpha2`, not an integer id. (`.claude/rules/customer-supplier-database-schema.md` describes `address.countryCode` as INTEGER; that is stale. The live schema wins.)
- `id('sba')` / `id('cba')` prefixed ids, composite PK with `companyId`, per `conventions-database.md`.
- All number columns are nullable because which ones apply is country-dependent: a US account uses `accountNumber` + `routingNumber`; a SEPA account uses `iban` + `swiftBic`. Validation is conditional on `countryCode` (D7).
- `active` gives soft-archive. Bank accounts are never hard-deleted once payments may reference them — matching Odoo's `active` flag (research §2).

#### RLS — accounting-gated

This is the deliberate departure from the sibling tables. `supplierPayment` is gated on `purchasing_view`; these are gated on `accounting_*`:

```sql
ALTER TABLE "public"."supplierBankAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."supplierBankAccount"
FOR SELECT USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
);

CREATE POLICY "INSERT" ON "public"."supplierBankAccount"
FOR INSERT WITH CHECK (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
);

CREATE POLICY "UPDATE" ON "public"."supplierBankAccount"
FOR UPDATE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
);

CREATE POLICY "DELETE" ON "public"."supplierBankAccount"
FOR DELETE USING (
  "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
);
```

`Accounting` is an existing value of the `module` enum (`20230123004409_permissions.sql:2-16`) and is actively used in the app (`permissions.can("view", "accounting")` across `apps/erp/app/modules/accounting/ui/`). No new permission module is introduced.

#### Audit registration

Both tables are added to `packages/database/src/audit.config.ts` under the existing `supplier` and `customer` entities, as child tables with their own surrogate PK:

```ts
supplierBankAccount: { entityIdColumn: "supplierId" },
```

This is the `{ entityIdColumn }` role documented at `audit.config.ts:17-18` — a child table whose named column holds the parent entity id. Changes then roll up into the supplier's audit view alongside `supplierPayment` and `supplierShipping`.

### UI

#### Documents tabs

Per side, three edits plus one new route, following `$supplierId.default-attachments.tsx` as the route shape and `OpportunityDocuments.tsx` as the component reference:

| File | Change |
|------|--------|
| `apps/erp/app/routes/x+/supplier+/$supplierId.documents.tsx` | New. Loader lists `${companyId}/supplier/${supplierId}` from the `private` bucket, gated `view: "purchasing"`. |
| `apps/erp/app/routes/x+/customer+/$customerId.documents.tsx` | New. Same, gated `view: "sales"`. |
| `apps/erp/app/utils/path.ts` | Add `supplierDocuments(id)` and `customerDocuments(id)`. |
| `useSupplierSidebar.tsx` / `useCustomerSidebar.tsx` | Add a Documents entry, `LuFiles` icon, matching the existing Default Attachments entry shape. |
| `DocumentsTable.tsx` `getDocumentLocation()` | Add `case "Supplier"` / `case "Customer"` returning `path.to.supplierDetails(id)` / `path.to.customerDetails(id)`, so a global-module row links back to the record. |

Upload flow is copied from `OpportunityDocuments.tsx`: upload bytes to storage, then `submit()` to `path.to.newDocument` with `sourceDocument` and `sourceDocumentId`.

Rather than duplicating the ~490-line `OpportunityDocuments.tsx` twice, a shared `RecordDocuments` component is extracted into `apps/erp/app/components/`, parameterised by source type, record id, and storage prefix. Both new tabs consume it. Opportunity is **not** migrated onto it in this spec — that is unrelated refactoring of working code.

#### Bank Accounts tab

A new tab per side at `/x/supplier/:id/bank-accounts` and `/x/customer/:id/bank-accounts`, listing accounts in a card with a `New` action and a drawer form, following the `SupplierLocations` / `SupplierLocationForm` pattern (list + `new` / `:id` / `delete` sub-routes).

Sidebar entries are permission-gated so the tab is hidden from users without `accounting_view`. **This needs a new mechanism.** The existing filter in `useSupplierSidebar.tsx:125-129` calls `permissions.is(role)`, which tests the user's *role* (employee / supplier / customer) — not a module permission. The `role: ["employee"]` field cannot express `accounting_view`. The sidebar hook therefore gains an optional `permission?: { action, module }` field, filtered with `permissions.can(action, module)` alongside the existing role check. Both sidebars use it; existing entries are untouched.

The route loader is the actual gate (`requirePermissions(request, { view: "accounting" })`); hiding the tab is a UX affordance on top of it.

**Masking.** The account number and IBAN render as last-4 only (`••••6789`) in the list. A per-row "Reveal" toggle shows the full value to a user who already has `accounting_view`. This is presentation only, not an access control — the loader returns the full row, so the mask deters shoulder-surfing and screenshots, nothing more. See Accepted Risks.

All new copy is wrapped in Lingui (`<Trans>` / `` t`` ``) from the first commit.

### Services

`apps/erp/app/modules/purchasing/purchasing.service.ts` and `sales.service.ts` gain:

- `getSupplierBankAccounts(client, supplierId, companyId)` / customer equivalent
- `getSupplierBankAccount(client, id)` / customer equivalent
- `upsertSupplierBankAccount(client, data)` / customer equivalent
- `deleteSupplierBankAccount(client, id)` / customer equivalent

Validators go in the matching `.models.ts`, per module conventions. Setting `isPrimary` on one row clears it on the party's other rows in the same transaction, guarded by the partial unique index.

## Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Where bank details live | New `supplierBankAccount` / `customerBankAccount` tables | Columns on `supplierPayment` would cap it at one account per party and expose numbers to every `purchasing_view` holder. Research §2: many-per-party with a primary is universal (NetSuite, Business Central, Odoo). |
| D2 | Who can read bank details | `accounting_*` permission module | Whoever runs payments is finance; `purchasing_view` is very widely held. `Accounting` already exists in the `module` enum and is used in-app — no new permission needed. |
| D3 | Cardinality | Many per party, one primary, soft-archived | Research §2. Currency is the dimension that forces a second account. Partial unique index enforces one primary among active rows. |
| D4 | Account number storage | **Plaintext columns, masked in the UI** | User decision, taken against the recommendation. See Accepted Risks. |
| D5 | Global Documents visibility | Supplier/customer documents appear in `/x/documents` too | Consistent with all 21 existing source types; makes files searchable. Hiding them would need a new exclusion in the documents query. |
| D6 | Bank change approval | Not in v1; deferred to its own spec | Real subsystem (pending state, approver routing, diff UI, must gate API + CSV import). Audit log still records who changed what. |
| D7 | Bank field shape | **Revised:** three generic columns (`accountNumber`, `bankCode`, `swiftBic`) + a `bankDetails` JSONB, driven by a per-country config | The original explicit-per-scheme design did not scale — four columns covered three regimes, and UK sort code, AU BSB, IN IFSC and CA transit would each have needed a migration. Odoo (research §1.1) stores one generic `acc_number` and infers the type per country; this keeps that flexibility while leaving the three fields payment-file generation actually reads as real columns. Carbon's own `trackedEntity.attributes` shows the failure mode of going pure-JSONB: `readableId` had to be added as a column and backfilled out of the JSON (`20251220013724`). |
| D8 | Storage prefix naming | Singular `supplier` / `customer` | Matches nearest neighbours `opportunity`, `quality`, `supplier-interaction`. |
| D9 | Component duplication | Extract shared `RecordDocuments`; do not migrate Opportunity | Avoids a third copy of ~490 lines without refactoring working unrelated code. |
| D10 | Country reference | `CHAR(2)` FK to `country("alpha2")` | Verified against the live DB; the schema rule doc's "INTEGER countryCode" is stale. |

## Accepted Risks

Recorded because D4 was taken against an explicit, code-verified recommendation. This is the user's call and is documented so a later reader understands it was deliberate, not an oversight.

**Bank account numbers are stored and logged in plaintext.** Consequences, each verified in code:

1. **Audit-log copies.** `supplierBankAccount` is registered in `audit.config.ts`, so every change writes a `diff` JSONB containing the before and after account number. `skipFields` is a single global list (`audit.config.ts:690`) with no per-field redaction, so the values are recorded in full.
2. **Storage archives.** Audit rows archive to `audit-logs/{companyId}/{year}/{month}.jsonl.gz` in the `private` bucket after 30 days (`audit.config.ts:693-697`). Those archives are not gated by `accounting_view`, so the plaintext numbers land outside the permission boundary that D2 was chosen to establish.
3. **Backups.** Company backups include the table and its plaintext columns.
4. **UI masking is not access control.** The route loader returns the full row; masking is client-side presentation. Anyone with `accounting_view` and network tools sees the full number regardless of the mask.

Research context (`.ai/research/supplier-customer-bank-details.md` §4): PCI-DSS confirmed **not** applicable (bank account numbers are not card data, per PCI SSC's own FAQ). What does apply is Nacha's "render unreadable when stored electronically" rule — which binds only above 2M ACH entries/year, so likely not yet, but it is the standard of care — plus GDPR Art. 32 (an IBAN is personal data, though not Art. 9 special category), and NIST 800-171 if Carbon serves defense manufacturing, where routing and account numbers are cited CUI.

The mitigation, if revisited: Vault-encrypt the number and keep a plaintext `last4`, reusing the integration-secret pattern already in the codebase (`20260817122916_integration-secret-vault.sql`). That closes items 1–4 at once, because the column never holds the value. Adding it later is a migration plus a backfill, not a redesign.

## Acceptance Criteria

**Documents**

- [ ] A user with `purchasing_view` opens `/x/supplier/:id/documents`, sees a Documents tab in the sidebar, drops `NDA.pdf`, and the file appears in the list with its name, size and upload timestamp.
- [ ] That upload creates an object at `${companyId}/supplier/${supplierId}/NDA.pdf` in the `private` bucket and one `document` row with `sourceDocument = 'Supplier'` and `sourceDocumentId = <supplierId>`.
- [ ] The same file appears at `/x/documents`, is findable by searching "NDA", and filtering the source-type column by `Supplier` returns it.
- [ ] Clicking that row in the global Documents table navigates to the supplier's detail page.
- [ ] Downloading the file writes a `documentTransaction` row with `type = 'Download'`.
- [ ] The document drawer's View/Edit Permissions pickers change `readGroups` / `writeGroups`, and a second user outside those groups no longer sees the row.
- [ ] The equivalent flow works end-to-end at `/x/customer/:id/documents` with `sourceDocument = 'Customer'`.
- [ ] Uploading to a supplier in company A produces a row invisible to a user scoped only to company B.

**Bank details**

- [ ] A user with `accounting_view` sees a Bank Accounts tab on the supplier page; a user with `purchasing_view` but not `accounting_view` does not see the tab, and a direct GET of the route returns no rows.
- [ ] Creating an account with name "USD Operating", `countryCode = 'US'`, `accountNumber = '123456789'`, `routingNumber = '011000015'` saves and lists as `••••6789`.
- [ ] Reveal on that row shows `123456789`.
- [ ] Creating a second account with `countryCode = 'DE'` and a valid IBAN saves; the form requires `iban` and not `routingNumber` for DE, and requires `routingNumber` for US.
- [ ] An invalid IBAN (failing mod-97) and an invalid ABA routing number (failing its checksum) are both rejected with a field-level error.
- [ ] Marking the second account primary clears `isPrimary` on the first; the DB rejects a direct attempt to set two active primaries for one supplier.
- [ ] Archiving an account (`active = false`) removes it from the default list and frees the primary slot.
- [ ] Editing an account number produces an audit-log entry under the parent supplier showing the old and new values, attributed to the editing user.
- [ ] The equivalent flow works for customers under `accounting_view`.
- [ ] All new user-facing strings render translated under a non-English locale — no hardcoded English.

## Open Questions

All resolved before this spec was written.

- [x] **Where should counterparty bank details live, and who can read them?** — **Answer:** New `supplierBankAccount` / `customerBankAccount` tables gated on `accounting_*`. Chosen over columns on `supplierPayment` (which would cap at one account and expose numbers to all `purchasing_view` holders) and over new tables kept on purchasing/sales permissions. Rationale: payments are run by finance, and research §2 shows many-accounts-per-party with a primary is the universal model.
- [x] **How should the account number be stored and shown?** — **Answer:** Plaintext columns, masked in the UI. Chosen over the recommended Vault-encrypted + plaintext-last4 approach and over plaintext-with-audit-redaction. Recorded in Accepted Risks with the verified consequences.
- [x] **Given the audit log copies values to storage in plaintext, keep plaintext with no redaction?** — **Answer:** Yes, re-confirmed after the audit-log leak was presented with file:line evidence. No per-field redaction will be added. Documented in Accepted Risks so the decision is traceable.
- [x] **Should changing bank details require approval?** — **Answer:** No approval workflow in v1. The audit log records who changed what. A D365-style change-proposal flow is deferred to its own spec, noted in Non-Goals with the reason it is not a small addition.
- [x] **How should the bank number fields be shaped?** — **Answer (revised during implementation):** three generic columns plus a JSONB long tail, driven by `getBankFieldConfig` in `@carbon/utils`. The originally-agreed explicit-per-scheme columns were replaced after the user observed that a column per country does not scale. See D7.
- [x] **Supplier documents will also appear in the global `/x/documents` module — is that right?** — **Answer:** Yes, both places. Consistent with every existing source type and keeps the files searchable; requires adding the two cases to `getDocumentLocation()`.

## Changelog

- **2026-09-16** — Initial spec. Six open questions resolved with the user before writing. Research on counterparty bank modelling captured in `.ai/research/supplier-customer-bank-details.md`.
- **2026-09-16** — D7 revised during implementation: bank identifier columns generalised to `accountNumber` + `bankCode` + `swiftBic` + `bankDetails` JSONB with a per-country config, replacing the per-scheme columns. Also fixed from review: edit actions no longer trust a form-supplied parent id, both upserts are Kysely transactions, and the `active` toggle was removed from the forms (archiving made a row unreachable).
