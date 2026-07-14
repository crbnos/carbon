# Intercompany Maturity — Tolerance Matching, FX Differences, Document Mirroring, Netting

> Status: in-progress
> Author: Claude (with Brad)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1058
> Readiness finding: SD-5.4–.5 remainder (`.ai/specs/2026-07-03-public-company-readiness.md`, Phase 4)

## TLDR

Carbon's intercompany skeleton is real and load-bearing — `journalLine.intercompanyPartnerId`, the `intercompanyTransaction` ledger, auto-synced IC customer/supplier records, elimination entities, and the `matchIntercompanyTransactions` / `generateEliminationEntries` / `getIntercompanyBalance` RPCs (`20260403120000_intercompany-tracking.sql`). But matching is exact-amount only, FX rate differences between the two sides make pairs permanently unmatchable, IC trade requires double data entry (a PO in one company and a hand-keyed SO in the other), and gross IC AR/AP balances can only be relieved by fake cash payments. This spec adds the four maturity layers the research consensus names (SAP trading-partner/ICMR, NetSuite IC framework — `.ai/research/public-company-compliance.md` §Pattern 6): **(1)** tolerance-based matching configurable per company group (default 1.00 base-currency units) with the difference plugged to a dedicated IC difference account, **(2)** document-currency matching for FX-rate mismatches with the base-currency delta posted to the same account, **(3)** opt-in IC document mirroring (PO→SO on release, invoice mirroring at posting; one-way sync, linked statuses, surfaced failures), and **(4)** a netting workbench that turns the existing balance matrix into per-pair netting statements generating paired zero-cash settlement payments riding the existing `payment`/`invoiceSettlement` machinery. Ownership %/NCI stays explicitly deferred per the readiness resolution.

## Problem Statement

Concretely, today:

1. **Exact-amount matching only.** `matchIntercompanyTransactions` joins on `src."amount" = tgt."amount"`. A one-cent rounding difference between the seller's invoice and the buyer's voucher leaves both rows `Unmatched` forever, and close-checklist task 5 (`unmatched-ic`, seeded Warning in the period-closing spec) nags every period with noise no one can clear.
2. **FX kills matching structurally.** `intercompanyTransaction.amount` is the source company's base-currency amount. When the two sides book the same 1,000 EUR invoice at 1.08 and 1.10, base amounts differ by 20.00 and can never match — there is no document-currency amount on the row to match on, and no account to absorb the difference.
3. **Double entry for IC trade.** The IC customer/supplier records are auto-synced, but a PO raised on an IC supplier requires someone in the partner company to re-key the same lines as an SO (and later re-key the invoice). Quantities and prices drift, which is where unmatchable IC balances come from in the first place.
4. **No netting.** `getIntercompanyBalance` renders the gross matrix, but relieving mutual AR/AP requires posting fictitious bank payments in both companies — wrong cash, wrong audit trail.
5. **No ownership %.** Consolidation is 100%-summation. Per the readiness resolution this is *deferred*, not in scope here — restated below so it isn't re-litigated.

## Proposed Solution

Four workstreams, each independently shippable, all riding existing machinery.

### 1. Tolerance matching

- `companyGroup.intercompanyMatchingTolerance NUMERIC NOT NULL DEFAULT 1` — base-currency units, editable from the existing group management UI (the `companyGroup` table stays service-role-only at the RLS layer, as today).
- `matchIntercompanyTransactions` becomes a three-pass matcher (same signature, same permission preamble):
  - **Pass 1 — exact (unchanged):** base amounts equal → `Matched`, difference 0.
  - **Pass 2 — FX (see §2):** document-currency amounts equal, base amounts differ → `Matched`, `differenceKind = 'FX'`.
  - **Pass 3 — tolerance:** `ABS(src.amount − tgt.amount) <= tolerance`, greedy closest-first (`ORDER BY ABS(difference) ASC, src.id, tgt.id` for determinism), only when both companies share the same base currency (cross-currency pairs must match via pass 2 — base amounts in different currencies are not comparable) → `Matched`, `differenceKind = 'Tolerance'`, `matchedDifference` recorded.
