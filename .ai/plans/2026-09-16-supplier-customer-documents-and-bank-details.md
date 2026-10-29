# Supplier & Customer Documents and Bank Details — implementation plan

**Spec / source:** `.ai/specs/2026-09-16-supplier-customer-documents-and-bank-details.md`
**Branch:** `feat/supplier-customer-docs`
**Worktree:** `/Users/aashu/work/carbon/carbon-feat-supplier-customer-docs` — run every command from here. Do NOT touch `/Users/aashu/work/carbon/carbon`.

## Critical context for the executor

- This is a **pnpm** workspace. Never use `npm`.
- The ERP app's package name is `erp` (not `@carbon/erp`) — `pnpm exec turbo run typecheck --filter=erp`.
- Whole-repo typecheck OOMs. Always scope with `--filter`.
- After any migration: `pnpm db:migrate` then `pnpm run generate:types`, BEFORE any typecheck.
- **Never run `git commit`.** The user commits. Leave changes in the working tree.
- Every new user-facing string must be Lingui-wrapped (`<Trans>` for JSX, `` t`...` `` from `useLingui()` for attributes/strings). No bare English.
- Local Postgres for this worktree is on port **58641** (`PGPASSWORD=postgres psql -h 127.0.0.1 -p 58641 -U postgres -d postgres`).

## Progress

- [x] Task 1: Migration — documentSourceType enum values
- [x] Task 2: Migration — supplierBankAccount + customerBankAccount tables
- [x] Task 3: Apply migrations and regenerate types
- [x] Task 4: Register bank tables in audit config
- [x] Task 5: Add documentSourceTypes TS mirror values + document location links
- [x] Task 6: Add path entries for documents and bank accounts
- [x] Task 7: Extract shared RecordDocuments component
- [x] Task 8: Supplier + customer Documents routes
- [x] Task 9: Add permission-gating to sidebar hooks
- [x] Task 10: Sidebar entries for Documents and Bank Accounts
- [x] Task 11: Bank account validators and services
- [x] Task 12: Bank account form + list UI components
- [x] Task 13: Bank account routes (list / new / edit / delete)
- [x] Task 14: Full verification

## Dependencies

- Task 1, 2 independent of each other; both must precede Task 3.
- Task 3 must precede Tasks 4, 11 (needs regenerated DB types).
- Task 5, 6 independent, can run any time after Task 3.
- Task 7 must precede Task 8.
- Task 9 must precede Task 10.
- Task 11 must precede Tasks 12, 13.
- Task 12 must precede Task 13.
- Task 14 last.

---

## Task 1: Migration — add Supplier and Customer to documentSourceType

**Depends on:** none

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_supplier-customer-document-source.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260202000000_supplier_quote_document_type.sql`

**Steps:**

1. Create the migration file:
   ```bash
   pnpm db:migrate:new supplier-customer-document-source
   ```
2. The generated filename has a timestamp. Verify its HHMMSS portion is NOT `000000` — if it is, rename the file with a randomized HHMMSS (e.g. `20260916142853_supplier-customer-document-source.sql`). The timestamp is the migration's primary key and `000000` collides across branches.
3. Write exactly this content into that file:
   ```sql
   -- Master records (supplier, customer) can now own documents. Every existing
   -- documentSourceType value is a transaction or an item; these are the first
   -- two master-record sources.
   ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Supplier';
   ALTER TYPE "documentSourceType" ADD VALUE IF NOT EXISTS 'Customer';
   ```

**Verify:**
```bash
ls packages/database/supabase/migrations/ | grep supplier-customer-document-source
# Expected: exactly one filename, timestamp not ending in 000000
```

**Out of scope:** Do not modify the `document` table itself — it needs no schema change. Do not touch any other enum.

---

## Task 2: Migration — supplierBankAccount and customerBankAccount tables

**Depends on:** none

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_supplier-customer-bank-accounts.sql`
- Copy from (precedent): `.claude/rules/conventions-database.md` table + RLS template; `packages/database/supabase/migrations/20260905132037_job-operation-batching.sql` for the exact RLS policy idiom.

**Steps:**

1. Create the migration file:
   ```bash
   pnpm db:migrate:new supplier-customer-bank-accounts
   ```
