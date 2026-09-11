# Ramp Transaction Sync Research: Best Practices Survey

## Summary

Researched (1) the Ramp Developer API v1 surface, (2) how Ramp's own first-party ERP
integrations (NetSuite, QBO, Sage Intacct, Xero) and the wider industry (SAP Concur,
Oracle Fusion, Brex, Airbase, Coupa) post corporate-card spend into an ERP, and (3)
Carbon's existing integration + AP/payments architecture. The central finding: Ramp's
API is explicitly designed for the ERP to act as the *accounting provider* — Carbon
registers an accounting connection, pushes its chart of accounts/vendors/dimensions
INTO Ramp (coding happens in Ramp against real Carbon accounts), pulls `SYNC_READY`
objects (transactions, bills, bill payments, reimbursements, transfers, cashbacks),
posts them in Carbon, and confirms each one back via `POST /accounting/syncs`. The
industry-consensus accounting model is unanimous: the card is a **liability account**
(never per-merchant AP), every card transaction gets **exactly one accounting home**
(match to an existing document OR post directly to GL), the statement payment is a
**liability transfer, never P&L**, and only **cleared** transactions post. The "big
syncing problem" the user flagged decomposes into a small set of well-understood
dedupe rules that Ramp itself already half-solves (card-paid bills skip payment sync;
bills dedupe on vendor+invoice number / `remote_id`). Carbon has **no expense/card
document type today** — the single biggest design decision for the spec is what a
posted card transaction becomes in Carbon.

## Competitors Surveyed

- **SAP (S/4HANA + Concur)** — the enterprise reference for card-spend posting (SAE/FIS pipeline, clearing accounts, CBCP/IBCP liability models)
- **Oracle NetSuite** — Ramp's deepest first-party integration; native Credit Card Charge document model
- **QuickBooks Online** — the canonical SMB card-feed model (Match vs Add, Pay down credit card)
- **Xero** — bank-feed reconcile model; instructive API-limitation workaround (card = bank-type account)
- **Sage Intacct** — Credit Card Transaction + per-card offset account; notable gaps (no statement-payment sync)
- **Ramp itself** (first-party integrations + Developer API) — the system we integrate with
- **Brex / Airbase** — competing spend platforms; JE-first and vendor-bill-per-charge variants
- **Coupa** — the reference for PO-backed virtual-card spend
- **Oracle Fusion Expenses** — clearing-account pay models (Company Pay creates AP invoice payable to the *card issuer*)

## Key Consensus Patterns