- **Posting the difference.** `generateEliminationEntries` already reverses both sides into the elimination entity's journal; with a near-match that journal no longer sums to zero. Add a balancing plug line to the new `accountDefault.intercompanyDifferenceAccount` (resolved **by id** from the elimination entity's `accountDefault`, per `.ai/lessons.md` "Never resolve a control account by number/name"). Subsidiary books are untouched — the difference is a consolidation-level plug, matching the ICMR pattern.

### 2. FX differences on IC pairs

- `intercompanyTransaction` gains `documentAmount NUMERIC` (nullable; document-currency amount — `currencyCode` already holds the document currency). Every posting path that inserts `intercompanyTransaction` rows starts populating it; legacy NULL rows are skipped by pass 2.
- **Computation.** For a pair on document amount `D` booked at rates `r_s`, `r_t`: source base `b_s = D × r_s`, target base `b_t = D × r_t`. Same-base-currency pair: FX difference `Δ = b_s − b_t`. Different base currencies: each side's reversal lines are translated to the elimination entity's currency at the group closing rate (the same `exchangeRateHistory` closing rates `translateTrialBalance` uses); `Δ` is the residual of the elimination journal after translation. Either way `Δ` posts to `intercompanyDifferenceAccount` as the journal's balancing line, description `IC FX difference: {ict.id}`.
- Pass 2 has **no tolerance cap** — the document amounts agree exactly; rate variance is legitimate and can exceed the tolerance. `differenceKind` distinguishes `'FX'` from `'Tolerance'` for reporting.

### 3. IC document mirroring (opt-in)

