# Reimbursements as a First-Class Carbon Document — implementation plan

**Spec (data model):** `.ai/specs/2026-09-23-reimbursements-first-class.md`
**Spec (shared shape):** `.ai/specs/2026-09-23-editable-imported-spend-documents.md`
**Research:** `.ai/research/2026-09-22-sap-grade-ap-ar-document-model.md`
**Branch:** `rillet-ramp-accounting-provider`

> **The model: imported, then editable — never hand-created.** The Ramp sync is
> the only thing that brings a reimbursement into existence, so there is **no
> create form and no `new` route**. But an imported reimbursement lands
> **Draft** (the sync no longer auto-posts) and is **editable while Draft** —
> header fields and coding lines, including adding and removing lines — then a
> human Posts it. The detail surface is a **full page** with read and edit
> modes, carries a **SOURCE badge** (provider logo + name + external id), and
> guards the header-total-equals-line-sum invariant before Post. A **Posted**
> row is immutable.
>
> **The sync CREATES; it never re-writes an existing document.** Once a row
> exists in Carbon, Carbon's copy is authoritative and no later sync run touches
> its header or its lines. Accepted cost, stated in the spec: a provider-side
> correction made after import does not flow through. **There is no
> activity/timeline surface** — Carbon has no generic activity table, the audit
> log is the real history, and the SOURCE badge carries provenance on its own.
>
> If a task below seems to want a create form or a `new` route, it is the wrong
> task — STOP and report.

> **Line dimensions go through the EXISTING `DimensionSelector`.** The shared
> spec (commit `f821ddf9c2`) reversed the earlier "defer the wider dimension
> set" decision. Do **not** build a picker per concept (Department, Location,
> Supplier, Item, Customer, Employee, Work Center, Process, Item Posting
> Group) — reuse
> `apps/erp/app/modules/accounting/ui/JournalEntries/DimensionSelector.tsx`,
> which already renders the company's *configured* dimensions generically,
> colours each entity type, and serves the high-cardinality ones (Customer,
> Supplier, Item) from the client stores through a searchable virtualized
> Combobox. It already covers **Project and CostCenter** as entity types, which
> is why this plan has no Project-picker task.
>
> That reverses the spec's earlier "v1 needs no migration" claim:
> `DimensionSelector` works in `{dimensionId, valueId}` pairs, so Task 1 adds a
> generic `reimbursementLineDimension` child table mirroring
> `journalLineDimension`. The legacy `reimbursementLine.costCenterId` /
> `projectId` columns **stay** — the Ramp sync writes them and posting reads
> them — and Task 9's posting pass **unions both sources, de-duplicating by
> `dimensionId`**. Consolidating onto the generic table alone is a documented
> follow-up, not this plan's work.

> **Ask-First gate.** The spec flags three Ask-First items (new tables, new edge
> function, Ramp rework) as *autonomously resolved, awaiting veto*. Do not start
> Task 1 until the user has confirmed. If no confirmation is on record, STOP and
> ask — do not improvise.