### 1. The card is a liability account, never per-merchant AP
- **SAP/Concur**: card charges credit the card-issuer vendor or a card clearing account (CBCP); the merchant is never a creditor.
- **NetSuite/QBO/Intacct**: a dedicated Credit Card account type; charges post Dr Expense / Cr card liability. The "vendor" on a NetSuite CCT is informational — no AP open item.
- **Xero**: card is a bank-type account (API can't create credit-card accounts) — same semantics.
- **Oracle Fusion**: Company Pay creates a Payables invoice payable to the **card issuer**, never the merchant.
- **Rationale**: the merchant was paid at swipe by the bank; the company's only creditor is the card issuer. A per-merchant open bill for card spend is a duplicate liability and a documented source of duplicate payments.

### 2. Every card transaction has exactly one accounting home (match-or-add)
- **QBO**: bank-feed "Match vs Add" — match the feed line to an existing bill/expense/payment, or add a new expense coded to GL.
- **Xero**: reconcile screen match-or-create; NetSuite: Intelligent Transaction Matching.
- **Ramp**: a bill paid by Ramp card is deliberately NOT synced as bill+payment — it flows through card accounting once ("accounted for as a normal card purchase").
- **Rationale**: bill + card charge = double expense; the match step is what prevents it.

### 3. Coding happens in the spend tool; the ERP receives GL-complete native objects
- **Ramp**: pulls the ERP's full CoA, dimensions, and vendors; coding (GL account, dimensions, memo, receipt) is done in Ramp; the synced object arrives fully coded. Sync gate = **cleared + fully coded + marked ready** (`sync_status: SYNC_READY`).
- **Concur**: coding on the expense report; SAE/FIS posts finished FI documents.
- **Brex**: same, with JE (single/batched) or native-CCT export modes.
- **Rationale**: the person with spend context codes once, near the spend; the ERP is the system of record, not the coding UI.

### 4. Statement payment = liability settlement, never P&L
- **QBO** "Pay down credit card", **Xero** Transfer, **NetSuite** Write Check (Dr card liability / Cr bank), **Ramp** syncs statement payments as "checks" doing exactly this. Sage Intacct is the cautionary tale: Ramp doesn't sync statement payments there at all — users book them manually.

### 5. Only cleared transactions post; pending auths are operational, not accounting
- **Ramp**: codeable/syncable only once fully cleared on the network; pending excluded from the accounting inbox. **QBO/Xero** feeds carry posted/cleared only. **Brex**: posted-only, with auto-reversing month-end accrual JEs for unreviewed spend (Ramp offers the same accrual option on NetSuite).
- **Rationale**: auth amounts change at capture (tips, FX, partial capture); some auths never settle.

### 6. PO-backed card spend keeps the PO document chain; the card is just the settlement rail
- **Coupa**: virtual card generated from the approved PO; charge auto-matches back to PO/invoice.
- **NetSuite manual pattern**: receive → bill (3-way match) → pay the bill FROM the credit-card account (Dr AP / Cr card liability).
- **Ramp**: bill↔PO matching (multi-PO, line-level on NetSuite), auto-fetches item receipts for 3-way match; single-use-card bill payments auto-match to their card transaction.

### 7. Dedupe is directional discipline, keyed on external ids
- Ramp bill import dedupes on **vendor + invoice number**; API objects carry **`remote_id`** (the ERP's id) on bills, POs, vendors, accounting objects.
- Payments attach to existing ERP bills instead of recreating them; `POST /accounting/syncs` marking is idempotent (`idempotency_key` required, Ramp dedupes).
- Synced card transactions are **immutable in Ramp** (fix-in-ERP only); bills re-sync edits.

## Answers to Research Questions

1. **What entities does Ramp's API expose, with what lifecycles?** — Answered (Ramp docs).
   - **Transactions**: `state: PENDING_INITIATION|PENDING|CLEARED|COMPLETION|DECLINED|ERROR`; separately `sync_status: NOT_SYNC_READY|SYNC_READY|SYNCED`. Carry `accounting_field_selections[]` (typed coding incl. `GL_ACCOUNT`, `COST_CENTER`, etc. with YOUR `external_id`), `line_items[]` (splits), `receipts[]`, `merchant_*`, `card_holder`, `statement_id`, amounts as `CurrencyAmount` (integer minor units).
   - **Bills**: `status: OPEN|PAID`, `approval_status`, granular `status_summary`; `sync_status: NOT_SYNCED|BILL_SYNCED|BILL_AND_PAYMENT_SYNCED`; line items with `purchase_order_line_item_id`; nested `payment` object (method enum incl. `ACH`, `CHECK`, `CARD`, `ONE_TIME_CARD`, `PAID_MANUALLY`); `remote_id` writable; `invoice_number`, `deep_link_url`. **Bills/POs have no updated-at filter** — use webhooks or periodic re-pulls.
   - **Purchase orders**: full CRUD via API; `creation_source: RAMP|DEVELOPER_API|ACCOUNTING_PROVIDER|EXTERNAL_IMPORT`; `billing_status`, `receipt_status`; line items with `remote_id`. **Item receipts** endpoints exist for 3-way match.
   - **Bill payments**: no dedicated endpoints — nested in the bill; `payments.updated` webhook.
   - **Transfers** (statement/balance payments pulled from the company bank): `GET /transfers`, `status` enum (INITIATED…COMPLETED…), `sync_status`, filterable by `statement_id`. **Statements**: `GET /statements` with balances and statement lines. **Cashbacks**: own endpoint with `sync_status`.
   - **Reimbursements**: `DRAFT→PENDING→APPROVED→REIMBURSED` (+ payment/export states), `sync_status`, `updated_after` filter, line items with coding.
   - **Vendors** (3 distinct objects): read-only card **merchants**; Ramp **vendors** (bill-pay payees, `accounting_vendor_remote_id` links to ERP vendor); **accounting vendors** (ERP-side coding options Carbon uploads, batch ≤500).
2. **How does Ramp's accounting-sync model work?** — Answered (ERP-integrations guide). Register a connection (`POST /accounting/connection`, `remote_provider_name` shown to the customer); push GL accounts (`classification: ASSET|LIABILITY|…|CREDCARD`), custom fields + options, vendors, entities (all with YOUR remote ids; responses return `ramp_id`); pull ready objects (`sync_status=SYNC_READY`, bills `sync_ready=true`); post to ERP; confirm with `POST /accounting/syncs {idempotency_key, sync_type: TRANSACTION_SYNC|BILL_SYNC|BILL_PAYMENT_SYNC|REIMBURSEMENT_SYNC|TRANSFER_SYNC|STATEMENT_CREDIT_SYNC, successful_syncs:[{id, reference_id, deep_link_url?}], failed_syncs:[{id, error:{message}}]}`. Failed syncs surface in the customer's Ramp Accounting tab as export errors. Bills are two-phase (BILL_SYNC, then BILL_PAYMENT_SYNC when PAID). `POST /accounting/codings` writes coding back onto transactions; `POST /accounting/ready-to-sync` can mark objects ready programmatically. Only one active connection per Ramp business — **a customer cannot have Ramp→Xero direct AND Ramp→Carbon simultaneously**, which conveniently prevents double-booking through two channels.
3. **What ERP document do card transactions become?** — Answered. Native credit-card documents where the ERP has them (QBO Expense, NetSuite Credit Card Charge, Intacct Credit Card Transaction), a bank transaction where it doesn't (Xero), journal entries as Brex's default. Always Dr expense / Cr card-liability, at the cleared amount, dated transaction-date or clearing-date (configurable in Ramp). **Carbon has no such document type — greenfield decision.**
4. **How is the matching problem handled?** — Answered. (a) Pure card spend: never matched — posts directly as a coded card charge. (b) Bills: dedupe on vendor+invoice number and `remote_id`; ERP-born bills can be pushed into Ramp (`POST /bills` w/ `remote_id`) or imported by Ramp (first-party); payments attach to the existing ERP bill. (c) POs: ERP POs pushed to Ramp (`POST /purchase-orders` w/ `remote_id`); Ramp OCR-matches invoices to POs; the resulting bill carries `purchase_order_id` + line-level `purchase_order_line_item_id` so the ERP can post it against its own PO. (d) Bill paid by Ramp card: Ramp suppresses the bill-payment sync; only the card transaction posts.
5. **How is double-posting avoided when a bill and its payment both flow?** — Answered. The bill's `sync_status` drives phase (BILL_SYNC vs BILL_PAYMENT_SYNC); payments to imported/ERP-born bills post as payment-only against the existing bill; card-paid bills route entirely through card accounting; statement payments post as liability transfers so they never touch P&L; "Mark as synced" exists as a bypass for entries handled outside the sync.
6. **Auth, sandbox, mechanics?** — Answered. OAuth2: client_credentials (10-day tokens, single-tenant "internal" apps) or authorization_code + refresh (1-hour tokens; **required for multi-tenant third-party apps**; only Admin/Owner can authorize; authorize URL `https://app.ramp.com/v1/authorize`, sandbox `https://demo.ramp.com/v1/authorize`). Sandbox API base `https://demo-api.ramp.com`; demo-actions panel (⌘J) simulates paying bills / adding transactions. Cursor pagination (`start`, `page_size≤100`, `page.next`). Rate limit 200 req/10 s. Webhooks: managed via API, HMAC-SHA256 `X-Ramp-Signature` over raw body, challenge verification, 10 retries w/ backoff, out-of-order delivery possible, thin payloads (re-fetch by id) — keep a fallback polling loop. Incremental polling: transactions `synced_after`, reimbursements `updated_after`, vendors `from_updated_at`; bills/POs need webhooks or re-pulls. Idempotency: `idempotency_key` on `/accounting/syncs` (and others); webhook event `id` for delivery dedupe.

## Competitor-Specific Details

### Ramp first-party integrations (the behavior to emulate)
- Sync is a committed action (Sync button or scheduled auto-sync) with per-item status (`SYNC_SUCCESS|SYNC_FAILURE|IN_PROGRESS|NOT_STARTED`), Sync History, Retry Sync, and "Mark as synced" bypass.
- Post-sync, card transactions lock in Ramp (no unsync; fix in the ERP). Bills stay editable and re-sync.
- Closed accounting period → Ramp shifts the accounting date to the first day of the next open period before syncing (logged in activity history).
- Repayments (employee pays company back) reverse the original expense lines (Deposit/JE/credit variants per provider).
- NetSuite month-end accrual option: JE for unsynced expenses + auto-reversal; accounting date of late-synced transactions moves to the reversal date.
- Explicit guidance to disable bank-feed auto-create in the ERP — the sync writes the ledger records; the feed only matches/clears them.

### SAP Concur (enterprise reference)
- Two posting paths: batch SAE file, or near-real-time Financial Integration Service with per-document success/error confirmations back to Concur — the formalized version of Ramp's `POST /accounting/syncs` loop (Carbon should mirror this: per-object `reference_id` on success, actionable message on failure).
- Liability models: CBCP (company pays issuer; central clearing account pivots expenses to departments), IBCP (split: business→issuer vendor, personal→employee), lodge cards centrally billed.

### NetSuite / QBO / Xero / Intacct mechanics worth copying or avoiding
- NetSuite CCT: transaction-level subsidiary/vendor + line-level account/department/class/location/customer/billable — the dimension shape Carbon's `journalLineDimension` should receive.
- QBO: vendor auto-created only after the transaction clears; USD-only limitation.
- Xero: statement payments as bank transactions on the "Ramp Card" bank account (API workaround).
- Intacct: unique offset account per card; **no statement-payment sync** (manual) — avoid this gap.

### Brex / Airbase (variant approaches)
- Brex: export-type choice (JE single/batched vs native CCT vs vendor-bill+auto-payment). Vendor-bill mode creates the bill *already paid* so no open AP survives — the only defensible "bill for card spend" variant.
- Airbase: vendor bill per cleared charge billed to an "Airbase Card" vendor; deep amortization-template support.

### Carbon (current state — what the integration builds on)
- **Integration framework** (`packages/ee/src`): `defineIntegration` config + `integrations` array (`packages/ee/src/index.ts`), server hooks in `hooks.server.ts` (`onInstall`/`onUpdate`/`onUninstall`/`onHealthcheck`), settings drawer at `apps/erp/app/routes/x+/settings+/integrations.$id.tsx`, seed migration required (`integration` table row), secrets in Supabase Vault via `SECRET_KEYS` + `persistIntegrationSecrets`/`resolveIntegrationSecrets` (`packages/ee/src/integrations/secrets.ts`, newest layer, Aug 17). OAuth callback routes under `apps/erp/app/routes/api+/integrations.{provider}.oauth.ts` (Xero is the model).
- **Accounting sync engine** (`@carbon/ee/accounting`): `ProviderID` = xero|quickbooks|rillet; `SyncFactory` + per-entity syncers; `externalIntegrationMapping` table is THE id-linking mechanism (per-entity `externalId` columns are dropped); `accountingSyncOperation` ledger with Pending→In Flight→Completed/Failed/Skipped/Warning; Inngest crons (`accounting-pull-sweep` */30 with metadata pull cursors — the "Celigo cursor rule"; `accounting-outbound-sweep`; weekly reconciliation). **Ramp is NOT naturally a new `ProviderID`** — it's a spend source, not a GL destination; it fits the generic integration framework with its own pull pipeline.
- **Payment write-back seam already built for Ramp**: `core/payment-syncer.ts` Phase G pushes Carbon-recorded payments out so the accounting provider's bill closes — the rule literally cites "a bill paid through Ramp."
- **Inbound webhooks**: React Router routes `apps/erp/app/routes/api+/webhook.{provider}.$companyId.ts`, Node runtime, raw body → HMAC verify (fail-closed, Rillet pattern) → `trigger(...)` Inngest → fast ack.
- **AP model**: `purchaseInvoice` (status Draft/Pending/Open/Partially Paid/Paid/Voided/Overdue; balance computed in view from `invoiceSettlement` with $0.01 dust forgiveness) + `purchaseInvoiceLine` (`invoiceLineType` incl. **'G/L Account'** — the only direct-expense line type today) posting via `post-purchase-invoice` edge fn (Dr expense/inventory / Cr `accountDefault.payablesAccount`). Unified `payment` table (Receipt|Disbursement; Draft→Posted→Voided; **`bankAccount` is an `account.id` FK** — a card-liability account can be the paying account) + `invoiceSettlement` (application primitive with discount/write-off/FX) posting via `post-payment`. `memo` for credit/debit memos. NET tie-out + aging RPCs.
- **PO model**: `purchaseOrder` (Draft→…→To Receive and Invoice→Completed) → receipt (`post-receipt`) → invoice via `convert` edge fn; lines carry `purchaseOrderLineId` linkage.
- **Missing entirely**: any expense/card-transaction/reimbursement document type; any "employee as payee" concept; `supplierLedger` is legacy/dead. Direct GL spend today = G/L Account invoice line or a Manual journal (Manual journals never sync to accounting providers).
- **Account resolution**: `accountDefault` (single row per company; posting groups dropped) — a Ramp card liability account mapping would live beside it in integration metadata or as a new default.

## Recommended Approach for Carbon

1. **Build Carbon as a Ramp "accounting provider" over the ERP-integration API** (Ramp's own intended shape): register an API accounting connection on install, push Carbon's CoA (`accounting/accounts` with `classification`), cost-center/dimension field options, and suppliers (`accounting/vendors`, keyed by Carbon ids as `remote_id`), then run the pull → post → confirm (`POST /accounting/syncs`) loop. This follows the SAP Concur FIS confirmation pattern and gives customers coding-in-Ramp against real Carbon accounts.
2. **Map the Ramp card to a liability account in Carbon** (chosen at install, like Ramp's first-party setup). Card transactions post Dr coded expense account(s) / Cr card liability; statement payments (Ramp **transfers**) post Dr card liability / Cr mapped bank account. Never create a supplier or supplier invoice for a card merchant (NetSuite/QBO/Concur consensus; duplicate-liability rule).
3. **Decide the Carbon document for a card charge in the spec** — the one genuinely open design question. Candidates: (a) a new lightweight `cardTransaction`-style document posting its own journal (NetSuite CCT analog — cleanest, most work), (b) journal entries with a new `journalEntrySourceType` (Brex JE model — least schema, weakest UX/auditability), (c) auto-paid purchase invoice with G/L Account lines (abuses AP; violates the no-merchant-AP consensus — include only to reject). Research recommends (a) or (b); NOT (c).
4. **Bills**: Ramp Bill Pay bills → Carbon `purchaseInvoice` (two-phase per `sync_status`): BILL_SYNC creates/links the invoice (dedupe via `externalIntegrationMapping` + supplier+invoice_number); BILL_PAYMENT_SYNC creates a Posted `payment` + `invoiceSettlement` against it (bank account = mapped Ramp funding account). Bills paid by Ramp card: follow Ramp — card transaction only. Carbon-born invoices can push into Ramp later (`POST /bills` w/ `remote_id`) — candidate phase 2.
5. **POs**: phase-2 push of Carbon POs into Ramp (`POST /purchase-orders`, `remote_id` = Carbon id, line `remote_id` = line id) so Ramp's OCR bill↔PO matching returns bills pre-linked to Carbon PO lines (`purchase_order_line_item_id`), letting Carbon post them through the existing PO→invoice chain. Coupa/NetSuite pattern: the PO chain stays intact, the card/Ramp is the settlement rail.
6. **Reimbursements**: defer or gate behind a per-company "employee payee" decision — Carbon has no employee-expense concept; first-party integrations use employee-as-vendor bills, which would pollute Carbon's supplier master. Explicit spec question.
7. **Transport**: webhook route (`webhook.ramp.$companyId.ts`, Rillet HMAC pattern, thin-payload re-fetch) for `transactions.ready_to_sync`, `bills.*`, `payments.updated` + an Inngest polling sweep (accounting-pull-sweep pattern) with per-entity cursors (`synced_after` for transactions, `updated_after` for reimbursements, re-pulls for bills/POs) as the correctness floor. Confirm every posting back with idempotency-keyed `/accounting/syncs`; write actionable failure messages (they render in the customer's Ramp UI).
8. **Sync gate**: post only `CLEARED` + `SYNC_READY` objects (consensus #5); ignore pending auths in v1. Respect Carbon period locks by shifting accounting date forward (Ramp first-party behavior) or failing with a clear message.
9. **Auth**: authorization-code OAuth (Xero-pattern callback route) since Carbon is multi-tenant; sandbox (`demo-api.ramp.com`) needs a separate Ramp app registration. Secrets → vault (`SECRET_KEYS.ramp = ["credentials.accessToken","credentials.refreshToken", webhook secret]`).
10. **Coexistence guard**: Ramp allows only one active accounting connection — connecting Carbon disconnects any Ramp→Xero/QBO direct link. Document this; Carbon's own downstream sync (Carbon→Xero/QBO/Rillet) then carries the postings onward via the existing journal/bill sync, so books stay single-sourced.

### Open questions to carry into the spec
- Which Carbon document represents an unmatched card transaction (new doc type vs journal source)? (Recommendation 3.)
- Statement-payment representation: Carbon `payment` requires a customer/supplier party — transfers have none. New party-less posting path, or a journal with a new source type?
- Reimbursements in v1 or deferred? If in: employee-as-supplier vs a new payee concept.
- Which Carbon dimensions push to Ramp as coding fields in v1 (cost centers? jobs/projects? departments)?
- OAuth app registration: does Brad create the Ramp developer apps (prod + sandbox), or per-customer client-credentials as an interim (Rillet-style API-key UX)?
- Pending-transaction visibility: ignore entirely (consensus) or show a non-accounting "pending card activity" view?
- Do Carbon-born purchase invoices push to Ramp for payment in v1, or is v1 strictly Ramp→Carbon?

## Sources

### Ramp Developer API (machine-readable docs)
- https://docs.ramp.com/llms.txt · https://docs.ramp.com/llms-api.txt · https://docs.ramp.com/openapi/developer-api.json
- https://docs.ramp.com/llms-guides/authorization.txt · getting-started.txt · sandbox.txt · sandbox-access.txt
- https://docs.ramp.com/llms-guides/erp-integrations.txt (core accounting-sync guide)
- https://docs.ramp.com/llms-guides/bill-pay.txt · bill-payments.txt · procurement.txt · reimbursements.txt
- https://docs.ramp.com/llms-guides/webhooks.txt · pagination.txt · rate-limiting.txt · monetary-values.txt · error-handling.txt · deferred-tasks.txt
- https://docs.ramp.com/developer-api/v1/guides/transfers · https://support.ramp.com/hc/en-us/articles/6169690785043

### Ramp first-party integrations
- https://support.ramp.com/quickbooks-online-overview · /netsuite-overview · /sage-intacct-overview · /xero-overview/
- https://support.ramp.com/overview-of-ramp-accounting · /bill-pay-accounting · /importing-bills-from-your-accounting-provider
- https://support.ramp.com/importing-and-matching-purchase-orders-pos-on-ramp-bill-pay · /3-way-match-with-ramp-procurement · /ramp-procurement-quick-start-guide
- https://support.ramp.com/marking-transactions-as-synced/ · /syncing-reimbursements-to-accounting · /sync-repayments-to-your-accounting-software
- https://support.ramp.com/hc/en-us/articles/36243535902355-Sync-Error-Accounting-Period-Closed · /ramp-checking-account-bank-feeds · /reconciliation-report-for-quickbooks-online · /managing-accounting-rules · /reviewing-transactions-from-ramp-cards
- https://community.ramp.com/t/unsync-or-unlock-a-synced-credit-card-transaction-to-allow-edits-bill-pay-match/1373
- https://ramp.com/blog/common-questions-ramp-netsuite-integration · https://ramp.com/netsuite-direct

### Industry consensus
- SAP/Concur: https://developer.concur.com/api-guides/ERP-integration/posting-via-financial-integration-service.html · https://help.sap.com/docs/SAP_CONCUR/f959944ebe30460dbe11e7ccbec19319/188ab11d6f0910148aeadacb5c6cb0d4.html · https://github.com/concur/developer.concur.com/blob/preview/src/api-reference/financial-integration/v4.financial-integration-service-use-cases.markdown · Concur community threads (IBCP/CBCP, clearing accounts, lodge cards — see research agents' full lists)
- Oracle Fusion: https://docs.oracle.com/cd/E48434_01/fusionapps.1118/e49599/F1110434AN7B1F9.htm · https://docs.oracle.com/en/cloud/saas/financials/25c/faiex/options-for-deciding-who-pays-the-corporate-card-issuer.html
- NetSuite: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N1548363.html (+ CCT entry, card-bill payment, reconciliation sections)
- QuickBooks: https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-feeds/match-online-bank-transactions-quickbooks-online/L6qyw0PvP_US_en_US · /record-payments-credit-cards/L7IjpiWLZ_US_en_US · /handle-duplicate-credit-card-transactions/L4hwxdIYm_US_en_US
- Xero: https://central.xero.com/0/article/Manage-your-credit-card-account-AU
- Brex: https://www.brex.com/support/netsuite-overview · /netsuite-integration · /accrued-spending
- Airbase: https://suitecentric.com/blog/airbase-integration-with-netsuite/
- Coupa: https://www.coupa.com/products/pay/virtual-card · https://supplier.coupa.com/coupa-pay-help/credit-cards/
- Sage 50: https://help-sage50.na.sage.com/en-us/2019/Content/Transactions/Accounts_Payable/Accounts_Payable_HDI/Pay_the_Credit_Card_Vendor_Purchases.htm
- (Caveat: blogs.sap.com and some community.concur.com pages returned 403 — those claims sourced from search snippets against the cited URLs.)

### Carbon internals (file paths, no URLs)
- `packages/ee/src/` (index.ts, fns.ts, types.ts, hooks.server.ts, integrations/secrets.ts)
- `packages/ee/src/accounting/` (core/models.ts, core/types.ts, core/service.ts, core/subscriptions.ts, core/external-mapping.ts, core/payment-syncer.ts, core/payment-application.ts, providers/rillet/)
- `packages/jobs/src/inngest/functions/integrations/` (accounting-pull-sweep.ts, accounting-outbound-sweep.ts, accounting-sync-operations.ts, reconcile.ts)
- `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` · `apps/erp/app/routes/api+/webhook.rillet.$companyId.ts` · `integrations.xero.oauth.ts`
- Migrations: `20230924004608_accounts-payable.sql`, `20260630093809_ar-ap-payments.sql`, `20260128140000` (externalIntegrationMapping), `20260817122916` (secret vault)
- `packages/database/supabase/functions/{post-purchase-invoice,post-payment,convert}/`
- Rules: `.claude/rules/accounting-sync-handlers.md`, `.claude/rules/event-system.md`, `.claude/rules/customer-supplier-database-schema.md`
