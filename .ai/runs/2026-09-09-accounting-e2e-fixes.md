# Bugfix run: accounting E2E priorities 1, 3 and 4

- Date: 2026-09-09
- Mode: fully autonomous, continuing the user-authorized accounting correction work.
- Request: “fix 1, 3, and 4”
- Phase plan: root-cause reused/confirmed from real E2E evidence; instrumentation only if new uncertainty requires it; fix with failing regression first; browser/live API verification; commit/push not requested in this turn.
- Plan: [implementation checklist](../plans/2026-09-09-accounting-e2e-fixes.md).

## Root-cause brief

**Bug:** live Rillet, payment and reporting flows fail despite the branch's core posting corrections.

**Root causes / confidence:** HIGH for reversed bill FX direction; mapped-document idempotency skipping voids; unimplemented payment void hooks; unrounded memo residual subtraction; refund paths inferring party from cash direction and subledgers omitting refunds; published settlement metadata omitting createdBy; historical period RPC active filters; unpaged application readers. These are reproduced in [the E2E run](2026-09-09-accounting-e2e.md). Rillet AR_ONLY FX/deferred revenue behavior is proven, but the correct supported provider representation still requires investigation.

**Approach:** repair each source of the mismatch and its real callers, preserving tenant scope and exact source-document principal. Add regression tests before production edits, then replay fresh owned E2E/provider fixtures. Use migrations for stored SQL definitions and regenerate types before typechecking.

**Risks / BC:** preserve edge names, event names, public routes and existing service callers. Refund flows span both customer/supplier and cash direction. Rillet retry behavior must not duplicate remote reversals; provider refusal states must remain visible. Existing accounting adoption instruction permits direct correction without legacy backfill machinery.

## Phase log

- Diagnosis: prior E2E artifacts loaded; current branch and workspace changes checked.
- Implementation: parallel bounded agents assigned Rillet, payments and reports; root handles published API author injection and integration gates.
- API regression RED: real manifest→dispatch tests failed 4 cases (27 existing cases passed): omitted authenticated creator and forged caller creator for both replaceInvoiceSettlements and applyCreditsToInvoices.
- API fix: use existing per-operation injection overrides for the two transaction services, matching their required createdBy contract. This preserves name-based behavior of unrelated operations and stamps authenticated identity with the existing dispatcher.
- API GREEN: 55 manifest/metadata/real-dispatch tests passed. Fresh local scoped HTTP requests for replaceInvoiceSettlements and applyCreditsToInvoices both returned200 with omitted and forged createdBy; all persisted rows carried the authenticated author. Temporary API key removed and owned invoice/memo voided after clearing Draft applications. Evidence: `.context/accounting/e2e-20260909/fix-api-live-results.json`.
- Refund UI RED→GREEN: 10 new failing cases covered validator acceptance of both refund directions, rejection of ambiguous parties, four visible payment choices, memo-only target loader, exact composer save/reopen. All56 model/form/composer/loader tests passed after implementation.
- Report SQL: both migrations applied without rebuilding database; actual historical leaf/ancestor/snapshot-writer regression and106 balance/report scenarios passed. Type regeneration remains in progress.
- Integration correction confirmed: live Rillet REVENUE_RECOGNITION_ONLY probe accepts reciprocal fixed FX and produces same-day revenue; adapter implementation uses that supported invoice scope.
- Runtime: overlapping validation with a separate user agent caused memory pressure and local ERP/API timeouts. Root stopped its own duplicate ERP typecheck; independent user's Explorer edits/typecheck left intact. Live browser/provider replay will resume after the current checks release resources.

## Final verification

**Result: implemented and verified locally.** All selected accounting failures are corrected. No commit or push was made during this fix turn.

