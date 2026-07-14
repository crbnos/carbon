# PDF Auto-Fill Implementation Plan

## Overview
- **Aptitude Brief:** Auto-fill Carbon fields from uploaded PDFs (invoices, RFQs)
- **Estimated Time:** 11 tasks × 3-5 min avg = ~40 minutes
- **Branch:** `feature/pdf-autofill`

## Dependencies
- Task 1.1 must complete before all others (migration creates the table)
- Task 1.2 (types regen) must run after 1.1
- Task 1.3 (env config) is independent
- Tasks 2.1–2.3 depend on 1.2
- Tasks 3.1–3.2 depend on 2.2 (events defined)
- Tasks 4.1–4.3 depend on 3.1 (service exists)

---

## Phase 1: Database & Config

### Task 1.1: Create `documentExtraction` table migration

**Files:**
- Create: `packages/database/supabase/migrations/YYYYMMDDHHMMSS_add-document-extraction.sql`

**Steps:**

1. Generate migration file:
   ```bash
   pnpm run db:migrate:new add-document-extraction
   ```

2. Write the migration SQL (replace timestamp in filename with the generated one):
   ```sql
   CREATE TYPE "documentExtractionStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

   CREATE TYPE "documentExtractionType" AS ENUM ('purchaseInvoice', 'salesRfq');

   CREATE TABLE "documentExtraction" (
       "id" TEXT NOT NULL DEFAULT id('docext'),
       "companyId" TEXT NOT NULL,
       "sourceDocument" TEXT NOT NULL,
       "sourceDocumentId" TEXT,
       "storagePath" TEXT NOT NULL,
       "documentType" "documentExtractionType" NOT NULL,
       "status" "documentExtractionStatus" NOT NULL DEFAULT 'pending',
       "extractedData" JSONB,
       "filteredData" JSONB,
       "error" TEXT,
       "createdBy" TEXT NOT NULL,
       "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       "updatedBy" TEXT,
       "updatedAt" TIMESTAMP WITH TIME ZONE,

       CONSTRAINT "documentExtraction_pkey" PRIMARY KEY ("id", "companyId"),
       CONSTRAINT "documentExtraction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "documentExtraction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
       CONSTRAINT "documentExtraction_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id")
   );

   CREATE INDEX "documentExtraction_companyId_idx" ON "documentExtraction" ("companyId");
   CREATE INDEX "documentExtraction_createdBy_idx" ON "documentExtraction" ("createdBy");
   CREATE INDEX "documentExtraction_sourceDocumentId_idx" ON "documentExtraction" ("sourceDocumentId");

   ALTER TABLE "documentExtraction" ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "SELECT" ON "public"."documentExtraction"
   FOR SELECT USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
   );

   CREATE POLICY "INSERT" ON "public"."documentExtraction"
   FOR INSERT WITH CHECK (
     "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
   );

   CREATE POLICY "UPDATE" ON "public"."documentExtraction"
   FOR UPDATE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
   );

   CREATE POLICY "DELETE" ON "public"."documentExtraction"
   FOR DELETE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])
   );
   ```

3. Commit:
   ```bash
   git add -A && git commit -m "feat(database): add documentExtraction table for PDF auto-fill"
   ```

---

### Task 1.2: Regenerate database types

**Steps:**
```bash
pnpm db:types
git add -A && git commit -m "chore(database): regenerate types for documentExtraction"
```

---

### Task 1.3: Add EXTRACTION_CONFIDENCE_THRESHOLD env variable

**Files:**
- Modify: `packages/env/src/index.ts`
- Modify: `.env.example`

**Steps:**

1. Add to `.env.example`: `EXTRACTION_CONFIDENCE_THRESHOLD=0.85`

2. Add to `packages/env/src/index.ts` (after EXCHANGE_RATES_API_KEY):
   ```typescript
   export const EXTRACTION_CONFIDENCE_THRESHOLD = parseFloat(
     getEnv("EXTRACTION_CONFIDENCE_THRESHOLD", { isRequired: false, isSecret: false }) ?? "0.85"
   );
   ```

3. Add `EXTRACTION_CONFIDENCE_THRESHOLD: string;` to the `ProcessEnv` interface.

4. Commit:
   ```bash
   git add -A && git commit -m "feat(env): add EXTRACTION_CONFIDENCE_THRESHOLD config"
   ```

---

## Phase 2: AI Logic & Background Job (Inngest)

### Task 2.1: Add Inngest event type

**Files:** Modify `packages/lib/src/events.ts`

Add to Events type:
```typescript
"carbon/extract-document": {
  data: {
    documentExtractionId: string;
    companyId: string;
  };
};
```

### Task 2.2: Create extraction Zod schemas

**Files:** Create `packages/jobs/src/inngest/functions/extraction/schemas.ts`

### Task 2.3: Create extractDocumentFunction Inngest worker

**Files:**
- Create `packages/jobs/src/inngest/functions/extraction/extract-document.ts`
- Create `packages/jobs/src/inngest/functions/extraction/index.ts`
- Modify `packages/jobs/src/inngest/index.ts`

---

## Phase 3: Route Actions & Services

### Task 3.1: Create extraction service functions

**Files:** Create `apps/erp/app/modules/documents/extraction.service.ts`

### Task 3.2: Create extraction API route

**Files:** Create `apps/erp/app/routes/api+/document-extraction.ts`

---

## Phase 4: Frontend UI & Realtime

### Task 4.1: Create useDocumentExtraction Realtime hook

**Files:** Create `apps/erp/app/hooks/useDocumentExtraction.ts`

### Task 4.2: Create PdfExtractor component

**Files:** Create `apps/erp/app/components/Form/PdfExtractor.tsx`

### Task 4.3: Integrate into PurchaseInvoiceForm and SalesRFQForm

**Files:**
- Modify `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceForm.tsx`
- Modify `apps/erp/app/modules/sales/ui/SalesRFQ/SalesRFQForm.tsx`
