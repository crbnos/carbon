# Certificate of Conformance — implementation plan

**Spec:** .ai/specs/2026-10-04-certificate-of-conformance.md
**Research:** .ai/research/certificate-of-conformance.md
**Run record:** .ai/runs/2026-10-04-certificate-of-conformance.md
**Branch:** `naveen/certificate-of-conformance`. Create it from `main`, not from `naveen/spec-writing-skill-33956e`.

> ✅ **Q1 resolved (2026-10-04): yes.** The human approved the new `customerShipping.certificateOfConformanceRequired` column. Task 1 keeps its `customerShipping` statement, and Task 11 stays in the plan.

> 🛑 The user said "do not execute" for this run. This plan stops at approval. `/execute` runs only on a later, explicit request.

## Progress

- [x] Task 0: Confirm Q1 with the human (gate) — answered yes, 2026-10-04
- [ ] Task 1: Write the migration, the authz rule and the seed sequence
- [ ] Task 2: Apply the migration, regenerate types, ship the authz rule
- [ ] Task 3: Add the `certificateOfConformance` document type to the template model
- [ ] Task 4: Build the CoC PDF component, its blocks, sample and render test
- [ ] Task 5: Add the quality validators and service functions
- [ ] Task 6: Write the issue/render server module and its unit test
- [ ] Task 7: Void the CoC inside the `post-shipment` void transaction
- [ ] Task 8: Add the issue, void, preview and download routes plus paths
- [ ] Task 9: Add the issue option to the post modal and the post route
- [ ] Task 10: Add the CoC card and modals to the shipment page
- [ ] Task 11: Add the "CoC required" flag to the customer shipping form (Q1)
- [ ] Task 12: Add the Quality → Certificates list page
- [ ] Task 13: Update the rule, the module guide, the Task Router and the product docs
- [ ] Task 14: Run the full validation gates and fill translations
- [ ] Task 15: Run the manual acceptance check (the user verifies in the browser)

## Dependencies

- Task 2 needs Task 1. Every later task needs Task 2 (the generated types).
- Task 4 needs Task 3.
- Task 6 needs Tasks 4 and 5.
- Task 8 needs Task 6.
- Tasks 9 and 10 need Task 8.
- Task 7 needs only Task 2. It is independent of Tasks 3–6 and can run in parallel with them.
- Task 11 needs only Tasks 2 and 5.
- Task 12 needs Tasks 2, 5 and 8. Task 8 adds the `path.to.qualityCertificates` helper.
- Tasks 11 and 12 do not depend on each other. Neither task needs Tasks 6, 7, 9 or 10.
- Task 13 needs Tasks 1–12. Task 14 needs Task 13. Task 15 needs Task 14.

---

## Task 0: Confirm Q1 with the human (gate)

**Depends on:** none
**Files:**
- Modify: `.ai/specs/2026-10-04-certificate-of-conformance.md` — check Q1 and record the answer

**Steps:**
1. Ask the human: "Can we add `certificateOfConformanceRequired BOOLEAN NOT NULL DEFAULT FALSE` to `customerShipping`?"
2. Record the answer inline on Q1 as `**Answer:** …`, then check the box.
3. If the answer is "no", apply the edits that the gate box at the top of this plan lists.

**Verify:**
```bash
sed -n '/^## Open Questions/,/^## Changelog/p' .ai/specs/2026-10-04-certificate-of-conformance.md | grep -c "^- \[ \]"
# Expected: 0 (only the Open Questions section counts; Acceptance Criteria boxes stay open until Task 15)
```

**Out of scope:** All code.

---

## Task 1: Write the migration, the authz rule and the seed sequence

