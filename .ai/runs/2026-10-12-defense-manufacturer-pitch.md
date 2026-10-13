# Feature run: Defense manufacturer pitch (WBS interop, progress payments, demo earned value)

- Date: 2026-10-12
- Mode: fully-autonomous
- Request: "ok let's build to that" — build what the pitch needs: (1) WBS interop: `wbsCode` on `projectElement` (derived from the tree position, can be pinned to the contract WBS), MIL-STD-881 starter templates, CSV import and export of the element tree, MS Project XML (MSPDI) export; (2) progress payments (SF 1443) and performance-based payments on contracts: request, liquidation on invoices, balance per contract; (3) a baseline and control accounts in the satellite demo dataset, and the deferred browser verification of Government Contracting 5a–5d.
- Phase plan: research [run — progress payments is accounting logic; 881 and MSPDI are external formats] · spec [run — data model, crosses modules] · plan [run] · execute [run] · test [run — new screens] · self-review [run]
- Scope: one run, one spec with 3 phases (user choice).
- Before phase 1: commit the ~70 uncommitted files already in the worktree as-is (user choice).

## Phase log
- Pre-run: committed the earlier worktree changes. 2c7b7809f3 (Missing Time report, report pages, translations, migration 20261012193140), 631806743b (charge number on schedule cards). All gates pass. The translation fill added 217 enforced glossary violations (2023 were already in the catalogs). They are reported, not repaired: the repair is a separate runbook.
- research: `.ai/research/wbs-interop-and-contract-financing.md` — 3 subagents (progress payments and PBP; MIL-STD-881F and WBS numbering; MSPDI and CSV exchange). STE-80 pass done.
- spec: `.ai/specs/2026-10-12-wbs-interop-and-contract-financing.md` — 17 open questions resolved autonomously (see Decisions). STE-80 pass done.
- plan: `.ai/plans/2026-10-12-wbs-interop-and-contract-financing.md` — 22 tasks in 3 phases. STE-80 pass done.
- execute: Tasks 1–20 committed (a8e827614b … b1d484227b). `pnpm test`: 35 of 35 turbo tasks pass.
- test: 3 isolated browser sessions (5a+5b, 5c+5d, A+B). 6 playbooks. 11 defects found, 10 fixed (2329a49b5a, 36f0abcc3c, ad39d8aea4, 14b401cbae, ec9baad0d4). Open: a manual journal accepts a posting date in year 100. Skipped: Community overlays (enterprise edition), the 5c snapshot freeze, the import on a locked plan, `db:seed:dev`.
- self-review: 2 reviewer subagents. 5 must-fix found and fixed (77a2d8c6e1, 8efe60f1d0, ad247e9815): an import parent loop that hung the server, import without create permission, a type change through import, a silent plan-lock refusal, corrections onto a held project. Also fixed: liquidation on a Partially Paid invoice, the stop-work date rule, code swaps on import, stripped names, XML control characters.
- Note: another session worked in this worktree at the same time (service UI, Settings → Time). Its commits are interleaved; its files were never staged here.

## Decisions
- Plan gate (2026-10-12): plan auto-approved in fully autonomous mode. Rationale: every spec acceptance criterion maps to a task; Task 21 is the browser verification.
- Spec gate (2026-10-12): all 17 Open Questions resolved autonomously; each is marked **Autonomous** in the spec. Key ones: pinned-only WBS code with derived codes computed on read; 881F templates as static data in `@carbon/utils`; project-scoped CSV import that never deletes; contract financing in `packages/ee` behind `GOVERNMENT_CONTRACTING`; the government payment is a customer deposit scoped to the contract (new nullable `payment.customerContractId`), liquidation is a deposit application; gross invoices; no `accountDefault` change. Schema changes are additive; the user asked for these features, and the PR lists them as assumed decisions.
- Subagents hit the usage limit during spec research (2026-10-12); the facts were gathered directly instead.


## Outcome
- execute: Task 3 committed with `CARBON_SKIP_BACKUP_CHECK=1`. `pnpm db:check:backups` fails on 5 tables (`lease`, `leaseLine`, `leaseEvent`, `leasePayment`, `leaseScheduleLine`) that main's `schema.json` has and this branch does not. The failure is from main moving ahead, not from this change. A rebase on main clears it.
- 2026-10-12: built, browser-verified with gaps, reviewed. Spec status `in-progress`: 5 acceptance criteria lack browser evidence. Not pushed; no PR.
- Data left in the dev company by the browser runs: test projects WBT881 and WBD, contracts CON000005 and CON000006, a fiscal-year-100 accounting period with a reversed journal (JE-2026-10-000049, reversed by …050 and offset by …051), user Grace Reviewer, account 6095, August and September 2026 Locked, FY2026 burden rates, posted test time.
