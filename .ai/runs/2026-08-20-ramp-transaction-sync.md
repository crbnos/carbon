# Feature run: Ramp transaction sync integration

- Date: 2026-08-20
- Mode: approval-per-phase
- Request: "we need add a /feature for a Ramp integration that allows transactions from ramp to flow back to carbon. there is quite a big syncing problem here. i believe ramp has purchase orders, purchase invoices and payments. they also have payments without anything." + "here are the api documentation: https://docs.ramp.com/developer-api/v1/introduction we have sandbox access that we can use for testing. please start by getting a good understanding of ramp and carbon"
- Phase plan: research [run — ERP-domain (AP/payments/accounting sync), user explicitly requested understanding phase] · spec [run — crosses modules, new data model, hard matching problem] · plan [run] · execute [run] · test [run — integration settings + matching UI are user-facing; confirm at phase time] · self-review [run — default]

## Decisions
<!-- approval mode: gates are human; decisions recorded as the user makes them -->
- 2026-08-20 (user, post-research): (1) Card transactions → NetSuite approach: new lightweight card-transaction document with its own posting (Dr expense / Cr card liability). (2) Statement payments → my best-practice call (delegated). (3) Reimbursements IN v1 (mechanism delegated to spec). (4) Coding dimensions pushed to Ramp: all EXCEPT items, customers, suppliers — those can be added later. (5) Direction: BOTH — push Carbon POs/invoices into Ramp AND pull Ramp bills/payments/transactions into Carbon. (6) Auth: OAuth is the destination; if sandbox blocks it, develop on API-style client credentials first, migrate to OAuth later (Ramp client_credentials uses the same client id/secret, so the credential schema supports both from day one).

## Phase log
- research: DONE 2026-08-20 — .ai/research/ramp-transaction-sync.md. Five parallel agents (Ramp API v1, Ramp first-party ERP integrations, industry consensus, Carbon integration architecture, Carbon AP/payments model). Key conclusions: Carbon acts as Ramp's "accounting provider" (push CoA/vendors → pull SYNC_READY → post → confirm via POST /accounting/syncs); card = liability account, never merchant AP; one accounting home per transaction; statement payments = liability transfers via Ramp "transfers" endpoint; only CLEARED+SYNC_READY posts; Carbon has NO card/expense document type today (biggest open design question). 7 open questions carried to spec (see findings file).
- spec: DONE 2026-08-20 — .ai/specs/2026-08-20-ramp-transaction-sync.md (status draft). All open questions resolved: six by user, five sub-decisions delegated + documented for veto (statement payments as cardTransaction type Payment; reimbursements as employee-as-supplier invoices; explicit Send-to-Ramp action; cashbacks in scope; no Carbon-side sync ledger v1; invoicing module home; optional entity filter). Prior-art note: bank-reconciliation spec (in-progress, tables NOT built) — composed with, not duplicated.
- 2026-08-20 (user, veto round): repayments IN scope v1 → spec updated (cardTransaction type Repayment, repaid_at cursor, expense-line reversal; confirm mechanism = sandbox-verify). Bank-rec sequencing assessed: build Ramp first (orthogonal; compose at journal-line level).
- 2026-08-20 (user, veto round 2): invoice→Ramp push = AUTOMATIC as submitted DRAFT bills — Ramp's own approval workflow decides approval (user's insight; POST /bills auto-approved path never used). Spec updated: pushInvoices toggle, archive-on-Carbon-settlement, double-payment-race risk, draft-API verify items. Spec now final pending plan-phase go.
- plan: DONE 2026-08-20 — .ai/plans/2026-08-20-ramp-transaction-sync.md (14 tasks). Precedent research via 3 Explore agents (ee integration shapes, jobs/webhook wiring, invoicing/DB). Spec amended (changelog): sweep-cursor outbound transport (SYNC handler is ProviderID-locked), payment-sibling single-column xid() PK, dynamicOptions account pickers, v1 dimensions = cost centers. Task 1 = sandbox endpoint verification (BLOCKED on user creds at execute time).
- NEXT (awaiting approval): execute — 🛑 plan approval gate. Task 1 needs sandbox clientId/clientSecret from Brad.

## Outcome
- (in progress)