2. Check the HHMMSS is not `000000`; rename with a randomized one if it is.
3. Write this content. Note `countryCode` is `CHAR(2)` referencing `country("alpha2")` — verified against the live DB; `country` has no integer id column.

   ```sql
   -- Counterparty bank accounts: the bank we pay a supplier into, and the bank we
   -- refund a customer to. NOT the company's own bank accounts, and unrelated to
   -- "payment"."bankAccount", which is a GL chart-of-accounts reference.
   --
   -- Gated on accounting_* rather than purchasing_*/sales_* on purpose: payments are
   -- run by finance, and purchasing_view is very widely held.

   CREATE TABLE "supplierBankAccount" (
       "id" TEXT NOT NULL DEFAULT id('sba'),
       "companyId" TEXT NOT NULL,
       "supplierId" TEXT NOT NULL,

       "name" TEXT NOT NULL,
       "accountHolderName" TEXT,
       "bankName" TEXT,
       "countryCode" CHAR(2),
       "currencyCode" TEXT,

       "accountNumber" TEXT,
       "routingNumber" TEXT,
       "iban" TEXT,
       "swiftBic" TEXT,

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
   CREATE INDEX "supplierBankAccount_updatedBy_idx" ON "supplierBankAccount" ("updatedBy");
   CREATE INDEX "supplierBankAccount_countryCode_idx" ON "supplierBankAccount" ("countryCode");

   CREATE UNIQUE INDEX "supplierBankAccount_primary_idx"
       ON "supplierBankAccount" ("supplierId", "companyId")
       WHERE "isPrimary" AND "active";

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

   CREATE TABLE "customerBankAccount" (
       "id" TEXT NOT NULL DEFAULT id('cba'),
       "companyId" TEXT NOT NULL,
       "customerId" TEXT NOT NULL,

       "name" TEXT NOT NULL,
       "accountHolderName" TEXT,
       "bankName" TEXT,
       "countryCode" CHAR(2),
       "currencyCode" TEXT,

       "accountNumber" TEXT,
       "routingNumber" TEXT,
       "iban" TEXT,
       "swiftBic" TEXT,

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
       FOREIGN KEY ("customerId", "companyId")
           REFERENCES "customer"("id", "companyId") ON UPDATE CASCADE ON DELETE CASCADE,
       FOREIGN KEY ("countryCode") REFERENCES "country"("alpha2")
           ON UPDATE CASCADE ON DELETE SET NULL
   );

   CREATE INDEX "customerBankAccount_companyId_idx" ON "customerBankAccount" ("companyId");
   CREATE INDEX "customerBankAccount_customerId_idx" ON "customerBankAccount" ("customerId");
   CREATE INDEX "customerBankAccount_createdBy_idx" ON "customerBankAccount" ("createdBy");
   CREATE INDEX "customerBankAccount_updatedBy_idx" ON "customerBankAccount" ("updatedBy");
   CREATE INDEX "customerBankAccount_countryCode_idx" ON "customerBankAccount" ("countryCode");

   CREATE UNIQUE INDEX "customerBankAccount_primary_idx"
       ON "customerBankAccount" ("customerId", "companyId")
       WHERE "isPrimary" AND "active";

   ALTER TABLE "public"."customerBankAccount" ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "SELECT" ON "public"."customerBankAccount"
   FOR SELECT USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_view'))::text[])
   );

   CREATE POLICY "INSERT" ON "public"."customerBankAccount"
   FOR INSERT WITH CHECK (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_create'))::text[])
   );

   CREATE POLICY "UPDATE" ON "public"."customerBankAccount"
   FOR UPDATE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_update'))::text[])
   );

   CREATE POLICY "DELETE" ON "public"."customerBankAccount"
   FOR DELETE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('accounting_delete'))::text[])
   );
   ```

4. Verify the FK target shape before trusting it:
   ```bash
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 58641 -U postgres -d postgres -c '\d country' | head -8
   ```
   Expected: a `alpha2 | character(2)` column and `country_pkey PRIMARY KEY, btree (alpha2)`.
   **If `country`'s PK is not `alpha2`, STOP and report — do not improvise a different FK.**

**Verify:**
```bash
grep -c "CREATE TABLE" packages/database/supabase/migrations/*supplier-customer-bank-accounts.sql
# Expected: 2
grep -c "get_companies_with_employee_permission('accounting_" packages/database/supabase/migrations/*supplier-customer-bank-accounts.sql
# Expected: 8
```