**Depends on:** Task 0
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_certificate-of-conformance.sql` (made by the command below)
- Modify: `packages/database/src/authz/manifest.ts` — add one rule next to `gauge` (line ~619)
- Modify: `packages/database/src/seed-data.ts` — add one sequence entry after `inventoryCount` (line ~308)
- Copy from (precedent): `packages/database/supabase/migrations/20260627143041_inventory-count.sql` (sequence insert), `.claude/rules/conventions-database.md`

**Steps:**
1. Read `.claude/rules/workflow-database-migration.md`.
2. Run `pnpm db:migrate:new certificate-of-conformance`.
3. Write this SQL into the new file:

```sql
DO $$ BEGIN
  CREATE TYPE "certificateOfConformanceStatus" AS ENUM ('Issued', 'Voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "certificateOfConformance" (
    "id" TEXT NOT NULL DEFAULT id('coc'),
    "companyId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL REFERENCES "shipment"("id") ON DELETE RESTRICT,
    "customerId" TEXT NOT NULL REFERENCES "customer"("id") ON DELETE RESTRICT,
    "status" "certificateOfConformanceStatus" NOT NULL DEFAULT 'Issued',
    "signedBy" TEXT NOT NULL REFERENCES "user"("id"),
    "signerName" TEXT NOT NULL,
    "signerTitle" TEXT NOT NULL,
    "signedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "documentPath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "voidedBy" TEXT REFERENCES "user"("id"),
    "voidedAt" TIMESTAMP WITH TIME ZONE,
    "voidReason" TEXT,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY ("id", "companyId"),
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
    CONSTRAINT "certificateOfConformance_void_check" CHECK (
      ("status" = 'Voided') = ("voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "certificateOfConformance_companyId_idx" ON "certificateOfConformance" ("companyId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_shipmentId_idx" ON "certificateOfConformance" ("shipmentId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_customerId_idx" ON "certificateOfConformance" ("customerId");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_signedBy_idx" ON "certificateOfConformance" ("signedBy");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_voidedBy_idx" ON "certificateOfConformance" ("voidedBy");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_createdBy_idx" ON "certificateOfConformance" ("createdBy");
CREATE INDEX IF NOT EXISTS "certificateOfConformance_updatedBy_idx" ON "certificateOfConformance" ("updatedBy");

ALTER TABLE "certificateOfConformance" DROP CONSTRAINT IF EXISTS "certificateOfConformance_companyId_certificateId_key";
ALTER TABLE "certificateOfConformance"
  ADD CONSTRAINT "certificateOfConformance_companyId_certificateId_key" UNIQUE ("companyId", "certificateId");

CREATE UNIQUE INDEX IF NOT EXISTS "certificateOfConformance_one_issued_per_shipment"
  ON "certificateOfConformance" ("companyId", "shipmentId") WHERE "status" = 'Issued';

-- Q1 (Ask-First). Delete this statement if Task 0 answered "no".
ALTER TABLE "customerShipping"
  ADD COLUMN IF NOT EXISTS "certificateOfConformanceRequired" BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
SELECT 'certificateOfConformance', 'Certificate of Conformance', 'COC', NULL, 0, 6, 1, "id"
FROM "company"
ON CONFLICT DO NOTHING;
```

4. Do not write any `CREATE POLICY` in the migration.
5. In `manifest.ts`, add `certificateOfConformance: company("quality"),` directly after `gaugeType: company("quality"),`.
6. In `seed-data.ts`, add this entry after the `inventoryCount` entry:
   `{ table: "certificateOfConformance", name: "Certificate of Conformance", prefix: "COC", suffix: null, next: 0, size: 6, step: 1 },`
7. Run the license-header fixer: `pnpm --filter @carbon/checks license-headers`.

If `shipment_pkey` or `customer_pkey` is now `("id","companyId")` in a newer migration, STOP and report. Do not improvise the FK.

**Verify:**
```bash
grep -rn "PRIMARY KEY" packages/database/supabase/migrations/*shipment*.sql | grep -i '"shipment_pkey"'
# Expected: only the 20250209170952_shipment.sql line, PRIMARY KEY ("id")
grep -n "certificateOfConformance" packages/database/src/authz/manifest.ts packages/database/src/seed-data.ts
# Expected: one hit in each file
```

**Out of scope:** Policies in SQL. An `item`-level flag (spec Q6). A per-customer statement column (spec Q5).

---

## Task 2: Apply the migration, regenerate types, ship the authz rule

**Depends on:** Task 1
**Files:**
- Modify (generated, never by hand): `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`
- Create (generated): `packages/database/supabase/migrations/<timestamp>_authz-certificate-of-conformance.sql`

**Steps:**
1. 🛑 Ask the human before you apply the migration (memory rule: no silent database writes).
2. Run `pnpm db:migrate`.
3. Run `pnpm run generate:types`.
4. Run `pnpm --filter @carbon/database authz migration certificate-of-conformance`.

**Verify:**
```bash
grep -c "certificateOfConformance" packages/database/src/types.ts
# Expected: a number > 0
pnpm --filter @carbon/database authz check
# Expected: exit code 0 (no drift)
pnpm --filter @carbon/database exec vitest run src/authz
# Expected: all tests pass (migration.test.ts sees the generated block)
```

**Out of scope:** Hand edits to the generated types or to the generated authz migration.

---

## Task 3: Add the `certificateOfConformance` document type to the template model

**Depends on:** Task 2
**Files:**
- Modify: `packages/documents/src/template/schema.ts` — the enum (lines 386–398) and two new built-in block schemas
- Modify: `packages/documents/src/template/defaults.ts` — `BLOCK_META` (line ~101), `DEFAULT_TEMPLATES` (line ~428), `DOCUMENT_CATALOG` (line ~689)
- Modify: `packages/documents/src/template/merge.ts` — `CERTIFICATE_OF_CONFORMANCE_MERGE_FIELDS` + a `MERGE_FIELDS` key (line ~233)
- Modify: `packages/documents/src/template/template.test.ts` — one new case
- Copy from (precedent): the `packingSlip` entries in the same files; `watermarkBlock` (`schema.ts:229`) for a built-in block with options

**Steps:**
1. Read `.claude/rules/document-template-customizer.md`.
2. Add `"certificateOfConformance"` to the end of `documentTemplateTypeSchema`.
3. Add two built-in block types to `blockSchema`, each with `id` and `visible` only:
   - `certificateStatement`, which also has an optional `content` (JSONContent), copied from the `terms` block schema;
   - `certificateSignature`.
4. Add `BLOCK_META` entries:
   - `certificateStatement: { label: "Conformance statement", isBuiltIn: true, removable: false, hideable: false, addable: false }`;
   - the same shape for `certificateSignature`, labelled `"Signature"`.
5. Add a `DEFAULT_TEMPLATES.certificateOfConformance` entry. Copy the `packingSlip` entry, but use blocks in this order:
   `header`, `details`, `parties`, `lineItems`, `certificateStatement`, `certificateSignature`.
6. Put the default statement (spec "Default statement") into the `certificateStatement` block's `content` as one paragraph with merge tokens.
7. Add a `DOCUMENT_CATALOG` entry: `{ type: "certificateOfConformance", label: "Certificate of Conformance", group: "Quality", supported: true, themeColors: "full" }`.
8. If `group` is a closed union without `"Quality"`, use `"Inventory"`. Note the change in the spec changelog.
9. Add `CERTIFICATE_OF_CONFORMANCE_MERGE_FIELDS` with these tokens: `customerPo`, `salesOrderId`, `shipmentId`, `certificateId` and `customer.name`. Copy the `{ token, label, group }` shape of `PACKING_SLIP_MERGE_FIELDS`.
10. Add the key `certificateOfConformance: CERTIFICATE_OF_CONFORMANCE_MERGE_FIELDS` to `MERGE_FIELDS`.
11. In `template.test.ts`, add a case. It asserts that `resolveTemplate("certificateOfConformance", null)` returns the 6 blocks in the order of Step 5.
12. Fix every type error that the new block types cause in the other registries. Each registry is `Partial<Record<…>>`, so no other doc needs an entry. If typecheck says a registry is a full `Record`, add `() => null` for both new keys.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: Tasks: 1 successful (no errors)
pnpm --filter @carbon/documents test
# Expected: all tests pass, including the new resolveTemplate case
```

**Out of scope:** Editor UI changes in `DocumentTemplateEditor/`. A `documentPreview.server.ts` live-record list (packingSlip has none either).

---

## Task 4: Build the CoC PDF component, its blocks, sample and render test

**Depends on:** Task 3
**Files:**
- Create: `packages/documents/src/pdf/CertificateOfConformancePDF.tsx`
- Create: `packages/documents/src/pdf/blocks/certificateOfConformance/{types.ts,vars.ts,registry.tsx,index.ts,HeaderBlock.tsx,DetailsBlock.tsx,PartiesBlock.tsx,LineItemsBlock.tsx,StatementBlock.tsx,SignatureBlock.tsx}`
- Create: `packages/documents/src/pdf/certificateOfConformance.samples.ts`
- Create: `packages/documents/src/pdf/CertificateOfConformancePDF.test.ts`
- Modify: `packages/documents/src/pdf/preview-documents.tsx` — add a `DOCUMENT_PDFS` entry (next to line 53)
- Modify: `packages/documents/src/pdf/index.ts` — export the component
- Copy from (precedent): `packages/documents/src/pdf/PackingSlipPDF.tsx`, `pdf/blocks/packingSlip/*`, `pdf/packingSlip.samples.ts`, `pdf/QuotePDF.test.ts`

**Steps:**
1. Define `CertificateOfConformanceData` in `types.ts` with these fields:
   - `company`
   - `customer: { name }`
   - `shippingAddress`
   - `certificateId: string | null`
   - `shipmentId`
   - `salesOrderId`
   - `customerPo: string | null`
   - `trackingNumber: string | null`
   - `issuedDate: string` (already formatted)
   - `lines: CertificateLine[]`
   - `mode: "preview" | "issued"`
   - `signer: { name; title; signedAt } | null` (signedAt already formatted)
2. Define `CertificateLine = { lineNumber, partNumber, revision, description, customerPartNumber, quantity, unitOfMeasure, trackingNumbers: string[] }`.
3. Write `CertificateOfConformancePDF.tsx`. Copy the props pattern and the visible-block loop of `PackingSlipPDF.tsx` lines 63 and 121–148. Call `resolveTemplate("certificateOfConformance", template)`.
4. Build `registry.tsx`. Copy `packingSlip/registry.tsx`, spread `...extensionBlocks`, and map the 6 block types to the new components.
5. Copy `HeaderBlock` from the packing slip block of the same name.
6. Copy `PartiesBlock` from the packing slip block of the same name.
7. In `DetailsBlock`, show the certificate number, date, shipment, sales order, customer PO and tracking number.
8. In preview mode, `DetailsBlock` shows "PREVIEW" as the certificate number.
9. `LineItemsBlock` shows one row per line. It shows part number + revision, description, customer part number, quantity + UoM, and lot/serial numbers joined with ", ".
10. In `StatementBlock`, call `resolveTerms(block, null, vars)` on the block content. `vars` comes from `vars.ts`.
11. If `mode === "issued"`, `SignatureBlock` shows "Electronically signed by {name}, {title}", the signed time and the certificate number.
12. If `mode === "preview"`, `SignatureBlock` shows a bordered banner "PREVIEW — NOT ISSUED" and no signer.
13. Write `certificateOfConformance.samples.ts` with 2 lines, one lot and two serials, in issued mode.
14. Add `certificateOfConformance: { Component: CertificateOfConformancePDF, sample: SAMPLE_CERTIFICATE_OF_CONFORMANCE }` to `DOCUMENT_PDFS`.
15. Write `CertificateOfConformancePDF.test.ts`. Copy the `renderToBuffer` + `createElement` pattern from `QuotePDF.test.ts`. Write 2 cases:
    - issued mode renders a non-empty buffer;
    - preview mode renders a non-empty buffer with `signer: null`.
16. Run the license-header fixer on the new files.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/documents
# Expected: no errors
pnpm --filter @carbon/documents exec vitest run src/pdf/CertificateOfConformancePDF.test.ts
# Expected: 2 passed
```

**Out of scope:** Thumbnails. Inspection data. Material-cert attachments (spec Q8).

---

## Task 5: Add the quality validators and service functions

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/modules/quality/quality.models.ts`
- Modify: `apps/erp/app/modules/quality/quality.service.ts`
- Copy from (precedent): `getGauges` in `quality.service.ts` (list with `GenericQueryFilters`), `.claude/rules/conventions-services.md`

**Steps:**
1. Read `.claude/rules/conventions-services.md` and `apps/erp/app/modules/quality/AGENTS.md`.
2. Add `certificateOfConformanceStatus = ["Issued", "Voided"] as const` in `quality.models.ts`.
3. Add `issueCertificateOfConformanceValidator = z.object({ signerTitle: z.string().min(1), attest: zfd.checkbox().refine(Boolean) })` in `quality.models.ts`.
4. Add `voidCertificateOfConformanceValidator = z.object({ voidReason: z.string().min(1) })` in `quality.models.ts`.
5. Add `getCertificatesOfConformance(client, companyId, args: GenericQueryFilters & { search: string | null })` to `quality.service.ts`.
   - It selects `*, customer(name), shipment(shipmentId)`.
   - The `search` matches `certificateId` with `ilike`.
   - Copy the `setGenericQueryFilters` usage from `getGauges`.
6. Add `getCertificatesOfConformanceByShipment(client, companyId, shipmentId)` to `quality.service.ts`. It returns every row for the shipment, ordered by `createdAt` descending.
7. Add `voidCertificateOfConformance(client, { id, companyId, userId, voidReason })` to `quality.service.ts`.
   - It runs an update `.eq("id").eq("companyId").eq("status","Issued")`.
   - It sets `status: "Voided"`, `voidedBy`, `voidedAt`, `voidReason`, `updatedBy` and `updatedAt`.
   - Take the timestamp from `now(timeZone).toAbsoluteString()` with `@internationalized/date`, passing `timeZone` in.
   - It returns `{ data, error }` and never throws.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** The issue function. It renders PDFs, so it belongs in the `.server.ts` file of Task 6, not in the browser-bundled service.

---

## Task 6: Write the issue/render server module and its unit test

**Depends on:** Tasks 4, 5
**Files:**
- Create: `apps/erp/app/modules/quality/certificate-of-conformance.server.ts` (not exported from `quality/index.ts`)
- Create: `apps/erp/app/modules/quality/certificate-of-conformance.server.test.ts`
- Copy from (precedent): `apps/erp/app/routes/file+/shipment+/$id[.]pdf.tsx` lines 48–233 (Sales Order branch, template resolve, stream→Buffer); `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` lines 300–370 (upload + `upsertDocument`)

**Steps:**
1. Export the pure function `buildCertificateLines(shipmentLines, trackedEntities, customerParts)` → `CertificateLine[]`.
   - It drops lines with `shippedQuantity <= 0`.
   - It groups `trackedEntity.readableId` by `attributes["Shipment Line"]`.
   - It reads the customer part number from the `customerParts` map keyed by `itemId`.
2. Export `loadCertificateData(client, companyId, shipmentId)`. It runs these reads in one `Promise.all`:
   - `getCompany`
   - `getShipment`
   - `getShipmentLinesWithDetails`
   - `getShipmentTracking`
   - the template resolve chain (`getDocumentTemplate` … `resolveSections`, `ensureFont`)
3. After the `Promise.all`, read `salesOrder` (`salesOrderId`, `customerReference`, `opportunityId`, `customerId`) with one select.
4. Read the customer and the ship-to location as in the Sales Order branch of the shipment PDF route.
5. Read `customerPartToItem` with one `.in("itemId", itemIds).eq("customerId", customerId)` query. Never query in a loop.
6. If `shipment.sourceDocument !== "Sales Order"`, return `{ data: null, error: "Certificates are only issued for Sales Order shipments" }`.
7. Export `renderCertificatePdf(data, template, sections)` → `Promise<Buffer>`. It calls `renderToStream`, then collects the chunks as the shipment PDF route does at lines 224–233.
8. Export `issueCertificateOfConformance({ client, serviceRole, companyId, userId, shipmentId, signerTitle })`. It does these steps in order:
   1. Read the shipment. Refuse unless `status === "Posted"` and `sourceDocument === "Sales Order"`.
   2. Read Issued rows for the shipment. Refuse if one exists.
   3. `getNextSequence(client, "certificateOfConformance", companyId)` → `certificateId`.
   4. Read `user.fullName` for `userId` → `signerName`.
   5. `timeZone = await getCompanyTimeZone(db, companyId)` (`~/modules/shared/timezone.server`). Then take `signedAt = now(timeZone)`.
   6. Format `signedAt` with `formatDate` / `formatDateTime` from `@carbon/utils` for the PDF. Never use JS `Date`.
   7. `loadCertificateData`, then `renderCertificatePdf` with `mode: "issued"` and the signer.
   8. Compute `contentHash = createHash("sha256").update(buffer).digest("hex")` (`import { createHash } from "node:crypto"`).
   9. Set `path`.
      - With an `opportunityId`: `${companyId}/opportunity/${opportunityId}/${certificateId}.pdf`.
      - Otherwise: `${companyId}/certificate-of-conformance/${certificateId}.pdf`.
   10. `storage(serviceRole).company(companyId).upload(path, buffer, { contentType: "application/pdf", upsert: true })`.
   11. `upsertDocument(serviceRole, { path, name: \`${certificateId}.pdf\`, size, sourceDocument: "Shipment", sourceDocumentId: shipmentId, readGroups: [userId], writeGroups: [userId], createdBy: userId, companyId })`.
   12. Insert ONE `certificateOfConformance` row with every column, including `signedAt: signedAt.toAbsoluteString()`. There is no later update.
   13. Return `{ data: { id, certificateId }, error: null }`. On any failure, return `{ data: null, error: message }`.
9. Take the `db` for `getCompanyTimeZone` from `getDatabaseClient()` (`~/services/database.server`). Never build a client in this file.
10. Write `certificate-of-conformance.server.test.ts` for `buildCertificateLines` only, with 4 cases:
    - a batch line with lot `L-100`;
    - a serial line with `S1` and `S2`;
    - a line with shipped quantity 0 — the function drops it;
    - a customer part number lookup.
11. Run the license-header fixer.

If `getShipmentLinesWithDetails` has no `revision` or `itemReadableId` field, add the item embed to the select in this module. Do not change the shared service function.

**Verify:**
```bash
pnpm --filter erp exec vitest run app/modules/quality/certificate-of-conformance.server.test.ts
# Expected: 4 passed
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** Email (spec Q9). The `$id[.]pdf.tsx` `@ts-expect-error` loader hack. Do not copy it.

---

## Task 7: Void the CoC inside the `post-shipment` void transaction

**Depends on:** Task 2
**Files:**
- Modify: `packages/server-functions/src/post-shipment/index.ts` — Sales Order void branch (case `"void"` at ~3033; Sales Order at ~3042; status update at ~3463–3473)

**Steps:**
1. Find the `trx.updateTable("shipment").set({ status: "Voided", … })` call in the Sales Order void branch.
2. Directly after it, inside the same `trx`, add:

```ts
await trx
  .updateTable("certificateOfConformance")
  .set({
    status: "Voided",
    voidedBy: userId,
    voidedAt: today,
    voidReason: "Shipment voided",
    updatedBy: userId,
    updatedAt: today
  })
  .where("shipmentId", "=", shipmentId)
  .where("companyId", "=", companyId)
  .where("status", "=", "Issued")
  .execute();
```

3. Use the same `today` value that the shipment update uses.
4. If `today` is a date string, not a timestamp, STOP and report. `voidedAt` is a `timestamptz`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/server-functions
# Expected: no errors
pnpm --filter @carbon/server-functions test
# Expected: all existing tests pass
```

**Out of scope:** The other void branches. Only Sales Order shipments carry a CoC.

---

## Task 8: Add the issue, void, preview and download routes plus paths

**Depends on:** Task 6
**Files:**
- Create: `apps/erp/app/routes/x+/shipment+/$shipmentId.certificate.tsx` (action only)
- Create: `apps/erp/app/routes/x+/shipment+/$shipmentId.certificate.void.$certificateId.tsx` (action only)
- Create: `apps/erp/app/routes/file+/shipment+/$id.certificate-preview[.]pdf.tsx` (loader)
- Create: `apps/erp/app/routes/file+/certificate-of-conformance+/$id[.]pdf.tsx` (loader)
- Modify: `apps/erp/app/utils/path.ts` — near `file.shipment` (~1132) and `shipmentVoid` (~2227)
- Copy from (precedent): `apps/erp/app/routes/x+/shipment+/$shipmentId.void.tsx`, `apps/erp/app/routes/file+/shipment+/$id[.]pdf.tsx`

**Steps:**
1. In `path.ts`, add `file.certificateOfConformance(id)` → `${file}/certificate-of-conformance/${id}.pdf`.
2. Add `file.shipmentCertificatePreview(id)` → `${file}/shipment/${id}.certificate-preview.pdf`.
3. Add `shipmentCertificate(id)` → `${x}/shipment/${id}/certificate`.
4. Add `shipmentCertificateVoid(id, certificateId)` → `${x}/shipment/${id}/certificate/void/${certificateId}`.
5. Add `qualityCertificates` → `${x}/quality/certificates`.
6. Issue action: `requirePermissions(request, { create: "quality", view: "inventory" })`.
   1. Validate with `issueCertificateOfConformanceValidator`.
   2. Call `issueCertificateOfConformance` with `serviceRole = getCarbonServiceRole()`.
   3. Return `data(null, await flash(request, success|error(...)))`.
7. Void action: `requirePermissions(request, { delete: "quality" })`.
   1. Validate with `voidCertificateOfConformanceValidator`.
   2. Call `voidCertificateOfConformance` and flash the result.
8. Preview loader: `requirePermissions(request, { view: "inventory" })`.
   1. Return 404 if the shipment's `companyId` differs from the user's company.
   2. Call `loadCertificateData` and `renderCertificatePdf` in preview mode with `certificateId: null`.
   3. Return the response with `Content-Disposition: inline`.
9. Download loader: `requirePermissions(request, { view: "inventory" })`.
   1. Read the row with `.eq("id").eq("companyId")`. Return 404 if there is none.
   2. `storage(client).company(companyId).download(row.documentPath)`.
   3. Return the bytes as `application/pdf`, inline, with filename `${certificateId}.pdf`.
   4. Never re-render.
10. Read `.claude/rules/flash-system.md` before you write the flash calls.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
grep -n "shipmentCertificate\|certificateOfConformance\|qualityCertificates" apps/erp/app/utils/path.ts
# Expected: 5 entries
```

**Out of scope:** Batch download. Email.

---

## Task 9: Add the issue option to the post modal and the post route

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/inventory/ui/Shipments/ShipmentPostModal.tsx` — new section + form data
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.tsx` — loader returns `certificateRequired`, `certificates`, `signerTitle`
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx` — issue after a successful post
- Copy from (precedent): `ShipmentPostModal.tsx` itself (its `Trans`/`useLingui` usage); `usePermissions` in `apps/erp/app/modules/quality/ui/Issue/IssuesTable.tsx:60,354`

**Steps:**
1. In the `$shipmentId.tsx` loader, add 3 reads to the existing `Promise.all`:
   - `customerShipping.certificateOfConformanceRequired` for the shipment's customer → `certificateRequired: boolean` (false if there is no row);
   - `getCertificatesOfConformanceByShipment` → `certificates`;
   - `getEmployeeJob(client, userId, companyId)` (`people.service.ts:222`) → `signerTitle: data?.title ?? ""`.
2. Return the 3 new keys with the existing keys.
3. In `ShipmentPostModal`, read `certificateRequired`, `signerTitle` and `shipment.sourceDocument` from `useRouteData`.
4. If `sourceDocument === "Sales Order"` and `permissions.can("create","quality")`, render a section with 3 controls:
   - a checkbox `issueCertificate`, default `certificateRequired`;
   - an input `signerTitle`, default `signerTitle`;
   - an attestation checkbox `attest` with the text "I am authorized to certify these parts conform."
5. If `certificateRequired` is true and the user lacks `quality_create`, render one warning line: "This customer requires a Certificate of Conformance. A quality user must issue it after posting."
6. Change the submit so it builds `FormData` from the section's field values instead of `new FormData()`. Keep `ruleViolations.submit(formData)`.
7. Disable submit while `issueCertificate` is checked and `attest` is not.
8. In `$shipmentId.post.tsx`, after the `post-shipment` invoke succeeds, read `issueCertificate`, `signerTitle` and `attest` from the form data.
9. If the form sends `issueCertificate`, read `permissions` from the `requirePermissions` result. Check `quality_create` there.
10. If the check passes, call `issueCertificateOfConformance`.
11. If issue fails, log with `logger.error`, keep the post, and flash `error(…, "Shipment posted, but the certificate was not issued")`.
12. Never revert the post because of an issue failure.

If `useRuleViolations().submit` cannot take a populated `FormData`, STOP and report.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm run lint
# Expected: no Biome errors in the touched files
```

**Out of scope:** Blocking the post (spec Q3). Rule-violation logic.

---

## Task 10: Add the CoC card and modals to the shipment page

**Depends on:** Task 8
**Files:**
- Create: `apps/erp/app/modules/quality/ui/CertificateOfConformance/ShipmentCertificateCard.tsx`
- Create: `apps/erp/app/modules/quality/ui/CertificateOfConformance/IssueCertificateModal.tsx`
- Create: `apps/erp/app/modules/quality/ui/CertificateOfConformance/VoidCertificateModal.tsx`
- Create: `apps/erp/app/modules/quality/ui/CertificateOfConformance/index.ts`
- Modify: `apps/erp/app/routes/x+/shipment+/$shipmentId.details.tsx` — render the card after `<ShipmentLines/>`. Import it from `~/modules/quality/ui/CertificateOfConformance`, as `gauges.tsx` imports `~/modules/quality/ui/Gauge/GaugesTable`. The quality module has no UI barrel, so do not create one.
- Copy from (precedent): `apps/erp/app/modules/inventory/ui/Shipments/ShipmentNotes.tsx` (Card shell), `ShipmentVoidModal.tsx` (destructive modal with `fetcher.Form`), `ShipmentPostModal.tsx` (modal shell)

**Steps:**
1. Run the `carbon-design` skill checklist for a detail-page card before you write the UI.
2. `ShipmentCertificateCard` reads `shipment`, `certificates` and `certificateRequired` from `useRouteData(path.to.shipment(id))`.
3. If `shipment.sourceDocument !== "Sales Order"`, the card returns `null`.
4. The card shows one of these states:
   - **Issued:** number, signer name, title, signed date (`formatDate`), a Download link to `path.to.file.certificateOfConformance(id)`, and a Void button (only with `delete:quality`).
   - **Not issued:** a "Required" warning badge when `certificateRequired`, a Preview link to `path.to.file.shipmentCertificatePreview(shipmentId)`, and an Issue button (only with `create:quality`).
5. Disable the Issue button with a tooltip "Post the shipment first" while `status !== "Posted"`.
6. Show voided rows in a collapsed list under a "Voided" label, each with number, reason and download.
7. In `IssueCertificateModal`, build a `ValidatedForm` with `issueCertificateOfConformanceValidator`, `action={path.to.shipmentCertificate(shipmentId)}` and 3 fields:
   - a read-only signer name;
   - `signerTitle`;
   - `attest`.
8. In `VoidCertificateModal`, show a destructive `Alert` and a required `voidReason` textarea. It submits to `path.to.shipmentCertificateVoid(shipmentId, id)`.
9. Wrap every string in Lingui `Trans` / `t`.
10. Run the license-header fixer.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
pnpm run lint
# Expected: no Biome errors
```

**Out of scope:** Styling outside Carbon components. A MES view.

---

## Task 11: Add the "CoC required" flag to the customer shipping form (Q1)

**Depends on:** Tasks 2, 5. Skip this task if Task 0 answered "no".
**Files:**
- Modify: `apps/erp/app/modules/sales/sales.models.ts` — `customerShippingValidator` (line ~231)
- Modify: `apps/erp/app/modules/sales/ui/Customer/CustomerShippingForm.tsx` — add one field
- Modify: `apps/erp/app/routes/x+/customer+/$customerId.shipping.tsx` — only if the loader picks columns explicitly
- Copy from (precedent): a `Boolean` field in another `ValidatedForm` (grep `<Boolean` in `apps/erp/app/modules/sales/ui`)

**Steps:**
1. Add `certificateOfConformanceRequired: zfd.checkbox()` to `customerShippingValidator`.
2. Add `<Boolean name="certificateOfConformanceRequired" label={t\`Certificate of Conformance required\`} />` after the incoterm fields.
3. Confirm that `updateCustomerShipping` (`sales.service.ts:3338`) spreads the validated object. If it lists columns, add the new column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** The customer list columns. The item-level flag.

---

## Task 12: Add the Quality → Certificates list page

**Depends on:** Tasks 2, 5, 8 (path)
**Files:**
- Create: `apps/erp/app/routes/x+/quality+/certificates.tsx`
- Create: `apps/erp/app/modules/quality/ui/CertificateOfConformance/CertificatesOfConformanceTable.tsx`
- Modify: `apps/erp/app/modules/quality/ui/useQualitySubmodules.tsx` — add an entry to the "Inspection" group
- Copy from (precedent): `apps/erp/app/routes/x+/quality+/gauges.tsx`, `apps/erp/app/modules/quality/ui/Gauge/GaugesTable.tsx`

**Steps:**
1. Copy `gauges.tsx`. Use `requirePermissions(request, { view: "quality", role: "employee" })` and `getCertificatesOfConformance`.
2. Set `handle = { breadcrumb: msg\`Certificates\`, to: path.to.qualityCertificates }`.
3. Copy `GaugesTable.tsx` and use these columns:
   - `certificateId` (links to the PDF)
   - `status` (badge: Issued green, Voided red)
   - customer name
   - `shipment.shipmentId` (links to `path.to.shipmentDetails`)
   - `signerName`
   - `signedAt` (`formatDate`)
4. Add filters for `status` and `customerId`.
5. Add no "New" button. A CoC is issued from a shipment.
6. Add `{ name: t\`Certificates\`, to: path.to.qualityCertificates, icon: <LuFileBadge /> }` to the Inspection group.
7. If `LuFileBadge` is not exported by `react-icons/lu`, use `LuFileCheck`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no errors
```

**Out of scope:** Bulk actions. CSV export.

---

## Task 13: Update the rule, the module guide, the Task Router and the product docs

**Depends on:** Tasks 1–12
**Files:**
- Create: `.claude/rules/certificate-of-conformance.md`
- Modify: `AGENTS.md` — Task Router row under **Domain Modules**
- Modify: `apps/erp/app/modules/quality/AGENTS.md` — the new table, functions and server module
- Modify: `.claude/rules/shipments-receipts-ui-patterns.md` — the post route's issue step and the void hook
- Modify: `.claude/rules/document-template-customizer.md` — 12 types, the 2 new block types
- Create: one Reference page under `docs/content/docs/reference/` (run the `carbon-docs` skill; ground every claim in the code)
- Modify: `.ai/specs/2026-10-04-certificate-of-conformance.md` — status `implemented`, plus a changelog line

**Steps:**
1. Write the rule.
   - Give it `paths:` frontmatter for `apps/erp/app/modules/quality/certificate-of-conformance.server.ts`, `packages/documents/src/pdf/CertificateOfConformancePDF.tsx` and `apps/erp/app/routes/x+/shipment+/$shipmentId.certificate*.tsx`.
   - Document only committed code.
2. Add the Task Router row: `| Certificate of Conformance (outbound) | .claude/rules/certificate-of-conformance.md |`.
3. Update the two existing rules and the quality `AGENTS.md`.
4. Run the `carbon-docs` skill for the Reference page.

**Verify:**
```bash
grep -n "certificate-of-conformance" AGENTS.md
# Expected: 1 line
pnpm --filter docs typecheck
# Expected: no errors
```

**Out of scope:** A changelog entry. That is a separate `/changelog-entry` request.

---

## Task 14: Run the full validation gates and fill translations

**Depends on:** Task 13
**Files:** none new

**Steps:**
1. Run the `/translate` skill for the new Lingui strings.
2. Run every command in the Verify block.
3. Fix every failure.
4. Re-run until all commands pass.
5. Commit only through `/check-and-commit`, and only when the human asks.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/documents --filter=@carbon/server-functions --filter=@carbon/database
# Expected: all tasks successful
pnpm run lint
# Expected: no errors
pnpm --filter @carbon/documents test && pnpm --filter erp exec vitest run app/modules/quality
# Expected: all pass
pnpm --filter @carbon/checks license-headers && git status --short | grep -v "^??" | wc -l
# Expected: the fixer changes nothing new
pnpm db:check:datasets
# Expected: all four datasets pass
pnpm db:check:backups
# Expected: verdict "compatible"
```

**Out of scope:** Whole-repo `pnpm typecheck` (it runs out of memory).

---

## Task 15: Run the manual acceptance check (the user verifies in the browser)

**Depends on:** Task 14
**Files:** none

The run record skips browser test (`/test`) because the user verifies by hand. This task gives the user the checklist. It maps 1:1 to the spec Acceptance Criteria.

**Steps:**
1. Switch on "Certificate of Conformance required" on a test customer. Reload the page and confirm the value.
2. Create a Sales Order for that customer with a batch-tracked line (lot `L-100`) and a serial-tracked line (`S1`, `S2`).
3. Create the shipment and post it. Confirm the issue section is pre-checked.
4. Fill in the title, check the attestation, and post.
5. Confirm the card shows `COC000001`, the signer, the title and the date.
6. Download the PDF. Check the customer PO, both part numbers with revisions, the quantities, `L-100`, `S1`, `S2`, the statement and the signature block.
7. Run `shasum -a 256 <downloaded file>`. Compare the hash with `contentHash` on the row.
8. Edit the statement in Settings → Templates → Certificate of Conformance.
9. Download `COC000001` again. Confirm the file is byte-identical to the first download.
10. Open Preview on a Draft shipment. Confirm the "PREVIEW — NOT ISSUED" banner and the disabled Issue button.
11. Void `COC000001` with reason "Wrong title". Issue again and confirm `COC000002`.
12. Void the shipment. Confirm `COC000002` shows Voided, with reason "Shipment voided".
13. Open Quality → Certificates. Filter by status and by customer.

**Verify:**
```bash
# Manual. Expected: every step above matches. Record pass/fail per step in the run record.
```

**Out of scope:** Automated browser tests (skipped by the user in this run).
