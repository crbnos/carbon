# Feature run: Dimensional pivot-table analytics reporting

- Date: 2026-08-09
- Mode: approval-per-phase
- Request: Add groupable pivot-table analytics reporting that leverages the dimensions layer on journal entry lines — slice/dice across reports to answer questions like biggest causes of scrap, what customer types drive sales, what item groups caused inventory to change. Inspired by Sage Intacct's dimensional reporting. Build via research → spec → plan.
- Phase plan: research [run — ERP-domain, dimensional analytics/BI; anchor design in industry practice] · spec [run — new data model + reporting surface, crosses accounting/reporting modules, 3+ files] · plan [run] · execute [skip for now — user scoped to "spec and then a plan"] · test [skip — no build yet] · self-review [skip — no build yet]

## Decisions
- (approval mode — human resolves the two 🛑 gates)

## Design steers (from user, in-flight)
- **Collapse hardcoded per-dimension reports into generic measure-anchored reports.** Instead of separate "Revenue by Customer" / "Expense by Supplier" routes, have a small set of generic reports ("Revenue", "Expenses", COGS, "Inventory Change", scrap, etc.) where the Group-By dimension is chosen interactively in the pivot UI. "Revenue by customer" and "revenue by customer type" become the same report with a different Group-By selection. Existing narrow reports become preset views of the generic ones. — 2026-08-09

## Phase log
- research: DONE → .ai/research/dimensional-pivot-reporting.md (5 subagents: codebase map + Intacct + NetSuite + SAP/QBO/Xero + pivot-UX/perf). Key: Carbon already has journalLineDimension tag layer (12 entity types populated); all current reports aggregate by account only; ScrapReason/Department enum values have no posting writers (scrap-tagging gap).
- spec: DONE → .ai/specs/2026-08-09-dimensional-pivot-reporting.md. Abbreviated interview (4 Qs): Q1=(a) seeded account-class scopes + replace narrow reports with preset redirects; Q2=(b) full shelf model (≤2 row dims + free column axis); Q3=(c) shareable saved views day one; Q4=(b) amount+quantity+count (+% of total toggle). Correction found during design: ScrapReason IS tagged since #1355 (codebase map was stale on this) — no posting changes needed.
- plan: DONE → .ai/plans/2026-08-09-dimensional-pivot-reporting.md (12 tasks: migration w/ full RPC SQL → rolled-back psql validation w/ fixtures → apply+generate:types → models registry/validators → service fns → pivotTree pure lib+tests → PivotControlBar/SaveViewModal → PivotTree/PivotLinesDrawer → routes+path → redirects+hub+dead-code → i18n/lint → /test browser verification). Spec approved by Brad before planning.


## Outcome
- Plan approved by Brad; /execute ran Tasks 1–11 (9 commits on financial-reports-module, pushed: 5e8f15541..3f6377a30). All gates green: rolled-back SQL validation (all asserts), 13 pivotData unit tests, scoped typecheck, biome, repo test pass (22 tasks). i18n: 225/300 msgstrs filled; hi/tr/ko deferred per Brad (session limit). Deviations: pivotTree.ts renamed pivotData.ts (case-collision with PivotTree.tsx); drill-through drawer shows journalEntryId as text (RPC lacks journal.id — follow-up candidate); tool-metadata.json rode along in Task-5 commit (schema-derived regen).
- Task 12 (browser verification): Brad is handling manually.
