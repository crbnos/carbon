# Segment Reporting (ASC 280 / ASU 2023-07) + Dimension Enforcement

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-04
> Tracking issue: crbnos/carbon#1049
> Readiness finding: GAP-7 (`.ai/specs/2026-07-03-public-company-readiness.md`)
> Research: `.ai/research/public-company-compliance.md` (SAP §S/4HANA; ASU 2023-07)

## TLDR

A reserved, system-managed **Segment** dimension that every posting derives
automatically — users never key segments (the SAP rule: segment derived from
profit-center master data). Segments are defined once per company group as
values under a seeded `Segment` dimension; at posting time each journal line
resolves its segment through a fixed precedence chain — cost center's segment
attribute (walking up `parentCostCenterId`) → item posting group's segment
attribute → document-type default → company default — implemented in one SQL
function and enforced by a deferred DB trigger, so **every** posting path
(nine edge functions, `accounting.server.ts` Kysely transactions, plpgsql
posting functions, manual JEs) is covered identically. The same trigger
finally enforces `dimension.required` server-side (today a stored flag the
server never reads): posting with a missing required dimension fails with an
error naming the dimension. Reporting extends the financial-reporting spec's
surfaces: segment filter + per-segment columns on TB/BS/IS, a segment column
+ filter on GL detail, and a new **Segment Disclosure** report (ASU 2023-07):
revenue, significant expense categories (from the existing expense
account-tree headings), other segment items, and segment profit per segment,
with an **Unassigned / Eliminations** reconciliation column so segment totals
tie to consolidated totals by construction. History is never rewritten —
pre-segment lines report as Unassigned. SAP document splitting /
zero-balancing is explicitly out of scope v1: segment balance sheets are
best-effort from natural postings.

## Problem Statement

- **No segment concept.** ASC 280 (as amended by ASU 2023-07, effective for
  all public filers *including single-segment filers*) requires reportable
  segments with segment profit/loss, significant expense categories regularly
  provided to the CODM, and reconciliation to consolidated totals. Carbon has
  dimensions (`20260228024512_dimensions.sql`) but nothing plays the segment
  role, and no report groups by any dimension.