> **Universal rule for every task in this plan.** After ANY `pnpm exec turbo …`
> command, run `git status --short packages/database/` and revert
> generated-artifact churn:
> ```bash
> git checkout -- packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts packages/database/supabase/functions/lib/types.ts
> ```
> The ONLY exception is Task 2, where `pnpm run generate:types` regenerates
> those files deliberately and they must be committed. (`.ai/lessons.md` —
> "Turbo typecheck/test runs can regenerate `@carbon/database` artifacts as
> ride-along churn".)

> **Never a whole-repo typecheck.** Only
> `pnpm exec turbo run typecheck --filter=erp`, `--filter=@carbon/ee`,
> `--filter=@carbon/jobs`.

> **Path correction, carried forward.** Both specs say the Ramp reimbursement
> syncer is `ramp-sync-reimbursement.ts` near
> `packages/ee/src/ramp/lib/suppliers.ts`. **It is not.** The real file is
> `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement.ts`
> (788 lines, Inngest-coupled), with its family driver at
> `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement-family.ts`.
> Task 23 targets the real files. Do not go looking in `packages/ee/src/ramp/`.

> **Scope boundary with the sibling spec.** Tasks 12 and 13 build the SOURCE
> badge and the line editor as **reusable, document-agnostic** components in
> `apps/erp/app/components/`, because
> `.ai/specs/2026-09-23-editable-imported-spend-documents.md` requires charges
> to use the same ones. **Converting the charge UI to use them, and stopping
> `ramp-sync-card.ts` from auto-posting charges, are that spec's work and are
> OUT OF SCOPE here** — see "Coordination with the sibling spec" at the end.

## Progress

- [x] Task 1: Migration — reimbursement schema, control account, settlement + payment payee
- [x] Task 2: Regenerate database types
- [x] Task 3: Seed data — 2180 account, account default, sequence row
- [x] Task 4: `invoicing.models.ts` — status constants + EDIT validators
- [x] Task 5: `invoicing.service.ts` — readers + `updateReimbursement` header write
- [x] Task 6: `invoicing.service.ts` — Kysely line writers
- [x] Task 7: Accounting defaults — Employee Reimbursements Payable picker
- [x] Task 8: `build-reimbursement-journal.ts` (pure) + its Deno test
- [x] Task 9: `post-reimbursement` edge function driver + `config.toml`
- [x] Task 10: `post-reimbursement` handler + transaction Deno tests
- [ ] Task 11: Dimension data plumbing for the line editor
- [ ] Task 12: Shared `DocumentSourceBadge` component
- [ ] Task 13: Shared `DocumentLineEditor` component
- [ ] Task 14: `path.to` entries for reimbursements
- [ ] Task 15: `ReimbursementStatus` + `ReimbursementsTable`
- [ ] Task 16: Reimbursement detail — read mode
- [ ] Task 17: Reimbursement detail — edit mode
- [ ] Task 18: Post + Void action routes, with the totals guard
- [ ] Task 19: Nav entry under Accounts Payable
- [ ] Task 20: Settlement target — models + service
- [ ] Task 21: `post-payment` — reimbursement settlement arm
- [ ] Task 22: Payment UI — employee payee + reimbursement apply target
- [ ] Task 23: Ramp inbound — create a Draft `reimbursement`; never auto-post, never re-write
- [ ] Task 24: `@carbon/ee` accounting — `reimbursement` entity type + plumbing
- [ ] Task 25: Rillet `ReimbursementSyncer`
- [ ] Task 26: Rillet payout — close `UNSUPPORTED_REIMBURSEMENT_PAYMENT`
- [ ] Task 27: QBO `ReimbursementSyncer`
- [ ] Task 28: Xero `ReimbursementSyncer`
- [ ] Task 29: Full validation gate
- [ ] Task 30: Browser verification via `/test`

## Dependencies

```
1 → 2 → everything else
2 → 3, 4, 7, 8          (parallel)
4 → 5 → 6, 15, 16, 20, 23
5 → 14 → 15, 16, 17, 18
8 → 9 → 10, 18, 23
11 → 13 → 17
12 → 16
6  → 17
16, 17, 18 → 19
20 → 21, 22             (21, 22 parallel)
2 → 24 → 25, 27, 28     (25, 27, 28 parallel)
25 → 26
all → 29 → 30
```

Independent, safe to run as parallel subagents once their dependencies are met:

- **Tasks 3, 4, 7, 8** (after Task 2) — different files.
- **Tasks 11, 12** (after Task 2) — different files.
- **Tasks 21, 22** (after Task 20) — edge function vs ERP UI.
- **Tasks 25, 27, 28** (after Task 24) — one provider directory each.

---

## Task 1: Migration — reimbursement schema, control account, settlement + payment payee

**Depends on:** none

**Files:**
- Create: `packages/database/supabase/migrations/<generated>_reimbursements-first-class.sql`
- Copy from (precedent): `packages/database/supabase/migrations/20260922195151_rename-card-transactions-to-charges.sql` (tables, triggers, RLS, sequence, event trigger)
- Copy from (precedent): `packages/database/supabase/migrations/20260908142501_returns-module.sql` lines 278–339 (nullable account default + company-group account seed)
- Copy from (precedent): `packages/database/supabase/migrations/20260630093809_ar-ap-payments.sql` lines 413–486 (`invoiceSettlement` target columns, XOR CHECK, partial indexes), lines 191–249 (`payment` party check)

**Steps:**

1. Create the file — **never hand-pick or backdate the timestamp**:
   ```bash
   pnpm db:migrate:new reimbursements-first-class
   ```
   Confirm the generated filename's HHMMSS is not `000000`; if it is, delete the
   file and re-run.

2. Write the SQL below into that file, in this order. Every statement is
   idempotent (the deploy runner retries a failed file over committed partial
   state).

   **(a) Enum + journal enum labels.** `ALTER TYPE … ADD VALUE` must not be
   referenced later in the same migration — nothing below does.
   ```sql
   DO $$
   BEGIN
     IF to_regtype('public."reimbursementStatus"') IS NULL THEN
       CREATE TYPE public."reimbursementStatus" AS ENUM ('Draft', 'Posted', 'Voided');
     END IF;
   END;
   $$;

   ALTER TYPE "journalEntrySourceType" ADD VALUE IF NOT EXISTS 'Reimbursement';
   ALTER TYPE "journalLineDocumentType" ADD VALUE IF NOT EXISTS 'Reimbursement';
   ```

   **(b) Tables.** `reimbursementLine` mirrors `chargeLine` **exactly**
   (`accountId`, `costCenterId`, `projectId`, `description`, `amount`,
   `sequence`) — the spec's Line-shape decision row requires it so one line
   editor serves both documents. Do not add or rename a line column.
   ```sql
   CREATE TABLE IF NOT EXISTS "reimbursement" (
     id TEXT NOT NULL DEFAULT id('reimb'),
     "companyId" TEXT NOT NULL,
     "reimbursementId" TEXT NOT NULL,
     "employeeId" TEXT NOT NULL,
     status "reimbursementStatus" NOT NULL DEFAULT 'Draft',
     integration TEXT NOT NULL DEFAULT 'ramp',
     "reimbursementDate" DATE NOT NULL,
     "postingDate" DATE,
     "currencyCode" TEXT NOT NULL REFERENCES "currencyCode"(code),
     "exchangeRate" NUMERIC NOT NULL DEFAULT 1 CHECK ("exchangeRate" > 0),
     amount NUMERIC NOT NULL CHECK (amount > 0),
     "payableAccountId" TEXT REFERENCES "account"(id),
     reference TEXT,
     notes TEXT,
     "journalId" TEXT REFERENCES "journal"(id),
     "postedAt" TIMESTAMP WITH TIME ZONE,
     "postedBy" TEXT REFERENCES "user"(id),
     "voidedAt" TIMESTAMP WITH TIME ZONE,
     "voidedBy" TEXT REFERENCES "user"(id),
     "createdBy" TEXT NOT NULL REFERENCES "user"(id),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"(id),
     "updatedAt" TIMESTAMP WITH TIME ZONE,
     "customFields" JSONB,

     CONSTRAINT "reimbursement_pkey" PRIMARY KEY (id, "companyId"),
     CONSTRAINT "reimbursement_companyId_fkey"
       FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
     CONSTRAINT "reimbursement_employeeId_fkey"
       FOREIGN KEY ("employeeId", "companyId")
       REFERENCES "employee"(id, "companyId") ON UPDATE CASCADE ON DELETE RESTRICT,
     CONSTRAINT "reimbursement_reimbursementId_companyId_key"
       UNIQUE ("reimbursementId", "companyId"),
     CONSTRAINT "reimbursement_lifecycle_audit_check" CHECK (
       (status = 'Draft' AND "journalId" IS NULL AND "postedAt" IS NULL
        AND "postedBy" IS NULL AND "voidedAt" IS NULL AND "voidedBy" IS NULL)
       OR (status = 'Posted' AND "postingDate" IS NOT NULL AND "postedAt" IS NOT NULL
           AND "postedBy" IS NOT NULL AND "voidedAt" IS NULL AND "voidedBy" IS NULL)
       OR (status = 'Voided' AND "postingDate" IS NOT NULL AND "postedAt" IS NOT NULL
           AND "postedBy" IS NOT NULL AND "voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL)
     )
   );

   CREATE TABLE IF NOT EXISTS "reimbursementLine" (
     id TEXT NOT NULL DEFAULT id('reimbl'),
     "companyId" TEXT NOT NULL,
     "reimbursementId" TEXT NOT NULL,
     "accountId" TEXT NOT NULL REFERENCES "account"(id),
     "costCenterId" TEXT,
     "projectId" TEXT,
     description TEXT,
     amount NUMERIC NOT NULL,
     sequence INTEGER NOT NULL DEFAULT 0,
     "createdBy" TEXT NOT NULL REFERENCES "user"(id),
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
     "updatedBy" TEXT REFERENCES "user"(id),
     "updatedAt" TIMESTAMP WITH TIME ZONE,
     "customFields" JSONB,

     CONSTRAINT "reimbursementLine_pkey" PRIMARY KEY (id, "companyId"),
     CONSTRAINT "reimbursementLine_companyId_fkey"
       FOREIGN KEY ("companyId") REFERENCES "company"(id) ON DELETE CASCADE,
     CONSTRAINT "reimbursementLine_reimbursementId_fkey"
       FOREIGN KEY ("reimbursementId", "companyId")
       REFERENCES "reimbursement"(id, "companyId") ON DELETE CASCADE,
     CONSTRAINT "reimbursementLine_costCenterId_fkey"
       FOREIGN KEY ("costCenterId", "companyId")
       REFERENCES "costCenter"(id, "companyId")
       ON UPDATE CASCADE ON DELETE SET NULL ("costCenterId"),
     CONSTRAINT "reimbursementLine_projectId_fkey"
       FOREIGN KEY ("projectId", "companyId")
       REFERENCES "project"(id, "companyId")
       ON UPDATE CASCADE ON DELETE SET NULL ("projectId")
   );

   -- Generic dimension pairs for a coding line. DimensionSelector works in
   -- {dimensionId, valueId} pairs and the two legacy columns above cannot hold
   -- them, so the editor needs this table. The legacy columns STAY (the Ramp
   -- sync writes them, posting reads them); Task 9's posting pass unions both
   -- sources and de-duplicates by dimensionId.
   --
   -- This MIRRORS "journalLineDimension" (20260228024512_dimensions.sql:116-138)
   -- and deliberately departs from the usual table template to do so, because
   -- it is the same kind of thing and the two are read together at posting:
   --   * single-column PRIMARY KEY ("id") — NOT the usual composite
   --     ("id","companyId"); journalLineDimension is PK ("id") alone.
   --   * single-column FK to "dimension"("id"). `dimension` is companyGroup-
   --     scoped with a single-column PK, like `account` and `item`, so a
   --     composite (dimensionId, companyId) FK would not resolve.
   --   * plain "companyId" REFERENCES "company"("id").
   --   * no createdBy/updatedBy — journalLineDimension carries only createdAt,
   --     and an association row written and replaced wholesale by one code path
   --     has no independent authorship worth recording.
   CREATE TABLE IF NOT EXISTS "reimbursementLineDimension" (
     "id" TEXT NOT NULL DEFAULT id('reimbld'),
     "reimbursementLineId" TEXT NOT NULL,
     "dimensionId" TEXT NOT NULL,
     "valueId" TEXT NOT NULL,
     "companyId" TEXT NOT NULL,
     "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

     CONSTRAINT "reimbursementLineDimension_pkey" PRIMARY KEY ("id"),
     CONSTRAINT "reimbursementLineDimension_line_dimension_key"
       UNIQUE ("reimbursementLineId", "dimensionId"),
     CONSTRAINT "reimbursementLineDimension_reimbursementLineId_fkey"
       FOREIGN KEY ("reimbursementLineId", "companyId")
       REFERENCES "reimbursementLine"("id", "companyId")
       ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT "reimbursementLineDimension_dimensionId_fkey"
       FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id")
       ON DELETE CASCADE ON UPDATE CASCADE,
     CONSTRAINT "reimbursementLineDimension_companyId_fkey"
       FOREIGN KEY ("companyId") REFERENCES "company"("id")
       ON DELETE CASCADE ON UPDATE CASCADE
   );

   -- valueId is INTENTIONALLY not a foreign key, exactly as on
   -- journalLineDimension (see the comment at 20260228024512:131-134). For a
   -- Custom dimension it references dimensionValue.id; for an entity-based one
   -- it references that entity's table (location.id, department.id, …). Adding
   -- a FK here would break every entity-typed dimension. The polymorphic
   -- reference is enforced at the application layer.
   ```
   The UNIQUE on `("reimbursementLineId","dimensionId")` is what makes "one
   value per dimension per line" true in the database — the same invariant
   `DimensionSelector` enforces in the UI, and the same two-column shape
   `journalLineDimension_journalLineId_dimensionId_key` uses. Note the line FK
   is composite because `reimbursementLine`'s OWN pk is composite; only the
   `dimension` and `company` references are single-column.
   `integration TEXT NOT NULL DEFAULT 'ramp'` mirrors `charge.integration` and
   is what the SOURCE badge reads. There is deliberately **no `importedAt`
   column**: an earlier draft of this plan added one to timestamp an Activity
   entry, and the spec has since dropped the activity/timeline surface
   altogether (Carbon has no generic activity table; the audit log is the real
   history). The SOURCE badge carries provenance without it. **Do not
   re-introduce it.**

   **(c) Indexes** — `companyId` and EVERY FK, mirroring the `charge` block
   (precedent lines 196–221):
   ```sql
   CREATE INDEX IF NOT EXISTS "reimbursement_companyId_idx" ON "reimbursement" ("companyId");
   CREATE INDEX IF NOT EXISTS "reimbursement_companyId_status_idx" ON "reimbursement" ("companyId", status);
   CREATE INDEX IF NOT EXISTS "reimbursement_companyId_reimbursementDate_idx" ON "reimbursement" ("companyId", "reimbursementDate");
   CREATE INDEX IF NOT EXISTS "reimbursement_employeeId_companyId_idx" ON "reimbursement" ("employeeId", "companyId");
   CREATE INDEX IF NOT EXISTS "reimbursement_currencyCode_idx" ON "reimbursement" ("currencyCode");
   CREATE INDEX IF NOT EXISTS "reimbursement_payableAccountId_idx" ON "reimbursement" ("payableAccountId");
   CREATE INDEX IF NOT EXISTS "reimbursement_journalId_idx" ON "reimbursement" ("journalId");
   CREATE INDEX IF NOT EXISTS "reimbursement_createdBy_idx" ON "reimbursement" ("createdBy");
   CREATE INDEX IF NOT EXISTS "reimbursement_updatedBy_idx" ON "reimbursement" ("updatedBy");
   CREATE INDEX IF NOT EXISTS "reimbursement_postedBy_idx" ON "reimbursement" ("postedBy");
   CREATE INDEX IF NOT EXISTS "reimbursement_voidedBy_idx" ON "reimbursement" ("voidedBy");

   CREATE INDEX IF NOT EXISTS "reimbursementLine_companyId_idx" ON "reimbursementLine" ("companyId");
   CREATE INDEX IF NOT EXISTS "reimbursementLine_reimbursementId_companyId_idx" ON "reimbursementLine" ("reimbursementId", "companyId");
   CREATE INDEX IF NOT EXISTS "reimbursementLine_accountId_idx" ON "reimbursementLine" ("accountId");
   CREATE INDEX IF NOT EXISTS "reimbursementLine_costCenterId_companyId_idx" ON "reimbursementLine" ("costCenterId", "companyId");
   CREATE INDEX IF NOT EXISTS "reimbursementLine_projectId_idx" ON "reimbursementLine" ("projectId");
   CREATE INDEX IF NOT EXISTS "reimbursementLine_createdBy_idx" ON "reimbursementLine" ("createdBy");
   CREATE INDEX IF NOT EXISTS "reimbursementLine_updatedBy_idx" ON "reimbursementLine" ("updatedBy");

   -- The same three journalLineDimension carries (20260228024512:136-138).
   CREATE INDEX IF NOT EXISTS "reimbursementLineDimension_reimbursementLineId_idx" ON "reimbursementLineDimension" ("reimbursementLineId");
   CREATE INDEX IF NOT EXISTS "reimbursementLineDimension_dimensionId_idx" ON "reimbursementLineDimension" ("dimensionId");
   CREATE INDEX IF NOT EXISTS "reimbursementLineDimension_companyId_idx" ON "reimbursementLineDimension" ("companyId");
   ```

   **(d) Triggers** — clone all four from the precedent, renaming
   `charge`→`reimbursement`, `chargeLine`→`reimbursementLine`,
   `chargeStatus`→`reimbursementStatus`. These are what make "editable while
   Draft, immutable once Posted" true in the database, which the shared spec
   relies on as the backstop behind the UI guard:
   - `public.check_reimbursement_account_company_group()` (precedent lines
     224–269) — guard `"payableAccountId"` only (there is no `cardAccountId`);
     skip the check when `payableAccountId IS NULL`. Trigger
     `reimbursement_account_companyGroup_guard` BEFORE INSERT OR UPDATE OF
     `"companyId","payableAccountId"`.
   - `public.check_reimbursement_line_account_company_group()` (precedent lines
     271–305) — verbatim rename. Trigger
     `reimbursementLine_account_companyGroup_guard`.
   - `public.check_reimbursement_draft_mutation()` (precedent lines 309–390) —
     verbatim rename. The Draft→Draft arm (`IF OLD.status = 'Draft' AND
     NEW.status = 'Draft' THEN RETURN NEW;`) is what permits header editing, so
     keep it exactly. The Draft→Posted arm's allowed-field list gains
     **`payableAccountId`**, because the posting transaction resolves and stores
     it. Trigger `reimbursement_draft_guard`.
   - `public.lock_reimbursement_line_parent()` (precedent lines 393–470) —
     verbatim rename, including the `pg_trigger_depth() > 1` cascade escape.
     This is what refuses a line write against a Posted parent. Trigger
     `reimbursementLine_draft_guard`.

   **(e) RLS** — clone the precedent's blocks (lines 476–560) verbatim with the
   renames. Four policies named exactly `SELECT` / `INSERT` / `UPDATE` /
   `DELETE` on each table, schema-qualified, helper result cast `::text[]`:
   `SELECT` via `get_companies_with_employee_role()`; `INSERT`/`UPDATE`/`DELETE`
   via `get_companies_with_employee_permission('invoicing_create'|'invoicing_update'|'invoicing_delete')`,
   each additionally requiring `status = 'Draft'` (header) or the parent
   `EXISTS (… h.status = 'Draft')` (lines).

   `reimbursementLineDimension` gets **SELECT / INSERT / DELETE only** — the
   same three `journalLineDimension` carries (20260228024512:144-172), and the
   right set here for an independent reason: Task 6 replaces a line's dimensions
   by delete-then-insert, so nothing ever issues an UPDATE against this table.
   Gate them on invoicing permissions (not accounting, unlike the precedent —
   this is an invoicing document), reaching the Draft check through TWO joins
   (`reimbursementLineDimension` → `reimbursementLine` → `reimbursement`). It
   carries its own `companyId`, so the `companyId = ANY(...)` clause is direct;
   the `EXISTS` is only for the Draft check.

   **(f) Account default** — nullable BY DESIGN with a runtime AP fallback
   (precedent `20260908142501` lines 278–281):
   ```sql
   ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "employeeReimbursementsPayableAccount" TEXT
     REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
   ```
   Then seed account `2180 "Employee Reimbursements Payable"` for every existing
   company group, copying the `DO $$ … LOOP` at `20260908142501` lines 289–326
   **exactly**, changing only:
   - parent lookup: `"isGroup" = TRUE AND name = 'Current Liabilities'`
     (resolve the parent group by NAME, never by number — group headers carry
     `number = NULL`; `.ai/lessons.md` "Chart-of-accounts group headers have no
     number")
   - the INSERT values: `'2180', 'Employee Reimbursements Payable', FALSE,
     'Other Current Liability'::"accountType",
     'Balance Sheet'::"glIncomeBalance", 'Liability'::"glAccountClass",
     'Current'::"glConsolidatedRate"` (matching the sibling `2150`/`2160`/`2170`
     rows in `seed.data.ts`)
   - on a missing parent, `RAISE WARNING … ; CONTINUE;` — never insert an orphan.

   Then backfill the default, guarded on name so a customized chart that already
   uses 2180 for something else stays NULL (precedent lines 328–339):
   ```sql
   UPDATE "accountDefault" ad
   SET "employeeReimbursementsPayableAccount" = (
     SELECT a.id FROM "account" a
       INNER JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
       WHERE c.id = ad."companyId"
         AND a.number = '2180'
         AND a.name = 'Employee Reimbursements Payable'
       LIMIT 1
   )
   WHERE ad."employeeReimbursementsPayableAccount" IS NULL;
   ```

   **(g) Settlement target.** Add the fourth target and widen the XOR:
   ```sql
   ALTER TABLE "invoiceSettlement" ADD COLUMN IF NOT EXISTS "targetReimbursementId" TEXT;

   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'invoiceSettlement_targetReimbursementId_fkey'
     ) THEN
       ALTER TABLE "invoiceSettlement"
         ADD CONSTRAINT "invoiceSettlement_targetReimbursementId_fkey"
         FOREIGN KEY ("targetReimbursementId", "companyId")
         REFERENCES "reimbursement"(id, "companyId")
         ON DELETE RESTRICT ON UPDATE CASCADE;
     END IF;
   END;
   $$;

   -- Widen the target XOR. `invoiceSettlement` is financial data, so the swap
   -- is guarded on the constraint's own DEFINITION (not just its name): a retry
   -- that already sees the widened form does nothing, and never drops a live
   -- constraint. Added NOT VALID then validated separately so the ADD takes a
   -- brief lock and the scan runs under SHARE UPDATE EXCLUSIVE.
   --
   -- It cannot reject an existing row: every existing row satisfies the old
   -- three-way XOR, and `targetReimbursementId` is NULL on all of them, so each
   -- sum is exactly 1. VALIDATE is therefore guaranteed to pass — it proves
   -- that rather than assuming it.
   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'invoiceSettlement_target_check'
         AND pg_get_constraintdef(oid) LIKE '%targetReimbursementId%'
     ) THEN
       ALTER TABLE "invoiceSettlement" DROP CONSTRAINT IF EXISTS "invoiceSettlement_target_check";
       ALTER TABLE "invoiceSettlement" ADD CONSTRAINT "invoiceSettlement_target_check" CHECK (
         (("targetSalesInvoiceId" IS NOT NULL)::int
           + ("targetPurchaseInvoiceId" IS NOT NULL)::int
           + ("targetMemoId" IS NOT NULL)::int
           + ("targetReimbursementId" IS NOT NULL)::int) = 1
       ) NOT VALID;
       ALTER TABLE "invoiceSettlement" VALIDATE CONSTRAINT "invoiceSettlement_target_check";
     END IF;
   END;
   $$;

   CREATE INDEX IF NOT EXISTS "invoiceSettlement_targetReimbursementId_idx"
     ON "invoiceSettlement" ("targetReimbursementId")
     WHERE "targetReimbursementId" IS NOT NULL;
   ```

   **(h) Payment payee — `payment` is PRODUCTION-CRITICAL.** A reimbursement
   payout is a disbursement to an employee, and `payment` today is customer XOR
   supplier. The spec approves the widening and requires the migration to be
   **additive and idempotent**, so every statement below is guarded and nothing
   is destructive. Adding a nullable column with no default is a catalogue-only
   operation in PostgreSQL 11+, so it does not rewrite the table.
   ```sql
   ALTER TABLE "payment" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;

   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'payment_employeeId_fkey'
     ) THEN
       ALTER TABLE "payment"
         ADD CONSTRAINT "payment_employeeId_fkey"
         FOREIGN KEY ("employeeId", "companyId")
         REFERENCES "employee"(id, "companyId")
         ON DELETE RESTRICT ON UPDATE CASCADE;
     END IF;
   END;
   $$;

   -- Same guarded swap as (g), and for a stronger reason: this is the payments
   -- table. The guard reads the constraint DEFINITION, so re-running the
   -- migration after success is a no-op and never leaves `payment` briefly
   -- unconstrained.
   --
   -- **It cannot reject an existing row.** Every existing payment satisfies the
   -- old customer-XOR-supplier rule, and `employeeId` is NULL on all of them
   -- (the column was just added), so each sum is exactly 1. The widened form is
   -- strictly weaker than the old one on the existing column pair — it only
   -- ADDS a third way to be valid — so no historical row can fail it.
   DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'payment_party_check'
         AND pg_get_constraintdef(oid) LIKE '%employeeId%'
     ) THEN
       ALTER TABLE "payment" DROP CONSTRAINT IF EXISTS "payment_party_check";
       ALTER TABLE "payment" ADD CONSTRAINT "payment_party_check" CHECK (
         (("customerId" IS NOT NULL)::int
           + ("supplierId" IS NOT NULL)::int
           + ("employeeId" IS NOT NULL)::int) = 1
       ) NOT VALID;
       ALTER TABLE "payment" VALIDATE CONSTRAINT "payment_party_check";
     END IF;
   END;
   $$;

   CREATE INDEX IF NOT EXISTS "payment_employeeId_companyId_idx"
     ON "payment" ("employeeId", "companyId") WHERE "employeeId" IS NOT NULL;
   ```
   **Before applying, confirm on the local database that the pre-existing
   constraint is named exactly `payment_party_check`** (it is, per
   `20260630093809_ar-ap-payments.sql:225`). If a later migration renamed it,
   STOP and report — a guard keyed on the wrong name would silently leave the
   old constraint in place and the new column unconstrained.

   **(i) Sequence + event trigger** (precedent lines 563–601):
   ```sql
   INSERT INTO "sequence" (
     "table", name, prefix, suffix, next, size, step, "companyId"
   )
   SELECT 'reimbursement', 'Reimbursement',
          'REIMB-%{yyyy}-%{mm}-', NULL, 0, 6, 1, c.id
   FROM "company" c
   ON CONFLICT DO NOTHING;

   SELECT attach_event_trigger(
     'reimbursement',
     ARRAY[]::TEXT[],
     ARRAY[]::TEXT[]
   );

   NOTIFY pgrst, 'reload schema';
   ```

3. Do **not** add a `packages/jobs/src/backups/renames.ts` entry — this
   migration renames and drops nothing.

4. Apply it:
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
psql "$(grep -m1 DATABASE_URL .env.local | cut -d= -f2-)" -c "\d reimbursement" -c "\d reimbursementLine" -c "\d reimbursementLineDimension" -c "SELECT conname, convalidated, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('invoiceSettlement_target_check','payment_party_check');" -c "SELECT count(*) AS payments_violating FROM \"payment\" WHERE ((\"customerId\" IS NOT NULL)::int + (\"supplierId\" IS NOT NULL)::int + (\"employeeId\" IS NOT NULL)::int) <> 1;" -c "SELECT unnest(enum_range(NULL::\"reimbursementStatus\"));" -c "SELECT count(*) FROM \"sequence\" WHERE \"table\"='reimbursement';"
```
```
# Expected: both \d outputs list the composite PK ("id","companyId"), the
# id('reimb') / id('reimbl') defaults, the four audit columns, and the RLS
# policies SELECT/INSERT/UPDATE/DELETE; reimbursementLine's columns are exactly
# accountId, costCenterId, projectId, description, amount, sequence plus
# id/companyId/reimbursementId/audit/customFields — the same set as chargeLine,
# and NO importedAt column anywhere; reimbursementLineDimension exists with a
# single-column PK ("id"), UNIQUE(reimbursementLineId, dimensionId), a
# single-column FK to dimension(id), and NO foreign key on valueId; BOTH
# constraints come
# back with convalidated = t and a definition mentioning targetReimbursementId /
# employeeId respectively; payments_violating is 0 (the widened CHECK rejects no
# existing row); the enum prints Draft, Posted, Voided; the sequence count
# equals the number of companies in the local DB (>= 1).
#
# Then run the migration a SECOND time (psql -f on the same file). It must
# succeed with no error and leave payments_violating at 0 — that is the
# idempotency proof for the production-critical payment table.
```

**Out of scope:** Do not touch `purchaseInvoice`, `supplier`, or `supplierType`.
No backfill of existing employee-supplier purchase invoices (spec: "No backfill
— a backfill would rewrite posted history"). Do not add a `reimbursementType`
enum — a reimbursement has exactly one shape. Do not add a column per dimension
concept to `reimbursementLine` — that is what `reimbursementLineDimension` is
for. Do not drop `costCenterId` / `projectId`; the spec keeps them and posting
unions both sources. Do not add an `importedAt` column.

---

## Task 2: Regenerate database types

**Depends on:** Task 1

**Files:**
- Modify: `packages/database/src/types.ts` — generated
- Modify: `packages/database/src/swagger-docs-schema.ts` — generated
- Modify: `packages/database/supabase/functions/lib/types.ts` — generated

**Steps:**

1. Run:
   ```bash
   pnpm run generate:types
   ```
2. These three files are generated — **never hand-edit them**. This is the ONE
   task where their modification is intended and must be committed.

**Verify:**
```bash
grep -c '"reimbursement"\|reimbursement:' packages/database/src/types.ts && grep -n 'reimbursementStatus' packages/database/src/types.ts | head -3 && grep -n '"Reimbursement"' packages/database/src/types.ts | head -3 && grep -n 'targetReimbursementId' packages/database/src/types.ts | head -2
```
```
# Expected: a non-zero count; `reimbursementStatus: "Draft" | "Posted" | "Voided"`
# appears in the Enums block; "Reimbursement" appears in the
# journalEntrySourceType and journalLineDocumentType unions;
# targetReimbursementId appears on the invoiceSettlement Row type.
```

**Out of scope:** No other file changes in this task. If `git status` shows
anything outside `packages/database/src/` and
`packages/database/supabase/functions/lib/types.ts`, revert it.

---

## Task 3: Seed data — 2180 account, account default, sequence row

**Depends on:** Task 2

**Files:**
- Modify: `packages/database/supabase/functions/lib/seed.data.ts` — add the
  account row, the `accountDefaults` entry, and the sequence row
- Copy from (precedent): the same file, line 711 (`current-liabilities` group),
  lines 715–717 (`2150`/`2160`/`2170` sibling rows), line 815
  (`salesReturnsAccount: "4900"`), lines 497–505 (the `charge` sequence row)

**Steps:**

1. In the chart-of-accounts array, immediately after the `2170` row (currently
   line 717), insert:
   ```ts
   { key: "2180", number: "2180", name: "Employee Reimbursements Payable", isGroup: false, parentKey: "current-liabilities", accountType: "Other Current Liability", incomeBalance: "Balance Sheet", class: "Liability", consolidatedRate: "Current", createdBy: "system" },
   ```
2. In the `accountDefaults` object (starts line 810), next to
   `salesReturnsAccount: "4900",` add:
   ```ts
   employeeReimbursementsPayableAccount: "2180",
   ```
3. In the sequences array, immediately after the `charge` entry (lines 497–505),
   add:
   ```ts
   {
     table: "reimbursement",
     name: "Reimbursement",
     prefix: "REIMB-%{yyyy}-%{mm}-",
     suffix: null,
     next: 0,
     size: 6,
     step: 1
   },
   ```

**Verify:**
```bash
grep -n '"2180"\|employeeReimbursementsPayableAccount\|table: "reimbursement"' packages/database/supabase/functions/lib/seed.data.ts
```
```
# Expected: exactly three hits — the account row (number: "2180"), the
# accountDefaults entry, and the sequence row.
```

**Out of scope:** Do not renumber or rename any existing account. Do not touch
`packages/database/src/datasets/**` — the demo datasets seed no reimbursements
in v1.

---

## Task 4: `invoicing.models.ts` — status constants + EDIT validators

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` — add a
  `Reimbursements` section after the `Charges` section (currently ends line 441)
- Copy from (precedent): the same file, lines 428–441 (`chargeStatus` /
  `ChargeStatusType`) for the constants, and lines 366–385 (`memoValidator`)
  for the `zfd` header-field style

**Steps:**

1. Append after the Charges section. Note what is **absent** and must stay
   absent: there is **no create validator**, because Carbon never hand-creates a
   reimbursement. `reimbursementUpdateValidator` is an EDIT-only schema — it
   requires `id` and deliberately omits `reimbursementId` (the readable id is
   allocated by the sync and is not user-editable) and `employeeId` (the payee
   is who Ramp says incurred the expense; re-pointing it would falsify the
   document).
   ```ts
   // ----------------------------------------------------------------------
   // Reimbursements (employee expense payables — imported from a spend tool,
   // then editable in Carbon while Draft; never hand-created)
   // ----------------------------------------------------------------------

   export const reimbursementStatus = ["Draft", "Posted", "Voided"] as const;
   export type ReimbursementStatusType = (typeof reimbursementStatus)[number];

   export function isReimbursementLocked(
     status: string | null | undefined
   ): boolean {
     return status !== null && status !== undefined && status !== "Draft";
   }

   // Header edit. No create counterpart by design.
   export const reimbursementUpdateValidator = z.object({
     id: z.string().min(1),
     reimbursementDate: z
       .string()
       .min(1, { message: "Reimbursement date is required" }),
     currencyCode: z.string().min(1, { message: "Currency is required" }),
     exchangeRate: zfd.numeric(z.number().positive().default(1)),
     amount: zfd.numeric(
       z.number().finite().positive({ message: "Amount must be positive" })
     ),
     reference: zfd.text(z.string().optional()),
     notes: zfd.text(z.string().optional())
   });

   // One coding line. The five stored columns mirror chargeLine, plus the
   // generic dimension pairs DimensionSelector works in. Do NOT add a field per
   // dimension concept — that is what `dimensions` is.
   //
   // These lines arrive as parsed JSON from a hidden field, not as form data,
   // so this validator is plain zod (no zfd coercion) — zfd.numeric expects a
   // FormData string and would reject an already-numeric amount.
   export const reimbursementLineDimensionValidator = z.object({
     dimensionId: z.string().min(1),
     valueId: z.string().min(1)
   });

   export const reimbursementLineValidator = z.object({
     id: z.string().optional(),
     accountId: z.string().min(1, { message: "Account is required" }),
     costCenterId: z.string().nullish(),
     projectId: z.string().nullish(),
     description: z.string().nullish(),
     amount: z
       .number()
       .finite()
       .positive({ message: "Line amount must be positive" }),
     dimensions: z.array(reimbursementLineDimensionValidator).default([])
   });

   // The editor submits the whole line set as ONE hidden JSON field, so the
   // route parses that string and runs it through this array.
   export const reimbursementLinesValidator = z
     .array(reimbursementLineValidator)
     .min(1, { message: "A reimbursement needs at least one line" });
   ```
2. Do **not** touch `invoiceSettlementBase` / `invoiceSettlementValidator` /
   `paymentValidator` here — those change in Task 20.

**Verify:**
```bash
grep -n "reimbursementStatus\|ReimbursementStatusType\|isReimbursementLocked\|reimbursementUpdateValidator\|reimbursementLineDimensionValidator\|reimbursementLineValidator\|reimbursementLinesValidator\|reimbursementValidator\b" apps/erp/app/modules/invoicing/invoicing.models.ts && pnpm exec turbo run typecheck --filter=erp && git status --short packages/database/
```
```
# Expected: the grep prints the seven intended exports (including
# reimbursementLineDimensionValidator) and NO bare `reimbursementValidator`
# (a create validator). If a create validator appears, the task is wrong.
# typecheck exits 0; `git status --short packages/database/` prints NOTHING.
# If it lists generated files, revert them:
#   git checkout -- packages/database/src/types.ts packages/database/src/swagger-docs-schema.ts packages/database/supabase/functions/lib/types.ts
```

**Out of scope:** No create validator, no `new`-route schema. No service or UI
changes.

---

## Task 5: `invoicing.service.ts` — readers + `updateReimbursement` header write

**Depends on:** Task 4

**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — add the
  readers and the header update next to the charge functions (line 1434-area)
- Copy from (precedent): the same file — `getCharge` (1434–1445) and
  `getCharges` (1447–1478) for the readers; `upsertMemo`'s update branch for
  the `sanitize(...)` + `updatedAt` shape

**Steps:**

1. Add, using the module's standard shape (client first, return the raw
   `{ data, error }`, never throw, always scope by `companyId`):
   ```ts
   export async function getReimbursement(
     client: SupabaseClient<Database>,
     companyId: string,
     id: string
   ) {
     return client
       .from("reimbursement")
       // Embed the generic dimension rows with the lines — the editor and the
       // read-mode badges both need them, and a per-line query would be an N+1.
       .select("*, reimbursementLine(*, reimbursementLineDimension(*))")
       .eq("id", id)
       .eq("companyId", companyId)
       .single();
   }

   export async function getReimbursements(
     client: SupabaseClient<Database>,
     companyId: string,
     args: GenericQueryFilters & {
       search: string | null;
       status: ReimbursementStatusType | null;
       employeeId: string | null;
     }
   ) {
     let query = client
       .from("reimbursement")
       .select("*", { count: "exact" })
       .eq("companyId", companyId);

     if (args.search) {
       query = query.or(
         `reimbursementId.ilike.%${args.search}%,reference.ilike.%${args.search}%`
       );
     }
     if (args.status) query = query.eq("status", args.status);
     if (args.employeeId) query = query.eq("employeeId", args.employeeId);

     // Newest first by the sequential reimbursementId (REIMB-yyyy-mm-NNNNNN),
     // mirroring getCharges' chargeId desc default.
     query = setGenericQueryFilters(query, args, [
       { column: "reimbursementId", ascending: false }
     ]);
     return query;
   }

   /**
    * Header edit. `.eq("status", "Draft")` is defence in depth alongside the
    * RLS UPDATE policy and the reimbursement_draft_guard trigger — a Posted
    * document is immutable, and a caller that tries gets zero rows rather than
    * a silent partial write. There is deliberately no insert branch: the Ramp
    * sync is the only thing that creates a reimbursement.
    */
   export async function updateReimbursement(
     client: SupabaseClient<Database>,
     reimbursement: z.infer<typeof reimbursementUpdateValidator> & {
       companyId: string;
       updatedBy: string;
       customFields?: Json;
     }
   ) {
     const { id, companyId, ...update } = reimbursement;
     return client
       .from("reimbursement")
       .update({
         ...sanitize(update),
         updatedAt: today(getLocalTimeZone()).toString()
       })
       .eq("id", id)
       .eq("companyId", companyId)
       .eq("status", "Draft")
       .select("id, reimbursementId")
       .single();
   }
   ```
2. Add `ReimbursementStatusType` to the type import block at the top of the file
   (the one that already imports `ChargeStatusType`, `ChargeType` at lines
   44–45).

**Verify:**
```bash
grep -n "export async function .*Reimbursement" apps/erp/app/modules/invoicing/invoicing.service.ts && pnpm exec turbo run typecheck --filter=erp && git status --short packages/database/
```
```
# Expected: the grep prints exactly three functions — getReimbursement,
# getReimbursements, updateReimbursement. It must NOT print an insert/upsert
# with a createdBy branch, nor a deleteReimbursement.
# typecheck exits 0; git status prints nothing for packages/database/.
```

**Out of scope:** No line writes here (Task 6 — they are multi-row and need
Kysely). No insert branch. Do not build a DB client in this file — it is
barrel-exported to the browser (`no-db-client-in-service`).

---

## Task 6: `invoicing.service.ts` — Kysely line writers

**Depends on:** Task 5

**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` — add the line
  writers after `updateReimbursement`
- Copy from (precedent): the same file, `replaceInvoiceSettlements` (2483–2670)
  — specifically its `db: Kysely<KyselyDatabase>` signature, the
  `db.transaction().execute()` wrapper, the **`forUpdate()` parent lock +
  status re-assert prologue at 2495–2507**, and the delete-all-then-reinsert
  body at 2650–2670
- Copy from (precedent): `apps/erp/app/modules/inventory/inventory.service.ts`
  `generateInventoryCountLines` (1868–1993) — the same shape with a bulk
  `.values(rows.map(...))` insert

**Steps:**

1. The existing type-only import at `invoicing.service.ts:3` already provides
   what is needed — do not add a value import:
   ```ts
   import type { Kysely, KyselyDatabase } from "@carbon/database/client";
   ```
   Invoicing already has six `db: Kysely<KyselyDatabase>` service functions
   (979, 1355, 2248, 2272, 2483, 3266), so this extends an established pattern.
2. Add:
   ```ts
   /**
    * Replace every coding line of a Draft reimbursement, transactionally.
    *
    * Kysely BYPASSES RLS, so the parent is re-read `forUpdate()` and its status
    * re-asserted inside the transaction — exactly as replaceInvoiceSettlements
    * does. The reimbursementLine_draft_guard trigger is the final backstop, but
    * it raises a raw 55000; this throws a message the route can flash.
    *
    * Delete-all-then-reinsert rather than a diff: the editor submits the whole
    * line set as one field, so a diff would be more code for the same result.
    */
   export async function upsertReimbursementLines(
     db: Kysely<KyselyDatabase>,
     args: {
       reimbursementId: string;
       companyId: string;
       createdBy: string;
       lines: z.infer<typeof reimbursementLineValidator>[];
     }
   ) {
     return db.transaction().execute(async (trx) => {
       const reimbursement = await trx
         .selectFrom("reimbursement")
         .select(["id", "status"])
         .where("id", "=", args.reimbursementId)
         .where("companyId", "=", args.companyId)
         .forUpdate()
         .executeTakeFirst();
       if (!reimbursement) throw new Error("Reimbursement not found");
       if (reimbursement.status !== "Draft")
         throw new Error(
           "Coding lines can only be edited while the reimbursement is Draft"
         );

       await trx
         .deleteFrom("reimbursementLine")
         .where("reimbursementId", "=", args.reimbursementId)
         .where("companyId", "=", args.companyId)
         .execute();

       if (args.lines.length === 0) return 0;

       // RETURNING id, so the dimension rows can be bound to the line they
       // belong to without relying on PostgreSQL's unspecified INSERT row
       // order — the same reason post-charge allocates journal line ids up
       // front. Insert order is preserved by `sequence`, but do NOT zip the
       // returned rows by position; key them by `sequence`.
       const inserted = await trx
         .insertInto("reimbursementLine")
         .values(
           args.lines.map((line, index) => ({
             reimbursementId: args.reimbursementId,
             companyId: args.companyId,
             accountId: line.accountId,
             costCenterId: line.costCenterId ?? null,
             projectId: line.projectId ?? null,
             description: line.description ?? null,
             amount: line.amount,
             sequence: index,
             createdBy: args.createdBy
           }))
         )
         .returning(["id", "sequence"])
         .execute();

       const idBySequence = new Map(inserted.map((r) => [r.sequence, r.id]));
       const dimensionRows = args.lines.flatMap((line, index) => {
         const lineId = idBySequence.get(index);
         if (!lineId) throw new Error("Failed to map reimbursement line");
         return (line.dimensions ?? []).map((d) => ({
           reimbursementLineId: lineId,
           companyId: args.companyId,
           dimensionId: d.dimensionId,
           valueId: d.valueId
         }));
       });
       if (dimensionRows.length) {
         await trx
           .insertInto("reimbursementLineDimension")
           .values(dimensionRows)
           .execute();
       }

       return args.lines.length;
     });
   }
   ```
   The `reimbursementLineDimension` rows need no explicit delete — the line
   delete above cascades them (`ON DELETE CASCADE` on the line FK), so the
   replace is still one delete and two inserts.
   `sequence` is assigned 0-based from array order — that is `chargeLine`'s
   convention and what `post-reimbursement` orders by. Do not use
   `purchaseInvoiceLine`'s 1-based `sortOrder`.
3. Do **not** add a `deleteReimbursementLine`. Removing a line is expressed by
   submitting the line set without it; a separate per-line delete endpoint would
   be a second write path into the same state with its own Draft guard to get
   wrong. **If a later task appears to need one, STOP and report.**

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec tsx -e "import('@carbon/checks').then(async (m) => { const r = await m.runChecks?.({ only: ['no-db-client-in-service'] }); console.log(JSON.stringify(r ?? 'runner-signature-differs', null, 2)); })" 2>/dev/null || grep -n "getPostgresConnectionPool\|getPostgresClient\|new Pool(\|PostgresDriver" apps/erp/app/modules/invoicing/invoicing.service.ts; git status --short packages/database/
```
```
# Expected: typecheck exits 0. The conformance check reports NO
# no-db-client-in-service violations; if the programmatic runner signature
# differs the grep fallback runs and must print NOTHING (those four tokens are
# exactly what the check bans in a *.service.ts — see
# packages/checks/src/conformance/no-db-client-in-service.ts). A `db: Kysely<KyselyDatabase>`
# PARAMETER is the prescribed fix and is not a violation.
# git status prints nothing for packages/database/.
```

**Out of scope:** Do not construct a pool or client in this file. Do not add a
per-line delete endpoint. Do not touch `replaceInvoiceSettlements`.

---

## Task 7: Accounting defaults — Employee Reimbursements Payable picker

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/modules/accounting/accounting.models.ts` — add the field
  to `defaultBalanceSheetAccountValidator`
- Modify: `apps/erp/app/modules/accounting/ui/AccountDefaults/AccountDefaultsForm.tsx`
  — add the field to the `payables` category group
- Copy from (precedent): the same form, the `payables` group (lines 194–226),
  field `supplierWriteOffAccount` (lines 220–225)
- Copy from (precedent): `accounting.models.ts` line 500
  (`scrapAccount: z.string().optional()`) — the optional-account-default shape

**Steps:**

1. In `defaultBalanceSheetAccountValidator`, next to `payablesAccount` (line
   457), add — **optional**, because the column is nullable by design with a
   runtime AP fallback, and a required field would break saves on every company
   whose chart has no 2180:
   ```ts
   employeeReimbursementsPayableAccount: z.string().optional(),
   ```
2. In `AccountDefaultsForm.tsx`, inside the `payables` group's `fields` array,
   after `supplierWriteOffAccount`, add:
   ```ts
   {
     name: "employeeReimbursementsPayableAccount",
     label: t`Employee Reimbursements Payable`,
     description: t`Liability account for amounts owed to employees for expense reimbursements. Falls back to Payables when unset`,
     badgeType: "Liability"
   }
   ```
3. Nothing else is needed: `updateDefaultAccounts` (the generic
   `.update(defaultAccounts)`) and `accounting.defaults.test.ts` both iterate
   `Object.keys(defaultAccountValidator.shape)`, so the new key flows through.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- accounting.defaults && git status --short packages/database/
```
```
# Expected: typecheck exits 0; the accounting.defaults test file passes
# ("Test Files  1 passed"); git status prints nothing for packages/database/.
```

**Out of scope:** Do not make any EXISTING account default optional or required.
Do not add a new category group.

---

## Task 8: `build-reimbursement-journal.ts` (pure) + its Deno test

**Depends on:** Task 2

**Files:**
- Create: `packages/database/supabase/functions/post-reimbursement/build-reimbursement-journal.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/build-reimbursement-journal.test.ts`
- Copy from (precedent): `packages/database/supabase/functions/post-charge/build-charge-journal.ts`
  (the whole file — imports, `GLAccountClass`, `AccountType`, `pushLine`,
  `requireLineSum`, `assertExchangeRate`/`toBase`, the `assertBalanced`
  backstop, `BALANCE_TOLERANCE = 0.01`)

**Steps:**

1. Create the builder as a pure function — no DB, no I/O, no clock. Amounts are
   **natural-balance-signed** via `credit()`/`debit()` from `../lib/utils.ts`
   (`.ai/lessons.md` — "Journal debit/credit is derived from account class +
   amount sign, not the raw sign": a positive amount on a Liability account IS a
   credit). Signature:
   ```ts
   export interface BuildReimbursementJournalInput {
     reimbursement: {
       amount: number;
       payableAccountId: string;
       currencyCode: string;
       exchangeRate: number;
     };
     lines: ReimbursementLineInput[]; // accountId, amount, costCenterId, projectId, description
     accounts: Record<string, { class: GLAccountClass }>;
     documentId: string;
     documentReadableId: string;
   }
   export interface ReimbursementJournalLine {
     accountId: string;
     amount: number;
     description: string;
     documentType: "Reimbursement";
     documentId: string;
     costCenterId?: string | null;
     projectId?: string | null;
   }
   export function buildReimbursementJournal(
     input: BuildReimbursementJournalInput
   ): { journalLines: ReimbursementJournalLine[] };
   ```
2. Body — there is exactly ONE shape (the charge builder's `case "Charge"` arm,
   with the card liability replaced by the resolved payable account):
   - `assertExchangeRate(exchangeRate)`; `toBase = (v) => toBaseAmount(v, exchangeRate)`.
   - `requireLineSum()`: at least one line; every `line.amount` finite and `> 0`;
     `|Σ lines − amount| <= EPSILON` else throw
     `` `Reimbursement ${documentReadableId}: line sum ${lineSum} does not equal header amount ${amount}` ``.
     This is the invariant the UI's totals guard (Task 18) mirrors — the message
     text is what a developer sees if the guard is ever bypassed.
   - For each line: `magnitude = toBase(line.amount)`; accumulate into
     `payableMagnitude`; `pushLine("debit", classOf(line.accountId), magnitude, {…})`
     with `description: line.description ?? "Employee reimbursement"`.
   - After the loop:
     `pushLine("credit", classOf(payableAccountId), payableMagnitude, { accountId: payableAccountId, description: "Employee reimbursement payable" })`.
     Take the class from the `accounts` map, **not** a hard-coded `"liability"` —
     the fallback AP trade account is also a Liability, but the class must come
     from the resolved account so a mis-classed default fails loudly.
   - `assertBalanced(signedDebitTotal, 0, BALANCE_TOLERANCE, "Reimbursement journal")`.
   - `classOf` throws
     `` `Reimbursement ${documentReadableId}: missing account class for ${accountId}` ``
     on an unknown id.
3. Write the golden-master test mirroring
   `post-charge/build-charge-journal.test.ts` (read it for the assertion style).
   Cover at minimum:
   - the spec's AC1 case — lines `500` (Expense) + `120` (Expense),
     payable (Liability) `620`, `exchangeRate: 1` → three lines, debits
     `+500` and `+120` on the expense accounts, `+620` on the liability (a
     positive amount on a Liability is a CREDIT), and `totalDebits ==
     totalCredits`;
   - the AP-fallback case — identical output when the payable account id is the
     AP trade account (AC2: the journal must still balance);
   - `costCenterId` / `projectId` carried through onto the matching line only —
     this is what becomes the `journalLineDimension` rows the edited coding is
     for;
   - a line sum that disagrees with the header → throws;
   - a zero or negative line amount → throws;
   - `exchangeRate: 1.25` → every magnitude divided (never multiplied) and the
     entry still balanced.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-lock --no-check post-reimbursement/build-reimbursement-journal.test.ts
```
```
# Expected: "ok | N passed | 0 failed" with N >= 6.
```

**Out of scope:** No DB access, no `Deno.env`, no `new Date()` in this file.
Do not add a reimbursement "type" discriminator — unlike a charge there is one
shape.

---

## Task 9: `post-reimbursement` edge function driver + `config.toml`

**Depends on:** Task 8

**Files:**
- Create: `packages/database/supabase/functions/post-reimbursement/index.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/handler.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/post-reimbursement-transaction.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/post-reimbursement-post.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/post-reimbursement-void.ts`
- Modify: `packages/database/supabase/config.toml` — add `[functions.post-reimbursement]`
- Copy from (precedent): `packages/database/supabase/functions/post-charge/index.ts`,
  `handler.ts`, `post-charge-transaction.ts`, `post-charge-post.ts`,
  `post-charge-void.ts` (one-for-one)

**Steps:**

1. `index.ts` — verbatim clone of `post-charge/index.ts` with the renames:
   `getConnectionPool(1)` at module scope,
   `handlePostReimbursement(req, (args) => postReimbursementTransaction(db, args))`.
2. `handler.ts` — clone `post-charge/handler.ts`. Validator:
   ```ts
   const payloadValidator = z.object({
     type: z.enum(["post", "void"]).default("post"),
     reimbursementId: z.string(),
     userId: z.string(),
     companyId: z.string()
   });
   ```
   Auth is `await requirePermissions(req, args.companyId, args.userId, { update: "invoicing" })`,
   and the record is re-read under `companyId` in the transaction, so a foreign
   id fails rather than posting cross-tenant.

   Both callers are the ERP's own action routes (Task 18) — under the new model
   the Ramp sync no longer posts, so a human's Post click is what reaches
   `type: "post"`.
3. `post-reimbursement-transaction.ts` — clone `post-charge-transaction.ts`:
   - ONE `db.transaction().execute()`.
   - The FIRST read is the tenant-scoped `.forUpdate()` select on
     `reimbursement` by `id` + `companyId`, selecting
     `id, reimbursementId, employeeId, status, amount, currencyCode, exchangeRate,
     payableAccountId, journalId`, plus
     `sql<string>`"reimbursementDate"::text`` and
     `sql<string | null>`"postingDate"::text``. Not found → `throw new Error("Reimbursement not found")`.
   - Idempotency: `type === "post" && status === "Posted"` → return the stored
     `journalId`; `type === "void" && status === "Voided"` → return the stored
     `journalId` (spec AC4's "re-voiding returns the stored journal id without a
     second reversal"). Otherwise require the expected status.
   - Load `companySettings.accountingEnabled` and
     `company.companyGroupId/baseCurrencyCode/timezone`; build the context with
     `datetime.timestamp()` and `datetime.today(company.timezone).toString()`.
4. `post-reimbursement-post.ts` — clone `post-charge-post.ts`, changing only:
   - Read the lines from `reimbursementLine` ordered by `sequence`, then `id`.
   - **Resolve the payable account by ID from `accountDefault`, never by number
     or name** (`.ai/lessons.md` — "Never resolve a control account by
     number/name"):
     ```ts
     const defaults = await trx.selectFrom("accountDefault")
       .select(["employeeReimbursementsPayableAccount", "payablesAccount"])
       .where("companyId", "=", companyId)
       .executeTakeFirst();
     const payableAccountId =
       reimbursement.payableAccountId ??
       defaults?.employeeReimbursementsPayableAccount ??
       defaults?.payablesAccount ??
       null;
     if (!payableAccountId) {
       throw new Error(
         "No employee reimbursements payable account and no payables account is configured"
       );
     }
     ```
     That `?? payablesAccount` chain is spec AC2 — an upgrading company with the
     new default unset must still post.
   - `accountIds = [...new Set([payableAccountId, ...lines.map(l => l.accountId)])]`;
     the same `account` query filtered by `companyGroupId`, `active = true`,
     `isGroup = false`; the same "must be active posting accounts in this
     company group" throw on a count mismatch or a missing class.
   - Replace the charge's card/offset class assertions with ONE check:
     `accounts[payableAccountId]?.class !== "Liability"` →
     `throw new Error("Reimbursement payable account must be a Liability account")`.
   - Keep the cost-center and project existence checks verbatim.
   - `postingDate = reimbursement.postingDate ?? reimbursement.reimbursementDate`,
     then `resolveAccountingPeriod(trx, companyId, postingDate, "historical-with-shift")`.
   - `buildReimbursementJournal({...})`; journal `description:
     `Reimbursement ${reimbursement.reimbursementId}``, `sourceType: "Reimbursement"`,
     `journalEntryId: await getNextSequence(trx, "journalEntry", companyId)`.
   - `allocateJournalLineIds` — import it from
     `../post-charge/journal-line-ids.ts` (already generic; do NOT copy the file).
   - Journal lines get `documentType: "Reimbursement" as const`.
   - The cost-center and project `dimension` lookups and their
     `journalLineDimension` inserts are verbatim, including the two throws
     ("Company group has no active Cost Center dimension" / "… Project
     dimension") — the spec's cost-center criterion requires that refusal.
   - **Then union the generic dimension rows.** Read
     `reimbursementLineDimension` for the document's lines and emit a
     `journalLineDimension` row per pair, **de-duplicating by `dimensionId`
     against the two legacy columns above** — the spec keeps
     `costCenterId`/`projectId` AND adds the generic table, so a line that
     carries a Cost Center in both must produce ONE dimension row, not two
     (`journalLineDimension` is one value per dimension per line). Resolve the
     conflict in favour of the **generic table**. Put the reason in the CODE
     COMMENT, not just here: the two legacy columns are what the **sync** wrote
     at import; the generic table is where a **human's** edit lands — and human
     intent beats a machine default. A reader who finds that precedence
     surprising needs the sentence at the call site.
     Validate every `dimensionId` is active and belongs to the company group,
     throwing in the same shape as the two existing checks.
   - Final update sets `status: "Posted", journalId, postingDate,
     payableAccountId, postedAt, postedBy, updatedAt, updatedBy`.
5. `post-reimbursement-void.ts` — clone `post-charge-void.ts` verbatim with the
   renames: the provenance guard becomes
   `originalJournal.sourceType !== "Reimbursement"`, the line guard
   `line.documentType !== "Reimbursement"`, the reversal description
   `` `VOID Reimbursement ${reimbursement.reimbursementId}` ``, the reversal
   lines `amount: -Number(line.amount)` with `documentType: "Reimbursement"`,
   and the dimension rows re-mapped through `reversalByOriginal`.
6. `config.toml` — after the `[functions.post-charge]` block (lines 217–220),
   add:
   ```toml
   [functions.post-reimbursement]
   enabled = true
   verify_jwt = true
   entrypoint = "./functions/post-reimbursement/index.ts"
   ```
   (Deployment is all-at-once and directory-driven, so this entry is for the
   settings and for discoverability — not a deploy gate.)

**Verify:**
```bash
cd packages/database/supabase/functions && deno check --no-lock post-reimbursement/index.ts && grep -A 3 '\[functions.post-reimbursement\]' ../config.toml
```
```
# Expected: `deno check` prints "Check file:///.../post-reimbursement/index.ts"
# and exits 0 with no diagnostics; the grep prints enabled = true,
# verify_jwt = true and the entrypoint line.
```

**Out of scope:** Do not change `post-charge` or `post-payment`. Do not add a
`reimbursement` case to `post-memo`.

---

## Task 10: `post-reimbursement` handler + transaction Deno tests

**Depends on:** Task 9

**Files:**
- Create: `packages/database/supabase/functions/post-reimbursement/handler.test.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/post-reimbursement-test-fixture.ts`
- Create: `packages/database/supabase/functions/post-reimbursement/post-reimbursement-transaction.test.ts`
- Copy from (precedent): `packages/database/supabase/functions/post-charge/handler.test.ts`,
  `post-charge-test-fixture.ts`, `post-charge-transaction.test.ts`

**Steps:**

1. `handler.test.ts` — clone the charge version's `withAuthTransport` harness.
   Assert: a service-role token is accepted; an `authenticated` token lacking
   `invoicing_update` is rejected; a malformed body returns a 500 with an
   `error` field.
2. `post-reimbursement-test-fixture.ts` — clone the charge fixture's in-memory
   Kysely stub, swapping the `charge`/`chargeLine` tables for
   `reimbursement`/`reimbursementLine` and adding an `accountDefault` row so the
   payable resolution can be exercised.
3. `post-reimbursement-transaction.test.ts` — cases:
   - **AC1** post with two lines → ONE `journal` row `sourceType = "Reimbursement"`,
     three `journalLine` rows, the header flips to `Posted` with `journalId` set
     and `payableAccountId` stored;
   - **AC2** `employeeReimbursementsPayableAccount` NULL → the journal credits
     `payablesAccount` instead and still balances;
   - both NULL → throws "No employee reimbursements payable account…";
   - **AC3** a line with `costCenterId` and an active Cost Center dimension →
     one `journalLineDimension` row on that line only; the same line with NO
     active dimension → throws "Company group has no active Cost Center
     dimension";
   - **AC4** void a Posted row → a second Posted journal whose line amounts are
     the exact negation, dimensions copied, status `Voided`; voiding it AGAIN
     returns the same `journalId` and writes nothing;
   - posting a `Voided` row → throws "Cannot post reimbursement in status Voided";
   - a payable account whose class is not `Liability` → throws;
   - **dimension union + de-duplication**: a line carrying `costCenterId = X`
     AND a `reimbursementLineDimension` row for the SAME Cost Center dimension
     with value `Y` produces exactly ONE `journalLineDimension` row for that
     dimension, carrying `Y` (the generic table wins); a line carrying only the
     legacy column still produces its row; a line carrying a generic dimension
     with no legacy counterpart produces its row;
   - an inactive or out-of-group `dimensionId` on a generic row → throws;
   - a reimbursement id belonging to another company → "Reimbursement not found".

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-lock --no-check post-reimbursement/
```
```
# Expected: every test file passes — "ok | N passed | 0 failed", N >= 15
# (build-reimbursement-journal + handler + transaction).
```

**Out of scope:** No live-database tests (`deno task test:db` is a separate
lane). Do not modify the `post-charge` tests.

---

## Task 11: Dimension data plumbing for the line editor

**Depends on:** Task 2

**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/Reimbursement/index.ts` — re-export the shared dimension types (Task 15 creates this file; if it does not exist yet, create it here with just these exports)
- Copy from (precedent): `apps/erp/app/routes/x+/journal-entry+/$journalEntryId.tsx:68-72` — the loader call `getActiveDimensionsWithValues(client, companyGroupId, companyId)` inside the `Promise.all`, and line 120 `dimensions: dimensions.data ?? []`
- Copy from (precedent): `apps/erp/app/modules/accounting/ui/JournalEntries/types.ts:10-23` — `DimensionWithValues` and `JournalLineDimensionValue`
- Copy from (precedent): `apps/erp/app/routes/x+/journal-entry+/$journalEntryId.details.tsx:48` — the submit shape `dimensions?: Array<{ dimensionId: string; valueId: string }>`

**Steps:**

1. **This task replaces an earlier `Project` picker task.** That task existed
   because the line editor needed a `projectId` combobox that does not exist in
   `apps/erp/app/components/Form/`. It is no longer needed:
   `DimensionSelector` already handles **Project and CostCenter** as dimension
   entity types (both appear in its `entityTypeColors` map), so the editor needs
   *dimension data*, not new pickers. **Do not build
   `apps/erp/app/components/Form/Project.tsx`, `getProjectsList`, or
   `api+/accounting.projects.ts`** — they would be dead code.
2. Confirm the existing reader is reusable as-is:
   `getActiveDimensionsWithValues(client, companyGroupId, companyId)` in
   `apps/erp/app/modules/accounting/accounting.service.ts`. It is company-GROUP
   scoped with a company argument, which is exactly what the reimbursement
   detail routes have from `requirePermissions`. **Add no new service
   function.** If its signature differs from the journal-entry call site, STOP
   and report rather than writing a parallel reader.
3. The two types the editor passes around (`DimensionWithValues`,
   `JournalLineDimensionValue`) live in
   `apps/erp/app/modules/accounting/ui/JournalEntries/types.ts`. Import them
   from there rather than redefining them — a second copy would drift from
   `DimensionSelector`'s own props and the mismatch would only show at a call
   site. If a shared home is wanted later that is a follow-up, not this task.
4. Record the contract the next three tasks depend on, so they cannot disagree:
   - the detail and edit **loaders** (Tasks 16, 17) add
     `getActiveDimensionsWithValues(...)` to their `Promise.all` and return
     `dimensions: dimensions.data ?? []`;
   - the **editor** (Task 13) takes `availableDimensions: DimensionWithValues[]`
     and holds each line's current pairs as `JournalLineDimensionValue[]`;
   - the **hidden JSON field** carries only
     `dimensions: Array<{ dimensionId, valueId }>` per line — the display names
     in `JournalLineDimensionValue` are client-side only and must be stripped on
     submit, exactly as `$journalEntryId.details.tsx:48` expects.

**Verify:**
```bash
grep -n "getActiveDimensionsWithValues" apps/erp/app/modules/accounting/accounting.service.ts apps/erp/app/routes/x+/journal-entry+/\$journalEntryId.tsx && grep -n "DimensionWithValues\|JournalLineDimensionValue" apps/erp/app/modules/accounting/ui/JournalEntries/types.ts && ls apps/erp/app/components/Form/Project.tsx 2>&1 | tail -1
```
```
# Expected: getActiveDimensionsWithValues is defined in accounting.service.ts
# and called in the journal-entry loader; both types are exported from the
# JournalEntries types file; and the `ls` prints "No such file or directory"
# for Project.tsx — confirming the dead picker was NOT built.
```

**Out of scope:** Do not build a Project or Cost Center picker. Do not add a new
dimensions service function or API route. Do not move the shared types.

---

## Task 12: Shared `DocumentSourceBadge` component

**Depends on:** Task 2

**Files:**
- Create: `apps/erp/app/components/DocumentSourceBadge.tsx`
- Modify: `apps/erp/app/components/index.ts` — import + export `DocumentSourceBadge`
- Modify: `packages/ee/src/ramp/config.tsx` — the `Logo` style clamp (lines 233–262)
- Copy from (precedent, THE BADGE): `apps/erp/app/modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx` lines 84–96 (reading the mapping off route data) and **lines 334–345** (the existing Ramp source badge — a `<Status color="blue">` optionally wrapped in a deep link)
- Copy from (precedent, THE LOGO): `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx:77` — `<integration.logo className="h-10 w-auto" />`

**Steps:**

1. **Context you need before writing this.** There is **no** reusable
   `<IntegrationLogo>` / `<ProviderLogo>` component in the repo — the logo is a
   `React.FC<ComponentProps<"svg">>` field on each integration config
   (`packages/ee/src/types.ts:155-190`), looked up with
   `getIntegrationConfigById(id)` (`packages/ee/src/index.ts:67-69`). The only
   existing source badge is text-only. This task creates the reusable one that
   both this plan and the sibling charge spec need.
2. **Bundle safety (read before worrying about it).** `@carbon/ee`'s barrel is
   already imported into the ERP **client** bundle by
   `apps/erp/app/routes/x+/settings+/integrations.tsx`
   (`import { integrations as availableIntegrations } from "@carbon/ee"`), so
   the config chain is proven client-safe. Importing it into an invoicing
   component adds it to that route's bundle but introduces no server-only
   module. Do **not** attempt a logo-extraction refactor of all twelve
   providers to avoid this — it is out of scope and the sibling spec does not
   ask for it.
3. **Fix the Ramp logo's size clamp first.** `packages/ee/src/ramp/config.tsx`
   lines ~251–257 currently spread `...props.style` BEFORE hard-coded
   `height: "1.25rem"`, so the clamp wins and a caller cannot make the logo
   badge-sized. Invert the order so an incoming style overrides the default:
   ```tsx
   style={{
     height: "1.25rem",
     width: "auto",
     maxWidth: "100%",
     ...props.style
   }}
   ```
   Keep the existing comment, amended to say the defaults are overridable.
   **If any other integration's `Logo` has the same inverted clamp, leave it
   alone** — only Ramp is needed here, and changing twelve logos is a different
   change.
4. Write the component. It is **document-agnostic** — it takes strings, not a
   reimbursement — because the charge detail page uses the same one:
   ```tsx
   type DocumentSourceBadgeProps = {
     /** The provider id stored on the document, e.g. `charge.integration`. */
     integration: string | null | undefined;
     /** The provider's own identifier, from externalIntegrationMapping.externalId. */
     externalId?: string | null;
     /** externalIntegrationMapping.metadata.deepLink, when the provider has one. */
     deepLink?: string | null;
     /** Renders the label above the badge. Defaults to "Source". */
     label?: ReactNode;
   };
   ```
   Body:
   - `const config = integration ? getIntegrationConfigById(integration as IntegrationID) : undefined;`
   - Render nothing (`return null`) when `integration` is falsy — a document
     with no provider has no SOURCE field.
   - When `config` resolves, render `<config.logo style={{ height: "0.875rem" }} />`
     next to `config.name`; when it does not (an unknown provider id), fall back
     to the raw id in a `<Status color="blue">` so the field is never blank —
     an unrecognised provider is data, not a crash.
   - Beneath, render `externalId` in `text-xs text-muted-foreground font-mono`
     when present.
   - Wrap the whole thing in `<a href={deepLink} target="_blank" rel="noreferrer">`
     when `deepLink` is set, exactly as `PurchaseInvoiceHeader.tsx:334-345` does.
5. Register it in `apps/erp/app/components/index.ts` alongside
   `DocumentHeader` (line 13 import / line 71 export).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee && grep -n "DocumentSourceBadge" apps/erp/app/components/index.ts && grep -n -A 6 'style={{' packages/ee/src/ramp/config.tsx | grep -n "props.style" && git status --short packages/database/
```
```
# Expected: both typechecks exit 0; the components index grep shows the import
# and the export; the config grep shows `...props.style` appearing AFTER the
# height/width/maxWidth defaults (if it still appears first, step 3 was not
# applied); git status prints nothing for packages/database/.
```

**Out of scope:** Do not wire this into the charge UI — that is the sibling
spec's work. Do not refactor other providers' `Logo` components. Do not add a
`ramp` entry to `INTEGRATION_LABELS` in
`apps/erp/app/modules/accounting/ui/SyncTieOut/SyncTieOutTable.tsx` — that map
is the tie-out surface's own, and this badge replaces the need for it here.

---

## Task 13: Shared `DocumentLineEditor` component

**Depends on:** Task 11

**Files:**
- Create: `apps/erp/app/components/DocumentLineEditor/DocumentLineEditor.tsx`
- Create: `apps/erp/app/components/DocumentLineEditor/DocumentLineRow.tsx`
- Create: `apps/erp/app/components/DocumentLineEditor/types.ts`
- Create: `apps/erp/app/components/DocumentLineEditor/index.ts`
- Copy from (precedent, CONTAINER): `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryForm.tsx`
  — `generateId` / `createEmptyLine` (72–85), the `useState` initialiser
  (111–119), `handleLineChange` / `handleDeleteLine` / `handleAddLine`
  (139–159), `linesJson` (161–172), **the hidden field
  `<input type="hidden" name="lines" value={linesJson} />` (280)**, the running
  totals + `<Status color="green">Balanced</Status>` badge, and the grid header
  / rows / totals block (312–400)
- Copy from (precedent, ROW): `apps/erp/app/modules/accounting/ui/JournalEntries/JournalLineRow.tsx`
  (151 lines — the fully-controlled `onChange({ ...line, field })` style,
  `AccountControlled`, a raw `Input`, and `NumberField` + `NumberInput` with
  `INPUT_FORMAT` from `useCurrencyDecimals(currencyCode)`)
- Copy from (precedent, TYPES): `apps/erp/app/modules/accounting/ui/JournalEntries/types.ts`
  (`ClientJournalLine`)

**Steps:**

1. **Why here and not in the invoicing module.** The shared spec requires one
   line editor for charges AND reimbursements, so it lives in
   `apps/erp/app/components/` (the repo's home for components two modules
   share, e.g. `Activity.tsx`, `DocumentHeader.tsx`). It must know nothing
   about either document.
2. `types.ts`:
   ```ts
   import type { JournalLineDimensionValue } from "~/modules/accounting/ui/JournalEntries/types";

   export type ClientDocumentLine = {
     /** Client-only row key. Never sent to the server. */
     key: string;
     /** Persisted line id when the row came from the database; absent for a new row. */
     id?: string;
     accountId: string;
     description: string;
     amount: number | null;
     /**
      * Generic dimension pairs, edited through DimensionSelector. Carries the
      * display names client-side; only {dimensionId, valueId} is submitted.
      */
     dimensions: JournalLineDimensionValue[];
     /**
      * The two legacy columns. The EDITOR does not write them — the Ramp sync
      * does, and posting unions them with `dimensions`. They ride along
      * read-only so a round-trip through the editor cannot drop what the sync
      * imported.
      */
     costCenterId: string | null;
     projectId: string | null;
   };
   ```
3. `DocumentLineRow.tsx` — props mirror `JournalLineRow`'s fully-controlled
   shape:
   ```ts
   type DocumentLineRowProps = {
     line: ClientDocumentLine;
     index: number;
     currencyCode: string;
     availableDimensions: DimensionWithValues[];
     /** Collapsed rows show account + amount only; expanded adds the rest. */
     isExpanded: boolean;
     onToggleExpand: () => void;
     onChange: (line: ClientDocumentLine) => void;
     onDelete: () => void;
     canDelete: boolean;
     isDisabled: boolean;
   };
   ```
   Cells, collapsed: `<AccountControlled>` (from `~/components/Form`), a plain
   `<Input size="sm">` for description, and a `<NumberField><NumberInput/></NumberField>`
   for amount with
   `formatOptions={INPUT_FORMAT.money(currencyCode, currencyDecimals)}` and
   `step={INPUT_STEP.money(currencyDecimals)}` from
   `useCurrencyDecimals(currencyCode)`. **A digit or step literal here is a
   `no-inline-fraction-digits` / precision violation** — take both from the
   helpers. Trailing `IconButton` delete, and a `LuChevronRight` expand toggle
   in the leading cell (the collapsible-row pattern
   `PurchaseInvoiceSummary.tsx:41-55` uses).

   Expanded adds **the existing `DimensionSelector`**, not a picker per concept:
   ```tsx
   {availableDimensions.length > 0 && (
     <DimensionSelector
       journalLineId={line.key}
       availableDimensions={availableDimensions}
       currentDimensions={line.dimensions}
       onChange={(dimensions) => onChange({ ...line, dimensions })}
       autoSave={false}
     />
   )}
   ```
   Copy the mount verbatim from `JournalLineRow.tsx:92-97` — including the
   `availableDimensions.length > 0` guard, which is what stops an empty selector
   rendering for a company that has configured no dimensions.

   Two things to know about that component. Its `journalLineId` prop is **named
   for its origin, not its meaning** — with `autoSave={false}` it is only an
   identity for the control, so passing the line's client `key` is correct.
   **Read its body first to confirm that;** if `journalLineId` is used for
   anything beyond identity on the non-autoSave path, STOP and report rather
   than passing a fake id into a fetcher. And it sources the high-cardinality
   types (Customer, Supplier, Item) from the client stores itself, so the editor
   supplies nothing for them.

   **Do not build a Cost Center or Project combobox.** `DimensionSelector`
   already covers both as entity types, along with Department, Location,
   Employee, Work Center, Process, Item Posting Group, Supplier Type and the
   rest — that is the whole reason the spec reuses it.
4. `DocumentLineEditor.tsx`:
   ```ts
   type DocumentLineEditorProps = {
     /** The form field name for the hidden JSON payload. Defaults to "lines". */
     name?: string;
     initialLines: ClientDocumentLine[];
     currencyCode: string;
     /** From getActiveDimensionsWithValues in the route loader (Task 11). */
     availableDimensions: DimensionWithValues[];
     /** The document header amount the lines must sum to. */
     headerAmount: number;
     isDisabled?: boolean;
     /** Notified on every change so the page header can show the running total. */
     onTotalChange?: (total: number, isBalanced: boolean) => void;
   };
   ```
   - `useState<ClientDocumentLine[]>` seeded from `initialLines`, falling back
     to one `createEmptyLine()` when empty.
   - `handleAddLine` / `handleLineChange(index, line)` /
     `handleDeleteLine(index)`; `canDelete` is `lines.length > 1` (the document
     must always have at least one coding line — `requireLineSum` in Task 8
     throws on zero).
   - `+ Add line item` buttons at **both** top and bottom of the card, per the
     shared spec.
   - Derived `total = Σ (line.amount ?? 0)` and
     `isBalanced = Math.abs(total - headerAmount) < 0.01` — the same 0.01
     threshold `JournalEntryForm` uses and the same one
     `build-reimbursement-journal`'s `BALANCE_TOLERANCE` uses, so the UI and the
     edge function agree. Render a `<Status color={isBalanced ? "green" : "red"}>`
     reading Balanced / Unbalanced in the card header, and call
     `onTotalChange(total, isBalanced)` in a `useEffect` so the page header can
     mirror it.
   - Emit the single hidden field:
     ```tsx
     <input type="hidden" name={name ?? "lines"} value={linesJson} />
     ```
     where `linesJson` maps each row to
     `{ id, accountId, costCenterId, projectId, description, amount,
     dimensions: line.dimensions.map(({ dimensionId, valueId }) => ({ dimensionId, valueId })) }`.
     Note it **drops `key`** (client-only) and **strips the dimension display
     names** — `JournalLineDimensionValue` carries `dimensionName`/`valueName`
     for rendering, and the server contract is only the id pair, exactly as
     `$journalEntryId.details.tsx:48` declares.
   - React key is `line.key`, **never the array index** (re-ordering would move
     rows under the cursor).
5. `index.ts` re-exports the component and the type. Do **not** add it to
   `apps/erp/app/components/index.ts` — it is a directory component imported by
   path, like `~/components/LineReorder`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/components/DocumentLineEditor/ && grep -rn "minimumFractionDigits\|maximumFractionDigits\|step={0\." apps/erp/app/components/DocumentLineEditor/ ; grep -rn "DimensionSelector" apps/erp/app/components/DocumentLineEditor/ ; git status --short packages/database/
```
```
# Expected: typecheck exits 0; biome reports no errors; the precision grep
# prints NOTHING (any hit is a no-inline-fraction-digits violation — take the
# digits from INPUT_FORMAT and the step from INPUT_STEP); the DimensionSelector
# grep DOES print a match (the editor must reuse it, not reimplement pickers);
# git status prints nothing for packages/database/.
```

**Out of scope:** Do not wire this into the charge UI (sibling spec). Do not add
line reordering (`~/components/LineReorder`) — `sequence` follows array order
and reordering coding lines changes nothing about the journal. No per-line
child routes. Do not modify `DimensionSelector` itself; if it needs a change to
be reusable here, STOP and report — it is live on journal entries.

---

## Task 14: `path.to` entries for reimbursements

**Depends on:** Task 5

**Files:**
- Modify: `apps/erp/app/utils/path.ts`
- Copy from (precedent): the same file, lines 1460–1468 — the `memo` block
  (`memo`, `memoDelete`, `memoNew`, `memoPost`, `memoVoid`) and line 564
  (`creditMemos: \`${x}/invoicing/credit-memos\``). That is the established
  split: the LIST sits under `/x/invoicing/`, the full-page DOCUMENT sits at
  its own top level.

**Steps:**

1. Add, in the same block style as the memo entries and with an equivalent
   explanatory comment:
   ```ts
   // Reimbursements — employee expense payables imported from a spend tool.
   // The list lives under invoicing (it is an AP nav entry); the document is a
   // full page of its own, because the coding-line editor does not fit the
   // Drawer detail convention (see
   // .ai/specs/2026-09-23-editable-imported-spend-documents.md).
   reimbursement: (id: string) => generatePath(`${x}/reimbursements/${id}`),
   reimbursementEdit: (id: string) =>
     generatePath(`${x}/reimbursements/${id}/edit`),
   reimbursementPost: (id: string) =>
     generatePath(`${x}/reimbursements/${id}/post`),
   reimbursementVoid: (id: string) =>
     generatePath(`${x}/reimbursements/${id}/void`),
   ```
   and, next to `creditMemos` (line 564):
   ```ts
   reimbursements: `${x}/invoicing/reimbursements`,
   ```
2. There is deliberately **no `reimbursementNew`** and **no
   `reimbursementDelete`**: a reimbursement is never hand-created, and a Draft
   that should not exist is a sync problem, not a user action.

**Verify:**
```bash
grep -n "reimbursement" apps/erp/app/utils/path.ts && pnpm exec turbo run typecheck --filter=erp && git status --short packages/database/
```
```
# Expected: the grep prints exactly five entries — reimbursement,
# reimbursementEdit, reimbursementPost, reimbursementVoid, reimbursements.
# It must NOT print reimbursementNew or reimbursementDelete.
# typecheck exits 0; git status prints nothing for packages/database/.
```

**Out of scope:** Do not rename or move any existing path.

---

## Task 15: `ReimbursementStatus` + `ReimbursementsTable`

**Depends on:** Tasks 5, 14

**Files:**
- Create: `apps/erp/app/modules/invoicing/ui/Reimbursement/ReimbursementStatus.tsx`
- Create: `apps/erp/app/modules/invoicing/ui/Reimbursement/ReimbursementsTable.tsx`
- Create: `apps/erp/app/modules/invoicing/ui/Reimbursement/index.ts`
- Modify: `apps/erp/app/modules/invoicing/ui/index.ts` — add `export * from "./Reimbursement";`
- Copy from (precedent): `apps/erp/app/modules/invoicing/ui/Charge/ChargeStatus.tsx`
  (21 lines, verbatim shape) and `apps/erp/app/modules/invoicing/ui/Charge/ChargesTable.tsx`
  (149 lines) and `Charge/index.ts`

**Steps:**

1. `ReimbursementStatus.tsx` — clone `ChargeStatus.tsx` exactly, typing the prop
   as `(typeof reimbursementStatus)[number] | null` and keeping the same colour
   mapping (`Draft` gray, `Posted` green, `Voided` red).
2. `ReimbursementsTable.tsx` — clone `ChargesTable.tsx`, changing:
   - `type ReimbursementRow = Database["public"]["Tables"]["reimbursement"]["Row"]`
   - Columns: `reimbursementId` (Hyperlink to
     `path.to.reimbursement(row.original.id)`, `meta.icon: <LuHash />`, pinned
     left); `status` (static filter over `reimbursementStatus`,
     `pluralHeader: t\`Statuses\``); `employeeId` rendered with
     `<EmployeeAvatar employeeId={row.original.employeeId} />` from
     `~/components` (it takes `employeeId: string | null` and resolves the name
     through `usePeople()`, and `employee.id` IS the user id — so this works
     directly); `reimbursementDate` (`formatDate(value, undefined, locale)`);
     `reference`; `amount` (per-row currency via `useCurrencyDecimalsLookup()` +
     `formatMoney(amount, locale, code, currencyDecimals(code))` — never a
     cross-currency total); `journalId` (hidden by default).
   - `title={t\`Reimbursements\``, `table="reimbursement"`, `withSavedView`,
     `defaultColumnPinning={{ left: ["reimbursementId"] }}`,
     `defaultColumnVisibility={{ journalId: false }}`.
   - **No "New" action button.** `ChargesTable` has none for the same reason:
     the document is never hand-created.
   - Default sort is `reimbursementId` descending, which `getReimbursements`
     already applies — but the shared spec's "drafts pile up unreviewed" risk
     means Draft rows must be findable, so ALSO set the status column's default
     filter chip to none and leave sorting alone. Do not invent a
     "Drafts first" sort; it is not in either spec.
3. `Reimbursement/index.ts`:
   ```ts
   export { default as ReimbursementStatus } from "./ReimbursementStatus";
   export { default as ReimbursementsTable } from "./ReimbursementsTable";
   ```
4. Add `export * from "./Reimbursement";` to `ui/index.ts`, alphabetically after
   `./PurchaseInvoice`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && grep -n "Reimbursement" apps/erp/app/modules/invoicing/ui/index.ts && git status --short packages/database/
```
```
# Expected: typecheck exits 0; the barrel grep shows
# `export * from "./Reimbursement";`; git status prints nothing for
# packages/database/.
```

**Out of scope:** No form here. Do not touch `ChargesTable.tsx`.

---

## Task 16: Reimbursement detail — read mode

**Depends on:** Tasks 5, 12, 14, 15

**Files:**
- Create: `apps/erp/app/routes/x+/invoicing+/reimbursements.tsx` — the list
- Create: `apps/erp/app/routes/x+/reimbursements+/_layout.tsx`
- Create: `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.tsx` — read mode
- Create: `apps/erp/app/modules/invoicing/ui/Reimbursement/ReimbursementSummary.tsx`
- Modify: `apps/erp/app/modules/invoicing/ui/Reimbursement/index.ts` — export it
- Copy from (precedent, LIST): `apps/erp/app/routes/x+/invoicing+/charges.tsx` (73 lines)
- Copy from (precedent, LAYOUT): `apps/erp/app/routes/x+/credits+/_layout.tsx` (19 lines)
- Copy from (precedent, PAGE FRAME): `apps/erp/app/routes/x+/journal-entry+/$journalEntryId.tsx`
  — the plain centered `max-w-5xl` page. **Use this, NOT the purchase-invoice
  three-pane `PanelProvider` + `ResizablePanels` frame** — this document has one
  card and a line list, not an explorer and a properties rail.
- Copy from (precedent, LINES TABLE): `apps/erp/app/routes/x+/invoicing+/charges.$id.tsx`
  lines 186–225 (the read-only account / cost center / description / amount table)
- Copy from (precedent, MAPPING READ): `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.tsx`
  lines 85–94 — the inline `externalIntegrationMapping` `.maybeSingle()` read in a loader

**Steps:**

1. `invoicing+/reimbursements.tsx` — clone `charges.tsx`:
   `handle = { breadcrumb: "Reimbursements", to: path.to.reimbursements, module: "invoicing" }`;
   loader `requirePermissions(request, { view: "invoicing" })`, reads `search`,
   `status`, `employeeId` from `searchParams` plus `getGenericQueryFilters`,
   calls `getReimbursements`, redirects to `path.to.invoicing` with a flash on
   error; default export renders `<ReimbursementsTable data count />` in a
   `<VStack spacing={0} className="h-full">`. **No `<Outlet />`** — unlike
   `charges.tsx`, the detail is a separate full page, not a Drawer child.
2. `reimbursements+/_layout.tsx` — clone `credits+/_layout.tsx`:
   `meta` title `"Carbon | Reimbursements"`,
   `handle = { breadcrumb: "Invoicing", to: path.to.invoicing, module: "invoicing" }`,
   renders `<Outlet />`.
3. `$reimbursementId.tsx` loader — `requirePermissions(request, { view: "invoicing" })`,
   then a `Promise.all` of:
   - `getReimbursement(client, companyId, id)` (redirect to
     `path.to.reimbursements` with a flash on error);
   - the account lookup for the header + every line, ONE query not N+1 —
     `client.from("account").select("id, number, name").eq("companyGroupId", companyGroupId).in("id", [...new Set(accountIds)])`,
     exactly as `charges.$id.tsx:60-72` does;
   - the provider mapping, copied from
     `purchase-invoice+/$invoiceId.tsx:85-94` with the entity type changed:
     ```ts
     client
       .from("externalIntegrationMapping")
       .select("id, externalId, metadata")
       .eq("companyId", companyId)
       .eq("integration", "ramp")
       .eq("entityType", "reimbursement")
       .eq("entityId", id)
       .maybeSingle()
     ```
     Keep that file's comment about falling back to `null` silently when RLS
     denies or no mapping exists — the badge must degrade, not throw. **`"reimbursement"`
     is the entityType Task 23 writes**; if Task 23 has not run yet this simply
     returns null and the badge shows the provider without an external id.
   - the journal, when `journalId` is set (`charges.$id.tsx:74-86`);
   - `getActiveDimensionsWithValues(client, companyGroupId, companyId)` (Task
     11's contract) — read mode renders the line dimensions as badges, and the
     edit route (Task 17) needs the same list, so both loaders fetch it.
4. `ReimbursementSummary.tsx` — a `<Card>` whose `CardHeader` carries the
   `reimbursementId` as `CardTitle`, the `<ReimbursementStatus>`, an
   `<EmployeeAvatar employeeId={reimbursement.employeeId} />`, and — in a
   labelled field to the right — `<DocumentSourceBadge integration={reimbursement.integration} externalId={mapping?.externalId} deepLink={mapping?.metadata?.deepLink} />`
   from Task 12. `CardContent` holds a `<dl>` of date / amount / currency /
   reference / journal link (the `charges.$id.tsx:139-184` block) and the
   read-only lines table (`charges.$id.tsx:186-225`). Each line's dimensions
   render as read-only **badges** — reuse the colour map and badge shape from
   `DimensionSelector.tsx` (`entityTypeColors` / `getColor`) so a dimension
   looks the same in read mode and edit mode. Resolve every id to a NAME:
   `charges.$id.tsx:210` renders `line.costCenterId ?? "—"`, which shows a raw
   id to the user and is a defect worth not copying. The generic pairs already
   carry `dimensionName`/`valueName` from
   `getActiveDimensionsWithValues`; the two legacy columns resolve through the
   same dimension list.
5. **No Activity component.** An earlier draft of this plan built a
   `ReimbursementActivity.tsx` that derived an "imported from Ramp" row from an
   `importedAt` column. The spec has since dropped the activity/timeline
   surface entirely: Carbon has no generic activity table, the audit log is the
   real document history, and building one to match the reference screenshots
   would invent a subsystem for a decoration. **The SOURCE badge carries the
   provenance on its own.** Do not create an Activity component, and do not add
   an `importedAt` column.

   Do still mount the real history: the audit-log trigger + drawer via
   `useAuditLog({ entityType: "reimbursement", entityId: id, companyId, variant: "card-action" })`,
   following `PurchaseInvoiceHeader.tsx:63`. **Note the two-part contract** —
   `trigger` goes in the card header, `drawer` must be mounted at component
   root (the hook's own comment explains why).

6. Default export: the page frame from
   `journal-entry+/$journalEntryId.tsx` — a centered `max-w-5xl` column holding
   `<ReimbursementSummary>`, plus a header action bar with **Edit** (link to `path.to.reimbursementEdit(id)`, rendered only
   when `status === "Draft"` and `permissions.can("update", "invoicing")`),
   **Post** (Task 18) and **Void** (Task 18).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/routes/x+/reimbursements+/ apps/erp/app/routes/x+/invoicing+/reimbursements.tsx apps/erp/app/modules/invoicing/ui/Reimbursement/ && git status --short packages/database/
```
```
# Expected: typecheck exits 0; biome reports no errors; git status prints
# nothing for packages/database/.
```

**Out of scope:** No editing here (Task 17). Do not use `Response.json(...)` —
return plain objects or `data(value, init)`. Do not create an `activity` table,
an Activity component, or an `importedAt` column — the spec drops that surface.

---

## Task 17: Reimbursement detail — edit mode

**Depends on:** Tasks 6, 13, 16

**Files:**
- Create: `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.edit.tsx`
- Create: `apps/erp/app/modules/invoicing/ui/Reimbursement/ReimbursementEditForm.tsx`
- Modify: `apps/erp/app/modules/invoicing/ui/Reimbursement/index.ts` — export the form
- Copy from (precedent, FORM + HIDDEN-JSON SUBMIT): `apps/erp/app/modules/accounting/ui/JournalEntries/JournalEntryForm.tsx`
  — one `<ValidatedForm>` wrapping a Details card and a Lines card, the hidden
  `lines` field, the header-level running total, and the `name="intent"` submit
  buttons
- Copy from (precedent, ACTION): `apps/erp/app/routes/x+/journal-entry+/$journalEntryId.details.tsx`
  — reading `formData.get("lines")`, the `JSON.parse` inside try/catch that
  flashes `"Invalid lines data"` rather than throwing, and the
  validate-then-save sequence
- Copy from (precedent, LOCK GUARD): `apps/erp/app/utils/lockedGuard.server.ts`
  (`requireUnlocked({ request, isLocked, redirectTo, message })`) and its use in
  `apps/erp/app/routes/x+/purchase-invoice+/$invoiceId.details.tsx`

**Steps:**

1. Loader — `requirePermissions(request, { update: "invoicing" })`, load the
   reimbursement AND
   `getActiveDimensionsWithValues(client, companyGroupId, companyId)` (Task 11's
   contract), then **`requireUnlocked({ request, isLocked: isReimbursementLocked(reimbursement.status), redirectTo: path.to.reimbursement(id), message: "A posted reimbursement cannot be edited" })`**.
   This is what makes spec AC "A Posted reimbursement is not editable" true for
   a direct URL, not just a hidden button. The RLS policy and the
   `reimbursement_draft_guard` trigger are the backstops behind it.
2. Action:
   - `assertIsPost`; `requirePermissions(request, { update: "invoicing" })`;
     read `formData` ONCE.
   - `const intent = formData.get("intent") as string;` — `"save"` or
     `"save-and-post"`.
   - `validator(reimbursementUpdateValidator).validate(formData)` →
     `validationError` on failure.
   - Re-read the row and hard-guard `existing.status !== "Draft"` before any
     write, returning a flash (the `credits+/$memoId.tsx:87-92` guard) — a
     readable message beats a raw 55000 from the trigger.
   - Parse the lines: `JSON.parse(formData.get("lines") as string)` inside
     try/catch → on failure `return data({}, await flash(request, error(null, "Invalid lines data")))`;
     then `reimbursementLinesValidator.safeParse(parsed)` → `validationError`-
     equivalent flash on failure.
   - `await updateReimbursement(client, { ...validation.data, companyId, updatedBy: userId, customFields: setCustomFields(formData) })`.
   - `await upsertReimbursementLines(getDatabaseClient(), { reimbursementId: id, companyId, createdBy: userId, lines })`
     — `getDatabaseClient` is imported from `~/services/database.server`. **A
     route may import a `.server` module; the service file may not**, which is
     why the client is built here and passed in (`no-db-client-in-service`).
     Wrap it in try/catch and flash the thrown message, following
     `payments+/$paymentId.applications.set.tsx:88-103`.
   - **The totals guard**: before doing anything for `intent === "save-and-post"`,
     recompute `Σ lines.amount` and compare to `validation.data.amount` with the
     same `< 0.01` tolerance the editor uses. On a mismatch, flash
     `"The coding lines must sum to the reimbursement amount before posting"`
     and redirect back to the edit page **without calling the edge function** —
     the shared spec requires the refusal to happen "before any edge-function
     call".
   - On success: `intent === "save"` redirects to `path.to.reimbursement(id)`
     with `success("Reimbursement updated")`; `"save-and-post"` falls through to
     the Post action's logic (call the same helper Task 18 extracts, do not
     duplicate the invoke).
3. `ReimbursementEditForm.tsx` — props
   `{ initialValues: z.infer<typeof reimbursementUpdateValidator>; initialLines: ClientDocumentLine[]; status: string }`.
   One `<ValidatedForm method="post" validator={reimbursementUpdateValidator} defaultValues={initialValues}>`
   containing:
   - a **Details** card — `<DatePicker name="reimbursementDate">`,
     `<Currency name="currencyCode">`,
     `<Number name="amount" formatOptions={INPUT_FORMAT.money(currencyCode, currencyDecimals)} step={INPUT_STEP.money(currencyDecimals)}>`,
     `<Input name="reference">`, `<TextArea name="notes">`,
     `<CustomFormFields table="reimbursement" />`, `<Hidden name="id" />`,
     `<Hidden name="exchangeRate" />`. The employee and the readable id are
     **displayed, not editable** — they are not in the validator.
   - a **Line items** card rendering
     `<DocumentLineEditor initialLines={initialLines} currencyCode={currencyCode} availableDimensions={dimensions} headerAmount={amount} onTotalChange={setTotals} />`
     from Task 13.
   - the running total in the page header, driven by `onTotalChange`, with the
     Balanced / Unbalanced `<Status>`.
   - footer: `Cancel` (link back to `path.to.reimbursement(id)`), `Save`
     (`name="intent" value="save"`), and `Save and post`
     (`name="intent" value="save-and-post"`, `isDisabled` while unbalanced).
4. `initialLines` is mapped in the route component from
   `reimbursement.reimbursementLine` sorted by `sequence`, assigning each row a
   fresh client `key`, and hydrating `dimensions` from the embedded
   `reimbursementLineDimension` rows — joined against `availableDimensions` to
   fill the `dimensionName` / `valueName` the badges render. Extend
   `getReimbursement`'s select in Task 5 to embed them
   (`reimbursementLine(*, reimbursementLineDimension(*))`) rather than issuing a
   second query per line (`.claude/rules/database-patterns.md` — never query in
   a loop). The two legacy columns ride along on `ClientDocumentLine` untouched.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm exec biome check apps/erp/app/routes/x+/reimbursements+/ apps/erp/app/modules/invoicing/ui/Reimbursement/ && grep -n "getDatabaseClient" apps/erp/app/routes/x+/reimbursements+/\$reimbursementId.edit.tsx && git status --short packages/database/
```
```
# Expected: typecheck exits 0; biome reports no errors; the grep shows
# getDatabaseClient imported from ~/services/database.server and called at the
# upsertReimbursementLines call site (the client must be built in the ROUTE,
# not the service); git status prints nothing for packages/database/.
```

**Out of scope:** No create path. No per-line delete endpoint. Do not make the
employee or the readable id editable.

---

## Task 18: Post + Void action routes, with the totals guard

**Depends on:** Tasks 9, 14, 16

**Files:**
- Create: `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.post.tsx`
- Create: `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.void.tsx`
- Create: `apps/erp/app/modules/invoicing/reimbursement.server.ts` — the shared
  post helper (a `.server` file, **not** barrel-exported)
- Copy from (precedent): `apps/erp/app/routes/x+/credits+/$memoId.post.tsx`
  (whole file, 47 lines — including the
  `(result.data as { message?: string })?.message ?? result.error.message`
  unwrap, which matters because a Supabase edge function puts its useful text in
  the body, not `error.message`) and `charges.$id.void.tsx` (46 lines)
- Copy from (precedent, `.server` placement): `apps/erp/app/modules/invoicing/stripe-customer.server.ts`
  — an in-module `.server.ts` that `invoicing/index.ts` deliberately does not
  re-export

**Steps:**

1. `reimbursement.server.ts` — one exported helper so the Post route and Task
   17's `save-and-post` intent cannot drift:
   ```ts
   export async function postReimbursement(args: {
     reimbursementId: string;
     companyId: string;
     userId: string;
   }): Promise<{ error: string | null }>;
   ```
   Body: `getCarbonServiceRole().functions.invoke("post-reimbursement", { body: { type: "post", ...args } })`,
   returning the unwrapped message on failure and `{ error: null }` on success.
   This file is **not** added to `apps/erp/app/modules/invoicing/index.ts`.

   **On success it also settles a deferred Ramp payout.** Task 23 step 5 records
   an already-paid Ramp reimbursement's payout intent on the
   `externalIntegrationMapping` metadata
   (`{ rampPaymentId, paidAt, bankAccountId }`) instead of creating a payment at
   import, because a Draft cannot be settled. So after the edge function reports
   success, this helper reads that metadata and — when present and not already
   settled — creates the `payment` (`Disbursement`, `employeeId`, the recorded
   bank account, `paidAt`, and the **preserved source FX**, never a re-derived
   rate) plus its `invoiceSettlement` with `targetReimbursementId`, then clears
   the intent from the metadata so a re-post cannot double-pay. Reuse Task 22's
   settlement path rather than writing the rows by hand.

   Make that step idempotent and non-fatal: a failure to record the payout must
   NOT unwind the successful post (the journal is already written). Flash a
   warning naming the reimbursement and leave the intent on the metadata so it
   can be retried.
2. `$reimbursementId.post.tsx` — `assertIsPost`;
   `requirePermissions(request, { update: "invoicing" })`; then **the totals
   guard, server-side, before the invoke**:
   - read the reimbursement and its lines with `getReimbursement`;
   - refuse a non-Draft status with a flash;
   - compute `Σ reimbursementLine.amount` and compare against
     `reimbursement.amount` with the `< 0.01` tolerance; on mismatch, redirect
     to `path.to.reimbursement(id)` flashing
     `"The coding lines must sum to the reimbursement amount before posting"`
     **without calling the edge function**.
   - otherwise call `postReimbursement(...)` and flash the result.
   The edge function's `requireLineSum` enforces the same invariant, but the
   shared spec requires the UI to refuse first, with a clear message.
3. `$reimbursementId.void.tsx` — clone `charges.$id.void.tsx` verbatim with the
   renames: `update: "invoicing"`, invoke `post-reimbursement` with
   `type: "void"`, redirect to `path.to.reimbursement(id)` with
   `success("Reimbursement voided")`. No totals guard — a void reverses whatever
   was posted.
4. Wire both into Task 16's header action bar: Post shown only when
   `status === "Draft"`, Void only when `status === "Posted"`, both gated on
   `permissions.can("update", "invoicing")`. Void opens the `Confirm` modal with
   the charge drawer's copy ("This posts a reversing journal entry and cannot be
   undone.", `charges.$id.tsx:271-280`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && grep -n "reimbursement.server" apps/erp/app/modules/invoicing/index.ts ; grep -c "post-reimbursement" apps/erp/app/modules/invoicing/reimbursement.server.ts && git status --short packages/database/
```
```
# Expected: typecheck exits 0. The FIRST grep must print NOTHING — the .server
# file must not be barrel-exported (it would reach the client graph). The
# second grep prints 1 — the edge function is invoked in exactly one place, so
# the Post route and the save-and-post intent cannot diverge.
# git status prints nothing for packages/database/.
```

**Out of scope:** No delete route. Do not invoke `post-reimbursement` from
anywhere else in the ERP.

---

## Task 19: Nav entry under Accounts Payable

**Depends on:** Tasks 16, 17, 18

**Files:**
- Modify: `apps/erp/app/modules/invoicing/ui/useInvoicingSubmodules.tsx`
- Copy from (precedent): the same file, the `Charges` entry — the last route in
  the `Accounts Payable` group

**Steps:**

1. In the `Accounts Payable` group's `routes` array, **after the `Charges`
   entry**, append:
   ```tsx
   {
     name: t`Reimbursements`,
     to: path.to.reimbursements,
     icon: <LuWallet />,
     table: "reimbursement",
     permission: "invoicing"
   }
   ```
   Add the icon to the `react-icons/lu` import block at the top of the file.
   **If `LuWallet` does not exist in the installed `react-icons` version, pick
   another from the icons this file already imports** (`LuBanknote`,
   `LuCreditCard`, `LuReceipt`, `LuReceiptText` — note `LuReceipt` is taken by
   Charges) rather than inventing a name.
2. Leave the comment above `isRouteVisible` intact — it explains why the entry
   is gated on permission only and not on a connected spend integration, which
   applies to reimbursements identically.

**Verify:**
```bash
grep -n "Reimbursements" -B 2 -A 6 apps/erp/app/modules/invoicing/ui/useInvoicingSubmodules.tsx && pnpm exec turbo run typecheck --filter=erp && git status --short packages/database/
```
```
# Expected: the grep shows the Reimbursements entry immediately after the
# Charges entry, inside the `Accounts Payable` group; typecheck exits 0;
# git status prints nothing for packages/database/.
```

**Out of scope:** Do not reorder the existing AP entries. Do not add a
Receivables or Payments entry.

---
## Task 20: Settlement target — models + service

**Depends on:** Task 5

**Files:**
- Modify: `apps/erp/app/modules/invoicing/invoicing.models.ts` —
  `invoiceSettlementBase` (line 446-area), `invoiceSettlementValidator`
  (469–486), `paymentValidator` (401–425)
- Modify: `apps/erp/app/modules/invoicing/invoicing.service.ts` —
  `getInvoiceSettlements` (1490-area), `replaceInvoiceSettlements` (2483–2670,
  guard at 2534–2545), `getMemoApplications` (1694–1757)
- Copy from (precedent): the existing `targetMemoId` handling in all three

**Steps:**

1. `invoiceSettlementBase` — add
   `targetReimbursementId: zfd.text(z.string().optional())` next to
   `targetMemoId`.
2. `invoiceSettlementValidator`'s target refine — widen the exactly-one check to
   four columns and update the message to
   `"Application must target exactly one document (sales invoice, purchase invoice, memo, or reimbursement)"`.
3. `paymentValidator` — add `employeeId: zfd.text(z.string().optional())` and
   replace the `Boolean(d.customerId) !== Boolean(d.supplierId)` refine with an
   exactly-one-of-three check:
   ```ts
   .refine(
     (d) =>
       [d.customerId, d.supplierId, d.employeeId].filter(Boolean).length === 1,
     {
       message:
         "A payment requires exactly one party (customer, supplier, or employee)",
       path: ["customerId"]
     }
   )
   ```
   Leave `memoValidator`'s party refine alone — a memo has no employee party.
4. `getInvoiceSettlements` — extend the embed to
   `..., targetReimbursement:targetReimbursementId(reimbursementId)` and add the
   field to the local `Settlement` type.
5. `replaceInvoiceSettlements` — the per-draft guard at 2534–2545 mirrors the
   edge function's. Add the employee arm: when the payment's party is an
   employee, the ONLY legal target is `targetReimbursementId`, and
   `discountAmount` / `writeOffAmount` must be 0 (a reimbursement payout takes
   no trade discount). Throw
   `"An employee payment targets reimbursements only, without discounts or write-offs"`.
6. `getMemoApplications` — the `if (s.targetSalesInvoiceId) … else if …` chain
   at 1739–1757 produces a discriminated union; add the
   `else if (s.targetReimbursementId) → { type: "reimbursement" }` arm so the
   union stays total.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- invoicing.models invoicing.settlements invoicing.application-history && git status --short packages/database/
```
```
# Expected: typecheck exits 0; the three invoicing test files pass
# ("Test Files  3 passed"); git status prints nothing for packages/database/.
# If an existing test asserts the OLD two-party payment message, update the
# assertion — do not weaken the validator to satisfy it.
```

**Out of scope:** Do not change `appliedAmount`/`sourceAmount`/FX semantics.
Do not touch `invoiceSettlement_anyComponent_check` behaviour.

---

## Task 21: `post-payment` — reimbursement settlement arm

**Depends on:** Task 20

**Files:**
- Modify: `packages/database/supabase/functions/post-payment/post-payment-transaction.ts`
  — the target switch (271–286), the refund prior-rows query (354), the
  write-back normalization (727–732)
- Modify: `packages/database/supabase/functions/post-payment/build-payment-journal.ts`
  — the application-target type (25–27) and switch (188–205)
- Modify: `packages/database/supabase/functions/shared/payment-funding.ts` —
  `SettlementBalanceRow` (236–237) and `invoiceRemainingAmounts` (292)
- Modify: `packages/database/supabase/functions/post-payment/post-payment.test.ts`
- Copy from (precedent): the existing `isRefund` / `targetMemoId` arm in each file

**Steps:**

1. `post-payment-transaction.ts` — introduce an `isReimbursement`
   discriminator derived from the payment row's `employeeId` being non-null, and
   extend the target-column resolution:
   ```ts
   const targetColumn = isReimbursement
     ? "targetReimbursementId"
     : isRefund
       ? "targetMemoId"
       : isAR
         ? "targetSalesInvoiceId"
         : "targetPurchaseInvoiceId";
   ```
   Extend the per-draft rejection so a reimbursement payment carries NO other
   target, no `memoId`/`sourcePaymentId` source, and zero `discountAmount` /
   `writeOffAmount`, throwing the existing
   `"Unsupported payment settlement target"`.
2. The write-back normalization (727–732) gains
   `targetReimbursementId: isReimbursement ? application.targetId : null` and
   the three existing keys each gain `&& !isReimbursement`.
3. `build-payment-journal.ts` — a reimbursement payout debits the
   reimbursement's **stored** `payableAccountId` (which Task 9's post pass
   writes onto the row) and credits the bank asset — structurally the AP arm
   with the payables control account swapped. **Read the id off the
   reimbursement row; never re-resolve it by number or name**
   (`.ai/lessons.md` — "Never resolve a control account by number/name"), and
   never re-derive it from `accountDefault` at payment time, because the default
   may have changed since the document posted. Extend the target-type union with
   `"reimbursement"`, add the arm, and keep
   `throw new Error("Invalid payment application target")` as the exhaustiveness
   guard.
4. `payment-funding.ts` — add `targetReimbursementId` to
   `SettlementBalanceRow` and an arm in `invoiceRemainingAmounts` so a
   reimbursement's remaining balance nets prior applications the way an
   invoice's does.
5. Add tests to `post-payment.test.ts`: a disbursement to an employee settling a
   Posted reimbursement in full → one balanced journal (payable debited, bank
   credited) and a settlement row carrying only `targetReimbursementId`; a
   partial application leaves the correct remaining balance; a reimbursement
   payment carrying a `discountAmount` → throws.

**Verify:**
```bash
cd packages/database/supabase/functions && deno test --no-lock --no-check post-payment/ shared/payment-funding.test.ts
```
```
# Expected: "ok | N passed | 0 failed" — every pre-existing post-payment and
# payment-funding test still passes, plus the three new reimbursement cases.
# If a pre-existing test now fails, the arm was added in the wrong place —
# STOP and report rather than relaxing the assertion.
```

**Out of scope:** Do not change the AR, AP, or refund arms' behaviour. Do not
touch `post-memo`.

---

## Task 22: Payment UI — Pay expense modal, employee payee, reimbursement apply target

**Depends on:** Task 20

**Files:**
- Create: `apps/erp/app/modules/invoicing/ui/Reimbursement/PayExpenseModal.tsx`
- Create: `apps/erp/app/routes/x+/reimbursements+/$reimbursementId.pay.tsx`
- Modify: `apps/erp/app/utils/path.ts` — add `reimbursementPay: (id) => \`${x}/reimbursements/${id}/pay\``
- Modify: `apps/erp/app/modules/invoicing/ui/Payment/PaymentForm.tsx` — employee payee option
- Modify: `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplyTable.tsx` —
  seeding (173–176) and the `onSave` payload (472–486)
- Modify: `apps/erp/app/modules/invoicing/ui/Payment/PaymentApplications.tsx` —
  target resolution (47–49, 63–65, 84–86) and the link branch (175–190)
- Modify: `apps/erp/app/routes/x+/payments+/$paymentId.tsx` — load the
  employee's open reimbursements when the payment's party is an employee
- Copy from (precedent): the `isRefund` / memo branch already threaded through
  all three components

**Steps:**

0. **The `Pay expense` modal** (spec: "Payout — the Pay expense modal"). An
   action on the detail page of a **Posted, not-fully-paid** reimbursement opens
   a small modal over a `Total Due` display with exactly three inputs:
   - **Amount** — defaults to the full balance due but is **editable; partial
     payment is supported**, so do not lock it to the balance;
   - **Date** — the payment date;
   - **Account** — the bank/cash account the payout is drawn from.

   Those three are a 1:1 match for Rillet's
   `POST /reimbursements/{id}/payments` (`{amount, date, account_code}`), which
   is what lets Task 26 close the stale `UNSUPPORTED_REIMBURSEMENT_PAYMENT`
   with no impedance — keep the field set exactly these three.

   Build it from `~/components/Modals` + `ValidatedForm`, cloning the shape of
   an existing three-field action modal in invoicing (grep
   `apps/erp/app/modules/invoicing/ui/` for a `Modal`-suffixed component and
   copy the nearest; if none exists, clone `~/components/Modals`' `Confirm`
   structure and add the fields). Use `<Number>` with
   `INPUT_FORMAT.money(currencyCode, currencyDecimals)`, `<DatePicker>`, and the
   existing bank-account picker the payment form already uses — **do not invent
   a new account selector**.

   `$reimbursementId.pay.tsx` is the action: validate, then create the
   **`payment`** (`paymentType: "Disbursement"`, `employeeId`, the chosen bank
   account, the amount and date) plus one **`invoiceSettlement`** with
   `targetReimbursementId`, and post it through the existing payment path. Reuse
   `replaceInvoiceSettlements` rather than writing settlement rows by hand —
   Task 20 taught it the employee arm. Balance and "fully paid" come from the
   settlement rows, so **do not add a `paidAmount` column** to `reimbursement`.

1. `PaymentForm.tsx` — where the form picks a party, add an Employee option
   rendering `<Employee name="employeeId" />` (from `~/components/Form`). Read
   the existing customer/supplier branch first and mirror its exact conditional
   shape; only ONE of the three fields may be mounted at a time so the zod
   refine holds.
2. `$paymentId.tsx` loader — when `payment.employeeId` is set, load that
   employee's `Posted` reimbursements with their settled-to-date balance and
   pass them to `PaymentApplyTable` in place of the invoice list. Reuse the
   existing balance query shape (`invoicing.service.ts:1878-1890`) rather than
   writing a new one.
3. `PaymentApplyTable.tsx` — add an `isReimbursement` branch:
   - seeding (173–176): `isReimbursement ? a.targetReimbursementId : …`
   - `onSave` (472–486): `targetReimbursementId: isReimbursement ? r.id : undefined`,
     with the existing three keys gated `&& !isReimbursement`.
4. `PaymentApplications.tsx` — add the reimbursement arm to the target
   resolution and a fourth link branch rendering
   `<Hyperlink to={path.to.reimbursement(id)}>{reimbursementId}</Hyperlink>`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp && pnpm --filter erp test -- PaymentApplyTable PaymentForm && grep -n "reimbursementPay" apps/erp/app/utils/path.ts && grep -cE "name=\"(amount|paymentDate|bankAccount)\"" apps/erp/app/modules/invoicing/ui/Reimbursement/PayExpenseModal.tsx && git status --short packages/database/
```
```
# Expected: typecheck exits 0; both component test files pass
# ("Test Files  2 passed"); the path entry exists; the modal field grep prints
# 3 — exactly the three fields Rillet's payments endpoint takes, no more (a
# fourth field means the 1:1 mapping Task 26 relies on has been broken);
# git status prints nothing for packages/database/.
```

**Out of scope:** Do not change AR receipt or AP disbursement behaviour for
customers and suppliers. Do not add credit-application
(`AvailableCreditsTable`) support for reimbursements. Do not add a `paidAmount`
column — the settlement rows are the source of truth for the balance.

---

## Task 23: Ramp inbound — create a Draft `reimbursement`; never auto-post, never re-write

**Depends on:** Tasks 6, 9

**Files:**
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement.ts`
  (788 lines — **this is the real path**, not `packages/ee/src/ramp/` as both
  specs say)
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement-family.ts`
  — the DI bag built at lines 48–69
- Copy from (precedent, STAGING): `packages/jobs/src/inngest/functions/integrations/ramp-sync-card-stage.ts`
  (177 lines — `stageOrResumeRampCharge` at line 49: the advisory lock, the
  mapping lookup, `get_next_sequence`, the header+lines insert).
  **Do NOT copy its Draft resume at 98–121**, which refreshes the header and
  deletes-then-reinserts the lines — that is exactly the behaviour the spec now
  forbids (see step 1)
- Copy from (precedent, LINE SCALING): `packages/jobs/src/inngest/functions/integrations/ramp-sync-card.ts:187`
  (`scaleLinesToTotal`)

**Steps:**

1. Replace `stageOrResumeRampReimbursementInvoice` with
   `createRampReimbursement` — note the name: it **creates, and never
   updates**. The spec's rule is *"provider owns it until it lands; Carbon owns
   it after"*. Modelled on `stageOrResumeRampCharge` except for the resume:
   - advisory lock key `ramp:reimbursement:${companyId}:${rampId}` (unchanged);
   - the `externalIntegrationMapping` entity type changes from `"bill"` to
     **`"reimbursement"`** — this is the value Task 16's loader reads to show the
     external id in the SOURCE badge, so the two must match exactly;
   - readable id from `get_next_sequence('reimbursement', companyId)`;
   - insert `reimbursement` with `status: "Draft"`, `integration: "ramp"`,
     `employeeId`, `reimbursementDate`, `postingDate`, `currencyCode`,
     `exchangeRate`, `amount`, `reference = RAMP-REIMB-<rampId>`, `companyId`,
     `createdBy: "system"`. **No `importedAt`** — that column was removed with
     the Activity surface;
   - then `reimbursementLine` rows with **0-based `sequence`** (the `chargeLine`
     convention, and the order `post-reimbursement` reads by) — NOT
     `purchaseInvoiceLine`'s 1-based `sortOrder`;
   - **and, when the mapping already exists, DO NOTHING.** Return the existing
     row as already-synced. Do not refresh the header, do not touch the lines,
     do not re-read Ramp's coding. Delete the resume branch rather than
     narrowing it — a narrowed one invites a later edit to widen it back.

   **Why this is load-bearing, not housekeeping.** The old resume path replaced
   a Draft's lines on every sweep. That was harmless while nothing was editable,
   but under the editable model a reviewer codes a Draft, the hourly sweep
   re-runs, and their work is gone — silently, with no error and no way to tell
   it happened. The accepted cost, stated in the spec: a provider-side
   correction made *after* import (Ramp re-codes the expense) does not flow
   through; the reviewer sees what originally arrived and can re-edit. That is
   the right trade, because the alternative destroys human work.
2. **Remove the auto-post.** Delete the `deps.postInvoice` call and the
   `postPurchaseInvoice` wiring; the row stays Draft. This is the shared spec's
   one behavioural change and the whole reason an editable moment exists. Do NOT
   replace it with a `post-reimbursement` invoke.
3. Replace `resolveEmployeeSupplier` (lines 713–718) with an **employee**
   resolution: map the Ramp user to a Carbon `employee` through the existing
   employee/user relationship
   (`.claude/rules/user-employee-job-relationships.md` — `employee.id` IS the
   user id). Resolve by the Ramp user's email against `user.email` joined to
   `employee` for the company. When no employee matches, **fail the item
   visibly** with
   `"Reimbursement has no matching Carbon employee — invite <email> as an employee, then retry"`
   — never auto-create an employee and never fall back to a synthetic supplier.
   That failure path is spec AC5 and the "employee vs user identity confusion"
   risk row.
4. `buildReimbursementLines` keeps `codeSelections` and its
   account/costCenter/project validation, and **must now also apply**
   `scaleLinesToTotal(lines, headerAmount, decimals)` — the card path does this
   (`ramp-sync-card.ts:187`) and the reimbursement path does not.
   `post-reimbursement`'s `requireLineSum` rejects a header/line mismatch
   outright, and under the Draft model an unbalanced import would block Post
   with no obvious cause.
5. **A Ramp-PAID reimbursement still imports as Draft — confirm at import,
   record the payout at Post.** This is now resolved in the spec, not a plan
   guess.

   The bind: `createOrResumeRampPayment` (572–589) creates an AP payment +
   settlement today, and the family's gating requires `REIMBURSED` /
   `REIMBURSED_VIA_PUSH` to have a **posted settlement** before confirming to
   Ramp. A Draft cannot be settled, so the two cannot both happen at import.

   The rationale for decoupling them, which belongs in the code comment and not
   just in this plan: **the editable window exists for CODING, not for deciding
   whether the employee was paid.** Whether Ramp already paid the employee is a
   settled fact about the outside world; which GL accounts the expense hits is
   the thing a reviewer is being given a chance to correct. Holding the import
   hostage to the payout would confuse the two.

   So:
   - **Confirm to Ramp at import.** Ramp's "synced" means the ERP has the
     record, which it does.
   - **Record the payout at Post.** The Ramp-paid branch records the payout
     intent on the mapping's `metadata`
     (`{ rampPaymentId, paidAt, bankAccountId }`) instead of creating a payment;
     Task 18's Post helper then creates the `payment` + `invoiceSettlement` —
     with `employeeId`, `targetReimbursementId` and the preserved source FX —
     immediately after the edge function reports success.
   - The source-FX snapshot must be preserved on that metadata, exactly as the
     existing resume path preserves it today; re-deriving the rate at Post time
     would post the payout at a different rate than Ramp used.
6. `ramp-sync-reimbursement-family.ts` — update the DI bag: remove
   `postInvoice`, rename `invoiceDeepLinkUrl` → `reimbursementDeepLinkUrl`
   pointing at `path.to.reimbursement(id)` (it is what the SOURCE badge's
   `deepLink` renders). The `syncType: "REIMBURSEMENT_SYNC"` confirm stays.
7. `validateLegacyDraft` (line 89) adopted a legacy Draft purchase invoice by
   `supplierReference`. **Delete it.** There is no legacy `reimbursement` row to
   adopt (the table is new), and keeping it would let a new sync attach itself
   to an old employee-supplier invoice. Existing employee-supplier purchase
   invoices are left exactly as they are — no backfill, no rewrite.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/jobs && pnpm --filter @carbon/jobs test -- ramp-sync-reimbursement && grep -nE "postInvoice|postPurchaseInvoice|updateTable\(\"reimbursement|deleteFrom\(\"reimbursementLine" packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement.ts packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement-family.ts ; git status --short packages/database/
```
```
# Expected: typecheck exits 0; the ramp-sync-reimbursement tests pass — any
# test asserting a purchaseInvoice is created must be rewritten to assert a
# Draft reimbursement, and any test asserting the row ends Posted must be
# rewritten to assert Draft; that is the behaviour change, not a regression.
# The grep must print NOTHING: no auto-post path, and no UPDATE of an existing
# reimbursement or DELETE of its lines — the sync creates only.
# git status prints nothing for packages/database/.
```

**Then prove edits survive a re-sync** — this is the spec's new acceptance
criterion and the whole point of the change. Add a test to the
`ramp-sync-reimbursement` suite that runs the sync twice around an edit:

```bash
pnpm --filter @carbon/jobs test -- ramp-sync-reimbursement
```
```
# The test must: (1) run the syncer against a Ramp reimbursement and assert a
# Draft row with its imported lines; (2) simulate a reviewer's edit — change a
# line's accountId, change its amount, and ADD a second line; (3) run the
# syncer AGAIN with the SAME Ramp payload; (4) assert the row's header and BOTH
# lines are byte-identical to the edited state, the added line still exists,
# and no line was deleted or re-inserted (compare line ids, not just values —
# a delete-then-reinsert would produce the same values with new ids and must
# fail this test).
# Expected: "Test Files  1 passed" with that case green.
```

**Out of scope:** Do not delete `resolveEmployeeSupplier`
(`packages/ee/src/ramp/lib/suppliers.ts:235`) — the spec retains it for the
QBO/Xero provider-side vendor mapping (Tasks 27–28). Do not touch
`ramp-sync-bill.ts`, `ramp-sync-card.ts` (the charge auto-post is the sibling
spec's), or `ramp-sync-repayment.ts`.

---

## Task 24: `@carbon/ee` accounting — `reimbursement` entity type + plumbing

**Depends on:** Task 2

**Files:**
- Modify: `packages/ee/src/accounting/core/types.ts` — the `AccountingEntityType` union (241–258)
- Modify: `packages/ee/src/accounting/core/models.ts` — `ENTITY_DEFINITIONS` (120–216),
  `DEFAULT_SYNC_CONFIG.entities` (218–292), `SyncConfigSchema.entities` (798–817),
  `PostingPolicyEntry.backingEntityType` (321–350), `POSTING_POLICY` (358+)
- Modify: `packages/ee/src/accounting/core/posting.ts` —
  `PostingSyncDocumentSyncFlags` (105–112), `decideDocumentFamily` (367–410)
- Modify: `packages/ee/src/accounting/core/subscriptions.ts` — `COMMON_PUSH_TABLES` (37–46)
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts` — `RILLET_PUSH_ONLY_ENTITIES` (248–258)
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/provider.ts` — `QBO_CARBON_OWNED_ENTITIES` (312–323)
- Modify: `packages/ee/src/accounting/providers/xero/provider.ts` — `XERO_CARBON_OWNED_ENTITIES` (107–117)
- Modify: `packages/jobs/src/inngest/functions/events/sync-tables.ts` — `TABLE_TO_ENTITY_MAP` (13–26)
- Modify: `packages/jobs/src/inngest/functions/integrations/reconcile.ts` — `ReconcileEntityType` (40–50), the decision switch (168–186)
- Modify: `packages/jobs/src/inngest/functions/integrations/reconcile-executor.ts` — `SNAPSHOT_TABLES` (45–62), `MAPPED_TYPES` (64–75)
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-outbound-sweep.ts` — a reimbursement sweep block modelled on the charge block (322–358)
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts` — a `SWEPT_REIMBURSEMENT_STATUSES` next to `SWEPT_CHARGE_STATUSES` (1582)
- Modify: `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx` — `ENTITY_LABELS` (166–178), `ENTITY_PATHS` (184–194)
- Modify: `packages/ee/src/accounting/core/sync-factory.test.ts` — the exact-key-set assertion (194–206)
- Copy from (precedent): every `charge` entry in each of the files above

**Steps:**

1. `types.ts` — add `| "reimbursement"` to `AccountingEntityType`, with a doc
   comment: *"A Carbon `reimbursement` (employee expense payable) pushed as the
   provider's native reimbursement object, or an employee-vendor bill where the
   provider has none."* Note the rule file currently states `employee` is
   declared but unimplemented — that stays true; `reimbursement` is a separate
   member. Several maps below are **total `Record`s**, so the compiler will list
   every site that needs a member — work the typecheck errors, do not hunt by
   hand.
2. `models.ts`:
   - `ENTITY_DEFINITIONS.reimbursement` — `label: "Reimbursements"`,
     `type: "document"`, `supportedDirections: ["push-to-accounting"]` (mirror
     the `charge` entry's field set exactly).
   - `DEFAULT_SYNC_CONFIG.entities.reimbursement` — `enabled: false` (spec:
     `defaultEnabled: false`), the rest mirroring `charge`.
   - `SyncConfigSchema.entities.reimbursement: createEntityConfigSchema().optional()`.
   - Widen `PostingPolicyEntry.backingEntityType` with `| "reimbursement"`.
   - `POSTING_POLICY.Reimbursement` — the new `journalEntrySourceType` value
     makes this total `Record` incomplete until it is added:
     ```ts
     Reimbursement: {
       representation: "document",
       family: "ap",
       backingEntityType: "reimbursement",
       defaultEnabled: false,
       defaultGranularity: "individual"
     },
     ```
3. `posting.ts` — add `reimbursementEnabled?: boolean` to
   `PostingSyncDocumentSyncFlags`, and an arm in `decideDocumentFamily`'s
   `documentSyncEnabled` ternary chain:
   `backingEntityType === "reimbursement" ? args.docSync.reimbursementEnabled === true : …`
   (alongside the `creditMemo` / `vendorCredit` arms). **Without it the chain
   falls through to `false` and a Reimbursement journal pushes as a plain
   journal entry ON TOP of the pushed document — a double-post.**
4. `subscriptions.ts` — append to `COMMON_PUSH_TABLES`:
   ```ts
   // Reimbursements push on the transition to Posted/Voided; the row is never
   // deleted once posted (Draft-only DELETE), so only INSERT/UPDATE.
   { table: "reimbursement", operations: ["INSERT", "UPDATE"] }
   ```
5. The three provider entity arrays — add `"reimbursement"` beside `"charge"` in
   `RILLET_PUSH_ONLY_ENTITIES`, `QBO_CARBON_OWNED_ENTITIES`,
   `XERO_CARBON_OWNED_ENTITIES`.
6. `sync-tables.ts` — `reimbursement: "reimbursement"`.
7. `reconcile.ts` — `| "reimbursement"` in `ReconcileEntityType`;
   `case "reimbursement":` falling into `reconcileDocument(input)` beside
   `case "charge":`.
8. `reconcile-executor.ts` —
   `reimbursement: { table: "reimbursement", columns: "id, status, updatedAt" }`
   in `SNAPSHOT_TABLES`; `"reimbursement"` in `MAPPED_TYPES`.
9. `accounting-sync-operations.ts` —
   `export const SWEPT_REIMBURSEMENT_STATUSES = ["Posted", "Voided"] as const;`
   Draft is deliberately absent: an unposted document has no journal and nothing
   to push.
10. `accounting-outbound-sweep.ts` — a reimbursement block cloned from the
    charge block (322–358): gate on `provider.getSyncConfig("reimbursement")`,
    `pageIds({ table: "reimbursement", statuses: SWEPT_REIMBURSEMENT_STATUSES, dateColumn: "reimbursementDate", floor })`
    plus a second pass on `dateColumn: "voidedAt"` with `statuses: ["Voided"]`
    for late voids, union the ids, push
    `{ entityType: "reimbursement", entityId: id }` refs, and an
    `else skippedReasons.push("reimbursements: reimbursement sync is disabled")`.
    There is no `type` filter — unlike a charge, every reimbursement is
    document-shaped.
11. `SyncActivity.tsx` — `reimbursement: "Reimbursement"` in `ENTITY_LABELS`,
    `reimbursement: path.to.reimbursement` in `ENTITY_PATHS`.
12. `sync-factory.test.ts:194-206` asserts the EXACT Rillet registry key list —
    add `"reimbursement"` there once Task 25 registers the syncer. Until then
    the test still passes; do not pre-add the key.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp && pnpm --filter @carbon/ee test -- posting-policy sync-factory && pnpm --filter @carbon/jobs test -- subscriptions-mapping && git status --short packages/database/
```
```
# Expected: all three typechecks exit 0; the posting-policy test (which asserts
# POSTING_POLICY totality against the DB enum) passes; sync-factory and
# subscriptions-mapping pass. git status prints nothing for packages/database/.
```

**Out of scope:** Do not register any provider syncer here (Tasks 25, 27, 28).
Do not change `charge`'s policy row or its per-row `isDocBackedCharge` special
case — a reimbursement is document-represented by policy and needs no per-row
analogue.

---

## Task 25: Rillet `ReimbursementSyncer`

**Depends on:** Task 24

**Files:**
- Create: `packages/ee/src/accounting/providers/rillet/entities/reimbursement.ts`
- Create: `packages/ee/src/accounting/providers/rillet/entities/__tests__/reimbursement.test.ts`
- Modify: `packages/ee/src/accounting/providers/rillet/index.ts` — import (line 4-area), re-export (13-area), registry key (36–48); leave `SyncFactory.register` at line 61 untouched
- Modify: `packages/ee/src/accounting/providers/rillet/entities/bill.ts` — REMOVE the employee special case
- Modify: `packages/ee/src/accounting/core/sync-factory.test.ts` — add `"reimbursement"` to the Rillet key-set assertion (194–206)
- Copy from (precedent): `packages/ee/src/accounting/providers/rillet/entities/charge.ts`
  (378 lines — `RilletChargeSyncer` at 163, `mapChargeToRilletCharge` at 87–160)
- Copy from (precedent): `providers/rillet/entities/bill.ts` lines 270–291
  (`toRilletReimbursement`), 611–633 (payable resolution + `UNMAPPED_ACCOUNTS`),
  655–685 (the `createReimbursement` call + idempotency key), 367–377
  (`deleteReimbursement` routing)

**Steps:**

1. Create `RilletReimbursementSyncer`, modelled on `RilletChargeSyncer`:
   - source rows from `reimbursement` + `reimbursementLine`, joined to the
     employee's provider **vendor** mapping (Rillet's `/reimbursements` takes a
     `vendor_id`);
   - `mapReimbursementToRilletReimbursement(...)` — a pure exported mapper
     mirroring `mapChargeToRilletCharge`: one item per coded line
     (`account_code`, amount, `fields[]` = the Cost Center / Project field +
     value), `reimbursement_date` = `reimbursementDate`, `impact_date` =
     `postingDate`, `payable_account_code` = the Rillet code mapped from the
     reimbursement's **stored** `payableAccountId`, `external_references`
     carrying the Carbon id;
   - the `UNMAPPED_ACCOUNTS` Warning when the payable account or any line
     account has no Rillet code — copy the message and metadata shape verbatim
     from `bill.ts:611-633`;
   - transport via the EXISTING `provider.ts` methods — `createReimbursement`
     (1023–1035), `getReimbursement` (1016–1021), `deleteReimbursement`
     (809–811). Do not add new transport.
   - Voided → `deleteReimbursement(remoteId)`, following the
     `ChargeSyncerBase` lifecycle.
2. Register it: `reimbursement: RilletReimbursementSyncer` in
   `rilletSyncerRegistry`, plus the import and
   `export * from "./entities/reimbursement";`.
3. **Remove** the employee-supplier detour from `bill.ts`: delete
   `EMPLOYEE_SUPPLIER_TYPE` / `REIMBURSEMENT_REMOTE_KIND` (279–282),
   `employeeSupplierIds` / `reimbursementPayableCodes` / `reimbursementRemoteIds`
   (300–305), `isReimbursement` (321–339), the `linkEntities` override (341–358),
   the `mapToRemote` payable block (611–633), and the `upsertRemote`
   reimbursement branch (655–685). Move `toRilletReimbursement` (270–291) into
   the new file. `bill.ts` goes back to doing one thing.
   **Escape hatch:** if any ALREADY-SYNCED bill carries
   `metadata.remoteKind === "reimbursement"` in `externalIntegrationMapping`,
   deleting the `deleteRemote` branch (367–377) would send a future void to
   `DELETE /bills/{id}` against a reimbursement id. Keep ONLY that branch as a
   legacy read-path, with a comment saying it exists solely for mappings written
   before this change. **If you conclude no such mappings can exist in any
   environment, STOP and confirm before deleting it.**
4. Tests: the pure mapper's output for a two-line reimbursement; the
   `UNMAPPED_ACCOUNTS` Warning when the payable account is unmapped; a Voided
   row issuing `DELETE /reimbursements/{id}`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee && pnpm --filter @carbon/ee test -- reimbursement bill sync-factory && git status --short packages/database/
```
```
# Expected: typecheck exits 0; the new reimbursement tests pass, the existing
# bill tests still pass with the employee cases removed, and sync-factory's
# Rillet key-set assertion now includes "reimbursement".
# git status prints nothing for packages/database/.
```

**Out of scope:** Do not touch the QBO or Xero providers. Do not change
`core/document-costing.ts`'s `loadChargeCostingLines`.

---

## Task 26: Rillet payout — close `UNSUPPORTED_REIMBURSEMENT_PAYMENT`

**Depends on:** Task 25

**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/provider.ts` — add `createReimbursementPayment` next to `createBillPayment`
- Modify: `packages/ee/src/accounting/providers/rillet/entities/payment.ts` — replace the bail-out at 434–456, extend `pushRemotePayment` (401–508)
- Modify: `packages/ee/src/accounting/providers/rillet/models.ts` — the payment payload/response schema, next to `ReimbursementSchema` (372–394)
- Modify: `packages/ee/src/accounting/core/posting.ts` — the `JOURNAL_ENTRY_SYNC_ERROR_CODES` comment at 599–603
- Modify: `packages/ee/src/accounting/providers/rillet/entities/__tests__/payment-push.test.ts`
- Copy from (precedent): `provider.ts` `createBillPayment` (the sibling of
  `createInvoicePayment`), and `payment.ts:469-508` (the payload +
  `buildRilletIdempotencyKey` + composite entity id)

**Steps:**

1. `provider.ts` — add
   `createReimbursementPayment(reimbursementId, payment, idempotencyKey)` →
   `POST /reimbursements/{id}/payments`, body `{ amount, date, account_code }`,
   with the same envelope/idempotency handling as `createBillPayment`. The
   endpoint was confirmed in the 2026-09-23 API survey.
2. `payment.ts` — delete the `UNSUPPORTED_REIMBURSEMENT_PAYMENT` throw (434–456)
   and replace it with a real branch: when the settled document is a
   **reimbursement** (its mapping entity type is `"reimbursement"`, resolved the
   same way the AR/AP arms resolve `"invoice"`/`"bill"` at 419–430), call
   `createReimbursementPayment` with the payload shape used at 469–486 and an
   idempotency key of
   `{ operation: "create reimbursement payment", localId: \`${carbonPaymentId}:${targetDocumentId}\` }`.
   Keep the `UNSYNCED_DOCUMENT` Warning for an unsynced reimbursement and the
   `UNMAPPED_ACCOUNTS` Warning for an unmapped bank account — both still apply.
3. `posting.ts` — `UNSUPPORTED_REIMBURSEMENT_PAYMENT` stays in the union (older
   operation rows still carry it), but rewrite its comment to say the code is
   **retired for new runs** as of this change and is kept only so historical
   failure rows still render. Do not remove the member.
4. Tests in `payment-push.test.ts`: a reimbursement payout POSTs to
   `/reimbursements/{id}/payments` and the operation closes `Completed` (spec
   AC — explicitly **not** `UNSUPPORTED_REIMBURSEMENT_PAYMENT`); an unsynced
   reimbursement still returns `UNSYNCED_DOCUMENT`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee && pnpm --filter @carbon/ee test -- payment-push payment && git status --short packages/database/
```
```
# Expected: typecheck exits 0; payment-push and payment tests pass, including
# the new Completed assertion; no test still asserts
# UNSUPPORTED_REIMBURSEMENT_PAYMENT for a NEW reimbursement payout.
# git status prints nothing for packages/database/.
```

**Out of scope:** The spec's risk row says this endpoint is "documented but
unexercised by Carbon" and must be **probed on the Rillet sandbox before
shipping**. That needs live credentials and is a human gate — recorded in Task
30; do not fake it with a mock and call it verified.

---

## Task 27: QBO `ReimbursementSyncer`

**Depends on:** Task 24

**Files:**
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/reimbursement.ts`
- Create: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/reimbursement.test.ts`
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/index.ts` — import (line 4-area), re-export (14-area), registry key (37–48)
- Copy from (precedent): `packages/ee/src/accounting/providers/quickbooks-online/entities/charge.ts`
  (591 lines — `QboChargeSyncer` at 209, `mapChargeToQboPurchase` at 121–207)
- Copy from (precedent): `providers/quickbooks-online/entities/bill.ts` — the `Bill` payload shape

**Steps:**

1. QBO has no native reimbursement object, so a reimbursement is pushed as a
   **`Bill` against an employee Vendor** (the spec's provider table; SAP and
   D365 do the same). The employee→vendor resolution stays provider-side: reuse
   the mapping-first lookup on the `vendor` entity type, creating the QBO Vendor
   JIT if absent — mirror how `QboChargeSyncer` JIT-syncs its merchant vendor.
   This is the one place `resolveEmployeeSupplier`'s naming convention survives.
2. `mapReimbursementToQboBill(...)` — a pure exported mapper: one `Line` per
   `reimbursementLine` with `AccountBasedExpenseLineDetail.AccountRef` = the
   mapped QBO account, `TxnDate` = `reimbursementDate`, `VendorRef` = the
   employee vendor, `APAccountRef` = the QBO account mapped from the
   reimbursement's stored `payableAccountId` (so the segregated control account
   survives into QBO), `DocNumber` = `reimbursementId`.
3. Extend the `ChargeSyncerBase` lifecycle: `upsertRemote` → create/update Bill;
   `deleteRemote` → the provider's bill delete. Read `QboChargeSyncer`'s
   `updateMappedCharges` comment at `charge.ts:214` before deciding whether the
   same flag applies.
4. Register `reimbursement: QboReimbursementSyncer` in `qboSyncerRegistry`.
5. Tests: the mapper's output for the spec's two-line case (a `Bill` against the
   employee vendor with two account-based lines and the segregated
   `APAccountRef`); an unmapped account → `UNMAPPED_ACCOUNTS`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee && pnpm --filter @carbon/ee test -- quickbooks && git status --short packages/database/
```
```
# Expected: typecheck exits 0; the QBO test suite passes including the new
# reimbursement cases. git status prints nothing for packages/database/.
```

**Out of scope:** No QBO `BillPayment` push in this task — the existing
`PaymentSyncer` AP arm already handles a Bill target once the mapping exists;
verify that, do not extend it. Do not touch Rillet or Xero.

---

## Task 28: Xero `ReimbursementSyncer`

**Depends on:** Task 24

**Files:**
- Create: `packages/ee/src/accounting/providers/xero/entities/reimbursement.ts`
- Create: `packages/ee/src/accounting/providers/xero/entities/__tests__/reimbursement.test.ts`
- Modify: `packages/ee/src/accounting/providers/xero/index.ts` — import (line 4-area), re-export (15-area), registry key (37–51)
- Copy from (precedent): `packages/ee/src/accounting/providers/xero/entities/charge.ts`
  (693 lines — `XeroChargeSyncer` at 218, `mapChargeToXeroBankTransaction` at 151–216)
- Copy from (precedent): `providers/xero/entities/bill.ts` — the `ACCPAY` invoice shape; `ContactSyncer` for the employee Contact

**Steps:**

1. Xero has no reimbursement object either: push an **`ACCPAY` invoice against
   an employee Contact**, resolved through the existing `vendor` mapping (Xero's
   `ContactSyncer` backs both `customer` and `vendor`).
2. `mapReimbursementToXeroInvoice(...)` — a pure exported mapper:
   `Type: "ACCPAY"`, `Contact` = the employee contact, `Date` =
   `reimbursementDate`, `InvoiceNumber` = `reimbursementId`, one `LineItem` per
   reimbursement line with `AccountCode` = the mapped Xero code, `Tracking` for
   cost center / project, `Status: "AUTHORISED"`. Use the adapter's named
   contract constants in
   `packages/ee/src/accounting/providers/xero/serialize.ts` for any external
   rounding — **never a scale literal**.
3. Register `reimbursement: XeroReimbursementSyncer` in `xeroSyncerRegistry`.
4. Tests mirroring Task 27's.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee && pnpm --filter @carbon/ee test -- xero && git status --short packages/database/
```
```
# Expected: typecheck exits 0; the Xero test suite passes including the new
# reimbursement cases. git status prints nothing for packages/database/.
```

**Out of scope:** Do not attach remote files (the rule notes the Xero and QBO
charge adapters do not attach them today either). Do not touch Rillet or QBO.

---

## Task 29: Full validation gate

**Depends on:** Tasks 1–28

**Files:**
- Modify (documentation sync):
  - `.claude/rules/accounting-sync-handlers.md` — the `AccountingEntityType`
    list at line 27, the note at line 20 that `employee` is not implemented
    (still true, but say `reimbursement` now is), and a new `reimbursement`
    section modelled on "Card charges as provider objects" (297+)
  - `.claude/rules/ramp-integration.md` — the sync-loop table row at line 284
    (`ramp-reimbursements` now becomes a **Draft** `reimbursement`, not a
    `purchaseInvoice (Employee supplier)`), the syncer description at 300–302,
    the `resolveEmployeeSupplier` note at 402, **the fact that the
    reimbursement family no longer auto-posts**, and **the fact that the sync
    creates but never re-writes an existing document** (with the accepted cost:
    a provider-side correction after import does not flow through)
  - `packages/ee/src/accounting/AGENTS.md` and
    `apps/erp/app/modules/invoicing/AGENTS.md` (if present) — the new tables,
    service functions and entity type
  - `.ai/specs/2026-09-23-reimbursements-first-class.md` — changelog entry, and
    **correct the `ramp-sync-reimbursement.ts` path** (it is in `@carbon/jobs`,
    not `packages/ee/src/ramp/`)

**Steps:**

1. Run, in order, fixing every failure before moving on:
   ```bash
   pnpm exec biome check --write apps/erp packages/ee packages/jobs
   pnpm exec turbo run typecheck --filter=erp
   pnpm exec turbo run typecheck --filter=@carbon/ee
   pnpm exec turbo run typecheck --filter=@carbon/jobs
   pnpm run test
   cd packages/database/supabase/functions && deno test --no-lock --no-check && cd -
   pnpm db:migrate
   pnpm db:check:datasets
   pnpm db:check:backups
   ```
   `pnpm db:migrate` must run BEFORE the two `db:check:*` commands — they read
   the live local schema, and a stale database fails them for the wrong reason.
2. After the turbo runs, `git status --short packages/database/`. The ONLY
   `packages/database/` changes that may remain are the new migration file, the
   `seed.data.ts` edit, the `config.toml` edit, the `post-reimbursement/`
   directory, the `post-payment`/`shared` edits, and the Task 2 generated types.
   Revert anything else.
3. Run `/translate` to fill any new empty `msgstr` entries in
   `packages/locale/locales/*/*.po` introduced by the new UI strings — Phase D
   adds a lot of them.
4. Update the documentation files above. A rule that still says a Ramp
   reimbursement becomes a purchase invoice, or that the family auto-posts, is
   stale the moment this lands.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs && pnpm run test && pnpm db:check:datasets && pnpm db:check:backups && git status --short packages/database/
```
```
# Expected: every typecheck exits 0; `pnpm run test` reports 0 failed across
# all packages; db:check:datasets prints a pass for all four datasets;
# db:check:backups gives a verdict of pass (and, from the pre-commit hook, will
# regenerate and stage packages/jobs/manifests/schema.json — that staged file
# is EXPECTED churn, unlike the generated types).
# git status --short packages/database/ lists ONLY the intended files above.
```

**Out of scope:** Do not run a whole-repo `tsc --noEmit` or `pnpm typecheck` —
it OOMs. Do not commit unless the user asks.

---

## Task 30: Browser verification via `/test`

**Depends on:** Task 29

**Files:**
- Read only. The stack is already running (`crbn up`) at
  `https://erp.rillet-ramp-accounting-provider.dev`.

**Steps:**

1. Invoke the `/test` skill (it calls `/auth` first for the DEV_BYPASS_EMAIL
   session, then drives the app with `agent-browser`). Base URL:
   `https://erp.rillet-ramp-accounting-provider.dev`.
2. Enable accounting for the dev company if it is off
   (`/x/settings/accounting`) — otherwise `post-reimbursement` skips journal
   creation and the posting criteria cannot be observed.
3. **Seeding the fixture.** There is no create form, so a Draft reimbursement
   must come from the Ramp sync (credential-gated) or a SQL fixture. Insert one
   directly against the local database:
   - one `reimbursement` row: `status 'Draft'`, `integration 'ramp'`, a real
     `employeeId` from `employee`, `amount 620`, base currency,
     `createdBy 'system'` (there is **no** `importedAt` column);
   - two `reimbursementLine` rows: 500 to a travel expense account and 120 to a
     meals expense account, `sequence` 0 and 1;
   - one `externalIntegrationMapping` row: `integration 'ramp'`,
     `entityType 'reimbursement'`, `entityId` = the reimbursement id,
     `externalId` = a fake Ramp id.
   Use real account ids from the company's chart — `.ai/lessons.md` warns that
   hand-built SQL fixtures which skip a companion row produce 404s in the UI.
4. Walk this script, capturing a screenshot at each numbered step:
   1. **Nav** — open `/x/invoicing`. A `Reimbursements` entry appears in the
      **Accounts Payable** group, immediately after `Charges`. Click it; the
      list loads and the seeded row shows as **Draft**.
   2. **SOURCE badge** — open the row. The detail page shows a SOURCE field with
      the **Ramp logo**, the name "Ramp", and the external id. There is
      deliberately **no Activity/timeline rail** — confirm none is rendered.
   3. **Edit header** — click Edit. Change the reference and save. The value
      persists.
   4. **Edit a line** — change line 1's account and description, then open the
      expanded row and set two **dimensions** through the `DimensionSelector`
      (pick a Cost Center and one other configured type). Save. Every change
      persists, and read mode renders the dimensions as coloured badges with
      NAMES, not ids.
   5. **Add a line + running total** — `+ Add line item`, type an amount, and
      confirm the running total in the page header updates as you type; the
      badge flips to **Unbalanced** because the lines no longer sum to 620.
      Remove the line and confirm it returns to **Balanced**.
   6. **Totals guard** — deliberately leave the lines unbalanced and click Post.
      It is refused with a clear message and **no journal is created** (check
      `/x/accounting/journal-entries`).
   7. **Post** — restore balance, Post. Status flips to `Posted`; the Journal
      link resolves; the journal debits 500 and 120 to the line accounts and
      credits 620 to the employee-payable account; `totalDebits == totalCredits`;
      each line's `journalLineDimension` carries its cost center / project.
   8. **Posted is not editable** — the Edit control is absent, and navigating
      directly to `/x/reimbursements/<id>/edit` redirects back with a message.
   9. **AP fallback** — clear `Employee Reimbursements Payable` at
      `/x/accounting/defaults`, seed and post a second reimbursement, and
      confirm the credit lands on the **Payables** trade account. Restore the
      default.
   10. **Void** — Void the posted reimbursement. Status `Voided`, a second
       Posted journal exists whose lines are the exact negation. Submit Void
       again and confirm no third journal is created.
   11. **Edits survive a re-sync** (spec's new criterion). This needs the Ramp
       sandbox, so if credentials are absent record it NOT VERIFIED here and
       rely on Task 23's unit test, which proves the same invariant. With
       credentials: edit a Draft's lines, re-run the Ramp sync, and assert the
       edits are intact and no line id changed.
   12. **Pay expense** — on the posted reimbursement, open **Pay expense**.
       The modal shows Total Due and exactly three fields (Amount defaulted to
       the balance, Date, Account). Enter a PARTIAL amount and submit; the
       payment posts and the reimbursement shows a remaining balance. Pay the
       remainder and confirm it settles fully.
   13. **Not in Purchase Invoices** — open `/x/invoicing/purchasing` and confirm
       the reimbursements do NOT appear.
   14. **Not in AP aging** — open the supplier/AP aging report and confirm no
       employee-named supplier was created and the amounts are absent.
   15. **Legacy rows intact** — open a pre-existing employee-supplier purchase
       invoice, if the dev company has one, and confirm it still loads with its
       Post action intact.
5. Record every screenshot path and the pass/fail per acceptance criterion.
6. **Credential-gated — report as explicitly NOT verified rather than claiming
   them:**
   - the Ramp inbound criterion (a real Ramp reimbursement landing Draft with no
     synthetic supplier) — needs Ramp sandbox credentials;
   - the Rillet criteria (`/reimbursements` record, and
     `POST /reimbursements/{id}/payments` closing `Completed`) — needs Rillet
     sandbox credentials, and the spec's risk row requires a live probe of the
     payments endpoint before shipping;
   - the QBO criterion (a `Bill` against the employee vendor) — needs QBO
     sandbox credentials.

**Verify:**
```bash
# The /test skill's own report is the verification artifact. It must state,
# per acceptance criterion, PASS with a screenshot path or NOT VERIFIED with
# the reason.
```
```
# Expected: the posting, fallback, dimension, void, edit, add-line, totals-guard,
# posted-immutability, SOURCE-badge, Pay-expense, nav,
# purchase-invoice-separation, AP-aging and legacy-rows criteria all PASS with
# screenshots. The Ramp inbound, edits-survive-re-sync, Rillet and QBO criteria
# are reported NOT VERIFIED (credential gate) — with the note that
# edits-survive-re-sync IS proven by Task 23's unit test. The toolchain
# criterion was covered by Task 29.
```

**Out of scope:** Do not modify code from this task — a failure here means
returning to the owning task. Do not commit; do not open a PR unless asked.

---

## Acceptance-criteria coverage

Re-checked against both specs at commit `595e0ba188`. Every criterion in scope
maps to at least one task.

### `.ai/specs/2026-09-23-reimbursements-first-class.md`

| Criterion | Tasks |
|---|---|
| Two lines (500 + 120) post to ONE journal; 620 credited to employee-payable; `Posted` + `journalId` | 1, 2, 8, 9, 10, 18, **30 (step 7)** |
| Control account unset → AP trade fallback, still balances | 1(f), 3, 7, 8, 9, 10, **30 (step 9)** |
| `costCenterId` writes `journalLineDimension`; no active dimension refuses | 9, 10, 13, **30 (steps 4, 7)** |
| Void writes a balanced reversal → `Voided`; re-void returns the stored id | 9, 10, 18, **30 (step 10)** |
| Ramp reimbursement syncs as a `reimbursement`, no synthetic supplier, **lands Draft** | 23, 30 (credential-gated) |
| Detail shows SOURCE: Ramp logo + name + external id | 12, 16, 23, **30 (step 2)** |
| **Editing a Draft's lines then re-running the Ramp sync leaves the edits intact** *(new)* | **23 (step 1 + its re-sync test)**, 30 (step 11, credential-gated) |
| A Draft can be edited: header, a line's account/amount/description/cost centre/project, `+ Add line item`, running total | 4, 5, 6, 11, 13, 17, **30 (steps 3–5)** |
| A **Posted** reimbursement is not editable | 1(d) trigger, 1(e) RLS, 17 `requireUnlocked`, **30 (step 8)** |
| **Pay expense** modal — amount (editable, partial allowed) / date / account | 1(g), 1(h), 20, 21, **22 (step 0)**, **30 (step 12)** |
| Rillet `/reimbursements` + `POST /reimbursements/{id}/payments` closes `Completed` | 22 (step 0), 25, 26, 30 (credential-gated) |
| QBO creates a `Bill` against the employee vendor | 27, 30 (credential-gated) |
| `Reimbursements` under Accounts Payable, opens the list | 15, 16, 19, **30 (step 1)** |
| No longer in the Purchase Invoices list | 23, **30 (step 13)** — see caveat below |
| Absent from supplier/AP aging | 1, 23, **30 (step 14)** |
| Existing employee-supplier purchase invoices still load and post | 23 (out-of-scope guard), **30 (step 15)** |
| `generate:types`, scoped typechecks, `pnpm run test`, `db:check:*` green | 2, 29 |

*Removed with the spec:* the "Activity entry — Reimbursement imported from Ramp"
criterion. No task covers it because the surface no longer exists.

### `.ai/specs/2026-09-23-editable-imported-spend-documents.md` — the shared shape, as it applies to reimbursements

| Criterion | Tasks |
|---|---|
| Import lands Draft, not Posted | 23, **30 (step 1)** |
| SOURCE field with logo + name + external id | 12, 16, **30 (step 2)** |
| **After a human edits a Draft's lines, re-running the sync leaves them intact** *(new)* | **23 (step 1 + its re-sync test)**, 30 (step 11) |
| Edit mode changes header + a line's account, amount and description; Save persists | 5, 6, 13, 17, **30 (steps 3–4)** |
| **The line editor renders the company's configured dimensions through the existing `DimensionSelector`** | 1(b) `reimbursementLineDimension`, 4, 6, **11**, **13**, 17, **30 (step 4)** |
| `+ Add line item`; running total updates on type and on remove | 13, 17, **30 (step 5)** |
| Post refused, before any edge-function call, while unbalanced | 17, 18, **30 (step 6)** |
| Posting writes `journalLineDimension` per line and flips to Posted | 9 (unions both sources), 10, **30 (step 7)** |
| Posted is not editable — controls absent AND a direct action refused | 1(d), 1(e), 17, **30 (step 8)** |
| Browser-verified end to end: import → edit → add line → post | **30** |

*Removed with the spec:* the Activity-entry criterion.

**The same spec's CHARGE criteria are not covered here** — see Coordination
below.

## Coordination with the sibling spec

`.ai/specs/2026-09-23-editable-imported-spend-documents.md` has no plan of its
own yet. This plan builds the two shared components it needs
(`DocumentSourceBadge`, Task 12; `DocumentLineEditor`, Task 13) as
document-agnostic components in `apps/erp/app/components/`, so the charge work
can consume them without modification. **Three pieces of that spec are
deliberately NOT in this plan and will go unimplemented unless separately
planned:**

1. `ramp-sync-card.ts` must stop invoking `post-charge` so charges land Draft
   (that spec's first acceptance criterion).
2. `charges.$id.tsx` must move from the read-only Drawer to a read/edit full
   page using the two shared components, and gain a Post action.
3. `invoicing.service.ts` needs `updateCharge` + `upsertChargeLines`, with the
   same `.server` Kysely handoff Task 6 establishes.

Flag this when handing the plan over.

---

## Where the specs were too thin to plan from

**Resolved since the first draft** (spec commits `f821ddf9c2`, `595e0ba188`) —
listed so nobody re-opens them:

- ~~The payout has no payee~~ → **approved**: `payment.employeeId`, CHECK widened
  to customer XOR supplier XOR employee, employee arm through `post-payment` /
  `build-payment-journal` / `payment-funding`. Tasks 1(h), 20, 21, 22. The
  migration is additive and idempotent, and Task 1(h) argues explicitly why the
  widened CHECK cannot reject an existing row (it is strictly weaker on the
  existing column pair).
- ~~Ramp-paid vs Draft~~ → **approved as proposed**: confirm at import, record
  the payout at Post, because the editable window is for coding rather than for
  deciding whether the employee was paid. Task 23 step 5, Task 18.
- ~~Re-syncing a Draft overwrites human edits~~ → **resolved**: the sync creates
  and never re-writes. Task 23 step 1, with a re-sync test in its Verify.
- ~~The Activity entry has no table~~ → **resolved by dropping the feature**.
  The `importedAt` column, the Activity component and the related criteria are
  all removed; the SOURCE badge carries provenance. Tasks 1, 16, 30.
- ~~The Project picker does not exist~~ → **moot**: `DimensionSelector` already
  covers Project and CostCenter as dimension entity types, so no picker is
  built. Task 11 became dimension data plumbing instead.
- ~~The `dimension` FK shape is unverified~~ → **resolved from precedent**:
  `reimbursementLineDimension` mirrors `journalLineDimension`
  (`20260228024512_dimensions.sql:116-138`) — single-column PK `("id")`,
  single-column FK to `dimension("id")`, plain `companyId` FK, `valueId`
  deliberately NOT a foreign key (polymorphic across Custom and entity-typed
  dimensions), `UNIQUE (reimbursementLineId, dimensionId)`, and no
  `createdBy`/`updatedBy`. Task 1(b) builds it outright; the STOP is gone.
- ~~Which dimension source wins at posting~~ → **confirmed**: the generic table
  beats the legacy columns, because the columns are what the sync wrote and the
  table is where a human's edit lands. Task 9 carries that rationale in the code
  comment; Task 10 pins it with a test.

**Still open — flag these before or during execution:**

1. **`DimensionSelector.journalLineId` is a misnamed prop.** The editor passes a
   reimbursement line's client key into a prop named for journal lines. With
   `autoSave={false}` it should only be an identity, but Task 13 requires
   reading the component body to confirm before relying on it, and STOPs if the
   prop reaches a fetcher. The spec says "reuse it" without noting the prop
   mismatch.

2. **The editor does not write the legacy columns.** The shared spec's line
   table lists only Account / Amount / Description / Dimensions, so a reviewer
   cannot change an imported `costCenterId` directly — only add a Cost Center
   *dimension* that then wins at posting. That is coherent but surprising, and
   the reimbursements spec's own criterion still says "cost centre/project" are
   editable. Task 13 threads the legacy values through read-only so a round-trip
   cannot drop them.

3. **"No longer appears in the Purchase Invoices list" is only true for new
   rows.** The spec also resolves "no backfill", so existing employee-supplier
   purchase invoices deliberately remain there. Task 30 steps 13 and 15 test
   both halves; the spec should say so.

4. **The two-mode detail surface has no exact precedent.** The ERP has the
   three-pane `PanelProvider` document (purchase invoice, quote) and the plain
   centred single-card page (journal entry). The spec's description matches the
   journal entry, which is also the ERP's only hidden-JSON-field editable line
   list, so the plan uses it — but neither spec says which.

5. **No reusable integration-logo component exists.** The shared spec says the
   logo "comes from the integration registry … so a new provider gets its badge
   with no extra work", but today it is only rendered inline in settings and the
   only existing source badge (`PurchaseInvoiceHeader.tsx:334-345`) is
   text-only. Task 12 builds the reusable one and fixes Ramp's `Logo`, which
   hard-codes `height: "1.25rem"` ahead of `...props.style` so a caller cannot
   size it.

6. **`reimbursementStatus` is referenced by the spec's DDL but never declared.**
   Task 1(a) declares it.

7. **The spec's DDL omits every lifecycle guard the `charge` precedent has** —
   the Draft-only mutation trigger, the line-parent lock, the company-group
   account guards, the lifecycle audit CHECK. Task 1(d) clones all four. Under
   the editable model these are load-bearing: they are what the shared spec
   means by "the lifecycle trigger is the backstop".

8. **`currencyCode` is bare TEXT in the spec's DDL**; the precedent references
    `"currencyCode"(code)`. Task 1(b) adds the FK.

9. **No sequence is mentioned outside a SQL comment.** `REIMB-%{yyyy}-%{mm}-`
    needs a `sequence` row per existing company (migration) and an entry in
    `seed.data.ts` for new ones. Tasks 1(i) and 3.

10. **The outbound-sync plumbing is one sentence** ("syncers for the three
    providers"). It is thirteen files — Task 24 enumerates them.

11. **`backingEntityType: "reimbursement"` is not a legal value today.** Both
    the union in `PostingPolicyEntry` and the ternary chain in
    `decideDocumentFamily` need widening; missing the second silently
    double-posts. Task 24 steps 2 and 3.

12. **Xero has no acceptance criterion** although it is in the provider table.
    Task 28 builds it; its own tests are the only contract.

13. **The Rillet payments endpoint is unproven against the live sandbox.** The
    spec's risk row demands a probe before shipping — credentials required, so
    Tasks 26 and 30 mark it a human gate rather than treating a mock as proof.