**Out of scope:** Do NOT add bank columns to `supplierPayment` or `customerPayment`. Do NOT add encryption, vault functions, or audit-redaction — the spec explicitly accepts plaintext (see the spec's Accepted Risks section). Do NOT create a `bankAccount` table for the company's own banks.

---

## Task 3: Apply migrations and regenerate types

**Depends on:** Task 1, Task 2

**Files:**
- Modify (generated, do not hand-edit): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`, `packages/database/src/swagger-docs-schema.ts`

**Steps:**

1. Apply:
   ```bash
   pnpm db:migrate
   ```
2. Regenerate DB types:
   ```bash
   pnpm run generate:types
   ```
3. Confirm the new tables and enum values exist in the live DB:
   ```bash
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 58641 -U postgres -d postgres -c "SELECT unnest(enum_range(NULL::\"documentSourceType\"))::text" | grep -E "Supplier$|Customer$"
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 58641 -U postgres -d postgres -c '\d "supplierBankAccount"' | head -20
   ```

**Verify:**
```bash
grep -c "supplierBankAccount" packages/database/src/types.ts
# Expected: a number greater than 0
grep -c "customerBankAccount" packages/database/src/types.ts
# Expected: a number greater than 0
```

**Out of scope:** Do not hand-edit any generated types file. If the generator fails, STOP and report — do not patch types by hand.

---

## Task 4: Register bank tables in the audit config

**Depends on:** Task 3

**Files:**
- Modify: `packages/database/src/audit.config.ts` — add both tables to the existing `supplier` and `customer` entities, and add display labels.

**Steps:**

1. In the `customer` entity's `tables` object (around line 141–155, which already contains `customerPayment: { role: "extension" }`), add:
   ```ts
   customerBankAccount: { entityIdColumn: "customerId" },
   ```
2. In the `supplier` entity's `tables` object (around line 174–190, which already contains `supplierPayment: { role: "extension" }`), add:
   ```ts
   supplierBankAccount: { entityIdColumn: "supplierId" },
   ```
3. In the table-label map (around line 615–625, which contains `customerPayment: "Payment"`), add:
   ```ts
   customerBankAccount: "Bank Account",
   supplierBankAccount: "Bank Account",
   ```

Use the `{ entityIdColumn }` role — documented at `audit.config.ts:17-18` as "a child table with its own surrogate PK; the named column contains the parent entity ID". Do NOT use `role: "extension"`, which is only for 1:1 tables whose PK equals the parent FK.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: exits 0, no type errors
```

**Out of scope:** Do NOT add per-field redaction or touch `skipFields`. The spec's Accepted Risks section documents that bank numbers appear in audit diffs in plaintext — that is the user's explicit decision, not a bug to fix here.

---

## Task 5: Add TS enum mirror values and document location links

**Depends on:** Task 3

**Files:**
- Modify: `apps/erp/app/modules/documents/documents.models.ts` — add two values to `documentSourceTypes` (line 9).
- Modify: `apps/erp/app/modules/documents/ui/Documents/DocumentsTable.tsx` — add two cases to `getDocumentLocation()` (around line 634).

**Steps:**

1. In `documents.models.ts`, the `documentSourceTypes` array starts at line 9 and ends with `...itemType`. Add `"Supplier"` and `"Customer"` as entries before `...itemType`:
   ```ts
   "Shipment",
   "Supplier",
   "Customer",
   ...itemType
   ```
   This array is hand-maintained (not generated) and drives the source-type filter in the documents table.
2. In `DocumentsTable.tsx`, inside `getDocumentLocation(sourceDocument, sourceDocumentId)`, add these two cases before `default:`:
   ```ts
   case "Supplier":
     return path.to.supplierDetails(sourceDocumentId);
   case "Customer":
     return path.to.customerDetails(sourceDocumentId);
   ```
   `path.to.supplierDetails` and `path.to.customerDetails` already exist (`apps/erp/app/utils/path.ts:2188` and `:557`).

**Verify:**
```bash
grep -A2 '"Shipment",' apps/erp/app/modules/documents/documents.models.ts
# Expected: shows "Supplier", and "Customer",
grep -c 'case "Supplier":' apps/erp/app/modules/documents/ui/Documents/DocumentsTable.tsx
# Expected: 1
```

**Out of scope:** Do not reorder or remove existing enum values — the array order feeds a UI filter list but the values must all remain.

---

## Task 6: Add path entries

**Depends on:** Task 3

**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add four route builders, keeping alphabetical order within the `to` object.

**Steps:**

1. Near the existing `customerDetails` (line 557) and `customerPayment` (line 569) entries, add:
   ```ts
   customerBankAccount: (customerId: string, id: string) =>
     generatePath(`${x}/customer/${customerId}/bank-accounts/${id}`),
   customerBankAccounts: (id: string) =>
     generatePath(`${x}/customer/${id}/bank-accounts`),
   customerDocuments: (id: string) =>
     generatePath(`${x}/customer/${id}/documents`),
   deleteCustomerBankAccount: (customerId: string, id: string) =>
     generatePath(`${x}/customer/${customerId}/bank-accounts/delete/${id}`),
   newCustomerBankAccount: (customerId: string) =>
     generatePath(`${x}/customer/${customerId}/bank-accounts/new`),
   ```
2. Near the existing `supplierDetails` (line 2190) entry, add:
   ```ts
   supplierBankAccount: (supplierId: string, id: string) =>
     generatePath(`${x}/supplier/${supplierId}/bank-accounts/${id}`),
   supplierBankAccounts: (id: string) =>
     generatePath(`${x}/supplier/${id}/bank-accounts`),
   supplierDocuments: (id: string) =>
     generatePath(`${x}/supplier/${id}/documents`),
   deleteSupplierBankAccount: (supplierId: string, id: string) =>
     generatePath(`${x}/supplier/${supplierId}/bank-accounts/delete/${id}`),
   newSupplierBankAccount: (supplierId: string) =>
     generatePath(`${x}/supplier/${supplierId}/bank-accounts/new`),
   ```
   Place each in its correct alphabetical position within the object.

**Verify:**
```bash
grep -cE "supplierDocuments|customerDocuments|supplierBankAccounts|customerBankAccounts" apps/erp/app/utils/path.ts
# Expected: 4
```

**Out of scope:** Do not modify the existing `supplierDefaultAttachments` entry — default attachments are a different feature (outbound PO email attachments).

---

## Task 7: Extract shared RecordDocuments component

**Depends on:** none (but do after Task 6 so `path.to.*` exists)

**Files:**
- Create: `apps/erp/app/components/RecordDocuments.tsx`
- Copy from (precedent): `apps/erp/app/modules/sales/ui/Opportunity/OpportunityDocuments.tsx` — the whole upload/download/delete/list card, minus the drag-and-drop and Opportunity-specific pieces.

**Steps:**

1. Read `apps/erp/app/modules/sales/ui/Opportunity/OpportunityDocuments.tsx` in full first. It is ~490 lines and contains the complete reference implementation.
2. Create `RecordDocuments.tsx` exporting a default component with this exact prop shape:
   ```ts
   type RecordDocumentsProps = {
     files: FileObject[];
     /** The record's id — becomes document.sourceDocumentId */
     id: string;
     /** Storage prefix segment under ${companyId}/, e.g. "supplier" */
     bucketPrefix: string;
     /** documentSourceType value, e.g. "Supplier" */
     sourceDocument: "Supplier" | "Customer";
     /** Permission module gating upload/delete, e.g. "purchasing" */
     module: "purchasing" | "sales";
     isReadOnly?: boolean;
   };
   ```
3. Carry over from the precedent, adapting names:
   - The `Card` / `CardHeader` / `CardTitle` / `CardAction` / `CardContent` layout with a `Table` of files.
   - `FileDropzone` + a hidden file input with an upload `IconButton` (`LuUpload`).
   - `upload()`: for each file, `stripSpecialCharacters(file.name)`, build the path as
     `` `${companyId}/${bucketPrefix}/${id}/${safeName}` ``, call
     `carbon.storage.from("private").upload(fileName, file, { cacheControl: `${12 * 60 * 60}`, upsert: true })`,
     then on success call `createDocumentRecord({ path, name, size })` which submits a `FormData`
     with `path`, `name`, `size` (KB, `Math.round(size / 1024)`), `sourceDocument`, `sourceDocumentId`
     to `path.to.newDocument` via `submit(formData, { method: "post", action: path.to.newDocument, navigate: false, fetcherKey: ... })`.
   - `download()`, `deleteAttachment()` (calls `.remove([path])`), optimistic rows via `useFetchers`, `revalidator.revalidate()`.
   - `getDocumentType(file.name)` for the icon, `convertKbToString` for the size column, `DateTime` for `updated_at`.
   - Permission checks: upload/delete gated on `permissions.can("update", module)` / `permissions.can("delete", module)`.
4. Wrap every user-facing string in Lingui: `<Trans>` in JSX, `` t`...` `` from `useLingui()` for toasts and aria labels. The precedent already does this — follow it exactly.
5. Do NOT carry over: `useDndContext` / `useDraggable` / `useOptimisticDocumentDrag` (drag-to-line is Opportunity-specific), the `LuRadioTower`/`LuShoppingCart` badges, the `Outlet`, or the `opportunity` prop.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
grep -c "Trans\|useLingui" apps/erp/app/components/RecordDocuments.tsx
# Expected: greater than 0 (proves Lingui wrapping is present)
```

**Out of scope:** Do NOT modify `OpportunityDocuments.tsx` to use this new component. Migrating it is unrelated refactoring of working code and is explicitly excluded by spec decision D9.

---

## Task 8: Supplier and customer Documents routes

**Depends on:** Task 5, Task 6, Task 7

**Files:**
- Create: `apps/erp/app/routes/x+/supplier+/$supplierId.documents.tsx`
- Create: `apps/erp/app/routes/x+/customer+/$customerId.documents.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/supplier+/$supplierId.default-attachments.tsx` — same loader shape, same storage `.list()` call.

**Steps:**

1. Create `$supplierId.documents.tsx`:
   ```tsx
   import { requirePermissions } from "@carbon/auth/auth.server";
   import type { LoaderFunctionArgs } from "react-router";
   import { useLoaderData } from "react-router";
   import RecordDocuments from "~/components/RecordDocuments";

   export async function loader({ request, params }: LoaderFunctionArgs) {
     const { client, companyId } = await requirePermissions(request, {
       view: "purchasing"
     });
     const { supplierId } = params;
     if (!supplierId) throw new Error("Missing supplierId");

     const result = await client.storage
       .from("private")
       .list(`${companyId}/supplier/${supplierId}`);

     return {
       supplierId,
       files: result.data ?? []
     };
   }

   export default function SupplierDocumentsRoute() {
     const { supplierId, files } = useLoaderData<typeof loader>();

     return (
       <RecordDocuments
         files={files}
         id={supplierId}
         bucketPrefix="supplier"
         sourceDocument="Supplier"
         module="purchasing"
       />
     );
   }
   ```
2. Create `$customerId.documents.tsx` — identical but with `customerId`, `view: "sales"`, prefix `` `${companyId}/customer/${customerId}` ``, `bucketPrefix="customer"`, `sourceDocument="Customer"`, `module="sales"`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
ls apps/erp/app/routes/x+/supplier+/\$supplierId.documents.tsx apps/erp/app/routes/x+/customer+/\$customerId.documents.tsx
# Expected: both paths listed, no "No such file"
```

**Out of scope:** Do not add an `Outlet` — these routes have no child routes.

---

## Task 9: Add permission-gating to the sidebar hooks

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/purchasing/ui/Supplier/SupplierSidebar/useSupplierSidebar.tsx` — extend the filter at lines 125–129.
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerSidebar/useCustomerSidebar.tsx` — same change.

**Steps:**

1. The current filter is:
   ```ts
   ].filter(
     (item) =>
       item.role === undefined ||
       item.role.some((role) => permissions.is(role as Role))
   );
   ```
   `permissions.is(role)` tests the user's ROLE (employee / supplier / customer) — verified at `apps/erp/app/hooks/usePermissions.tsx:40-45`. It cannot express a module permission like `accounting_view`. `permissions.can(action, feature)` is the separate function for that (`usePermissions.tsx:26-31`).
2. Change the filter in BOTH files to also honour an optional `permission` field:
   ```ts
   ].filter((item) => {
     const roleOk =
       item.role === undefined ||
       item.role.some((role) => permissions.is(role as Role));
     const permissionOk =
       !("permission" in item) ||
       item.permission === undefined ||
       permissions.can(item.permission.action, item.permission.module);
     return roleOk && permissionOk;
   });
   ```
3. If TypeScript complains that `permission` does not exist on the array's inferred element type, add the field as optional to the object literal type. The array is built inline, so the simplest fix is to annotate the returned array's element type explicitly. **If the inline-array inference makes this awkward, STOP and report rather than restructuring the whole hook.**

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
```

**Out of scope:** Do NOT change the `role` field on any existing sidebar entry. Existing entries must keep behaving exactly as they do now.

---

## Task 10: Sidebar entries for Documents and Bank Accounts

**Depends on:** Task 6, Task 9

**Files:**
- Modify: `apps/erp/app/modules/purchasing/ui/Supplier/SupplierSidebar/useSupplierSidebar.tsx`
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerSidebar/useCustomerSidebar.tsx`

**Steps:**

1. In `useSupplierSidebar.tsx`, add two entries. Place Documents immediately after the existing `Default Attachments` entry (which uses `icon: <LuFiles />` at line ~87), and Bank Accounts after `Payment`:
   ```tsx
   {
     name: t`Documents`,
     to: path.to.supplierDocuments(supplierId),
     role: ["employee"],
     icon: <LuFiles />
   },
   {
     name: t`Bank Accounts`,
     to: path.to.supplierBankAccounts(supplierId),
     role: ["employee"],
     permission: { action: "view", module: "accounting" },
     icon: <LuLandmark />
   },
   ```
2. `LuFiles` is already imported in that file (line 6). Add `LuLandmark` to the `react-icons/lu` import list — note it already appears in a commented-out block at line ~122, so the name is correct but the import may need adding.
3. Do the same in `useCustomerSidebar.tsx` with `path.to.customerDocuments` / `path.to.customerBankAccounts`. Check which `Lu*` icons that file already imports and add what is missing.
4. Both `name` values use the `` t`...` `` template tag from `useLingui()`, matching every existing entry in these files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
grep -c "supplierDocuments\|supplierBankAccounts" apps/erp/app/modules/purchasing/ui/Supplier/SupplierSidebar/useSupplierSidebar.tsx
# Expected: 2
```

**Out of scope:** Do not remove the commented-out Shipping/Accounting blocks at the end of the supplier sidebar — they are pre-existing and unrelated.

---

## Task 11: Bank account validators and services

**Depends on:** Task 3

**Files:**
- Modify: `apps/erp/app/modules/purchasing/purchasing.models.ts` — add `supplierBankAccountValidator`.
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — add four functions.
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — add `customerBankAccountValidator`.
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — add four functions.
- Modify: `apps/erp/app/modules/purchasing/types.ts` and `apps/erp/app/modules/sales/types.ts` — export the row types.
- Copy from (precedent): `supplierProcessValidator` at `purchasing.models.ts:414`; `upsertSupplierProcess` at `purchasing.service.ts:2064`; `deleteSupplierProcess` at `purchasing.service.ts:275`.

**Steps:**

1. Add to `purchasing.models.ts` (near `supplierLocationValidator`, line ~400):
   ```ts
   export const supplierBankAccountValidator = z
     .object({
       id: zfd.text(z.string().optional()),
       supplierId: z.string().min(1, { message: "Supplier is required" }),
       name: zfd.text(z.string().min(1, { message: "Name is required" })),
       accountHolderName: zfd.text(z.string().optional()),
       bankName: zfd.text(z.string().optional()),
       countryCode: zfd.text(z.string().optional()),
       currencyCode: zfd.text(z.string().optional()),
       accountNumber: zfd.text(z.string().optional()),
       routingNumber: zfd.text(z.string().optional()),
       iban: zfd.text(z.string().optional()),
       swiftBic: zfd.text(z.string().optional()),
       isPrimary: zfd.checkbox(),
       active: zfd.checkbox(),
       notes: zfd.text(z.string().optional())
     })
     .refine((data) => data.accountNumber || data.iban, {
       message: "Either an account number or an IBAN is required",
       path: ["accountNumber"]
     })
     .refine((data) => !data.iban || isValidIban(data.iban), {
       message: "Invalid IBAN",
       path: ["iban"]
     })
     .refine((data) => !data.routingNumber || isValidAbaRouting(data.routingNumber), {
       message: "Invalid routing number",
       path: ["routingNumber"]
     })
     .refine((data) => !data.swiftBic || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(data.swiftBic.toUpperCase()), {
       message: "Invalid SWIFT/BIC code",
       path: ["swiftBic"]
     });
   ```
2. Create the two validation helpers in `packages/utils/src/bank.ts` and export them from `packages/utils/src/index.ts`:
   ```ts
   /** ISO 13616 IBAN check: rearrange, letters->digits, mod 97 must equal 1. */
   export function isValidIban(raw: string): boolean {
     const iban = raw.replace(/\s+/g, "").toUpperCase();
     if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(iban)) return false;
     const rearranged = iban.slice(4) + iban.slice(0, 4);
     const expanded = rearranged.replace(/[A-Z]/g, (c) =>
       (c.charCodeAt(0) - 55).toString()
     );
     // mod-97 over a string, digit by digit (the number exceeds Number.MAX_SAFE_INTEGER)
     let remainder = 0;
     for (const digit of expanded) {
       remainder = (remainder * 10 + Number(digit)) % 97;
     }
     return remainder === 1;
   }

   /** ABA routing checksum: 9 digits, weighted 3-7-1 sum mod 10 must equal 0. */
   export function isValidAbaRouting(raw: string): boolean {
     const digits = raw.replace(/\s+/g, "");
     if (!/^[0-9]{9}$/.test(digits)) return false;
     const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
     const sum = digits
       .split("")
       .reduce((acc, d, i) => acc + Number(d) * w[i], 0);
     return sum % 10 === 0;
   }
   ```
   Import them into the models file from `@carbon/utils`.
   **Check first whether `zfd.checkbox()` is the idiom used elsewhere in these models files** (`grep -n "zfd.checkbox" apps/erp/app/modules/*/*.models.ts`). If the repo uses a different boolean coercion, match it. If `zfd.checkbox` does not exist, STOP and report — do not invent a coercion.
3. Add to `purchasing.service.ts`, matching the `upsertSupplierProcess` shape exactly (two-arm union on `createdBy` vs `updatedBy`, `sanitize()` on update):
   ```ts
   export async function getSupplierBankAccounts(
     client: SupabaseClient<Database>,
     supplierId: string
   ) {
     return client
       .from("supplierBankAccount")
       .select("*")
       .eq("supplierId", supplierId)
       .eq("active", true)
       .order("isPrimary", { ascending: false })
       .order("name");
   }

   export async function getSupplierBankAccount(
     client: SupabaseClient<Database>,
     id: string
   ) {
     return client.from("supplierBankAccount").select("*").eq("id", id).single();
   }

   export async function upsertSupplierBankAccount(...)  // mirror upsertSupplierProcess
   export async function deleteSupplierBankAccount(...)  // mirror deleteSupplierProcess
   ```
   In `upsertSupplierBankAccount`, when `isPrimary` is true, first clear it on the party's other rows:
   ```ts
   await client
     .from("supplierBankAccount")
     .update({ isPrimary: false })
     .eq("supplierId", bankAccount.supplierId)
     .neq("id", idBeingSaved ?? "");
   ```
   Do this before the insert/update so the partial unique index never sees two primaries.
4. Mirror all of the above in the sales module for `customerBankAccount`.
5. Export the new functions and validators from each module's `index.ts` barrel, and add row types to `types.ts` following how `SupplierProcess` / `SupplierLocation` are declared there.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/utils
# Expected: exits 0
```

**Out of scope:** Do not build a Kysely transaction — these are simple supabase-client calls, matching every sibling service function. Do not add encryption or masking in the service layer; masking is presentation-only (Task 12).

---

## Task 12: Bank account form and list UI components

**Depends on:** Task 11

**Files:**
- Create: `apps/erp/app/modules/purchasing/ui/Supplier/SupplierBankAccountForm.tsx`
- Create: `apps/erp/app/modules/purchasing/ui/Supplier/SupplierBankAccounts.tsx`
- Create: `apps/erp/app/modules/sales/ui/Customer/CustomerBankAccountForm.tsx`
- Create: `apps/erp/app/modules/sales/ui/Customer/CustomerBankAccounts.tsx`
- Modify: the `index.ts` in each `ui/Supplier` / `ui/Customer` folder to export them.
- Copy from (precedent): `apps/erp/app/modules/purchasing/ui/Supplier/SupplierLocations.tsx` (list card with actions + ConfirmDelete) and `apps/erp/app/modules/purchasing/ui/Supplier/SupplierProcessForm.tsx` (drawer form with ValidatedForm).

**Steps:**

1. Read both precedent files fully before writing.
2. `SupplierBankAccountForm.tsx` — a drawer `ValidatedForm` with `validator={supplierBankAccountValidator}`, containing, in this order:
   - `<Hidden name="id" />`, `<Hidden name="supplierId" />`
   - `Input name="name"` label `` t`Name` ``
   - `Input name="accountHolderName"` label `` t`Account Holder` ``
   - `Input name="bankName"` label `` t`Bank Name` ``
   - `Country name="countryCode"` label `` t`Country` ``
   - `Currency name="currencyCode"` label `` t`Currency` ``
   - `Input name="accountNumber"` label `` t`Account Number` ``
   - `Input name="routingNumber"` label `` t`Routing Number` ``
   - `Input name="iban"` label `` t`IBAN` ``
   - `Input name="swiftBic"` label `` t`SWIFT / BIC` ``
   - `Boolean name="isPrimary"` label `` t`Primary Account` ``
   - `Boolean name="active"` label `` t`Active` ``
   - `TextArea name="notes"` label `` t`Notes` ``
   - `<CustomFormFields table="supplierBankAccount" />`
   - `<Submit isDisabled={isDisabled}>` where `isDisabled = !permissions.can(isEditing ? "update" : "create", "accounting")`

   All of `Input`, `TextArea`, `Boolean`, `Country`, `Currency`, `Hidden`, `Submit`, `CustomFormFields` are exported from `~/components/Form` (verified present in `apps/erp/app/components/Form/index.ts`).
3. `SupplierBankAccounts.tsx` — a `Card` listing accounts, following `SupplierLocations.tsx`:
   - `CardAction` with a `New` button → `path.to.newSupplierBankAccount(supplierId)`, gated `permissions.can("create", "accounting")`.
   - One row per account showing: `name`, a `Badge` reading `` t`Primary` `` when `isPrimary`, the bank name, and the **masked** number.
   - Masking helper, defined in the component file:
     ```ts
     function maskAccountNumber(value: string | null): string {
       if (!value) return "";
       const trimmed = value.replace(/\s+/g, "");
       if (trimmed.length <= 4) return "••••";
       return `••••${trimmed.slice(-4)}`;
     }
     ```
     Show `maskAccountNumber(account.iban ?? account.accountNumber)`.
   - A per-row reveal toggle (`useState<Set<string>>` of revealed ids, `LuEye` / `LuEyeOff` icon button) that swaps the masked string for the raw value. Add a comment above it stating this is presentation-only and the loader already returns the full value.
   - Row actions (Edit / Delete) gated on `permissions.can("update"/"delete", "accounting")`, plus `ConfirmDelete` wired to `path.to.deleteSupplierBankAccount(...)`, exactly as `SupplierLocations.tsx` does.
   - An `<Outlet />` at the end so the new/edit/delete child routes render.
4. Mirror both files for customer.
5. Every visible string Lingui-wrapped.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
grep -c "maskAccountNumber" apps/erp/app/modules/purchasing/ui/Supplier/SupplierBankAccounts.tsx
# Expected: 2 or more (definition plus at least one use)
```

**Out of scope:** Do not build an approval/pending-change workflow — spec decision D6 defers it. Do not add a "verify with supplier" step.

---

## Task 13: Bank account routes

**Depends on:** Task 11, Task 12

**Files:**
- Create: `apps/erp/app/routes/x+/supplier+/$supplierId.bank-accounts.tsx`
- Create: `apps/erp/app/routes/x+/supplier+/$supplierId.bank-accounts.new.tsx`
- Create: `apps/erp/app/routes/x+/supplier+/$supplierId.bank-accounts.$id.tsx`
- Create: `apps/erp/app/routes/x+/supplier+/$supplierId.bank-accounts.delete.$id.tsx`
- Create: the four mirrored `$customerId.bank-accounts*.tsx` files.
- Copy from (precedent): `$supplierId.locations.tsx`, `$supplierId.locations.new.tsx`, `$supplierId.processes.$id.tsx`, `$supplierId.processes.delete.$id.tsx`.

**Steps:**

1. **List route** (`$supplierId.bank-accounts.tsx`) — mirror `$supplierId.locations.tsx` exactly, but:
   - `requirePermissions(request, { view: "accounting" })`
   - call `getSupplierBankAccounts(client, supplierId)`
   - on error, redirect to `path.to.supplier(supplierId)` with a flash message `"Failed to fetch supplier bank accounts"`
   - render `<SupplierBankAccounts bankAccounts={bankAccounts} />`
2. **New route** — mirror `$supplierId.locations.new.tsx`:
   - `requirePermissions(request, { create: "accounting" })`
   - validate with `supplierBankAccountValidator`
   - call `upsertSupplierBankAccount(client, { ...data, supplierId, companyId, createdBy: userId, customFields: setCustomFields(formData) })`
   - redirect to `path.to.supplierBankAccounts(supplierId)` with success flash
   - the default export renders `SupplierBankAccountForm` with `initialValues` of empty strings, `isPrimary: false`, `active: true`, and `countryCode: company?.countryCode ?? ""`
   - `userId` comes from `requirePermissions` — confirm the exact destructured name against the precedent file (`grep -n "userId" apps/erp/app/routes/x+/supplier+/\$supplierId.processes.new.tsx`). **If `requirePermissions` does not return `userId`, STOP and report.**
3. **Edit route** (`$supplierId.bank-accounts.$id.tsx`) — mirror `$supplierId.processes.$id.tsx`: loader `getSupplierBankAccount`, action with `update: "accounting"` calling `upsertSupplierBankAccount` with `updatedBy`.
4. **Delete route** — mirror `$supplierId.processes.delete.$id.tsx`: `delete: "accounting"`, `deleteSupplierBankAccount`, `ConfirmDelete` reading the row from `useRouteData` on `path.to.supplierBankAccounts(supplierId)`.
5. Mirror all four for customer with `sales`→ still `accounting` permissions (the permission module is accounting on BOTH sides — that is the point of spec decision D2).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0
ls apps/erp/app/routes/x+/supplier+/ | grep -c bank-accounts
# Expected: 4
ls apps/erp/app/routes/x+/customer+/ | grep -c bank-accounts
# Expected: 4
```

**Out of scope:** Do not gate these routes on `purchasing` or `sales` — they are accounting-gated by design.

---

## Task 14: Full verification

**Depends on:** all previous tasks

**Steps:**

1. Typecheck the touched packages:
   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/database --filter=@carbon/utils
   ```
2. Lint:
   ```bash
   pnpm run lint
   ```
3. Unit tests:
   ```bash
   pnpm run test
   ```
4. Dataset / backup pre-commit gates (these read the live schema and are run by `.husky/pre-commit`; the migrations are already applied by Task 3):
   ```bash
   pnpm db:check:datasets
   pnpm db:check:backups
   ```
5. Confirm no English-only strings were introduced in the new UI files:
   ```bash
   grep -rn "label=\"" apps/erp/app/modules/purchasing/ui/Supplier/SupplierBankAccount*.tsx apps/erp/app/modules/sales/ui/Customer/CustomerBankAccount*.tsx apps/erp/app/components/RecordDocuments.tsx
   # Expected: no output. A raw label="..." string is untranslated; it must be label={t`...`}.
   ```
6. Report results honestly — including any failures — and list what was NOT verified (the app was not launched; no browser testing was done).

**Verify:** all commands above exit 0, except where a pre-existing failure is present on the branch — in that case report it as pre-existing rather than fixing unrelated code.

**Out of scope:** Do NOT run `git commit`. Do not launch the dev server unless the user asks.