- **`dimension.required` is decorative.** The flag exists on the table and in
  UI types but no posting path reads it. Nine edge functions
  (`post-purchase-invoice`, `post-sales-invoice`, `post-payment`,
  `post-receipt`, `post-shipment`, `post-memo`, `post-production-event`,
  `close-job`, `issue`), the Kysely paths in
  `apps/erp/app/modules/accounting/accounting.server.ts`, the plpgsql posting
  functions (`backflush_job_materials`, `complete_job_to_inventory` —
  `20260630092517_job-costing-item-dimension.sql`), and manual JE posting all
  insert `journalLineDimension` rows opportunistically ("if the dimension
  exists, tag it"); none fails when a required dimension is absent. An
  auditor testing dimension completeness finds a paper control.
- **If users key segments, segments are wrong.** SAP's hard-won lesson: keyed
  segment fields drift immediately; derivation from master data is the only
  pattern that yields a complete, consistent segment population. Carbon's
  posting paths already stamp CostCenter / ItemPostingGroup dimensions on
  lines, so derivation's inputs are already on every line at commit time.

## Proposed Solution

### 1. Reserved Segment dimension + segment master data

- `ALTER TYPE "dimensionEntityType" ADD VALUE 'Segment'` (own migration —
  enum values cannot be used in the transaction that adds them).
- Seed one system dimension per company group: `name = 'Segment'`,
  `entityType = 'Segment'`, `required = false` (flips on first configuration,
  §2). Segment values are plain `dimensionValue` rows under it — **no new
  segment table**; `dimensionValue` is already group-scoped with RLS and
  `journalLineDimension.valueId` already points at `dimensionValue.id` for
  non-entity dimensions. The `dimensionValues` view's `entityType = 'Custom'`
  filter widens to `IN ('Custom', 'Segment')`.
- Reserved semantics, service-enforced: it cannot be renamed, deleted, or
  deactivated, and is hidden from the manual-JE selector — derivation owns it.
- **Segment attributes as columns** (no mapping tables):
  - `costCenter."segmentId"` — nullable FK to `dimensionValue`. Effective
    segment = own value, else nearest ancestor's via `parentCostCenterId`
    (hierarchy already exists, `20260317233050_cost-centers.sql`).
  - `itemPostingGroup."segmentId"` — nullable FK to `dimensionValue`.
  - `accountDefault."defaultSegmentId"` — nullable FK; `accountDefault` is
    the existing one-row-per-company posting-defaults table
    (`20230820020844_posting-groups.sql`), the natural home for the
    company-level fallback.
- Document-type defaults need a map (source type → segment), which cannot be
  a column: one small table `documentSegmentDefault` — see Data Model.

### 2. Derivation + server-side required-dimension enforcement

One SQL function, one trigger pair — DB-level so every path is bound, per the
readiness audit's Decision 1 precedent (`20260702044133_period-close-lifecycle.sql`).

- **`resolve_segment(p_company_id, p_cost_center_id, p_item_posting_group_id,
  p_source_type)`** — the precedence chain: cost center's effective segment
  (recursive CTE up `parentCostCenterId`) → `itemPostingGroup."segmentId"` →
  `documentSegmentDefault` for the source type →
  `accountDefault."defaultSegmentId"` → NULL.
- **Deferred constraint trigger on `journalLine`** (`AFTER INSERT …
  DEFERRABLE INITIALLY DEFERRED`), firing at transaction commit — by which
  point the posting path has written the line's CostCenter /
  ItemPostingGroup `journalLineDimension` rows (system posters write
  journal → lines → dimensions inside one transaction: Kysely
  `db.transaction()` in the edge functions and `accounting.server.ts`; one
  plpgsql call for the job-costing functions). Skips lines whose journal is
  `Draft`. For `Posted` journals it:
  1. **Derives Segment** — if the group has ≥1 segment value and the line has
     no Segment row: read the line's CostCenter / ItemPostingGroup dimension
     values from `journalLineDimension`, call `resolve_segment` with them +
     `journal."sourceType"`, insert the Segment `journalLineDimension` row.
     NULL result ⇒ `RAISE EXCEPTION` ("No segment could be derived for line
     %; set a company default segment in Account Defaults").
  2. **Enforces `required`** — for every `active AND required` dimension in
     the company group, assert a `journalLineDimension` row exists for the
     line; else `RAISE EXCEPTION` naming the missing dimension(s) and the
     `journalLineReference`.
- **Trigger on `journal` status transition to `Posted`** runs the same two
  checks across all of the journal's lines — covers manual JEs, whose lines
  and dimensions are written in earlier `Draft` transactions with posting as
  a later status flip.
- **Segment becomes required-by-default once configured**: creating the first
  segment value flips the Segment dimension's `required` to `true`
  (service-side, with a UI notice); the admin may untoggle. Independent of
  that flag, derivation runs whenever any segment values exist — `required`
  only governs whether a NULL derivation errors or lands unassigned.
- Client-side validation stays as UX; the DB is the control.

### 3. Segment reporting (extends `.ai/specs/2026-07-02-financial-reporting.md`)

- **Balance RPCs**: `accountTreeBalancesByCompany` and `trialBalance` gain
  `p_segment_value_id TEXT DEFAULT NULL` and `p_segment_unassigned BOOLEAN
  DEFAULT FALSE` (fork the newest definitions, additive — same convention the
  financial-reporting spec used for `p_include_drafts`). Filtered mode joins
  `journalLineDimension` on the group's Segment dimension; unassigned mode
  anti-joins. Exactly one of total / one-segment / unassigned per call, so
  Total = Σ segments + Unassigned by construction.
- **Statement screens** (TB / BS / IS): `ReportFilters` gains a Segment
  select — a single segment filters the report; **"By segment"** renders one
  column per segment plus an **Unassigned / Eliminations** reconciliation
  column and the existing Total. Loader = one balance call per column zipped
  by account id — the N-call-zip mechanism the financial-reporting spec built
  for comparatives (§5 there); ASC 280 segment counts are small (2–10).
  Elimination-entity journals carry no cost center / posting group, so they
  derive the company default or land in Unassigned — either way the
  reconciliation column absorbs them and columns tie.
- **GL detail** (`getGeneralLedgerLines`): Segment display column and filter
  (join through `journalLineDimension`), incl. `segment=unassigned`;
  statement segment-column amounts drill to GL detail pre-filtered to
  account + window + segment. CSV export inherits via the shared `Table`.
- **Segment Disclosure report** (new route, the ASU 2023-07 artifact): rows =
  Revenue, one row per top-level expense heading of the account tree (the
  significant expense categories the CODM sees — no new category entity),
  Other segment items (plug), Segment profit (ties to the income statement
  bottom line per column); columns = each segment,
  Unassigned/Eliminations, consolidated Total. Works single-company and
  consolidated (translated balances, same as the other statements); CSV.
- **Segment balance sheet is best-effort** and labeled as such in the UI:
  without document splitting, cash, AR/AP settlement, tax, and equity lines
  do not fully allocate; the Unassigned column absorbs the remainder and
  each row still ties to the consolidated total. Honest > fake.

### 4. Backfill posture

None. Historical `journalLine` rows without a Segment row report as
Unassigned forever; `journalLineDimension` is append-only and posted journals
are immutable — we do not rewrite history. The Unassigned column is the
honest representation of pre-segment data.

### Out of scope (v1)

- **SAP document splitting / zero-balancing per segment** — inheriting the
  segment onto offsetting lines (cash, AR/AP) and posting zero-balancing
  clearing lines so each segment's balance sheet balances independently. A
  full sub-ledger rework; explicitly deferred. Consequence stated in §3.
- A dedicated Eliminations segment value / segment-aware IC eliminations.
- Segment budgeting (budgeting spec owns budget columns), segment PDF pages,
  ASU 2023-07 interim-disclosure checklists, and generalizing per-segment
  columns to arbitrary dimensions (the join is by dimension id, so a future
  "by any dimension" mode reuses the shape).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Segment storage | `dimensionValue` rows under a seeded, reserved `entityType='Segment'` dimension — no new table | Machinery (group scoping, RLS, `journalLineDimension.valueId`, UI selectors) already exists; a `segment` table would duplicate all of it |
| Who keys segments | Nobody — derivation only, selector hidden | SAP rule (research §S/4HANA): keyed segments drift; derivation from master data gives a complete population |
| Derivation precedence | costCenter (hierarchical) → itemPostingGroup → documentSegmentDefault → accountDefault.defaultSegmentId | Resolved by Brad 2026-07-04 (ambitious/full derivation). Cost center is the org-structure signal (SAP profit-center analog); posting group covers product-line segmentation; defaults guarantee termination |
| Enforcement point | Deferred constraint trigger on `journalLine` + status-transition trigger on `journal`, both SECURITY DEFINER | Only DB-level covers all nine edge functions, Kysely paths, plpgsql posters, and PostgREST at once; commit-time deferral is when dimension rows exist; readiness Decision 1 precedent |
| `required` semantics | Enforced at Posted only (Draft exempt); error names dimension + line | Drafts are workpads; posting is the control gate (matches period-close and posted-immutability gates) |
| Segment auto-required | First segment value flips `required=true` (notice shown, admin may untoggle) | "Required once configured" without a special case in the trigger — Segment goes through the same required check as every dimension |
| Reporting mechanism | Additive RPC params (`p_segment_value_id` / `p_segment_unassigned`) + N-call zip in loaders | Same additive-fork and column-zip conventions the financial-reporting spec established; Total = Σ segments + Unassigned by construction |
| Expense categories (ASU 2023-07) | Top-level expense headings of the existing account tree | The tree already encodes the groupings statements render; a parallel category entity would drift from it |
| Multi-tenancy (heuristic 1) | Segment values group-scoped (`dimensionValue.companyGroupId` — chart-of-accounts pattern); attributes on company-scoped tables (`costCenter`, `itemPostingGroup`, `accountDefault`); `documentSegmentDefault` composite-PK `("id","companyId")` | Segments must be shared across a group for consolidated segment reporting; assignment is per company |
| Service shape (heuristic 2) | `getSegments`, `upsertSegment`, `deactivateSegment`, `getDocumentSegmentDefaults`, `upsertDocumentSegmentDefault`, `getSegmentDisclosure` in `accounting.service.ts`; costCenter/itemPostingGroup services gain the column | One `{module}.service.ts`; no new files beyond routes/UI |
| RLS (heuristic 3) | `documentSegmentDefault`: four policies, SELECT `get_companies_with_employee_role()`, writes `get_companies_with_employee_permission('accounting_*')`; everything else inherits existing policies | Standard company-scoped template; dimension/dimensionValue policies already correct |
| Permissions (heuristic 4) | Segment config = `update: "accounting"`; reports = `view: "accounting"` + `role: "employee"` (matches `balance-sheet.tsx`) | Segment master data is accounting configuration |
| Forms (heuristic 5) | Segment select added to existing costCenter / itemPostingGroup / account-defaults `ValidatedForm`s; new small forms for segment values + doc-type defaults | Extend existing forms before creating new ones |
| Module layout (heuristic 6) | Everything in `apps/erp/app/modules/accounting/` + `routes/x+/accounting+/`; report UI under `ui/Reports/` | Segments are an accounting concept even though attributes live on items/production entities |
| Backward compatibility (heuristic 7) | RPCs extended additively; new columns nullable; trigger inert until segment values exist and no dimension is `required`; existing posters unmodified (derivation reads what they already write) | Zero behavior change for unconfigured companies — the entire feature is opt-in by configuring it |

## Data Model Changes

Two migrations (`pnpm db:migrate:new …`, randomized HHMMSS), then
`pnpm run generate:types`. Migration 1 (enum only):

```sql
ALTER TYPE "dimensionEntityType" ADD VALUE IF NOT EXISTS 'Segment';
```

Migration 2 (everything else):

```sql
-- Seed the reserved Segment dimension per company group (idempotent);
-- seed-company edge function gains the same row for new groups
INSERT INTO "dimension" ("name", "entityType", "companyGroupId", "createdBy")
SELECT 'Segment', 'Segment', cg."id", 'system' FROM "companyGroup" cg
ON CONFLICT ("name", "companyGroupId") DO NOTHING;

-- Segment attributes: columns, not tables
ALTER TABLE "costCenter" ADD COLUMN IF NOT EXISTS "segmentId" TEXT
  REFERENCES "dimensionValue"("id") ON DELETE SET NULL;
ALTER TABLE "itemPostingGroup" ADD COLUMN IF NOT EXISTS "segmentId" TEXT
  REFERENCES "dimensionValue"("id") ON DELETE SET NULL;
ALTER TABLE "accountDefault" ADD COLUMN IF NOT EXISTS "defaultSegmentId" TEXT
  REFERENCES "dimensionValue"("id") ON DELETE SET NULL;

-- Document-type fallback (a map, so a table; company-scoped template)
CREATE TABLE IF NOT EXISTS "documentSegmentDefault" (
  "id" TEXT NOT NULL DEFAULT id('dsd'),
  "companyId" TEXT NOT NULL,
  "sourceType" "journalEntrySourceType" NOT NULL,
  "segmentId" TEXT NOT NULL REFERENCES "dimensionValue"("id") ON DELETE CASCADE,
  "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT REFERENCES "user"("id"),
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "documentSegmentDefault_pkey" PRIMARY KEY ("id", "companyId"),
  CONSTRAINT "documentSegmentDefault_companyId_sourceType_key"
    UNIQUE ("companyId", "sourceType"),
  CONSTRAINT "documentSegmentDefault_companyId_fkey" FOREIGN KEY ("companyId")
    REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "documentSegmentDefault" ENABLE ROW LEVEL SECURITY;
-- Policies SELECT/INSERT/UPDATE/DELETE: SELECT via
-- get_companies_with_employee_role(); writes via
-- get_companies_with_employee_permission('accounting_<action>'); ::text[] casts

-- resolve_segment(p_company_id, p_cost_center_id, p_item_posting_group_id,
--   p_source_type) RETURNS TEXT — STABLE, SECURITY DEFINER, search_path=public:
--   recursive CTE up costCenter.parentCostCenterId for the first non-null
--   segmentId → itemPostingGroup → documentSegmentDefault → accountDefault → NULL

-- enforce_line_dimensions(): derive Segment (§2.1) then assert required
-- dimensions (§2.2); SECURITY DEFINER.
CREATE CONSTRAINT TRIGGER "journalLine_dimension_enforcement"
  AFTER INSERT ON "journalLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_line_dimensions();
CREATE TRIGGER "journal_post_dimension_enforcement"
  AFTER UPDATE OF "status" ON "journal"
  FOR EACH ROW WHEN (NEW."status" = 'Posted' AND OLD."status" = 'Draft')
  EXECUTE FUNCTION enforce_journal_dimensions();

-- Widen the custom-values view to include Segment
CREATE OR REPLACE VIEW "dimensionValues" WITH(SECURITY_INVOKER=true) AS
  SELECT … WHERE d."entityType" IN ('Custom', 'Segment');

-- Fork newest trialBalance + accountTreeBalancesByCompany definitions
-- (post-financial-reporting versions) adding:
--   p_segment_value_id TEXT DEFAULT NULL, p_segment_unassigned BOOLEAN DEFAULT FALSE
-- Join/anti-join journalLineDimension jld ON jld."journalLineId" = jl."id"
--   AND jld."dimensionId" = (group's Segment dimension id)
-- Partial index to serve it:
CREATE INDEX IF NOT EXISTS "journalLineDimension_dimensionId_valueId_idx"
  ON "journalLineDimension" ("dimensionId", "valueId", "journalLineId");
```

## API / Service Changes

`apps/erp/app/modules/accounting/accounting.service.ts` (+ zod in
`accounting.models.ts`): `getSegments`, `upsertSegment` (flips
`dimension.required` on first value), `getDocumentSegmentDefaults` /
`upsertDocumentSegmentDefault`, `getSegmentDisclosure(client, companyGroupId,
companyIds, { startDate, endDate })` (per-segment IS balances folded into
revenue / expense-heading / profit rows), and `p_segment_*` pass-throughs on
`getTrialBalance` / `getFinancialStatementBalances` /
`getGeneralLedgerLines`. Existing `costCenter` / `itemPostingGroup` upserts
gain `segmentId`; `accountDefault` upsert gains `defaultSegmentId`.
Reserved-dimension guard in `updateDimension` / `deleteDimension`.

Routes (`routes/x+/accounting+/`): `settings.segments.tsx` (one settings
screen: values, doc-type defaults, company default); `segment-disclosure.tsx`;
TB / BS / IS / GL loaders accept `segment` / `bySegment` search params.
`path.to` additions: `segments`, `segmentDisclosure`. Edge functions are
**unchanged** — derivation and enforcement live in the database.

## UI Changes

- **`Reports/ReportFilters.tsx`**: Segment select (All / each segment /
  Unassigned) + "By segment" columns toggle on TB/BS/IS.
- **`Reports/FinancialStatementTree.tsx` / `TrialBalanceTable.tsx`**:
  per-segment columns + Unassigned/Eliminations + Total when `bySegment`;
  best-effort banner on the segmented balance sheet (§3).
- **`Reports/SegmentDisclosure.tsx`**: the ASU 2023-07 grid; CSV export.
- **`GeneralLedger/GeneralLedgerTable.tsx`**: Segment column + filter.
- **Settings — Segments screen**: value list, doc-type default rows, company
  default select; notice when the first value flips Segment to required.
- **Cost center / item posting group / account defaults forms**: Segment
  select added to the existing `ValidatedForm`s.
- **`JournalEntries/DimensionSelector.tsx`**: hides the Segment dimension;
  posting-failure toasts surface the trigger's missing-dimension message.

## Acceptance Criteria

- [ ] With segments A and B configured, a cost center under a parent whose `segmentId = A`, and a purchase invoice posted against that cost center: every journal line of the posting carries a Segment `journalLineDimension` row with value A (hierarchy walk proven), with **no changes to the edge function**.
- [ ] A posting with no cost-center segment but an item posting group assigned to B derives B; with neither, a `documentSegmentDefault` for the source type wins; with none of the three, `accountDefault."defaultSegmentId"` wins — precedence proven by four postings.
- [ ] With segments configured but no company default and no other rule matching, posting fails with an error naming the line and pointing at Account Defaults; nothing is committed (the whole posting transaction rolls back).
- [ ] With a custom dimension marked `required`, posting a journal (via edge function AND via manual JE draft→post) whose lines lack that dimension fails naming the dimension; adding the dimension row lets the same posting succeed. Draft journals save freely either way.
- [ ] With no segment values and no required dimensions, all posting paths behave byte-for-byte as today (trigger inert) — regression run on the demo dataset.
- [ ] Creating the first segment value flips the Segment dimension to `required = true` and the settings screen says so; untoggling it makes unresolvable postings fall through to Unassigned instead of erroring.
- [ ] The Segment dimension cannot be renamed, deleted, or deactivated via the dimension UI/service, and never appears in the manual-JE dimension selector.
- [ ] Income statement "By segment": columns for each segment + Unassigned/Eliminations + Total, where each row's segment cells sum to its Total cell exactly; historical (pre-segment) activity appears in Unassigned; single-segment filter matches that segment's column.
- [ ] Segmented balance sheet renders with the best-effort banner; every row ties across columns; unallocated cash/AR/AP sits in Unassigned.
- [ ] GL detail filtered to account + window + segment sums to the corresponding statement cell; `segment=unassigned` returns exactly the lines with no Segment row; CSV matches the visible rows.
- [ ] Segment Disclosure report: per segment — revenue, one row per top-level expense heading, other segment items, segment profit; Total column equals the consolidated income statement for the same window (single-company and consolidated/translated modes).
- [ ] Four-column trial balance with a segment filter still foots (total debits = credits); `pnpm run generate:types`, scoped typechecks (`--filter=@carbon/erp`, `--filter=@carbon/database`), and `pnpm run lint` pass; both migrations apply idempotently twice.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| A posting path writes lines and dimensions in **separate transactions** (like manual JEs) while status = Posted → deferred trigger fires before dimensions exist → false failures | Med | Audit at implementation: all nine edge functions + `accounting.server.ts` use single transactions today; the status-transition trigger is the sanctioned two-phase path; add a lesson + test per poster |
| Deferred per-row trigger cost on large postings (backflush with many lines) | Low | Checks are index-served lookups per line (new partial index); posting sizes are tens of lines; measure on `close-job` in staging |
| Trigger exception text lost/blurred through PostgREST → unclear user error | Med | Use `ERRCODE` + stable message prefix; edge functions and services map it to a flash message; acceptance criterion covers the toast |
| Segment join slows balance RPCs on large ledgers when segment params are NULL | Low | Join only added inside the branch where a segment param is set; unfiltered plans unchanged |
| Concurrent redefinition of the same RPCs as financial-reporting spec | Med | This spec forks the **post-financial-reporting** definitions (per `.ai/lessons.md` fork-newest rule); sequencing noted in the meta spec `2026-07-04-accounting-implementation-meta.md` |
| Companies segment by geography, not cost center / product line | Low | Assign segments to per-location cost centers; a `location.segmentId` attribute is a cheap follow-up if demanded |

## Open Questions

> All questions resolved 2026-07-04 with Brad: **ambitious scope — full
> derivation**, not cost-center-only.

- [x] **Scope: cost-center-only vs full derivation?** — **Answer (Brad 2026-07-04):** Ambitious. Full precedence chain (cost center → item posting group → document-type default → company default), server-side required-dimension enforcement for all posting paths, and the full reporting surface incl. ASU 2023-07 disclosure, in v1.
- [x] **Segment storage** — **Answer:** `dimensionValue` rows under a reserved seeded dimension; no new segment table (machinery reuse; see Design Decisions).
- [x] **Enforcement mechanism** — **Answer:** DB triggers (deferred constraint trigger + status-transition trigger), not per-path TS checks — only the DB covers all nine edge functions, Kysely paths, and plpgsql posters uniformly.
- [x] **Document splitting / zero-balancing** — **Answer:** Out of scope v1; segment balance sheets best-effort with an explicit UI banner and the Unassigned reconciliation column (limitation stated honestly).
- [x] **Backfill** — **Answer:** None. Historical lines report as Unassigned; posted journals and `journalLineDimension` stay immutable.

## Changelog

- 2026-07-04: Created — readiness finding GAP-7 (ASC 280 / ASU 2023-07); grounded in the dimension machinery (`20260228024512_dimensions.sql` + enum extensions), the nine dimension-writing edge functions, `accounting.server.ts` Kysely paths, plpgsql posters (`20260630092517`), `costCenter` (`20260317233050`), `itemPostingGroup` (`20230330024716`), `accountDefault` (`20230820020844`), `journal.sourceType`/`status` (`20260402000000`), and the SAP segment-derived-from-master-data pattern (research §S/4HANA). Extends the financial-reporting spec's surfaces and RPC-fork conventions. Scope resolved ambitious/full-derivation by Brad 2026-07-04.
