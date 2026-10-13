# Feature run: Lessee leases (ASC 842) in purchasing

- Date: 2026-10-11
- Mode: approval-per-phase (the request did not say "autonomous"; the design has schema and posting decisions)
- Request: "we've implemented the sales (lessor) side of ASC 842 -- now we have to have to implement the lessee side in purchasing. generally we want to follow as many patterns as possible whle being simple and complete"
- Phase plan: research [run — accounting domain, mandatory] · spec [run — new tables, posting, crosses purchasing / invoicing / accounting] · plan [run] · execute [run] · test [run — user-facing flows] · self-review [run]

## Decisions
- spec Q1–Q7: resolved by Brad in the interview (2026-10-11)
- spec Q8: Brad said "move forward with the plan" after the recommendation; planning then found the Migration Clearing conflict, so Q8 is re-opened with a new recommendation (retained earnings). Only plan Task 30 waits on it.
- spec Q8 (final): Brad: "do a little research and if it's not conclusive, do the recommendation". Research was not conclusive across ERPs; ASC 250 supports retained earnings. Recommendation adopted; research addendum added.
- plan: overlap fixes from the projects branch session (6140, run synthesizer signature, Lease lines refuse projectId)

## Phase log
- research: lessor-side code map, purchasing / AP / accounting seam map, competitor + ASC 842 research → `.ai/research/2026-10-11-lessee-lease-accounting.md`
- research: STE-80 pass done (by the research agent; re-read by the main session)
- spec: `.ai/specs/2026-10-11-lessee-leases.md` drafted with Q1–Q7 resolved; Q8 open. STE-80 pass done

- plan: `.ai/plans/2026-10-11-lessee-leases.md` (34 tasks). Spec corrected during planning (Lease Run source type, type-aware Draft/Post/Reverse, inline void, invoiceFromDate, rouAssetCost, Skipped status). STE-80 pass done on plan and spec

## Outcome

## 2026-10-11 — Tasks 16–19, 22–24
- Task 22 committed (eb43f50f44). Task 23: lease-releasing purchase invoice deletes in `purchasing.server.ts` (mirrors sales `*ReleasingRentals`), MCP `invoicing_deletePurchaseInvoice*` blocked, digest regenerated (79a0681a20).
- Task 24: `create-lease-invoices` (01ea3c04b1). Found and fixed a schema gap: `purchaseInvoiceLine.invoiceLineType_check` refused a Lease line — migration `20261011202305_lease-invoice-line-type.sql`. Each drafted invoice gets its own `supplierInteraction` (NOT NULL), as `insertPurchaseInvoice` does.
- Tasks 16–19 (UI subagent) reviewed and committed (6bb7026427), with `$id.invoice.tsx`.
- Invariants: `tracked-entity-readable-id` fails on local seed data (25 rows); unrelated to leases.

## 2026-10-11 — Tasks 25–33
- 25 dc21d9d0c2: lease billing / reminders / expiry in recurring-billing; `drafted` digest outcome; `LeaseCriticalDate`. `expireLeases` / `stampLeaseReminders` live in `src/invoicing/lease-reminders.ts` (importing the job module pulls Lingui macros into vitest). Their SQL was run against the local DB; no behavioural DB test in @carbon/jobs (none exist there).
- 27 e4b2960412: lessee cutover open items (liability incl. a remeasurement after the last line before the cutover, ROU cost, accumulated amortization).
- 30 7d64a71cd0: opening-balance activation. As-of = `resolveAccountingPeriod(cutover, "historical-with-shift").postingDate`. An operating lease's retained-earnings leg is ~0 (straight-line cost = payments); the test uses a finance lease. Cancel ignores Posted rows without a run line.
- 26/28/29 a9175a930d (subagent), 31 d352fa6e07 (subagent + docs sidebar), 33 b071e12a3f (2,364 strings, 12 locales, glossary check exit 0).
- 32 sweep: typecheck 8/8 packages; tests utils 676, database 493, jobs 955, notifications 16, server-functions 613, ERP modules 810 — all pass. Biome: 0 errors. db:check:datasets 4/4, db:check:backups restorable, clobbers none.
- Known, unrelated: invariant `tracked-entity-readable-id` fails on local seed data.
- Follow-ups noted by the docs agent: `RECOGNIZED_REVENUE_VOID_ERROR` (post-sales-invoice) still says "revenue recognition run" for rental invoices; `period-close.mdx` seeded-checks table is stale; no `status-colors` map for leases.

## 2026-10-11 — Task 34 (browser)
All six flows PASS on the dev company (LSE000001, AP000008–12): create, activate (PV 65,742.03, journal on May 1), Invoice Now (5 drafts), post (Dr Lease Liabilities / Cr AP), void (row back to Pending), Lease Runs / Lease Liabilities / Settings pages. Playbook: .ai/playbooks/lessee-lease-lifecycle.md