- ERP: 204 targeted tests pass across payment models/form/composer/loader/services, paginated histories, reports, manifest and real API dispatch. Final scoped `pnpm exec turbo run typecheck --filter=erp` exits0.
- Rillet/EE: 197 tests pass; jobs:142 tests pass. Both scoped typechecks exit0. The provider accepts fixed invoice/bill FX, recognizes revenue on Carbon's posting date, and deletes native invoices/bills/payments on void with retry-safe retained mappings.
- Payment/memo edge:69 tests pass, including actual database transactions for both parties, final document cents, original-account provenance, over-refund rollback and memo void guards. Deno typecheck still reports eight diagnostics in untouched shared pg/sequence files; no changed payment/memo diagnostics.
- SQL:106 reporting cases plus inactive-account tree, period-series and actual snapshot-writer regressions pass. Both RPC migrations applied; generated database types/swagger refreshed. All four seed datasets remain applicable; backup compatibility is restorable against main (rerun through the local environment loader after the plain command skipped for its connection environment). Workflow catalog and manifest checks pass.
- Published APIs: fresh real HTTP requests accept omitted createdBy and replace forged createdBy with the authenticated user, on both settlement replacements and memo applications.
- Live Rillet:11 fresh documents (USD, three EUR rates, JPY, BHD, small-line tax and shipping) preserve the independent remote GL. Three native payments, including AR fanout, post and void through reconciliation/drain. All11 document voids return remote404; the final remote GL contains no remaining fixture entries; replay enqueues0.
- Browser customer refund: created `dagpujaqu0h3tdpb7h7g` from the new form as Refund to Customer, EUR55/r1.25. Auto apply saved target memo principal55/base50/FXgain6. Post gave AR debit50, cash credit44 and FX gain credit6, with AR variance0. Void restored memo55/base50 and reversed every original account. Owned memo then voided through the actual endpoint. The initial assertion mistakenly summed natural-balance storage signs; class-aware signed-debit proof passed. The initial type selector's blank registered default was reproduced, fixed, and covered by a red→green regression.
- Supplier live API:11 assertions pass for final-cent memo application, partial/full FX refunds, consumed-memo void refusal, restoration, and unallocated refund aging/tie-out. Owned fixtures voided and API keys removed.
- Reports under actual PostgREST max_rows1000: payment and invoice UI show all1105 applications; inactive child and All Companies reports retain balanced160 assets/equity,120 net income and40 CTA; all1061 CSV rows match both monthly columns. Invalid scope returns404 on BS/IS/TB. Cap restored and independently verified; test accounts reactivated.
- Translations:168 empty entries filled across12 locales using Haiku with the approved glossary; deterministic merge reports0 remaining and `linguito check` exits0. The terminology audit retains15773 existing findings and flags4 newly filled Russian/Hindi strings (including inflection/negation cases) for terminology review; this is not a clean glossary audit. The glossary was not edited.

Detailed evidence: `.context/accounting/e2e-20260909/fix-{rillet,payments,reports}-results.md`, `fix-api-live-results.json`, `fix-customer-refund-fixtures.json`, and associated `fix-*.log` files. Successful workflows are cached in the accounting, purchase, reports and Rillet playbooks.

Preserved unrelated concurrent edits: `AccountMapping.tsx`, `PurchaseInvoiceExplorer.tsx`, `SalesInvoiceExplorer.tsx`. Shared shipping/bank mapping gaps (item2), inbound webhook delivery, unconfigured Xero/QBO acceptance, and the separate fixed-asset master lifecycle gap remain outside this selected scope. Foreign-currency payment push remains the provider's explicit unsupported capability; the corrected FX normalization applies to native invoices/bills.

## Commit preparation

The user subsequently requested committing and pushing all workspace changes. The commit therefore also includes the concurrent account-mapping form refresh and invoice-explorer styling edits, alongside the completed fixes and test documentation. Those three UI files pass Biome; the final translation completeness check exits0. Previously completed scoped typechecks, automated tests, SQL and live verification remain applicable to the unchanged implementation. All76 changed source/documentation/catalog files were screened for credential patterns with no matches; disposable evidence and translation chunks stay gitignored.