- `companyGroup.intercompanyDocumentMirroring BOOLEAN NOT NULL DEFAULT false`.
- **PO → SO:** when a purchase order on a supplier with `intercompanyCompanyId` set leaves `Draft` (release: status → `'To Review'`/`'To Receive*'`), and the group setting is on, an event fires (event system → Inngest job in `@carbon/jobs`, service-role — the write crosses a company boundary and must not depend on the releasing user's membership in the partner company). The job drafts a `salesOrder` in the partner company for the auto-synced IC customer, copying lines (item, quantity, unit price, promised date), and records an `intercompanyDocumentLink` row.
- **Line identity:** items are matched in the partner company by `readableIdWithRevision`. Any unmatched item fails the whole mirror (no partial documents): link `status = 'Failed'` with `failureReason`, notification to the partner company's sales/accounting owners, row surfaced in the Mirroring exceptions panel. (Open question 5 below.)
- **One-way sync, linked statuses:** the initiating PO is the source of truth for quantities/prices. While the mirrored SO is `Draft`/`Confirmed`, PO line edits re-sync it (`lastSyncedAt` updated). Once the SO is `In Progress` or beyond, a PO edit no longer syncs — it flips the link to `'Exception'` with the diff in `failureReason` for humans to reconcile. PO cancellation cancels a `Draft`/`Confirmed` SO; otherwise it raises an exception. Mirrored documents carry the link and are never themselves mirror *initiators* (loop guard).
- **Invoice mirroring at posting:** when the seller posts the sales invoice against the mirrored SO (or any sales invoice to an IC customer, if the setting is on), the job drafts the matching purchase invoice in the buyer company, linked the same way. The mirrored invoice stays **Draft** — the receiving company reviews and posts under its own controls (approvals, period status); mirroring never auto-posts.

### 4. Netting workbench

- **Matrix → statement:** the workbench renders `getIntercompanyBalance` per group. For a company pair, "Create netting statement" snapshots the pair's open IC invoices (posted, unpaid, counterparty is the IC customer/supplier) into `intercompanyNettingStatement` + lines. Net amount = min(gross A→B, gross B→A); the residual stays open for real cash settlement.
- **Settle → paired payments:** settling an `Agreed` statement generates up to four `payment` documents through the existing posting machinery — in each company, a `Receipt` from the IC customer applying its AR invoices and a `Disbursement` to the IC supplier applying its AP invoices, each for the netted amount, each with `bankAccount = accountDefault.intercompanyNettingAccount` (a clearing account — `payment.bankAccount` references `account(id)`, so no schema bend). Within each company the clearing account debits and credits offset to exactly zero: **zero cash movement**, and `invoiceSettlement` rows close the invoices normally. `payment.totalAmount = 0` credit-application shortcut is *not* used — the paired gross payments keep each invoice's settlement trail ordinary and auditable.
- **Audit trail:** statement → lines → `payment.nettingStatementId` back-reference; statement carries `proposedBy/agreedBy/settledBy` + timestamps; status machine `Draft → Proposed → Agreed → Settled` (or `Cancelled` before settlement). Voiding any generated payment (existing void flow) flips the statement to `Exception`.
- The netting-generated journal lines carry `intercompanyPartnerId` like any IC posting, so they flow into `intercompanyTransaction` and match under passes 1–3 — netting *feeds* the existing matching control rather than bypassing it.

### 5. NCI / ownership % — deferred

Per the readiness resolution (SD-5.5): consolidation remains 100%-summation. No `ownershipPercent` column, no NCI equity accounts, no goodwill computation in this spec. NetSuite also does 100% summation; sub-100% subsidiaries are SAP-tier and wait for a real customer need.

### 6. Close integration

**No new close task.** Reasoning: the control the close needs is "IC positions are matched and eliminable," which seeded task 5 (`unmatched-ic`, Warning) already evaluates — and this spec makes it *passable* by clearing tolerance/FX noise. Netting is cash-management hygiene, not a close control: unsettled gross IC balances eliminate correctly regardless of netting, and netting-generated settlements land in `intercompanyTransaction` where task 5 already looks. Registering a "run netting" task would gate the close on an optional treasury activity. Instead, task 5's drill-through page links to both the matching page and the netting workbench.

### Design Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Tolerance scope | Per company group (`companyGroup` column), default 1.00 base-currency units | RESOLVED with user. Group is where matching runs; per-pair tolerance is config sprawl (lesson: no N×M config matrices) |
| 2 | Where the difference posts | Balancing plug in the elimination entity's journal, to `accountDefault.intercompanyDifferenceAccount` resolved by id | Subsidiary books stay untouched; one plug per elimination journal; obeys the control-account-by-id lesson |
| 3 | FX matching key | Document-currency amount (`documentAmount` + `currencyCode`), no tolerance cap on the base delta | Doc amounts agreeing exactly proves same economic transaction; rate variance is legitimate FX, not error |
| 4 | Cross-base-currency tolerance | Pass 3 restricted to same-base-currency pairs | Base amounts in different currencies aren't comparable; cross-currency pairs match on document currency (pass 2) |
| 5 | Mirroring transport | Event-system trigger → Inngest job (service role), never a synchronous DB trigger | Cross-company writes need service role + item mapping + retry + failure surfacing; sync triggers would couple PO release latency to partner-company state |
| 6 | Mirrored documents auto-post? | Never — always Draft in the receiving company | Receiving company's approvals/period gates must apply; auto-posting would bypass MW-2 controls |
| 7 | Netting settlement shape | Paired gross `payment` docs through an IC netting clearing account, existing posting + `invoiceSettlement` | RESOLVED in scope. NetSuite netting-workbench pattern; zero new posting machinery; clearing nets to zero per company |
| 8 | NCI / ownership % | Deferred | Readiness resolution SD-5.5; restated to prevent scope creep |
| 9 | Close checklist | No new task; task 5 drill-through links matching + netting | Netting is optional treasury hygiene; the matched-IC control already exists and this spec makes it clearable |
| 10 | Multi-tenancy (heuristic 1) | New group-level tables follow the `intercompanyTransaction` precedent: single-column PK, `companyGroupId` + explicit company columns, audit columns | Cross-company rows can't carry one `companyId`; precedent already reviewed and shipped |
| 11 | Service shape (heuristic 2) | All new functions in `accounting.service.ts` / `accounting.models.ts`, `(client, companyGroupId, ...)` → `{data, error}` | Intercompany is accounting-owned; one service file per module |
| 12 | RLS (heuristic 3) | Four policies per table gated on `get_companies_with_employee_permission('accounting_*')` against source **or** target company, matching `intercompanyTransaction` | Same visibility rule as the existing IC table; either side's accountants may view/manage |
| 13 | Permission scoping (heuristic 4) | Routes `view/update: "accounting"`; mirroring job runs service-role; settle requires `accounting_update` in *both* companies (checked in RPC preamble) | Settlement writes both companies' books; one-sided permission would let A close B's AR |
| 14 | Form pattern (heuristic 5) | `ValidatedForm` + zod (`nettingStatementValidator`, `icToleranceValidator`); Drawer overlays for statement detail | House convention |
| 15 | Module layout (heuristic 6) | No new module; accounting module, `ui/Intercompany/` components, routes under `x+/accounting+/intercompany-*` | Extends the existing intercompany surface |
| 16 | Backward compatibility (heuristic 7) | All new columns nullable or defaulted to current behavior (`tolerance` default keeps near-matches auto-matching only after upgrade; mirroring default **off**); pass 1 unchanged; legacy rows without `documentAmount` skip pass 2 | Groups that do nothing see exact matching exactly as today, plus tolerance ≤ 1.00 |

## Data Model Changes

```sql
-- 1) Group settings
ALTER TABLE "companyGroup"
  ADD COLUMN "intercompanyMatchingTolerance" NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN "intercompanyDocumentMirroring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companyGroup"
  ADD CONSTRAINT "companyGroup_icTolerance_check" CHECK ("intercompanyMatchingTolerance" >= 0);

-- 2) Match difference tracking
ALTER TABLE "intercompanyTransaction"
  ADD COLUMN "documentAmount" NUMERIC,            -- document-currency amount ("currencyCode" is already the doc currency)
  ADD COLUMN "matchedDifference" NUMERIC,          -- base-currency delta absorbed at elimination
  ADD COLUMN "differenceKind" TEXT CHECK ("differenceKind" IN ('Tolerance', 'FX'));

-- 3) Account defaults (resolved by id — .ai/lessons.md), seeded accounts backfilled
--    once by number/parent-group-name per the 20260702181547 precedent
ALTER TABLE "accountDefault"
  ADD COLUMN "intercompanyDifferenceAccount" TEXT REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD COLUMN "intercompanyNettingAccount"    TEXT REFERENCES "account"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
-- Seed "Intercompany Differences" (expense, parent resolved by isGroup+name, never number)
-- and "Intercompany Netting Clearing" (asset, sibling of 1130) in seed.data.ts + backfill migration.

-- 4) Document mirroring links (group-level: intercompanyTransaction PK/RLS precedent)
CREATE TABLE "intercompanyDocumentLink" (
  "id" TEXT NOT NULL DEFAULT id('icdl'),
  "companyGroupId" TEXT NOT NULL REFERENCES "companyGroup"("id") ON DELETE CASCADE,
  "sourceCompanyId" TEXT NOT NULL REFERENCES "company"("id"),
  "targetCompanyId" TEXT NOT NULL REFERENCES "company"("id"),
  "sourceDocumentType" TEXT NOT NULL CHECK ("sourceDocumentType" IN ('purchaseOrder', 'salesInvoice')),
  "sourceDocumentId" TEXT NOT NULL,
  "targetDocumentType" TEXT NOT NULL CHECK ("targetDocumentType" IN ('salesOrder', 'purchaseInvoice')),
  "targetDocumentId" TEXT,                         -- null until the mirror is created
  "status" TEXT NOT NULL DEFAULT 'Pending'
    CHECK ("status" IN ('Pending', 'Mirrored', 'Failed', 'Exception', 'Detached')),
  "failureReason" TEXT,
  "lastSyncedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT REFERENCES "user"("id"),        -- null when created by the mirroring job
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "intercompanyDocumentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "icdl_source_unique" UNIQUE ("sourceDocumentType", "sourceDocumentId", "sourceCompanyId")
);
-- RLS: 4 policies, source OR target company via get_companies_with_employee_permission('accounting_*'
--      for writes) / get_companies_with_employee_role() intersection with the two companies for SELECT —
--      exactly the intercompanyTransaction policy shape.

-- 5) Netting
CREATE TABLE "intercompanyNettingStatement" (
  "id" TEXT NOT NULL DEFAULT id('icns'),
  "statementId" TEXT NOT NULL,                     -- readable, sequence-assigned per group
  "companyGroupId" TEXT NOT NULL REFERENCES "companyGroup"("id") ON DELETE CASCADE,
  "companyAId" TEXT NOT NULL REFERENCES "company"("id"),
  "companyBId" TEXT NOT NULL REFERENCES "company"("id"),
  "currencyCode" TEXT NOT NULL,
  "nettedAmount" NUMERIC NOT NULL CHECK ("nettedAmount" > 0),
  "residualAmount" NUMERIC NOT NULL DEFAULT 0,
  "residualPayerCompanyId" TEXT REFERENCES "company"("id"),
  "status" TEXT NOT NULL DEFAULT 'Draft'
    CHECK ("status" IN ('Draft', 'Proposed', 'Agreed', 'Settled', 'Exception', 'Cancelled')),
  "settlementDate" DATE,
  "proposedBy" TEXT REFERENCES "user"("id"), "proposedAt" TIMESTAMP WITH TIME ZONE,
  "agreedBy"   TEXT REFERENCES "user"("id"), "agreedAt"   TIMESTAMP WITH TIME ZONE,
  "settledBy"  TEXT REFERENCES "user"("id"), "settledAt"  TIMESTAMP WITH TIME ZONE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "intercompanyNettingStatement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "icns_statementId_group_key" UNIQUE ("statementId", "companyGroupId"),
  CONSTRAINT "icns_distinct_companies" CHECK ("companyAId" <> "companyBId")
);

CREATE TABLE "intercompanyNettingStatementLine" (
  "id" TEXT NOT NULL DEFAULT id('icnl'),
  "statementId" TEXT NOT NULL REFERENCES "intercompanyNettingStatement"("id") ON DELETE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "company"("id"),  -- whose book this open item sits in
  "salesInvoiceId" TEXT, "purchaseInvoiceId" TEXT,       -- exactly one (CHECK)
  "openAmount" NUMERIC NOT NULL,
  "appliedAmount" NUMERIC NOT NULL CHECK ("appliedAmount" >= 0),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "intercompanyNettingStatementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "icnl_one_target" CHECK ((("salesInvoiceId" IS NOT NULL)::int + ("purchaseInvoiceId" IS NOT NULL)::int) = 1)
);

-- Back-reference for the audit trail
ALTER TABLE "payment" ADD COLUMN "nettingStatementId" TEXT
  REFERENCES "intercompanyNettingStatement"("id") ON DELETE RESTRICT;
CREATE INDEX "payment_nettingStatementId_idx" ON "payment"("nettingStatementId")
  WHERE "nettingStatementId" IS NOT NULL;
```

RPC changes: `matchIntercompanyTransactions` gains passes 2–3 (reads tolerance from `companyGroup`); `generateEliminationEntries` adds the difference plug line and refuses to post if `intercompanyDifferenceAccount` is unset while any matched pair carries a nonzero `matchedDifference` (explicit error beats silent imbalance). New `settleNettingStatement(p_statement_id, p_user_id)` RPC verifies `accounting_update` in **both** companies, then builds the paired payments + settlements transactionally.

Pass 2/3 sketch (inside the existing RPC, after the exact pass; same self-join shape and `sourceJournalLineId <` de-dup as pass 1):

```sql
-- Pass 2: FX — document-currency amounts agree, base amounts differ
... ON src."documentAmount" = tgt."documentAmount"
   AND src."currencyCode" = tgt."currencyCode"
   AND src."documentAmount" IS NOT NULL AND tgt."documentAmount" IS NOT NULL
   AND src."amount" <> tgt."amount"          -- else pass 1 took it
-- sets: status='Matched', differenceKind='FX', matchedDifference = src.amount - tgt.amount

-- Pass 3: tolerance — same base currency only, greedy closest-first
SELECT DISTINCT ON (src."id") src."id", tgt."id"
FROM unmatched src JOIN unmatched tgt ON <pair predicate>
  AND ABS(src."amount" - tgt."amount") <= v_tolerance
  AND src_company_base_currency = tgt_company_base_currency
ORDER BY src."id", ABS(src."amount" - tgt."amount") ASC, tgt."id"
-- second DISTINCT ON (tgt.id) pass drops double-claimed targets before UPDATE;
-- sets: differenceKind='Tolerance', matchedDifference = src.amount - tgt.amount
```

Seed/backfill sketch for the two new accounts (follows `20260702181547` + the group-header lesson):

```sql
-- seed.data.ts adds: 1135 "Intercompany Netting Clearing" (asset, parentKey next to 1130)
--                    7095 "Intercompany Differences"     (expense, parentKey other-expenses)
-- backfill migration: insert per company group where missing (parent resolved by
-- "isGroup" = TRUE AND name — group headers have NULL number), then one-time
-- resolve into accountDefault by seeded number; authoritative by id thereafter:
UPDATE "accountDefault" ad
SET "intercompanyDifferenceAccount" = a."id"
FROM "account" a JOIN "company" c ON c."companyGroupId" = a."companyGroupId"
WHERE c."id" = ad."companyId" AND a."number" = '7095'
  AND ad."intercompanyDifferenceAccount" IS NULL;
-- (same shape for 1135 → intercompanyNettingAccount)
```

## API / Service Changes

All in `apps/erp/app/modules/accounting/accounting.service.ts` (+ validators in `accounting.models.ts`):

- `updateCompanyGroupIntercompanySettings(client, groupId, {tolerance, mirroring})`
- `getIntercompanyDocumentLinks(client, groupId, filters)` / `retryIntercompanyMirror(client, linkId)` / `detachIntercompanyLink(client, linkId)`
- `getNettingMatrix(client, groupId)` (wraps `getIntercompanyBalance`), `createNettingStatement(client, groupId, pairIds)`, `proposeNettingStatement`, `agreeNettingStatement`, `settleNettingStatement`, `cancelNettingStatement`
- `@carbon/jobs`: `intercompany.mirror.requested` Inngest function (PO release / sales-invoice posted events → mirror creation, retries, `Failed` links + notifications on exhaustion)

## UI Changes

- **Intercompany page** (accounting) grows three tabs: **Matching** (existing, now showing `differenceKind`/`matchedDifference` badges), **Mirroring** (link table with status filter, failure reasons, retry/detach), **Netting** (matrix → statement list → statement Drawer with lines, status actions, generated payment links).
- **Group settings**: tolerance input + mirroring toggle.
- **Close drawer task 5** drill-through links to Matching and Netting tabs (no new task).
- PO/SO/invoice detail views show a "Mirrored from/to" banner with a link when an `intercompanyDocumentLink` exists.

## Acceptance Criteria

- [ ] Two IC transactions differing by 0.40 base units (tolerance 1.00, same base currency) auto-match on the RPC run with `differenceKind = 'Tolerance'`, `matchedDifference = 0.40`; the elimination journal balances via a 0.40 line to `intercompanyDifferenceAccount`; setting group tolerance to 0.10 leaves the same pair `Unmatched`.
- [ ] The same 1,000 EUR document booked at 1.08 vs 1.10 matches on `documentAmount` with `differenceKind = 'FX'` and a 20.00 base-currency plug to the difference account; the plug exceeds the 1.00 tolerance and still matches (no cap on pass 2).
- [ ] `generateEliminationEntries` raises a clear error (not an unbalanced journal) when a matched pair has nonzero difference and the elimination entity's `intercompanyDifferenceAccount` is unset.
- [ ] Mirrored PO→SO round-trip: with mirroring on, releasing a 3-line PO on an IC supplier produces a Draft SO in the partner company with identical items/quantities/prices and a `Mirrored` link; editing a PO quantity while the SO is Draft re-syncs it; posting the seller's sales invoice drafts the buyer's purchase invoice (Draft, not posted); an unmappable item yields a `Failed` link with reason, a notification, and **no** partial SO; mirrored documents never trigger a reverse mirror.
- [ ] Netting: a pair with 100 AR / 80 AP nets 80 — the settled statement generates four posted payments through `intercompanyNettingAccount`, the clearing account nets to zero in each company, both sides' invoices show 80 settled via ordinary `invoiceSettlement` rows, residual 20 remains open, and `payment.nettingStatementId` traces every payment to the statement.
- [ ] Settling requires `accounting_update` in both companies; a user with permission in only one gets a permission error and no partial postings.
- [ ] Close checklist is unchanged (still 9 seeded tasks); task 5 clears once tolerance/FX matching runs; no `ownershipPercent` or NCI artifact exists anywhere.
- [ ] With mirroring off and tolerance at default, an upgraded group's matching behavior differs from today only by auto-matching pairs within 1.00.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Greedy tolerance matching mis-pairs when many near-identical amounts exist between a pair | Med | Closest-first deterministic ordering; `matchedDifference` visible pre-elimination; manual unmatch action on the Matching tab before eliminating |
| Mirroring loop (mirrored SO's invoice re-mirrors back) | High | Mirror-created documents carry the link and are excluded as initiators (loop guard, tested) |
| Netting payments posted into a Locked/Closed period | Med | `settleNettingStatement` posts through the standard payment path — the period-close trigger and accounting-source rules apply unchanged |
| Difference account absorbs real errors silently (tolerance set too high) | Med | Tolerance floor-checked ≥ 0, no upper bound but the Matching tab totals `Tolerance` differences per period; auditors see one account |
| Cross-currency elimination translation drift | Med | FX plug computed as the journal residual after translation (never a second independent calculation), so the journal balances by construction |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.

- [x] Tolerance configurability and default — **RESOLVED:** per company group, default 1.00 base-currency units.
- [x] Netting in or out of v1 — **RESOLVED:** in scope; workbench → per-pair statements → paired zero-cash settlements riding payment/memo + `invoiceSettlement` machinery.
- [x] Ownership % / NCI — **RESOLVED:** explicitly deferred (readiness SD-5.5); 100%-summation stands.
- [x] Close checklist impact — **RESOLVED (this spec):** no new task; existing task 5 covers the control and links to the new surfaces.
- [x] Mirroring item identity: is `readableIdWithRevision` equality across group companies an acceptable v1 mapping, or do we need an explicit cross-company item reference table before shipping mirroring? (Fails safe today — unmapped items produce a `Failed` link — but silent *wrong* matches are possible if two companies reuse a readable ID for different items.) — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** Build the explicit cross-company item reference table now, seeded by `readableIdWithRevision` auto-matching. Back out to pure readableId equality at plan stage.
- [x] Netting residual: confirm the residual is settled by ordinary cash payment outside the statement (current design), rather than the statement optionally generating the residual cash payment too. — **Answer (Brad, 2026-07-04, ambition heuristic — be ambitious and thorough; back out at /plan stage if needed):** The statement optionally generates the residual settlement payment document too (ambitious); manual cash settlement remains the fallback path.

## Changelog

- 2026-07-04: Created — resolutions from the readiness review baked in (tolerance default, netting in scope, NCI deferred); grounded in `20260403120000_intercompany-tracking.sql`, `20260702181547` (account-by-id precedent), `20260630093809_ar-ap-payments.sql` (payment/memo/settlement machinery), and research §Pattern 6 (SAP trading-partner/ICMR, NetSuite netting workbench).
- 2026-07-04: Remaining open questions resolved under the program ambition heuristic (ambitious scope now; back-out valves at plan stage).
