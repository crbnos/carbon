# Bank Reconciliation — Phase 1 (Foundations) Implementation Plan

> ⚠️ **2026-07-03 delta (readiness roadmap):** `journalLine.sourceAmount`/`sourceCurrencyCode` population is now **mandatory on every posting path** (base-currency documents write base amount + base code), not best-effort — see the spec's FX section and `.ai/plans/2026-07-03-public-company-readiness-roadmap.md`. The posting-path tasks in this plan must cover all `post-*` edge functions and app-side posters.

## Overview

- **Design Spec:** `.ai/specs/2026-07-02-bank-reconciliation.md` (status: in-progress; all open questions resolved)
- **Research:** `.ai/research/bank-reconciliation.md`
- **Scope:** Phase 1 only — schema (incl. `journalLine` FX columns), bank accounts, CSV + OFX statement import, deterministic matching + N:M match groups, reconcile workspace, close-out with optional approval workflow, on-demand PDF report. Plaid (Phase 2), BAI2/MT940/CAMT.053 + rules engine + auto-match tolerance (Phase 3), intelligence (Phase 4) are out.
- **Tasks:** 24 tasks ≈ 2 hours of focused execution
- **Branch:** `period-closing-spec` (shared with the period-close work per Brad's call, 2026-07-02 — coordinate edits to `accounting.service.ts` / `types.ts` / `path.ts` with that workstream)

### Execution notes (read before Task 1)

1. **Generated DB types**: `pnpm db:migrate` regenerates types locally — fine for local typechecking, but **do not commit the regenerated types file** (committed types come from the cloud DB; a local regen produces a huge divergent per-company diff — see project memory). Before the PR merges, Brad applies the migration to the cloud dev DB and regenerates the committed types. All service code below assumes typed tables exist locally.
2. **Plan deviations from the spec** (confirm at approval; Task 24 syncs the spec):
   - **PDF is rendered on-demand** via a `file+` route (`renderToStream`, the `sales-invoice` precedent) instead of generated-and-stored at completion. Completed reconciliations are immutable, so on-demand output is identical with far less machinery. The `reportDocumentPath` column is dropped.
   - **Tolerance** ships in Phase 1 for **manual** match groups only (per Phase 1 acceptance criteria); the auto-match tolerance layer stays in Phase 3 (per the phasing table — the spec is internally ambiguous here).
   - **Reference agreement in auto-match is dropped from the RPC**: `journalLine` has no structured reference column, so reference matching would be description-fuzzing. Auto-match = exact amount + ±7d + unique candidate. Reference/description similarity returns as a *suggestion* ranker in Phase 4.
3. **PK style**: single-column PKs + `companyId` FK + RLS, matching `payment`/`memo`/`invoiceSettlement` (2026-06-30) — the spec's accepted design decision. This intentionally deviates from the composite-PK line in `workflow-database-migration.md` per its own "newest migration wins" rule.
4. **Audit**: event-system driven in Carbon (no imperative audit inserts). Who/when columns (`createdBy`, `completedBy`, `submittedBy`, `voidedBy`, `matchType`) capture the trail in v1.
5. **Never** run whole-project `tsc --noEmit` (OOM). Use `pnpm run typecheck` (turbo, per-package).

### Dependencies

```
T1 (migration) ─▶ T2 (apply) ─▶ T3 (models) ─▶ T4 (types) ─▶ T5..T10 (services, parallelizable)
T2 ─▶ T11 (sourceAmount in post-payment)          T2 ─▶ T12..T14 (edge function)
T3 ─▶ T15 (paths/sidebar) ─▶ T16..T22 (routes/UI; 16-18 ∥ 19-21 ∥ 22)
T5..T14 ─▶ T19..T22        T23 (settings UI) after T3        T24 (verify + sync) last
```

---

## Task 1: Branch + migration

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_bank-reconciliation.sql`

**Steps:**

1. Create the migration file on the current `period-closing-spec` branch (HHMMSS must not be `000000` — the CLI stamps the real time):
   ```bash
   pnpm db:migrate:new bank-reconciliation
   # Expected: Created new migration at supabase/migrations/<ts>_bank-reconciliation.sql
   ```

2. Write the migration (full contents):

   ```sql
   -- Bank Reconciliation Phase 1
   -- Spec: .ai/specs/2026-07-02-bank-reconciliation.md

   DO $$ BEGIN
     CREATE TYPE "bankAccountType" AS ENUM ('Checking', 'Savings', 'Credit Card', 'Other');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankAccountSource" AS ENUM ('Manual', 'Plaid');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankConnectionStatus" AS ENUM ('Connected', 'Requires Reauth', 'Error');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankTransactionSource" AS ENUM ('Plaid', 'Import');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankTransactionStatus" AS ENUM ('Pending', 'Unmatched', 'Matched', 'Excluded', 'Reconciled');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankMatchType" AS ENUM ('Auto', 'Rule', 'Manual');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankStatementFormat" AS ENUM ('CSV', 'OFX', 'BAI2', 'MT940', 'CAMT053');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
   DO $$ BEGIN
     CREATE TYPE "bankReconciliationStatus" AS ENUM ('Draft', 'In Review', 'Completed', 'Voided');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

   -- FX groundwork: source-currency amounts on journal lines (additive, nullable)
   ALTER TABLE "journalLine"
     ADD COLUMN IF NOT EXISTS "sourceAmount" NUMERIC,
     ADD COLUMN IF NOT EXISTS "sourceCurrencyCode" TEXT REFERENCES "currencyCode"("code");

   CREATE TABLE IF NOT EXISTS "bankAccount" (
     "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('bka'),
     "name" TEXT NOT NULL,
     "bankName" TEXT,
     "accountNumberLastFour" TEXT,
     "type" "bankAccountType" NOT NULL DEFAULT 'Checking',
     "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"("code"),
     "glAccountId" TEXT NOT NULL REFERENCES "account"("id") ON DELETE RESTRICT,
     "openingBalance" NUMERIC NOT NULL DEFAULT 0,
     "openingDate" DATE,
     "source" "bankAccountSource" NOT NULL DEFAULT 'Manual',
     "plaidItemId" TEXT,
     "plaidAccountId" TEXT,
     "connectionStatus" "bankConnectionStatus",
     "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
     "active" BOOLEAN NOT NULL DEFAULT TRUE,
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
     "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"("id"),
     "updatedAt" TIMESTAMP WITH TIME ZONE,
     "customFields" JSONB
   );
   CREATE UNIQUE INDEX IF NOT EXISTS "bankAccount_glAccount_idx" ON "bankAccount" ("glAccountId", "companyId");
   CREATE UNIQUE INDEX IF NOT EXISTS "bankAccount_plaid_idx" ON "bankAccount" ("plaidAccountId", "companyId") WHERE "plaidAccountId" IS NOT NULL;
   CREATE INDEX IF NOT EXISTS "bankAccount_companyId_idx" ON "bankAccount" ("companyId");
   CREATE INDEX IF NOT EXISTS "bankAccount_createdBy_idx" ON "bankAccount" ("createdBy");

   CREATE TABLE IF NOT EXISTS "bankStatementImport" (
     "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('bsi'),
     "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
     "fileName" TEXT NOT NULL,
     "filePath" TEXT NOT NULL,
     "format" "bankStatementFormat" NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'Pending',
     "error" TEXT,
     "importedCount" INTEGER,
     "duplicateCount" INTEGER,
     "statementOpeningBalance" NUMERIC,
     "statementEndingBalance" NUMERIC,
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
     "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS "bankStatementImport_bankAccountId_idx" ON "bankStatementImport" ("bankAccountId");
   CREATE INDEX IF NOT EXISTS "bankStatementImport_companyId_idx" ON "bankStatementImport" ("companyId");
   CREATE INDEX IF NOT EXISTS "bankStatementImport_createdBy_idx" ON "bankStatementImport" ("createdBy");

   CREATE TABLE IF NOT EXISTS "bankReconciliation" (
     "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('brc'),
     "reconciliationId" TEXT NOT NULL,
     "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
     "statementDate" DATE NOT NULL,
     "startingBalance" NUMERIC NOT NULL,
     "statementEndingBalance" NUMERIC NOT NULL,
     "status" "bankReconciliationStatus" NOT NULL DEFAULT 'Draft',
     "notes" TEXT,
     "submittedAt" TIMESTAMP WITH TIME ZONE,
     "submittedBy" TEXT REFERENCES "user"("id"),
     "completedAt" TIMESTAMP WITH TIME ZONE,
     "completedBy" TEXT REFERENCES "user"("id"),
     "voidedAt" TIMESTAMP WITH TIME ZONE,
     "voidedBy" TEXT REFERENCES "user"("id"),
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
     "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"("id"),
     "updatedAt" TIMESTAMP WITH TIME ZONE
   );
   CREATE UNIQUE INDEX IF NOT EXISTS "bankReconciliation_statement_idx"
     ON "bankReconciliation" ("bankAccountId", "statementDate") WHERE "status" <> 'Voided';
   CREATE UNIQUE INDEX IF NOT EXISTS "bankReconciliation_readable_idx"
     ON "bankReconciliation" ("reconciliationId", "companyId");
   CREATE INDEX IF NOT EXISTS "bankReconciliation_companyId_idx" ON "bankReconciliation" ("companyId");
   CREATE INDEX IF NOT EXISTS "bankReconciliation_bankAccountId_idx" ON "bankReconciliation" ("bankAccountId");

   CREATE TABLE IF NOT EXISTS "bankTransaction" (
     "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('btx'),
     "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
     "transactionDate" DATE NOT NULL,
     "amount" NUMERIC NOT NULL,
     "description" TEXT NOT NULL,
     "counterparty" TEXT,
     "reference" TEXT,
     "externalId" TEXT NOT NULL,
     "pendingExternalId" TEXT,
     "source" "bankTransactionSource" NOT NULL,
     "importId" TEXT REFERENCES "bankStatementImport"("id") ON DELETE SET NULL,
     "status" "bankTransactionStatus" NOT NULL DEFAULT 'Unmatched',
     "reconciliationId" TEXT REFERENCES "bankReconciliation"("id") ON DELETE SET NULL,
     "needsReview" BOOLEAN NOT NULL DEFAULT FALSE,
     "suggestion" JSONB,
     "raw" JSONB,
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"("id"),
     "updatedAt" TIMESTAMP WITH TIME ZONE
   );
   CREATE UNIQUE INDEX IF NOT EXISTS "bankTransaction_external_idx" ON "bankTransaction" ("bankAccountId", "externalId");
   CREATE INDEX IF NOT EXISTS "bankTransaction_account_status_idx" ON "bankTransaction" ("bankAccountId", "status", "transactionDate");
   CREATE INDEX IF NOT EXISTS "bankTransaction_companyId_idx" ON "bankTransaction" ("companyId");
   CREATE INDEX IF NOT EXISTS "bankTransaction_reconciliationId_idx" ON "bankTransaction" ("reconciliationId");
   CREATE INDEX IF NOT EXISTS "bankTransaction_importId_idx" ON "bankTransaction" ("importId");

   CREATE TABLE IF NOT EXISTS "bankMatchGroup" (
     "id" TEXT NOT NULL PRIMARY KEY DEFAULT id('bmg'),
     "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
     "matchType" "bankMatchType" NOT NULL DEFAULT 'Manual',
     "toleranceJournalId" TEXT REFERENCES "journal"("id"),
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
     "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS "bankMatchGroup_bankAccountId_idx" ON "bankMatchGroup" ("bankAccountId");
   CREATE INDEX IF NOT EXISTS "bankMatchGroup_companyId_idx" ON "bankMatchGroup" ("companyId");
   CREATE INDEX IF NOT EXISTS "bankMatchGroup_createdBy_idx" ON "bankMatchGroup" ("createdBy");

   CREATE TABLE IF NOT EXISTS "bankMatchGroupTransaction" (
     "groupId" TEXT NOT NULL REFERENCES "bankMatchGroup"("id") ON DELETE CASCADE,
     "bankTransactionId" TEXT NOT NULL UNIQUE REFERENCES "bankTransaction"("id") ON DELETE CASCADE,
     PRIMARY KEY ("groupId", "bankTransactionId")
   );
   CREATE TABLE IF NOT EXISTS "bankMatchGroupJournalLine" (
     "groupId" TEXT NOT NULL REFERENCES "bankMatchGroup"("id") ON DELETE CASCADE,
     "journalLineId" TEXT NOT NULL UNIQUE REFERENCES "journalLine"("id") ON DELETE RESTRICT,
     PRIMARY KEY ("groupId", "journalLineId")
   );

   CREATE TABLE IF NOT EXISTS "bankAccountBalance" (
     "id" TEXT NOT NULL PRIMARY KEY DEFAULT xid(),
     "bankAccountId" TEXT NOT NULL REFERENCES "bankAccount"("id") ON DELETE CASCADE,
     "date" DATE NOT NULL,
     "balance" NUMERIC NOT NULL,
     "source" TEXT NOT NULL,
     "companyId" TEXT NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
   );
   CREATE UNIQUE INDEX IF NOT EXISTS "bankAccountBalance_day_idx" ON "bankAccountBalance" ("bankAccountId", "date");
   CREATE INDEX IF NOT EXISTS "bankAccountBalance_companyId_idx" ON "bankAccountBalance" ("companyId");

   -- Settings + defaults
   ALTER TABLE "companySettings"
     ADD COLUMN IF NOT EXISTS "bankMatchToleranceAmount" NUMERIC NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "bankRecRequireApproval" BOOLEAN NOT NULL DEFAULT FALSE;
   ALTER TABLE "accountDefault"
     ADD COLUMN IF NOT EXISTS "bankFeesAccount" TEXT REFERENCES "account"("id");
   -- Idempotent backfill so bankFeesAccount is never NULL (interestAccount is NOT NULL on accountDefault)
   UPDATE "accountDefault" SET "bankFeesAccount" = "interestAccount" WHERE "bankFeesAccount" IS NULL;

   -- Readable reconciliation ids
   INSERT INTO "sequence" ("table", "name", "prefix", "suffix", "next", "size", "step", "companyId")
   SELECT 'bankReconciliation', 'Bank Reconciliation', 'REC-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
   FROM "company" c
   ON CONFLICT DO NOTHING;

   -- Matchable GL lines (posted lines on any account + their match state)
   DROP VIEW IF EXISTS "bankMatchableJournalLine";
   CREATE VIEW "bankMatchableJournalLine" WITH(SECURITY_INVOKER=true) AS
   SELECT
     jl."id",
     jl."accountId",
     jl."amount",
     jl."sourceAmount",
     jl."sourceCurrencyCode",
     jl."description",
     jl."companyId",
     j."id" AS "journalId",
     j."journalEntryId",
     j."postingDate",
     j."sourceType",
     m."groupId"
   FROM "journalLine" jl
     JOIN "journal" j ON j."id" = jl."journalId"
     LEFT JOIN "bankMatchGroupJournalLine" m ON m."journalLineId" = jl."id"
   WHERE j."status" = 'Posted';

   -- Bank accounts list view (GL account info + unmatched count)
   DROP VIEW IF EXISTS "bankAccounts";
   CREATE VIEW "bankAccounts" WITH(SECURITY_INVOKER=true) AS
   SELECT
     ba.*,
     a."number" AS "glAccountNumber",
     a."name" AS "glAccountName",
     a."class" AS "glAccountClass",
     (SELECT COUNT(*) FROM "bankTransaction" bt
        WHERE bt."bankAccountId" = ba."id" AND bt."status" = 'Unmatched') AS "unmatchedCount",
     (SELECT MAX(br."statementDate") FROM "bankReconciliation" br
        WHERE br."bankAccountId" = ba."id" AND br."status" = 'Completed') AS "lastReconciledDate"
   FROM "bankAccount" ba
     JOIN "account" a ON a."id" = ba."glAccountId";

   -- RLS
   ALTER TABLE "bankAccount" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankStatementImport" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankReconciliation" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankTransaction" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankMatchGroup" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankMatchGroupTransaction" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankMatchGroupJournalLine" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "bankAccountBalance" ENABLE ROW LEVEL SECURITY;

   DO $$
   DECLARE t TEXT;
   BEGIN
     FOREACH t IN ARRAY ARRAY['bankAccount','bankStatementImport','bankReconciliation','bankTransaction','bankMatchGroup','bankAccountBalance']
     LOOP
       EXECUTE format('DROP POLICY IF EXISTS "SELECT" ON "public".%I', t);
       EXECUTE format('CREATE POLICY "SELECT" ON "public".%I FOR SELECT USING ("companyId" = ANY (get_companies_with_employee_permission(''accounting_view'')::text[]))', t);
       EXECUTE format('DROP POLICY IF EXISTS "INSERT" ON "public".%I', t);
       EXECUTE format('CREATE POLICY "INSERT" ON "public".%I FOR INSERT WITH CHECK ("companyId" = ANY (get_companies_with_employee_permission(''accounting_create'')::text[]))', t);
       EXECUTE format('DROP POLICY IF EXISTS "UPDATE" ON "public".%I', t);
       EXECUTE format('CREATE POLICY "UPDATE" ON "public".%I FOR UPDATE USING ("companyId" = ANY (get_companies_with_employee_permission(''accounting_update'')::text[]))', t);
       EXECUTE format('DROP POLICY IF EXISTS "DELETE" ON "public".%I', t);
       EXECUTE format('CREATE POLICY "DELETE" ON "public".%I FOR DELETE USING ("companyId" = ANY (get_companies_with_employee_permission(''accounting_delete'')::text[]))', t);
     END LOOP;
   END $$;

   -- Membership tables have no companyId: scope through the parent group
   DROP POLICY IF EXISTS "SELECT" ON "public"."bankMatchGroupTransaction";
   CREATE POLICY "SELECT" ON "public"."bankMatchGroupTransaction" FOR SELECT USING (
     EXISTS (SELECT 1 FROM "bankMatchGroup" g WHERE g."id" = "groupId"
       AND g."companyId" = ANY (get_companies_with_employee_permission('accounting_view')::text[]))
   );
   DROP POLICY IF EXISTS "INSERT" ON "public"."bankMatchGroupTransaction";
   CREATE POLICY "INSERT" ON "public"."bankMatchGroupTransaction" FOR INSERT WITH CHECK (
     EXISTS (SELECT 1 FROM "bankMatchGroup" g WHERE g."id" = "groupId"
       AND g."companyId" = ANY (get_companies_with_employee_permission('accounting_create')::text[]))
   );
   DROP POLICY IF EXISTS "DELETE" ON "public"."bankMatchGroupTransaction";
   CREATE POLICY "DELETE" ON "public"."bankMatchGroupTransaction" FOR DELETE USING (
     EXISTS (SELECT 1 FROM "bankMatchGroup" g WHERE g."id" = "groupId"
       AND g."companyId" = ANY (get_companies_with_employee_permission('accounting_delete')::text[]))
   );
   -- Same three policies for bankMatchGroupJournalLine (identical bodies, table name swapped)
   DROP POLICY IF EXISTS "SELECT" ON "public"."bankMatchGroupJournalLine";
   CREATE POLICY "SELECT" ON "public"."bankMatchGroupJournalLine" FOR SELECT USING (
     EXISTS (SELECT 1 FROM "bankMatchGroup" g WHERE g."id" = "groupId"
       AND g."companyId" = ANY (get_companies_with_employee_permission('accounting_view')::text[]))
   );
   DROP POLICY IF EXISTS "INSERT" ON "public"."bankMatchGroupJournalLine";
   CREATE POLICY "INSERT" ON "public"."bankMatchGroupJournalLine" FOR INSERT WITH CHECK (
     EXISTS (SELECT 1 FROM "bankMatchGroup" g WHERE g."id" = "groupId"
       AND g."companyId" = ANY (get_companies_with_employee_permission('accounting_create')::text[]))
   );
   DROP POLICY IF EXISTS "DELETE" ON "public"."bankMatchGroupJournalLine";
   CREATE POLICY "DELETE" ON "public"."bankMatchGroupJournalLine" FOR DELETE USING (
     EXISTS (SELECT 1 FROM "bankMatchGroup" g WHERE g."id" = "groupId"
       AND g."companyId" = ANY (get_companies_with_employee_permission('accounting_delete')::text[]))
   );

   -- Deterministic auto-match core: exact amount + ±7 days + exactly one candidate.
   -- SECURITY INVOKER: RLS applies for app users; service role bypasses.
   CREATE OR REPLACE FUNCTION run_bank_matching(bank_account_id TEXT, company_id TEXT, user_id TEXT)
   RETURNS INTEGER
   LANGUAGE plpgsql
   AS $$
   DECLARE
     v_gl_account TEXT;
     v_currency TEXT;
     v_class TEXT;
     v_base_currency TEXT;
     v_sign NUMERIC;
     v_is_base BOOLEAN;
     v_matched INTEGER := 0;
     r RECORD;
     v_count INTEGER;
     v_line_id TEXT;
     v_group_id TEXT;
   BEGIN
     SELECT ba."glAccountId", ba."currencyCode", a."class"::text
       INTO v_gl_account, v_currency, v_class
     FROM "bankAccount" ba JOIN "account" a ON a."id" = ba."glAccountId"
     WHERE ba."id" = bank_account_id AND ba."companyId" = company_id;
     IF v_gl_account IS NULL THEN
       RAISE EXCEPTION 'Bank account % not found', bank_account_id;
     END IF;

     SELECT c."code" INTO v_base_currency
     FROM "currency" c
     WHERE c."isBaseCurrency" = TRUE
       AND c."companyGroupId" = (SELECT "companyGroupId" FROM "company" WHERE "id" = company_id);

     v_is_base := (v_currency = v_base_currency);
     v_sign := CASE WHEN v_class = 'Liability' THEN -1 ELSE 1 END;

     FOR r IN
       SELECT "id", "amount", "transactionDate"
       FROM "bankTransaction"
       WHERE "bankAccountId" = bank_account_id
         AND "companyId" = company_id
         AND "status" = 'Unmatched'
     LOOP
       SELECT COUNT(*)::int, (array_agg(v."id"))[1]
         INTO v_count, v_line_id
       FROM "bankMatchableJournalLine" v
       WHERE v."accountId" = v_gl_account
         AND v."companyId" = company_id
         AND v."groupId" IS NULL
         AND v."postingDate" BETWEEN r."transactionDate" - 7 AND r."transactionDate" + 7
         AND (
           (v_is_base AND v."amount" = v_sign * r."amount")
           OR (NOT v_is_base AND v."sourceCurrencyCode" = v_currency AND v."sourceAmount" = v_sign * r."amount")
         );

       IF v_count = 1 THEN
         INSERT INTO "bankMatchGroup" ("bankAccountId", "matchType", "companyId", "createdBy")
         VALUES (bank_account_id, 'Auto', company_id, user_id)
         RETURNING "id" INTO v_group_id;
         INSERT INTO "bankMatchGroupTransaction" ("groupId", "bankTransactionId") VALUES (v_group_id, r."id");
         INSERT INTO "bankMatchGroupJournalLine" ("groupId", "journalLineId") VALUES (v_group_id, v_line_id);
         UPDATE "bankTransaction" SET "status" = 'Matched' WHERE "id" = r."id";
         v_matched := v_matched + 1;
       END IF;
     END LOOP;

     RETURN v_matched;
   END;
   $$;
   ```

3. Commit:
   ```bash
   git add packages/database/supabase/migrations/ && git commit -m "feat(accounting): bank reconciliation schema + matching RPC

   Tracking spec: .ai/specs/2026-07-02-bank-reconciliation.md

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

---

## Task 2: Apply migration locally + verify

**Steps:**

1. ```bash
   pnpm db:migrate
   # Expected: applies <ts>_bank-reconciliation.sql, regenerates local types
   ```
2. Verify (use the `PORT_DB` from `.env.local`):
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:$(grep PORT_DB .env.local | cut -d= -f2)/postgres" \
     -c '\d "bankTransaction"' -c "SELECT run_bank_matching('nope','nope','nope');" 2>&1 | head -30
   # Expected: table description, then ERROR: Bank account nope not found (function exists + guards)
   ```
3. Idempotency: re-run the file directly — must apply cleanly twice:
   ```bash
   psql "<same conn>" -f packages/database/supabase/migrations/<ts>_bank-reconciliation.sql
   # Expected: no errors (IF NOT EXISTS / OR REPLACE / ON CONFLICT guards hold)
   ```
4. **Do NOT commit** the regenerated `@carbon/database` types diff (cloud-generated; see Execution notes).

---

## Task 3: Zod validators + enum arrays

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts`

**Steps:**

1. Add at the end of the file (imports `z`/`zfd` already present):

   ```typescript
   export const bankAccountTypes = ["Checking", "Savings", "Credit Card", "Other"] as const;
   export const bankTransactionStatuses = ["Pending", "Unmatched", "Matched", "Excluded", "Reconciled"] as const;
   export const bankReconciliationStatuses = ["Draft", "In Review", "Completed", "Voided"] as const;
   export const bankStatementFormats = ["CSV", "OFX"] as const; // Phase 3 adds BAI2/MT940/CAMT053

   export const bankAccountValidator = z.object({
     id: zfd.text(z.string().optional()),
     name: z.string().min(1, { message: "Name is required" }),
     bankName: zfd.text(z.string().optional()),
     accountNumberLastFour: zfd.text(z.string().max(4).optional()),
     type: z.enum(bankAccountTypes, {
       errorMap: () => ({ message: "Type is required" }),
     }),
     currencyCode: z.string().min(1, { message: "Currency is required" }),
     glAccountId: z.string().min(1, { message: "GL account is required" }),
     openingBalance: zfd.numeric(z.number()),
     openingDate: zfd.text(z.string().optional()),
   });

   export const bankStatementUploadValidator = z.object({
     bankAccountId: z.string().min(1),
     filePath: z.string().min(1, { message: "Upload a file first" }),
     fileName: z.string().min(1),
     format: z.enum(bankStatementFormats),
     columnMappings: zfd.text(z.string().optional()), // JSON: CSV header -> field
   });

   export const bankMatchValidator = z.object({
     bankTransactionIds: z.array(z.string().min(1)).min(1, { message: "Select a bank line" }),
     journalLineIds: z.array(z.string().min(1)).min(1, { message: "Select a GL line" }),
   });

   export const bankQuickJournalValidator = z.object({
     bankTransactionId: z.string().min(1),
     accountId: z.string().min(1, { message: "Account is required" }),
     memo: zfd.text(z.string().optional()),
   });

   export const bankReconciliationValidator = z.object({
     id: zfd.text(z.string().optional()),
     bankAccountId: z.string().min(1),
     statementDate: z.string().min(1, { message: "Statement date is required" }),
     statementEndingBalance: zfd.numeric(z.number()),
     notes: zfd.text(z.string().optional()),
   });
   ```

2. Verify + commit:
   ```bash
   pnpm --filter erp exec tsc --noEmit -p . 2>/dev/null || pnpm run typecheck --filter=erp
   # Expected: no new errors in accounting.models.ts
   git add apps/erp/app/modules/accounting/accounting.models.ts && git commit -m "feat(accounting): bank reconciliation validators

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

---

## Task 4: Derived types

**Files:**
- Modify: `apps/erp/app/modules/accounting/types.ts`

**Steps:**

1. Add (after the existing `Awaited<ReturnType<...>>` types; service functions arrive in Tasks 5–9 — write these now, they compile once services exist; execute Task 4 after Task 9 if strict ordering is preferred):

   ```typescript
   import type {
     getBankAccounts,
     getBankTransactions,
     getBankReconciliations,
     getMatchCandidates,
   } from "./accounting.service";

   export type BankAccount = NonNullable<
     Awaited<ReturnType<typeof getBankAccounts>>["data"]
   >[number];
   export type BankTransaction = NonNullable<
     Awaited<ReturnType<typeof getBankTransactions>>["data"]
   >[number];
   export type BankReconciliation = NonNullable<
     Awaited<ReturnType<typeof getBankReconciliations>>["data"]
   >[number];
   export type BankMatchCandidate = NonNullable<
     Awaited<ReturnType<typeof getMatchCandidates>>["data"]
   >[number];
   ```

2. Commit with Task 9.

---

## Task 5: Bank account services

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (append; barrel `index.ts` already re-exports `*` from the service — verify, else add exports)

**Steps:**

1. Append:

   ```typescript
   export async function getBankAccounts(
     client: SupabaseClient<Database>,
     companyId: string,
     args?: GenericQueryFilters & { search: string | null }
   ) {
     let query = client
       .from("bankAccounts") // view: + glAccountNumber/Name/Class, unmatchedCount, lastReconciledDate
       .select("*", { count: "exact" })
       .eq("companyId", companyId);
     if (args?.search) {
       query = query.ilike("name", `%${args.search}%`);
     }
     if (args) {
       query = setGenericQueryFilters(query, args, [{ column: "name", ascending: true }]);
     }
     return query;
   }

   export async function getBankAccount(client: SupabaseClient<Database>, id: string) {
     return client.from("bankAccounts").select("*").eq("id", id).single();
   }

   export async function upsertBankAccount(
     client: SupabaseClient<Database>,
     bankAccount:
       | (Omit<z.infer<typeof bankAccountValidator>, "id"> & {
           companyId: string;
           createdBy: string;
           customFields?: Json;
         })
       | (Omit<z.infer<typeof bankAccountValidator>, "id"> & {
           id: string;
           updatedBy: string;
           customFields?: Json;
         })
   ) {
     // Validate GL account class/type per bank type (spec: Bank/Cash asset, or Liability for Credit Card)
     const account = await client
       .from("account")
       .select("id, class, accountType")
       .eq("id", bankAccount.glAccountId)
       .single();
     if (account.error || !account.data) {
       return { data: null, error: { message: "GL account not found" } };
     }
     const isCard = bankAccount.type === "Credit Card";
     const validGl = isCard
       ? account.data.class === "Liability"
       : ["Bank", "Cash"].includes(account.data.accountType ?? "");
     if (!validGl) {
       return {
         data: null,
         error: {
           message: isCard
             ? "Credit card accounts must link to a Liability GL account"
             : "Bank accounts must link to a GL account with type Bank or Cash",
         },
       };
     }

     if ("createdBy" in bankAccount) {
       return client.from("bankAccount").insert([bankAccount]).select("id").single();
     }
     return client
       .from("bankAccount")
       .update({ ...sanitize(bankAccount), updatedAt: today(getLocalTimeZone()).toString() })
       .eq("id", bankAccount.id)
       .select("id")
       .single();
   }

   export async function deactivateBankAccount(
     client: SupabaseClient<Database>,
     { id, userId }: { id: string; userId: string }
   ) {
     return client
       .from("bankAccount")
       .update({ active: false, updatedBy: userId, updatedAt: today(getLocalTimeZone()).toString() })
       .eq("id", id)
       .select("id")
       .single();
   }
   ```

   Imports: `z` from `zod`, `bankAccountValidator` from `./accounting.models`, `Json` from `@carbon/database` — all already imported at the top of the service; add any missing.

2. Commit:
   ```bash
   git add apps/erp/app/modules/accounting/ && git commit -m "feat(accounting): bank account services

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

---

## Task 6: Bank transaction services

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`

**Steps:**

1. Append:

   ```typescript
   export async function getBankTransactions(
     client: SupabaseClient<Database>,
     companyId: string,
     args: GenericQueryFilters & {
       bankAccountId: string;
       status: string | null;
       search: string | null;
     }
   ) {
     let query = client
       .from("bankTransaction")
       .select("*", { count: "exact" })
       .eq("companyId", companyId)
       .eq("bankAccountId", args.bankAccountId);
     if (args.status) {
       query = query.eq("status", args.status as Database["public"]["Enums"]["bankTransactionStatus"]);
     }
     if (args.search) {
       query = query.ilike("description", `%${args.search}%`);
     }
     query = setGenericQueryFilters(query, args, [
       { column: "transactionDate", ascending: false },
     ]);
     return query;
   }

   export async function excludeBankTransaction(
     client: SupabaseClient<Database>,
     { id, userId }: { id: string; userId: string }
   ) {
     return client
       .from("bankTransaction")
       .update({ status: "Excluded", updatedBy: userId, updatedAt: today(getLocalTimeZone()).toString() })
       .eq("id", id)
       .eq("status", "Unmatched")
       .select("id")
       .single();
   }

   export async function restoreBankTransaction(
     client: SupabaseClient<Database>,
     { id, userId }: { id: string; userId: string }
   ) {
     return client
       .from("bankTransaction")
       .update({ status: "Unmatched", updatedBy: userId, updatedAt: today(getLocalTimeZone()).toString() })
       .eq("id", id)
       .eq("status", "Excluded")
       .select("id")
       .single();
   }

   // Suggestion candidates: amount-equal (class/currency-normalized), ±30 days, unmatched, ranked by date proximity
   export async function getMatchCandidates(
     client: SupabaseClient<Database>,
     companyId: string,
     bankTransactionId: string
   ) {
     const txn = await client
       .from("bankTransaction")
       .select("id, amount, transactionDate, bankAccountId")
       .eq("id", bankTransactionId)
       .single();
     if (txn.error || !txn.data) return { data: null, error: txn.error };

     const bankAccount = await client
       .from("bankAccounts")
       .select("glAccountId, currencyCode, glAccountClass")
       .eq("id", txn.data.bankAccountId)
       .single();
     if (bankAccount.error || !bankAccount.data) return { data: null, error: bankAccount.error };

     const base = await getBaseCurrency(client, companyId);
     const isBase = bankAccount.data.currencyCode === base.data?.code;
     const sign = bankAccount.data.glAccountClass === "Liability" ? -1 : 1;
     const target = sign * txn.data.amount;

     const from = dateAdd(txn.data.transactionDate, -30);
     const to = dateAdd(txn.data.transactionDate, 30);
     const lines = await client
       .from("bankMatchableJournalLine")
       .select("*")
       .eq("companyId", companyId)
       .eq("accountId", bankAccount.data.glAccountId)
       .is("groupId", null)
       .gte("postingDate", from)
       .lte("postingDate", to)
       .limit(200);
     if (lines.error) return { data: null, error: lines.error };

     const candidates = (lines.data ?? [])
       .filter((l) =>
         isBase
           ? Number(l.amount) === target
           : l.sourceCurrencyCode === bankAccount.data.currencyCode &&
             Number(l.sourceAmount) === target
       )
       .sort(
         (a, b) =>
           Math.abs(daysBetween(a.postingDate!, txn.data.transactionDate)) -
           Math.abs(daysBetween(b.postingDate!, txn.data.transactionDate))
       );
     return { data: candidates, error: null };
   }
   ```

   Add two tiny local date helpers next to them (or reuse existing utils if present — grep `daysBetween` first):

   ```typescript
   function dateAdd(date: string, days: number): string {
     const d = new Date(`${date}T00:00:00Z`);
     d.setUTCDate(d.getUTCDate() + days);
     return d.toISOString().slice(0, 10);
   }
   function daysBetween(a: string, b: string): number {
     return Math.round(
       (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86400000
     );
   }
   ```

2. Commit (message: `feat(accounting): bank transaction services + match candidates`).

---

## Task 7: Match group create/delete (Kysely transactions)

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts`

**Steps:**

1. Append (imports of `Kysely`, `KyselyDatabase`, `sql` follow the existing header of this file — `postDepreciationRun` precedent):

   ```typescript
   export async function createBankMatchGroup(
     db: Kysely<KyselyDatabase>,
     args: {
       companyId: string;
       userId: string;
       bankTransactionIds: string[];
       journalLineIds: string[];
       matchType?: "Auto" | "Rule" | "Manual";
       // Pre-allocated when a tolerance JE may be needed (allocated by the route, Task 19):
       toleranceJournal?: {
         journalEntryId: string; // readable JE id from getNextSequence
         accountingPeriodId: string;
         bankFeesAccountId: string;
         companyGroupId: string;
       };
     }
   ) {
     return db.transaction().execute(async (trx) => {
       const txns = await trx
         .selectFrom("bankTransaction")
         .select(["id", "amount", "bankAccountId", "status", "transactionDate"])
         .where("id", "in", args.bankTransactionIds)
         .where("companyId", "=", args.companyId)
         .execute();
       if (txns.length !== args.bankTransactionIds.length)
         throw new Error("Bank transaction not found");
       if (txns.some((t) => t.status !== "Unmatched"))
         throw new Error("Only unmatched bank lines can be matched");
       const bankAccountId = txns[0]?.bankAccountId;
       if (!bankAccountId || txns.some((t) => t.bankAccountId !== bankAccountId))
         throw new Error("All bank lines must belong to the same bank account");

       const account = await trx
         .selectFrom("bankAccount")
         .innerJoin("account", "account.id", "bankAccount.glAccountId")
         .select(["bankAccount.glAccountId", "bankAccount.currencyCode", "account.class"])
         .where("bankAccount.id", "=", bankAccountId)
         .executeTakeFirstOrThrow();

       const lines = await trx
         .selectFrom("journalLine")
         .innerJoin("journal", "journal.id", "journalLine.journalId")
         .leftJoin("bankMatchGroupJournalLine as m", "m.journalLineId", "journalLine.id")
         .select(["journalLine.id", "journalLine.amount", "journalLine.sourceAmount", "journalLine.sourceCurrencyCode"])
         .where("journalLine.id", "in", args.journalLineIds)
         .where("journalLine.companyId", "=", args.companyId)
         .where("journalLine.accountId", "=", account.glAccountId)
         .where("journal.status", "=", "Posted")
         .where("m.journalLineId", "is", null)
         .execute();
       if (lines.length !== args.journalLineIds.length)
         throw new Error("GL line not found, already matched, or not posted to this bank account");

       const settings = await trx
         .selectFrom("companySettings")
         .select(["bankMatchToleranceAmount"])
         .where("id", "=", args.companyId)
         .executeTakeFirst();
       const tolerance = Number(settings?.bankMatchToleranceAmount ?? 0);

       const sign = account.class === "Liability" ? -1 : 1;
       const bankSum = txns.reduce((s, t) => s + Number(t.amount), 0);
       const glSum = lines.reduce((s, l) => s + sign * Number(l.amount), 0);
       const difference = Number((bankSum - glSum).toFixed(6));

       let toleranceJournalId: string | null = null;
       if (difference !== 0) {
         if (Math.abs(difference) > tolerance || !args.toleranceJournal) {
           throw new Error(
             `Selection does not balance: bank ${bankSum} vs GL ${glSum} (difference ${difference})`
           );
         }
         // Book the difference: bank GL takes `difference` (inflow-signed), bankFees takes the offset.
         const tj = args.toleranceJournal;
         const journal = await trx
           .insertInto("journal")
           .values({
             journalEntryId: tj.journalEntryId,
             description: "Bank match tolerance adjustment",
             postingDate: txns[0]!.transactionDate,
             status: "Posted",
             sourceType: "Manual",
             accountingPeriodId: tj.accountingPeriodId,
             postedAt: new Date().toISOString(),
             postedBy: args.userId,
             createdBy: args.userId,
             companyId: args.companyId,
           })
           .returning("id")
           .executeTakeFirstOrThrow();
         toleranceJournalId = journal.id;
         // bank GL line (class-signed): Asset debit = +, Liability flips
         await trx
           .insertInto("journalLine")
           .values([
             {
               journalId: journal.id,
               accountId: account.glAccountId,
               description: "Bank match tolerance adjustment",
               amount: sign * difference,
               companyId: args.companyId,
               companyGroupId: tj.companyGroupId,
             },
             {
               // bankFees is an Expense: positive = debit. Outflow difference (negative) = fee expense.
               journalId: journal.id,
               accountId: tj.bankFeesAccountId,
               description: "Bank match tolerance adjustment",
               amount: -difference,
               companyId: args.companyId,
               companyGroupId: tj.companyGroupId,
             },
           ])
           .execute();
         // The adjustment's bank-GL line joins the group so the group sums exactly
         const adjLine = await trx
           .selectFrom("journalLine")
           .select("id")
           .where("journalId", "=", journal.id)
           .where("accountId", "=", account.glAccountId)
           .executeTakeFirstOrThrow();
         args.journalLineIds.push(adjLine.id);
       }

       const group = await trx
         .insertInto("bankMatchGroup")
         .values({
           bankAccountId,
           matchType: args.matchType ?? "Manual",
           toleranceJournalId,
           companyId: args.companyId,
           createdBy: args.userId,
         })
         .returning("id")
         .executeTakeFirstOrThrow();
       await trx
         .insertInto("bankMatchGroupTransaction")
         .values(args.bankTransactionIds.map((id) => ({ groupId: group.id, bankTransactionId: id })))
         .execute();
       await trx
         .insertInto("bankMatchGroupJournalLine")
         .values(args.journalLineIds.map((id) => ({ groupId: group.id, journalLineId: id })))
         .execute();
       await trx
         .updateTable("bankTransaction")
         .set({ status: "Matched", updatedBy: args.userId })
         .where("id", "in", args.bankTransactionIds)
         .execute();
       return { groupId: group.id };
     });
   }

   export async function deleteBankMatchGroup(
     db: Kysely<KyselyDatabase>,
     args: { companyId: string; userId: string; groupId: string }
   ) {
     return db.transaction().execute(async (trx) => {
       const members = await trx
         .selectFrom("bankMatchGroupTransaction")
         .innerJoin("bankTransaction", "bankTransaction.id", "bankMatchGroupTransaction.bankTransactionId")
         .select(["bankTransaction.id", "bankTransaction.status"])
         .where("bankMatchGroupTransaction.groupId", "=", args.groupId)
         .where("bankTransaction.companyId", "=", args.companyId)
         .execute();
       if (members.length === 0) throw new Error("Match group not found");
       if (members.some((m) => m.status === "Reconciled"))
         throw new Error("Cannot unmatch a reconciled line — void the reconciliation first");
       await trx.deleteFrom("bankMatchGroup").where("id", "=", args.groupId).execute(); // memberships cascade
       await trx
         .updateTable("bankTransaction")
         .set({ status: "Unmatched", updatedBy: args.userId })
         .where("id", "in", members.map((m) => m.id))
         .execute();
       // Note: a tolerance JE, if any, stays posted; user reverses it via the journal UI if desired.
     });
   }
   ```

   Note: keep the small floating-point guard (`toFixed(6)`) — NUMERIC comes back as string from Kysely; `Number(...)` everywhere as shown.

2. Commit (`feat(accounting): bank match group transactions`).

---

## Task 8: Quick-create JE from a bank line

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts`

**Steps:**

1. Append:

   ```typescript
   export async function createJournalEntryFromBankTransaction(
     db: Kysely<KyselyDatabase>,
     args: {
       companyId: string;
       companyGroupId: string;
       userId: string;
       bankTransactionId: string;
       accountId: string; // offset account chosen by the user
       memo?: string;
       journalEntryId: string; // pre-allocated readable id (getNextSequence in the route)
       accountingPeriodId: string; // pre-resolved (getOrCreateAccountingPeriod in the route)
     }
   ) {
     return db.transaction().execute(async (trx) => {
       const txn = await trx
         .selectFrom("bankTransaction")
         .select(["id", "amount", "transactionDate", "description", "bankAccountId", "status"])
         .where("id", "=", args.bankTransactionId)
         .where("companyId", "=", args.companyId)
         .executeTakeFirstOrThrow();
       if (txn.status !== "Unmatched") throw new Error("Bank line is not unmatched");

       const account = await trx
         .selectFrom("bankAccount")
         .innerJoin("account", "account.id", "bankAccount.glAccountId")
         .select(["bankAccount.glAccountId", "account.class"])
         .where("bankAccount.id", "=", txn.bankAccountId)
         .executeTakeFirstOrThrow();
       const offset = await trx
         .selectFrom("account")
         .select(["id", "class"])
         .where("id", "=", args.accountId)
         .executeTakeFirstOrThrow();

       const description = args.memo || txn.description;
       const journal = await trx
         .insertInto("journal")
         .values({
           journalEntryId: args.journalEntryId,
           description,
           postingDate: txn.transactionDate,
           status: "Posted",
           sourceType: "Manual",
           accountingPeriodId: args.accountingPeriodId,
           postedAt: new Date().toISOString(),
           postedBy: args.userId,
           createdBy: args.userId,
           companyId: args.companyId,
         })
         .returning("id")
         .executeTakeFirstOrThrow();

       const inflow = Number(txn.amount); // account currency == base (FX quick-create deferred; see step note)
       const bankSign = account.class === "Liability" ? -1 : 1;
       // Offset line: natural-balance signed for the offset account's class.
       // Debit/credit space: bank debit = inflow. Offset takes the opposite side.
       const offsetDebit = -inflow; // inflow>0 → offset is a credit; outflow → offset debit
       const offsetAmount =
         offset.class === "Asset" || offset.class === "Expense" ? offsetDebit : -offsetDebit;

       const lines = await trx
         .insertInto("journalLine")
         .values([
           {
             journalId: journal.id,
             accountId: account.glAccountId,
             description,
             amount: bankSign * inflow,
             companyId: args.companyId,
             companyGroupId: args.companyGroupId,
           },
           {
             journalId: journal.id,
             accountId: offset.id,
             description,
             amount: offsetAmount,
             companyId: args.companyId,
             companyGroupId: args.companyGroupId,
           },
         ])
         .returning(["id", "accountId"])
         .execute();

       const bankLine = lines.find((l) => l.accountId === account.glAccountId)!;
       const group = await trx
         .insertInto("bankMatchGroup")
         .values({
           bankAccountId: txn.bankAccountId,
           matchType: "Manual",
           companyId: args.companyId,
           createdBy: args.userId,
         })
         .returning("id")
         .executeTakeFirstOrThrow();
       await trx
         .insertInto("bankMatchGroupTransaction")
         .values({ groupId: group.id, bankTransactionId: txn.id })
         .execute();
       await trx
         .insertInto("bankMatchGroupJournalLine")
         .values({ groupId: group.id, journalLineId: bankLine.id })
         .execute();
       await trx
         .updateTable("bankTransaction")
         .set({ status: "Matched", updatedBy: args.userId })
         .where("id", "=", txn.id)
         .execute();
       return { journalId: journal.id, groupId: group.id };
     });
   }
   ```

   Note: quick-create on a **foreign-currency** bank account additionally needs `sourceAmount`/`sourceCurrencyCode` on both lines and a base-converted `amount` (rate from `exchangeRateHistory`). Route (Task 19) blocks quick-create for non-base accounts in this iteration with a clear message ("record a payment or manual JE with FX instead") — smallest correct v1.

2. Commit (`feat(accounting): quick-create journal entry from bank line`).

---

## Task 9: Reconciliation services (list/summary/create/submit)

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts`

**Steps:**

1. Append:

   ```typescript
   export async function getBankReconciliations(
     client: SupabaseClient<Database>,
     companyId: string,
     args?: GenericQueryFilters & { bankAccountId: string | null }
   ) {
     let query = client
       .from("bankReconciliation")
       .select("*, bankAccount!inner(name)", { count: "exact" })
       .eq("companyId", companyId);
     if (args?.bankAccountId) query = query.eq("bankAccountId", args.bankAccountId);
     if (args) {
       query = setGenericQueryFilters(query, args, [{ column: "statementDate", ascending: false }]);
     }
     return query;
   }

   export async function getBankReconciliation(client: SupabaseClient<Database>, id: string) {
     return client
       .from("bankReconciliation")
       .select("*, bankAccount!inner(name, currencyCode, glAccountId)")
       .eq("id", id)
       .single();
   }

   export async function getBankReconciliationSummary(
     client: SupabaseClient<Database>,
     companyId: string,
     args: { bankAccountId: string; statementDate: string; statementEndingBalance: number }
   ) {
     const [account, lastCompleted, scopeLines] = await Promise.all([
       client.from("bankAccount").select("openingBalance, glAccountId").eq("id", args.bankAccountId).single(),
       client
         .from("bankReconciliation")
         .select("statementEndingBalance, statementDate")
         .eq("bankAccountId", args.bankAccountId)
         .eq("status", "Completed")
         .order("statementDate", { ascending: false })
         .limit(1)
         .maybeSingle(),
       client
         .from("bankTransaction")
         .select("id, transactionDate, amount, description, status")
         .eq("companyId", companyId)
         .eq("bankAccountId", args.bankAccountId)
         .in("status", ["Unmatched", "Matched"])
         .lte("transactionDate", args.statementDate),
     ]);
     if (account.error) return { data: null, error: account.error };
     if (scopeLines.error) return { data: null, error: scopeLines.error };

     const startingBalance = lastCompleted.data
       ? Number(lastCompleted.data.statementEndingBalance)
       : Number(account.data.openingBalance);
     const lines = scopeLines.data ?? [];
     const clearedTotal = lines.reduce((s, l) => s + Number(l.amount), 0);
     const difference = Number(
       (startingBalance + clearedTotal - args.statementEndingBalance).toFixed(6)
     );
     const unmatchedLines = lines.filter((l) => l.status === "Unmatched");

     const outstanding = await client
       .from("bankMatchableJournalLine")
       .select("id, journalEntryId, postingDate, description, amount")
       .eq("companyId", companyId)
       .eq("accountId", account.data.glAccountId)
       .is("groupId", null)
       .lte("postingDate", args.statementDate)
       .order("postingDate", { ascending: false })
       .limit(100);

     return {
       data: {
         startingBalance,
         clearedTotal,
         difference,
         unmatchedLines,
         outstandingGlLines: outstanding.data ?? [],
         priorStatementDate: lastCompleted.data?.statementDate ?? null,
       },
       error: null,
     };
   }

   export async function createBankReconciliation(
     client: SupabaseClient<Database>,
     data: z.infer<typeof bankReconciliationValidator> & {
       reconciliationId: string; // pre-allocated REC- id
       startingBalance: number;
       companyId: string;
       createdBy: string;
     }
   ) {
     // Sequential per account: statementDate must be after the last completed statement
     const last = await client
       .from("bankReconciliation")
       .select("statementDate")
       .eq("bankAccountId", data.bankAccountId)
       .eq("status", "Completed")
       .order("statementDate", { ascending: false })
       .limit(1)
       .maybeSingle();
     if (last.data && data.statementDate <= last.data.statementDate) {
       return {
         data: null,
         error: { message: `Statement date must be after ${last.data.statementDate}` },
       };
     }
     const { id: _id, ...rest } = data;
     return client.from("bankReconciliation").insert([rest]).select("id").single();
   }

   export async function submitBankReconciliation(
     client: SupabaseClient<Database>,
     { id, userId }: { id: string; userId: string }
   ) {
     return client
       .from("bankReconciliation")
       .update({
         status: "In Review",
         submittedAt: new Date().toISOString(),
         submittedBy: userId,
         updatedBy: userId,
         updatedAt: new Date().toISOString(),
       })
       .eq("id", id)
       .eq("status", "Draft")
       .select("id")
       .single();
   }
   ```

2. Commit including Task 4's types (`feat(accounting): bank reconciliation services + derived types`).

---

## Task 10: Complete / void reconciliation (Kysely)

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.server.ts`

**Steps:**

1. Append:

   ```typescript
   export async function completeBankReconciliation(
     db: Kysely<KyselyDatabase>,
     args: { companyId: string; userId: string; reconciliationId: string; requireApproval: boolean }
   ) {
     return db.transaction().execute(async (trx) => {
       const rec = await trx
         .selectFrom("bankReconciliation")
         .selectAll()
         .where("id", "=", args.reconciliationId)
         .where("companyId", "=", args.companyId)
         .executeTakeFirstOrThrow();

       if (args.requireApproval) {
         if (rec.status !== "In Review")
           throw new Error("Reconciliation must be submitted for review before completion");
         if (rec.submittedBy === args.userId)
           throw new Error("The preparer cannot approve their own reconciliation");
       } else if (rec.status !== "Draft" && rec.status !== "In Review") {
         throw new Error(`Cannot complete a ${rec.status} reconciliation`);
       }

       const lines = await trx
         .selectFrom("bankTransaction")
         .select(["id", "amount", "status"])
         .where("companyId", "=", args.companyId)
         .where("bankAccountId", "=", rec.bankAccountId)
         .where("status", "in", ["Unmatched", "Matched"])
         .where("transactionDate", "<=", rec.statementDate)
         .execute();
       const unmatched = lines.filter((l) => l.status === "Unmatched");
       if (unmatched.length > 0)
         throw new Error(`${unmatched.length} statement lines are still unmatched`);

       const cleared = lines.reduce((s, l) => s + Number(l.amount), 0);
       const difference = Number(
         (Number(rec.startingBalance) + cleared - Number(rec.statementEndingBalance)).toFixed(6)
       );
       if (difference !== 0)
         throw new Error(`Reconciliation does not balance (difference ${difference})`);

       await trx
         .updateTable("bankTransaction")
         .set({ status: "Reconciled", reconciliationId: rec.id, updatedBy: args.userId })
         .where("id", "in", lines.map((l) => l.id))
         .execute();
       await trx
         .updateTable("bankReconciliation")
         .set({
           status: "Completed",
           completedAt: new Date().toISOString(),
           completedBy: args.userId,
           updatedBy: args.userId,
           updatedAt: new Date().toISOString(),
         })
         .where("id", "=", rec.id)
         .execute();
       await trx
         .insertInto("bankAccountBalance")
         .values({
           bankAccountId: rec.bankAccountId,
           date: rec.statementDate,
           balance: rec.statementEndingBalance,
           source: "Statement",
           companyId: args.companyId,
         })
         .onConflict((oc) =>
           oc.columns(["bankAccountId", "date"]).doUpdateSet({ balance: rec.statementEndingBalance })
         )
         .execute();
       return { id: rec.id };
     });
   }

   export async function voidBankReconciliation(
     db: Kysely<KyselyDatabase>,
     args: { companyId: string; userId: string; reconciliationId: string }
   ) {
     return db.transaction().execute(async (trx) => {
       const rec = await trx
         .selectFrom("bankReconciliation")
         .selectAll()
         .where("id", "=", args.reconciliationId)
         .where("companyId", "=", args.companyId)
         .executeTakeFirstOrThrow();
       if (rec.status !== "Completed") throw new Error("Only completed reconciliations can be voided");

       const later = await trx
         .selectFrom("bankReconciliation")
         .select("id")
         .where("bankAccountId", "=", rec.bankAccountId)
         .where("status", "=", "Completed")
         .where("statementDate", ">", rec.statementDate)
         .executeTakeFirst();
       if (later) throw new Error("Only the latest completed reconciliation can be voided");

       await trx
         .updateTable("bankTransaction")
         .set({ status: "Matched", reconciliationId: null, updatedBy: args.userId })
         .where("reconciliationId", "=", rec.id)
         .execute();
       await trx
         .updateTable("bankReconciliation")
         .set({
           status: "Voided",
           voidedAt: new Date().toISOString(),
           voidedBy: args.userId,
           updatedBy: args.userId,
           updatedAt: new Date().toISOString(),
         })
         .where("id", "=", rec.id)
         .execute();
       await trx
         .deleteFrom("bankAccountBalance")
         .where("bankAccountId", "=", rec.bankAccountId)
         .where("date", "=", rec.statementDate)
         .where("source", "=", "Statement")
         .execute();
       return { id: rec.id };
     });
   }
   ```

2. Commit (`feat(accounting): reconciliation complete/void transactions`).

---

## Task 11: Populate `journalLine.sourceAmount` in payment posting

**Files:**
- Modify: `packages/database/supabase/functions/post-payment/build-payment-journal.ts`
- Modify: `packages/database/supabase/functions/post-payment/post-payment.test.ts`

**Steps:**

1. In `build-payment-journal.ts`, the bank-side line (built from `bankAccount` + `exchangeRate`) currently sets base `amount` only. Add to the bank line object:
   ```typescript
   sourceAmount: cashIn ? totalAmount : -totalAmount, // document currency, class-signed like `amount`
   sourceCurrencyCode: currencyCode,
   ```
   Thread `currencyCode` into `BuildPaymentJournalInput` (add `currencyCode: string` to the input type; `index.ts` already has `payment.data.currencyCode` in scope at the call site — pass it through). Non-bank lines (control/discount/FX) stay null.
2. Update the golden-master tests: every `arBase`/`apBase` fixture gains `currencyCode: "USD"`, and the bank-line assertions add `sourceAmount`/`sourceCurrencyCode` expectations (e.g. AR receipt of 100 → bank line `{ amount: 100, sourceAmount: 100, sourceCurrencyCode: "USD" }`; FX case with `exchangeRate: 1.1` → `amount: 110, sourceAmount: 100`).
3. Run + commit:
   ```bash
   cd packages/database/supabase/functions/post-payment && deno test .
   # Expected: all tests pass, including new sourceAmount assertions
   git add packages/database/supabase/functions/post-payment/ && git commit -m "feat(accounting): stamp source-currency amounts on payment bank lines

   Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

---

## Task 12: `import-bank-statement` edge function — scaffold + CSV parser

**Files:**
- Create: `packages/database/supabase/functions/import-bank-statement/parsers/types.ts`
- Create: `packages/database/supabase/functions/import-bank-statement/parsers/csv.ts`
- Create: `packages/database/supabase/functions/import-bank-statement/parsers/csv.test.ts`

**Steps:**

1. `parsers/types.ts`:
   ```typescript
   export type NormalizedBankTransaction = {
     transactionDate: string; // yyyy-MM-dd
     amount: number; // signed, positive = inflow
     description: string;
     reference?: string;
     externalId: string;
   };
   export type ParseResult = {
     transactions: NormalizedBankTransaction[];
     statementOpeningBalance?: number;
     statementEndingBalance?: number;
   };
   ```

2. `parsers/csv.ts` (complete):
   ```typescript
   import { parse } from "https://deno.land/std@0.175.0/encoding/csv.ts";
   import type { NormalizedBankTransaction, ParseResult } from "./types.ts";

   export type CsvColumnMappings = {
     date: string; // header name
     description: string;
     amount?: string; // signed single column…
     debit?: string; // …or a debit/credit pair (debit = money out)
     credit?: string;
     reference?: string;
   };

   function parseDate(value: string): string {
     const v = value.trim();
     if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
     const mdY = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
     if (mdY) {
       const [, m, d, y] = mdY;
       return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
     }
     throw new Error(`Unparseable date: ${value}`);
   }

   function parseAmount(value: string): number {
     let v = value.trim().replace(/[$,\s]/g, "");
     if (v === "" || v === "-") return 0;
     const negative = /^\(.*\)$/.test(v);
     if (negative) v = v.slice(1, -1);
     const n = Number(v);
     if (Number.isNaN(n)) throw new Error(`Unparseable amount: ${value}`);
     return negative ? -n : n;
   }

   async function contentHash(parts: string[]): Promise<string> {
     const data = new TextEncoder().encode(parts.join("|"));
     const digest = await crypto.subtle.digest("SHA-256", data);
     return Array.from(new Uint8Array(digest))
       .map((b) => b.toString(16).padStart(2, "0"))
       .join("");
   }

   export async function parseCsvStatement(
     text: string,
     mappings: CsvColumnMappings
   ): Promise<ParseResult> {
     const rows = (await parse(text, { skipFirstRow: false, lazyQuotes: true })) as string[][];
     if (rows.length < 2) return { transactions: [] };
     const headers = rows[0]!.map((h) => h.trim());
     const col = (name?: string) => (name ? headers.indexOf(name) : -1);
     const iDate = col(mappings.date);
     const iDesc = col(mappings.description);
     const iAmount = col(mappings.amount);
     const iDebit = col(mappings.debit);
     const iCredit = col(mappings.credit);
     const iRef = col(mappings.reference);
     if (iDate < 0 || iDesc < 0 || (iAmount < 0 && (iDebit < 0 || iCredit < 0))) {
       throw new Error("Column mappings must include date, description, and amount (or debit + credit)");
     }

     const occurrences = new Map<string, number>();
     const transactions: NormalizedBankTransaction[] = [];
     for (const row of rows.slice(1)) {
       if (row.every((c) => (c ?? "").trim() === "")) continue;
       const transactionDate = parseDate(row[iDate] ?? "");
       const description = (row[iDesc] ?? "").trim();
       const reference = iRef >= 0 ? (row[iRef] ?? "").trim() || undefined : undefined;
       const amount =
         iAmount >= 0
           ? parseAmount(row[iAmount] ?? "")
           : parseAmount(row[iCredit] ?? "") - parseAmount(row[iDebit] ?? "");
       const key = `${transactionDate}|${amount}|${description}|${reference ?? ""}`;
       const occurrence = (occurrences.get(key) ?? 0) + 1;
       occurrences.set(key, occurrence);
       transactions.push({
         transactionDate,
         amount,
         description,
         reference,
         externalId: await contentHash([key, String(occurrence)]),
       });
     }
     return { transactions };
   }
   ```

3. `parsers/csv.test.ts` — fixtures: (a) signed-amount CSV with `$1,234.56`, `(45.00)` parens-negative, blank row; (b) debit/credit pair CSV; (c) duplicate identical rows keep distinct externalIds; (d) re-parse yields identical externalIds. Assert dates normalize from `6/15/2026`. Run:
   ```bash
   cd packages/database/supabase/functions/import-bank-statement && deno test parsers/
   # Expected: PASS
   ```

4. Commit (`feat(accounting): bank statement CSV parser`).

---

## Task 13: OFX parser

**Files:**
- Create: `packages/database/supabase/functions/import-bank-statement/parsers/ofx.ts`
- Create: `packages/database/supabase/functions/import-bank-statement/parsers/ofx.test.ts`

**Steps:**

1. `parsers/ofx.ts` (complete — tolerant of SGML and XML flavors):
   ```typescript
   import type { NormalizedBankTransaction, ParseResult } from "./types.ts";

   function tag(block: string, name: string): string | undefined {
     const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
     return m?.[1]?.trim() || undefined;
   }

   function ofxDate(value?: string): string {
     if (!value || value.length < 8) throw new Error(`Unparseable OFX date: ${value}`);
     return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
   }

   export function parseOfxStatement(text: string): ParseResult {
     const blocks = text.match(/<STMTTRN>[\s\S]*?(<\/STMTTRN>|(?=<STMTTRN>)|$)/gi) ?? [];
     const transactions: NormalizedBankTransaction[] = blocks.map((block) => {
       const fitId = tag(block, "FITID");
       const amount = Number(tag(block, "TRNAMT"));
       if (!fitId) throw new Error("OFX transaction missing FITID");
       if (Number.isNaN(amount)) throw new Error("OFX transaction missing TRNAMT");
       const name = tag(block, "NAME");
       const memo = tag(block, "MEMO");
       return {
         transactionDate: ofxDate(tag(block, "DTPOSTED")),
         amount, // OFX TRNAMT: positive = credit/inflow — already our convention
         description: [name, memo].filter(Boolean).join(" — ") || "(no description)",
         reference: tag(block, "CHECKNUM"),
         externalId: fitId,
       };
     });

     let statementEndingBalance: number | undefined;
     const ledger = text.match(/<LEDGERBAL>[\s\S]*?(<\/LEDGERBAL>|$)/i)?.[0];
     if (ledger) {
       const bal = Number(tag(ledger, "BALAMT"));
       if (!Number.isNaN(bal)) statementEndingBalance = bal;
     }
     return { transactions, statementEndingBalance };
   }
   ```

2. `parsers/ofx.test.ts` — fixtures: a minimal SGML OFX (no closing inner tags) and an XML-flavored OFX, each with 3 `STMTTRN` blocks (deposit, check with CHECKNUM, fee) + `LEDGERBAL`. Assert dates, signs, FITIDs, reference, ending balance; assert missing-FITID throws.
   ```bash
   deno test parsers/
   # Expected: PASS (csv + ofx)
   ```

3. Commit (`feat(accounting): bank statement OFX parser`).

---

## Task 14: Edge function handler + service wrapper

**Files:**
- Create: `packages/database/supabase/functions/import-bank-statement/index.ts`
- Modify: `apps/erp/app/modules/accounting/accounting.service.ts` (append `importBankStatement`)

**Steps:**

1. `index.ts` — mirror `post-payment/index.ts` structure exactly (serve, CORS, zod payload, `getSupabaseServiceRole`, Kysely pool):

   ```typescript
   import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
   import z from "npm:zod@^3.24.1";
   import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
   import { corsHeaders } from "../lib/headers.ts";
   import { getSupabaseServiceRole } from "../lib/supabase.ts";
   import { parseCsvStatement, type CsvColumnMappings } from "./parsers/csv.ts";
   import { parseOfxStatement } from "./parsers/ofx.ts";
   import { sql } from "npm:kysely@^0.26.3"; // match the kysely version pinned in ../lib/database.ts

   const pool = getConnectionPool(1);
   const db = getDatabaseClient<DB>(pool);

   const payloadValidator = z.object({
     importId: z.string(),
     companyId: z.string(),
     userId: z.string(),
   });

   serve(async (req: Request) => {
     if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
     const payload = await req.json();
     let importId = "";
     try {
       const parsed = payloadValidator.parse(payload);
       importId = parsed.importId;
       const { companyId, userId } = parsed;
       const client = await getSupabaseServiceRole(
         req.headers.get("Authorization"),
         req.headers.get("carbon-key") ?? "",
         companyId
       );

       const importRow = await client
         .from("bankStatementImport")
         .select("*")
         .eq("id", importId)
         .eq("companyId", companyId)
         .single();
       if (importRow.error || !importRow.data) throw new Error("Import not found");
       const { bankAccountId, filePath, format } = importRow.data;

       const bankAccount = await client
         .from("bankAccount")
         .select("id")
         .eq("id", bankAccountId)
         .eq("companyId", companyId)
         .single();
       if (bankAccount.error) throw new Error("Bank account not found");

       const file = await client.storage.from("private").download(filePath);
       if (file.error || !file.data) throw new Error("Failed to download statement file");
       const text = await file.data.text();

       const result =
         format === "OFX"
           ? parseOfxStatement(text)
           : await parseCsvStatement(
               text,
               JSON.parse(
                 (importRow.data as { columnMappings?: string }).columnMappings ??
                   (payload.columnMappings ?? "{}")
               ) as CsvColumnMappings
             );

       let imported = 0;
       await db.transaction().execute(async (trx) => {
         for (const t of result.transactions) {
           const inserted = await trx
             .insertInto("bankTransaction")
             .values({
               bankAccountId,
               transactionDate: t.transactionDate,
               amount: t.amount,
               description: t.description,
               reference: t.reference ?? null,
               externalId: t.externalId,
               source: "Import",
               importId,
               status: "Unmatched",
               companyId,
             })
             .onConflict((oc) => oc.columns(["bankAccountId", "externalId"]).doNothing())
             .returning("id")
             .executeTakeFirst();
           if (inserted) imported++;
         }
         await trx
           .updateTable("bankStatementImport")
           .set({
             status: "Completed",
             importedCount: imported,
             duplicateCount: result.transactions.length - imported,
             statementEndingBalance: result.statementEndingBalance ?? null,
             statementOpeningBalance: result.statementOpeningBalance ?? null,
           })
           .where("id", "=", importId)
           .execute();
       });

       const matched = await sql<{ run_bank_matching: number }>`
         SELECT run_bank_matching(${bankAccountId}, ${companyId}, ${userId})
       `.execute(db);

       return new Response(
         JSON.stringify({
           imported,
           duplicates: result.transactions.length - imported,
           autoMatched: matched.rows[0]?.run_bank_matching ?? 0,
         }),
         { headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     } catch (err) {
       if (importId) {
         try {
           await db
             .updateTable("bankStatementImport")
             .set({ status: "Failed", error: (err as Error).message })
             .where("id", "=", importId)
             .execute();
         } catch (_) { /* best effort */ }
       }
       return new Response(JSON.stringify({ error: (err as Error).message }), {
         status: 500,
         headers: corsHeaders,
       });
     }
   });
   ```

   Note: `columnMappings` travels in the POST body (route → edge fn), not on the import row — adjust the two lines above to read `payload.columnMappings` only, and extend `payloadValidator` with `columnMappings: z.string().optional()`. (Keep the import row lean.)

2. Service wrapper in `accounting.service.ts`:
   ```typescript
   export async function importBankStatement(
     client: SupabaseClient<Database>, // pass getCarbonServiceRole() from the route
     args: { importId: string; companyId: string; userId: string; columnMappings?: string }
   ) {
     return client.functions.invoke<{ imported: number; duplicates: number; autoMatched: number }>(
       "import-bank-statement",
       { body: args }
     );
   }
   ```
3. Serve locally + smoke test (crbn stack must already be up — do not start it):
   ```bash
   grep -rn "import-bank-statement\|post-payment" packages/database/supabase/config.toml | head -3
   # If post-payment has a [functions.*] entry, add a matching one for import-bank-statement; if not, none needed.
   ```
4. Commit (`feat(accounting): import-bank-statement edge function`).

---

## Task 15: Path helpers + sidebar Banking group

**Files:**
- Modify: `apps/erp/app/utils/path.ts`
- Modify: `apps/erp/app/modules/accounting/ui/useAccountingSubmodules.tsx`

**Steps:**

1. `path.ts` — add alphabetically among the accounting entries:
   ```typescript
   bankAccount: (id: string) => generatePath(`${x}/accounting/bank-accounts/${id}`),
   bankAccountImport: (id: string) => generatePath(`${x}/accounting/bank-accounts/${id}/import`),
   bankAccounts: `${x}/accounting/bank-accounts`,
   bankReconciliation: (id: string) => generatePath(`${x}/accounting/reconciliations/${id}`),
   bankReconciliationPdf: (id: string) => generatePath(`/file/bank-reconciliation/${id}.pdf`),
   bankReconciliations: `${x}/accounting/reconciliations`,
   bankReconcile: (id: string) => generatePath(`${x}/accounting/reconcile/${id}`),
   bankReconcileFinish: (id: string) => generatePath(`${x}/accounting/reconcile/${id}/finish`),
   newBankAccount: `${x}/accounting/bank-accounts/new`,
   ```
2. `useAccountingSubmodules.tsx` — insert a group between `General Ledger` and `Fixed Assets` (icons from `react-icons/lu`; `LuLandmark` + `LuFileCheck` exist — verify with a quick grep in `node_modules/react-icons/lu/index.d.ts` and substitute `LuBanknote`/`LuListChecks` if not):
   ```typescript
   {
     name: t`Banking`,
     routes: [
       {
         name: t`Bank Accounts`,
         to: path.to.bankAccounts,
         role: "employee",
         icon: <LuLandmark />,
       },
       {
         name: t`Reconciliations`,
         to: path.to.bankReconciliations,
         role: "employee",
         icon: <LuFileCheck />,
       },
     ],
   },
   ```
   Match the exact route-object fields of the neighboring groups (some include `permission`; copy whatever `Journal Entries` uses).
3. Commit (`feat(accounting): banking paths + sidebar group`).

---

## Task 16: Bank accounts list route + table

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Banking/BankAccountsTable.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Banking/index.ts` (barrel)
- Create: `apps/erp/app/routes/x+/accounting+/bank-accounts.tsx`

**Steps:**

1. `BankAccountsTable.tsx`: clone the structure of `apps/erp/app/modules/invoicing/ui/Payment/PaymentsTable.tsx` (memoized `Table<T>`, `columns` in `useMemo`, `renderContextMenu`, `New` primary action). Type rows as `BankAccount` from `~/modules/accounting/types`. Columns:
   - `name` → `Hyperlink` to `path.to.bankReconcile(row.original.id)` (the workspace is the primary drill-in), pinned left, icon `LuLandmark`
   - `bankName`, `glAccountNumber` + `glAccountName` (combined cell), `currencyCode` (`Enumerable`)
   - `type` (`Enumerable`, static filter from `bankAccountTypes`)
   - `unmatchedCount` (plain number — never parenthesized), `lastReconciledDate` (`formatDate`)
   - `source` badge + `connectionStatus` badge (render nothing when null), `active` boolean
   Context menu: Reconcile (→ `bankReconcile`), Import Statement (→ `bankAccountImport`), Edit (→ `bankAccount`), Deactivate (permission `update`/`accounting`, `ConfirmDelete`-style confirm posting `intent=deactivate` to the edit route).
   Primary action: `<New label={t`Bank Account`} to={path.to.newBankAccount} />` gated by `permissions.can("create", "accounting")`.
2. Route `bank-accounts.tsx`:
   ```typescript
   import { requirePermissions } from "@carbon/auth/auth.server";
   import type { LoaderFunctionArgs } from "react-router";
   import { Outlet, useLoaderData } from "react-router";
   import { getBankAccounts } from "~/modules/accounting";
   import { BankAccountsTable } from "~/modules/accounting/ui/Banking";
   import { getGenericQueryFilters } from "~/utils/query";

   export const handle = { breadcrumb: "Banking", to: "/x/accounting/bank-accounts" };

   export async function loader({ request }: LoaderFunctionArgs) {
     const { client, companyId } = await requirePermissions(request, { view: "accounting" });
     const url = new URL(request.url);
     const search = url.searchParams.get("search");
     const { limit, offset, sorts, filters } = getGenericQueryFilters(url.searchParams);
     const bankAccounts = await getBankAccounts(client, companyId, {
       search, limit, offset, sorts, filters,
     });
     return { bankAccounts: bankAccounts.data ?? [], count: bankAccounts.count ?? 0 };
   }

   export default function BankAccountsRoute() {
     const { bankAccounts, count } = useLoaderData<typeof loader>();
     return (
       <>
         <BankAccountsTable data={bankAccounts} count={count} />
         <Outlet />
       </>
     );
   }
   ```
   Mirror the exact loader helper names from `journals.tsx` (`getGenericQueryFilters` signature varies — copy that file's usage verbatim).
3. Commit (`feat(accounting): bank accounts list`).

---

## Task 17: Bank account form + new/edit drawer routes

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Banking/BankAccountForm.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/bank-accounts.new.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/bank-accounts.$bankAccountId.tsx`

**Steps:**

1. `BankAccountForm.tsx` — follow the `conventions-forms.md` ModalDrawer skeleton exactly (props `{ initialValues, open?, onClose }`, `useFetcher`, permission-driven `isDisabled`). Fields:
   ```tsx
   <Hidden name="id" />
   <VStack spacing={4}>
     <Input name="name" label={t`Name`} />
     <Input name="bankName" label={t`Bank`} />
     <Input name="accountNumberLastFour" label={t`Account Number (last 4)`} maxLength={4} />
     <Select name="type" label={t`Type`} options={bankAccountTypes.map((v) => ({ label: v, value: v }))} />
     <Currency name="currencyCode" label={t`Currency`} />
     <Account name="glAccountId" label={t`GL Account`} classes={["Asset", "Liability"]} />
     <Number name="openingBalance" label={t`Opening Balance`} formatOptions={{ style: "decimal", minimumFractionDigits: 2 }} />
     <DatePicker name="openingDate" label={t`Opening Date`} />
     <CustomFormFields table="bankAccount" />
   </VStack>
   ```
   (`Account` selector props: copy the exact prop names from its use in `PaymentForm.tsx` — it takes the field name + label; if it lacks a class filter prop, omit and rely on service validation.)
2. `bank-accounts.new.tsx` — action per the forms rule: `assertIsPost` → `requirePermissions({ create: "accounting" })` → `validator(bankAccountValidator).validate` → `upsertBankAccount(client, { ...data, companyId, createdBy: userId, customFields: setCustomFields(formData) })` → error: `return data({}, await flash(request, error(...)))` → success: `throw redirect(path.to.bankAccounts + ?getParams, await flash(request, success("Bank account created")))`. Default export renders `<BankAccountForm initialValues={{ name: "", type: "Checking", currencyCode: baseCurrency, glAccountId: "", openingBalance: 0 }} onClose={() => navigate(path.to.bankAccounts)} />` (fetch base currency in a small loader).
3. `bank-accounts.$bankAccountId.tsx` — loader `getBankAccount` (redirect+flash on error), action branches on `intent`: `deactivate` → `deactivateBankAccount`; default → update path of `upsertBankAccount` with `update: "accounting"`. Default export passes loader data to the form.
4. Commit (`feat(accounting): bank account form + drawers`).

---

## Task 18: Statement import drawer

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Banking/BankStatementImportDrawer.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/bank-accounts.$bankAccountId.import.tsx`

**Steps:**

1. Drawer component (3 steps, state machine like `ImportCSVModal.tsx` but simpler — no enum mappings):
   - **Step 1 Upload**: `react-dropzone` accepting `.csv,.ofx,.qfx`; on drop, upload to `carbon.storage.from("private").upload(`${companyId}/bank-statements/${nanoid()}.${ext}`, file)` (clone the upload block from `apps/erp/app/components/ImportCSVModal/UploadCSV.tsx`); detect format from extension (`.ofx`/`.qfx` → `OFX`, else `CSV`); for CSV, PapaParse the first 5 rows for headers + preview.
   - **Step 2 Map (CSV only)**: selects mapping each required field (Date, Description, and Amount **or** Debit+Credit, optional Reference) to a CSV header, previewing first rows — clone the row layout from `FieldMappings.tsx`. OFX skips to step 3.
   - **Step 3 Confirm**: shows file name + line count; submit via `useFetcher` POST to this route with `filePath`, `fileName`, `format`, `columnMappings` (JSON string). On `fetcher.data` show result (`imported`, `duplicates`, `autoMatched`) with a Done button → navigate to `path.to.bankReconcile(bankAccountId)`.
2. Route action:
   ```typescript
   export async function action({ request, params }: ActionFunctionArgs) {
     assertIsPost(request);
     const { companyId, userId } = await requirePermissions(request, { create: "accounting" });
     const { bankAccountId } = params;
     if (!bankAccountId) throw new Error("bankAccountId not found");
     const formData = await request.formData();
     const validation = await validator(bankStatementUploadValidator).validate(formData);
     if (validation.error) return validationError(validation.error);

     const serviceRole = getCarbonServiceRole();
     const importRow = await serviceRole
       .from("bankStatementImport")
       .insert([{
         bankAccountId,
         fileName: validation.data.fileName,
         filePath: validation.data.filePath,
         format: validation.data.format,
         companyId,
         createdBy: userId,
       }])
       .select("id")
       .single();
     if (importRow.error) {
       return data({}, await flash(request, error(importRow.error, "Failed to create import")));
     }
     const result = await importBankStatement(serviceRole, {
       importId: importRow.data.id,
       companyId,
       userId,
       columnMappings: validation.data.columnMappings,
     });
     if (result.error) {
       return data({}, await flash(request, error(result.error, "Import failed")));
     }
     return data(result.data, { status: 201 });
   }
   ```
   (`getCarbonServiceRole` import: same as `x+/shared+/import.$tableId.tsx`.)
3. Commit (`feat(accounting): bank statement import drawer`).

---

## Task 19: Reconcile workspace route (loader + action)

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/reconcile.$bankAccountId.tsx`

**Steps:**

1. Loader: `requirePermissions({ view: "accounting" })`; `Promise.all`: `getBankAccount`, `getBankTransactions` (status filter from `?status=`, default `Unmatched`), unmatched GL lines (`bankMatchableJournalLine` where `accountId = glAccountId`, `groupId is null`, order `postingDate desc`, limit 100), `getCompanySettings` (for tolerance display). Redirect+flash if the account is missing.
2. Action — single route, `intent` field switch (each branch validates its own small schema):
   ```typescript
   export async function action({ request, params }: ActionFunctionArgs) {
     assertIsPost(request);
     const { client, companyId, userId } = await requirePermissions(request, { update: "accounting" });
     const { bankAccountId } = params;
     if (!bankAccountId) throw new Error("bankAccountId not found");
     const formData = await request.formData();
     const intent = formData.get("intent");
     const db = getCarbonServiceRole(); // Kysely handle: use the SAME import the postDepreciationRun caller route uses — grep "postDepreciationRun(" under apps/erp/app/routes and mirror it exactly

     try {
       switch (intent) {
         case "match": {
           const bankTransactionIds = formData.getAll("bankTransactionIds").map(String);
           const journalLineIds = formData.getAll("journalLineIds").map(String);
           const validation = bankMatchValidator.safeParse({ bankTransactionIds, journalLineIds });
           if (!validation.success) {
             return data({}, await flash(request, error(validation.error, "Select bank and GL lines")));
           }
           // Pre-allocate tolerance JE inputs so the server fn can book a within-tolerance difference
           const [settings, defaults, company] = await Promise.all([
             getCompanySettings(client, companyId),
             getDefaultAccounts(client, companyId),
             getCompany(client, companyId),
           ]);
           let toleranceJournal;
           if (Number(settings.data?.bankMatchToleranceAmount ?? 0) > 0 && defaults.data?.bankFeesAccount) {
             const [seq, period] = await Promise.all([
               getNextSequence(client, "journalEntry", companyId),
               getOrCreateAccountingPeriod(client, companyId, todayIsoDate()),
             ]);
             if (seq.data && period.data) {
               toleranceJournal = {
                 journalEntryId: seq.data,
                 accountingPeriodId: period.data,
                 bankFeesAccountId: defaults.data.bankFeesAccount,
                 companyGroupId: company.data!.companyGroupId,
               };
             }
           }
           await createBankMatchGroup(db, { companyId, userId, bankTransactionIds, journalLineIds, toleranceJournal });
           return data({}, await flash(request, success("Matched")));
         }
         case "unmatch": {
           await deleteBankMatchGroup(db, { companyId, userId, groupId: String(formData.get("groupId")) });
           return data({}, await flash(request, success("Unmatched")));
         }
         case "exclude":
         case "restore": {
           const fn = intent === "exclude" ? excludeBankTransaction : restoreBankTransaction;
           const result = await fn(client, { id: String(formData.get("bankTransactionId")), userId });
           if (result.error) return data({}, await flash(request, error(result.error, "Update failed")));
           return data({}, await flash(request, success(intent === "exclude" ? "Excluded" : "Restored")));
         }
         case "create-journal": {
           const validation = await validator(bankQuickJournalValidator).validate(formData);
           if (validation.error) return validationError(validation.error);
           const account = await getBankAccount(client, bankAccountId);
           const base = await getBaseCurrency(client, companyId);
           if (account.data?.currencyCode !== base.data?.code) {
             return data({}, await flash(request, error(null, "Quick-create is not available for foreign-currency accounts yet — record a payment or manual journal entry instead")));
           }
           const txnDate = String(formData.get("transactionDate") ?? todayIsoDate());
           const [seq, period, company] = await Promise.all([
             getNextSequence(client, "journalEntry", companyId),
             getOrCreateAccountingPeriod(client, companyId, txnDate),
             getCompany(client, companyId),
           ]);
           if (seq.error || !seq.data) return data({}, await flash(request, error(seq.error, "Failed to allocate journal id")));
           if (period.error || !period.data) return data({}, await flash(request, error(period.error, "Accounting period is not open")));
           await createJournalEntryFromBankTransaction(db, {
             companyId,
             companyGroupId: company.data!.companyGroupId,
             userId,
             bankTransactionId: validation.data.bankTransactionId,
             accountId: validation.data.accountId,
             memo: validation.data.memo,
             journalEntryId: seq.data,
             accountingPeriodId: period.data,
           });
           return data({}, await flash(request, success("Journal entry posted and matched")));
         }
         case "run-matching": {
           const result = await client.rpc("run_bank_matching", {
             bank_account_id: bankAccountId,
             company_id: companyId,
             user_id: userId,
           });
           if (result.error) return data({}, await flash(request, error(result.error, "Matching failed")));
           return data({}, await flash(request, success(`Auto-matched ${result.data} lines`)));
         }
         default:
           throw new Error(`Unknown intent ${intent}`);
       }
     } catch (err) {
       return data({}, await flash(request, error(err, (err as Error).message)));
     }
   }
   ```
   Notes for the executor: (a) the `db` Kysely import — grep `postDepreciationRun(` for the calling route and copy its import line; (b) `getOrCreateAccountingPeriod` may have gained a `source` param from the in-flight period-close work — pass `"accounting"` if the signature accepts it; (c) `todayIsoDate()` = `today(getLocalTimeZone()).toString()` from `@internationalized/date`, already used across the module; (d) `getCompanySettings`/`getCompany` live in `~/modules/settings` — copy imports from a route that uses them.
3. Commit (`feat(accounting): reconcile workspace actions`).

---

## Task 20: Reconcile workspace UI

**Files:**
- Create: `apps/erp/app/modules/accounting/ui/Banking/ReconcileWorkspace.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Banking/BankTransactionStatus.tsx`
- Modify: `apps/erp/app/routes/x+/accounting+/reconcile.$bankAccountId.tsx` (default export)

**Steps:**

1. `BankTransactionStatus.tsx`: status badge component cloned from `PaymentStatus` (gray Pending/Unmatched, blue Matched, amber Excluded, green Reconciled).
2. `ReconcileWorkspace.tsx` — full-page two-pane layout (`grid grid-cols-2 gap-4 h-full`):
   - **Header**: account name + currency, running totals (`cleared`, `statement lines`, unmatched count — plain numbers), buttons: `Run matching` (fetcher POST `intent=run-matching`), `Import statement` (→ `path.to.bankAccountImport`), `Finish reconciliation` (→ `path.to.bankReconcileFinish`).
   - **Left pane** (statement lines): status filter tabs (Unmatched / Matched / Excluded / All → `?status=` search param); each row: date, description, reference, signed amount (`tabular-nums`, red negative), status badge; row selection (checkbox, multi); row actions: Exclude/Restore (fetcher), `Add` popover — a small `ValidatedForm` with `<Account name="accountId" />` + `<Input name="memo" />` + hidden `bankTransactionId`/`transactionDate`, submitting `intent=create-journal`.
   - **Right pane** (unmatched GL lines): date, `journalEntryId`, description, amount; multi-select checkboxes.
   - **Match bar** (sticky footer): shows Σselected-bank vs Σselected-GL and their difference; `Match` button enabled when both sides have a selection, submits `intent=match` with `bankTransactionIds`/`journalLineIds` repeated fields via `fetcher.submit`.
   - For a selected Matched line show its group members + `Unmatch` (fetcher `intent=unmatch` with `groupId` — extend the loader to include group memberships for visible Matched lines: query `bankMatchGroupTransaction` + `bankMatchGroupJournalLine` joined for the page of lines).
   - ERP default sizes (`size="md"`), Lingui `t`/`Trans` for all labels, no parenthesized counts.
3. Default export wires loader data into the workspace.
4. Commit (`feat(accounting): reconcile workspace UI`).

---

## Task 21: Finish-reconciliation drawer

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/reconcile.$bankAccountId.finish.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Banking/FinishReconciliationDrawer.tsx`

**Steps:**

1. Loader: `requirePermissions({ view: "accounting" })`; reads `?statementDate=&statementEndingBalance=` when present and returns `getBankReconciliationSummary(...)` plus the latest OFX `statementEndingBalance` from `bankStatementImport` (most recent Completed import for the account) as a prefill; also `companySettings.bankRecRequireApproval`.
2. Drawer: `ValidatedForm` (`bankReconciliationValidator`) with `DatePicker name="statementDate"`, `Number name="statementEndingBalance"`, `TextArea name="notes"`; on change of either key field, refetch summary via `useFetcher` against the loader; render: starting balance, cleared total, **difference** (green 0 / red otherwise), unmatched-lines blocker list, outstanding GL items (collapsed). Submit button label: `Complete reconciliation` or `Submit for review` (per `bankRecRequireApproval`), disabled unless `difference === 0 && unmatchedLines.length === 0`.
3. Action:
   ```typescript
   const validation = await validator(bankReconciliationValidator).validate(formData);
   if (validation.error) return validationError(validation.error);
   const summary = await getBankReconciliationSummary(client, companyId, { ...validation.data });
   if (summary.error || !summary.data) return data({}, await flash(request, error(summary.error, "Failed to compute summary")));
   const seq = await getNextSequence(client, "bankReconciliation", companyId);
   if (seq.error || !seq.data) return data({}, await flash(request, error(seq.error, "Failed to allocate reconciliation id")));
   const created = await createBankReconciliation(client, {
     ...validation.data,
     reconciliationId: seq.data,
     startingBalance: summary.data.startingBalance,
     companyId,
     createdBy: userId,
   });
   if (created.error || !created.data) return data({}, await flash(request, error(created.error, "Failed to create reconciliation")));
   const settings = await getCompanySettings(client, companyId);
   const requireApproval = Boolean(settings.data?.bankRecRequireApproval);
   if (requireApproval) {
     const submitted = await submitBankReconciliation(client, { id: created.data.id, userId });
     if (submitted.error) return data({}, await flash(request, error(submitted.error, "Failed to submit")));
     throw redirect(path.to.bankReconciliations, await flash(request, success("Submitted for review")));
   }
   await completeBankReconciliation(db, { companyId, userId, reconciliationId: created.data.id, requireApproval: false });
   throw redirect(
     path.to.bankReconciliation(created.data.id),
     await flash(request, success("Reconciliation completed"))
   );
   ```
   Wrap the `completeBankReconciliation` call in try/catch → flash the thrown message (it throws on gate failures).
4. Commit (`feat(accounting): finish reconciliation flow`).

---

## Task 22: Reconciliations list, detail/report, approve/void + PDF

**Files:**
- Create: `apps/erp/app/routes/x+/accounting+/reconciliations.tsx`
- Create: `apps/erp/app/routes/x+/accounting+/reconciliations.$reconciliationId.tsx`
- Create: `apps/erp/app/modules/accounting/ui/Banking/BankReconciliationsTable.tsx`
- Create: `packages/documents/src/pdf/BankReconciliationPDF.tsx` (+ export from the pdf barrel)
- Create: `apps/erp/app/routes/file+/bank-reconciliation+/$id[.]pdf.tsx`

**Steps:**

1. List route + table: clone the Task 16 pattern. Columns: `reconciliationId` (Hyperlink → detail), bank account name, `statementDate`, `statementEndingBalance` (currency), status badge (Draft gray / In Review amber / Completed green / Voided red), `completedBy`/`completedAt`. Filter by bank account (`?bankAccountId=`).
2. Detail route (drawer over the list via `<Outlet />`): loader returns `getBankReconciliation`, its reconciled lines (`bankTransaction` where `reconciliationId`), and outstanding GL lines at the statement date (reuse the summary query). Renders the report: header (account, REC id, statement date, preparer/approver), balances block (starting → cleared deposits/withdrawals → ending), reconciled-lines table, outstanding-items table, book-balance tie line. Buttons: `Download PDF` (link to `path.to.bankReconciliationPdf(id)`), `Approve` (visible when status In Review AND `user.id !== submittedBy` AND `permissions.can("update", "accounting")`; fetcher `intent=approve`), `Void` (visible on latest Completed; `intent=void`, `ConfirmDelete`-style confirm).
   Action: `approve` → `completeBankReconciliation(db, { ..., requireApproval: true })`; `void` → `voidBankReconciliation(db, ...)`; both try/catch → flash.
3. `BankReconciliationPDF.tsx`: hand-built like `KanbanLabelPDF.tsx` (no template customizer) — `Document`/`Page` from `@react-pdf/renderer`, company header, the same four report blocks as the detail drawer, monospace-aligned amount columns. Props: `{ company, reconciliation, bankAccount, reconciledLines, outstandingLines, locale }`. Export from `packages/documents/src/pdf/index.ts` (match how `KanbanLabelPDF` is exported).
4. `file+/bank-reconciliation+/$id[.]pdf.tsx`: clone `file+/sales-invoice+/$id[.]pdf.tsx` skeleton — `requirePermissions({ view: "accounting" })`, fetch the same data as the detail loader, `renderToStream(<BankReconciliationPDF ... />)`, drain to Buffer, return `application/pdf` response with `Content-Disposition: inline; filename="{reconciliationId}.pdf"`. Skip the template/sections machinery; call `ensureFont("Inter")` only if the sales-invoice route shows it's required for base fonts.
5. Commit (`feat(accounting): reconciliation history, approval, and PDF report`).

---

## Task 23: Settings UI (tolerance, approval, bank fees account)

**Files:**
- Modify: the accounting settings route (grep `accountingEnabled` under `apps/erp/app/routes/x+/settings+/` — the page that edits `companySettings`) — add `Number` field `bankMatchToleranceAmount` and `Boolean` field `bankRecRequireApproval` (with description "Reconciliations must be approved by someone other than the preparer") to its form + validator.
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add `bankFeesAccount: z.string().min(1)` to `defaultIncomeAcountValidator` (sic — existing name), and `apps/erp/app/routes/x+/accounting+/defaults.tsx` UI — add an `Account` field labeled `Bank Fees` next to `Interest`; extend `updateDefaultIncomeAccounts` field list in `accounting.service.ts`.

**Steps:** mirror the neighboring fields exactly in each file; commit (`feat(accounting): bank rec settings + bank fees default account`).

---

## Task 24: Verification + source sync

**Steps:**

1. Full verification:
   ```bash
   pnpm run typecheck            # per-package via turbo — expected: pass
   pnpm run lint                 # expected: pass
   cd packages/database/supabase/functions/import-bank-statement && deno test parsers/ && cd -
   cd packages/database/supabase/functions/post-payment && deno test . && cd -
   psql "<local conn>" -f packages/database/supabase/migrations/<ts>_bank-reconciliation.sql   # idempotency re-check
   ```
2. Sync sources (keep-sources-in-sync rule):
   - Spec `.ai/specs/2026-07-02-bank-reconciliation.md` changelog: PDF on-demand via `file+` route (drop `reportDocumentPath`), tolerance = manual-match-only in Phase 1, reference-agreement removed from the auto-match RPC (returns as Phase 4 suggestion ranking), quick-create blocked on FX accounts pending source-amount support in the quick-create path.
   - `apps/erp/app/modules/accounting/AGENTS.md`: add the banking tables/services/routes to its inventory.
   - `.ai/rules/`: no rule tracks banking yet — add a stub section to `.ai/rules/accounting-sync-handlers.md` only if it mentions payments GL specifics; otherwise skip (Phase 2 adds a `bank-feed` rule with Plaid).
3. Manual UI verification is deliberately deferred (user instruction: don't run the app). Flag in the PR description that agent-browser verification (`/test` skill) has not run and should gate merge per the ui-e2e-verification convention.
4. Final commit + summary of any deviations discovered during execution.

---

## Self-review checklist (per plan skill)

- [x] Migration follows the newest sibling patterns (single-col PK per ar-ap-payments, `id('prefix')`, audit columns, FK indexes, 4-policy RLS with `::text[]`, idempotent DDL, no NUMERIC precision, randomized timestamp via CLI)
- [x] Validators use `z` + `zfd`; actions use `validator(schema).validate(formData)`; forms use `ValidatedForm` + `~/components/Form` barrel
- [x] Services: `(client, ...)` → `{ data, error }`, `companyId` scoping, `setGenericQueryFilters`, Kysely for multi-row transactions
- [x] No `Response.json`; drawers for detail views; full page only for the workspace; flash on every mutation; `path.to.*` everywhere
- [x] Deviations from spec/skill defaults are explicit (Execution notes 2–3) — nothing silent
- [x] Two grep-and-mirror steps remain (Kysely `db` import; settings route filename) — flagged inline rather than guessed
