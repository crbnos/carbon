# Accounting purchases and intercompany posting

Last verified: 2026-09-09 against the existing local stack.

Companion to [Accounting posting corrections](accounting-posting-corrections.md).
This playbook caches passing purchase and intercompany workflows. Failed refund
and fixed-asset master reversal behavior is documented separately in the run
report; a passing GL reversal does not prove the asset master was restored.

## Prerequisites

Use isolated owned companies with seeded accounting defaults, currencies, fiscal
periods and sequences. Enable accounting on the fixture companies. Create a common
root/group with seller and buyer subsidiaries for IC; `seed-company` already
creates an elimination entity. Discover that entity instead of assuming a manually
created one will be selected. Install no outbound integrations on these fixtures.
Suppress outbound sync during database fixture setup and use real posting APIs.

Authenticate through `/auth`. If local HTTPS API certificate handling prevents
Node fetches, the existing Kong HTTP port from `.env.local` can run local edge
requests. Authenticated HTTP route testing can use a locally generated magic link,
OTP verification and the production `/callback` action; avoid replacing the
service-role client's auth session when doing so. These requests carry magic
links and OTPs in cleartext, and `docker-compose.dev.yml` publishes
`"${PORT_API}:8000"` on every host interface — so on a shared or untrusted
network, bind it to loopback (`"127.0.0.1:${PORT_API}:8000"`) before running
this playbook.

## Direct inventory AP purchase

1. Prepare a EUR invoice at rate 1.1, quantity 2 × purchase conversionFactor 5,
   supplier unit price 55, line freight 5.5, line tax 2.2, header freight 11 and a
   separate negative supplier G/L amount−11.
2. Invoke `post-purchase-invoice` on the Draft. Verify 10 inventory units, signed
   AP 107 base /117.70 EUR. Header freight is allocated proportionally across signed
   line totals: inventory 118.03093, negative expense−11.03093, net 107.
3. Change the fixture's payables default. Create/post a EUR 117.70 supplier
   Disbursement at rate 1.1 against this invoice. Verify original AP 107 relieved,
   invoice Paid, source principal 117.70 and FX 0.
4. Void payment; invoice returns Open with 107 base. Void invoice; group every
   original/reversal journal by account and verify net 0. Owned item/cost layers
   net 0. `get_ap_tie_out` variance must remain 0.

## Receipt-owned costs and purchase units

1. Create the PO with actual `insertPurchaseOrder` service/API; never insert the
   PO header directly. Add two lines with purchase quantities 2 and 1, factor 5,
   unit price 55, line shipping 5.5, supplier tax 2.2, rate 1.1; header freight 11.
2. Call actual `finalizePurchaseOrder`, then `create` with
   `type: receiptFromPurchaseOrder`. The create endpoint returns `{id}` without
   a `success` field. Post that receipt.
3. Verify 15 inventory units and 174 base cost /191.40 EUR. Create/post a matching
   purchase invoice; verify zero PPV and no duplicate invoice-owned cost/item rows.
4. Void invoice. Receipt-owned inventory/cost records must be unchanged, PO
   `quantityInvoiced` must be 0 in purchase units, and invoice journals must net 0.

## Supplier applications

1. Prepare invoice 100 and draft supplier Disbursement 90. Post the real
   `/x/payments/{id}/applications/set` action with applied 90, discount 5, writeoff 5,
   source/target rate 1 and exact source 90. Verify the saved settlement, post, and
   verify Paid, cash−90, supplier discount expense−5, writeoff revenue+5.
2. Prepare a posted supplier Debit memo 30, invoice 50, and draft Disbursement 0.
   Submit `/x/payments/{id}/credits/set` with memoId, invoiceId, amount 30 and
   sourceAmount 30. Post; invoice becomes Partially Paid with 20 remaining.
3. Source memo void must be refused while consumed. Void consumer and verify
   invoice 50 restored, then void memo and invoice. Final AP tie-out variance 0.

## Actual IC posting, matching and elimination

1. Seller acquires 3 tracked units at 60 each using real purchase posting. Seller
   invoices the IC customer `3 × 100.005`; buyer purchases the same trade from
   its IC supplier. Both actual `intercompanyTransaction.amount` values must be
   exactly 300.015 (matching uses internal precision).
2. Run `matchIntercompanyTransactions` for the owned group. Verify reciprocal
   source/target journal anchors and Matched status. Run `generateEliminationEntries`.
   For BOTH the IC Balance and IC Revenue journals, assert total debits equal
   total credits explicitly — matching account-class signs shows the entries
   point the right way, it does not prove the journal balances, which is the
   invariant `postJournalEntry` enforces before posting. Then verify
   revenue 300.015, COGS 180 and buyer inventory margin 120.015 are eliminated.
3. Sell 1.5 of the buyer's3 units externally through real sales posting. Explicitly
   regenerate eliminations; all previous entries are reversed, remaining deferred
   profit is 60.0075. A normal rerun creates 0 entries; repeated regeneration changes
   no net account balance.
4. Repeat with two merchandise lines 100/50, line shipping 5/2, tax percent 0.1,
   header shipping 8. Supplier tax amounts are 10.5/5.2. Verify matching key 157,
   both controls 180.70, seller captured revenue 165, external tax 15.70 excluded,
   buyer capitalization 180.70 and all lines included in balanced eliminations.
5. Repeat a100 transfer with seller group cost 60 and a buyer Fixed Asset line.
   Actual purchase activates 100 acquisition and captures the buyer asset account.
   Elimination removes 40 margin from that account. The engine creates one shared
   balance journal per pair and one revenue journal per trade; retries add no net
   duplicates.

## Evidence

The 2026-09-09 isolated fixture IDs, exact HTTP results, original/reversal GL rows,
matching/capture IDs and final assertions are in
`.context/accounting/e2e-20260909/purchase-ic-results.md` and its linked JSON files.

## Payment fixes verified 2026-09-09

The prior supplier refund and final-cent memo failures are fixed. Reuse `.context/accounting/e2e-20260909/fix-supplier-live.ts` as a reference for new uniquely named fixtures; the recorded fixtures are already voided and must not be replayed as fresh documents.

- Published `applyCreditsToInvoices` accepts omitted `createdBy` and injects the API-key actor. A EUR 160.01 memo/invoice at rate 16000 posts source 160/base.01 and then source.01/base 0 successfully.
- Published `replaceInvoiceSettlements` accepts supplier Receipt refunds with `targetMemoId`. Refund EUR 22 at rate 1.25 against a EUR 55 memo at 1.1 posts AP 20, bank 17.6, FX loss 2.4 and leaves exact memo principal 33/base 30. Final refund 33 clears the memo; every stage has AP tie-out variance 0.
- Memo void is blocked while posted refunds consume it. Void the refund payments, then the memo. Exact reversal restores the books.
- An unallocated supplier Receipt EUR 55 at 1.1 appears as AP+50 in both aging and tie-out; void restores 0.
- Pure/transaction verification: post-payment + post-memo Deno directories 69/69; ERP settlement service 55/55. Evidence and IDs: `.context/accounting/e2e-20260909/fix-payments-results.md` and `fix-supplier-live-evidence.json`.
