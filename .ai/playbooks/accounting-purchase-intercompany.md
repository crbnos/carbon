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
service-role client's auth session when doing so.

## Direct inventory AP purchase

1. Prepare a EUR invoice at rate1.1, quantity2 × purchase conversionFactor5,
   supplier unit price55, line freight5.5, line tax2.2, header freight11 and a
   separate negative supplier G/L amount−11.
2. Invoke `post-purchase-invoice` on the Draft. Verify10 inventory units, signed
   AP107 base /117.70 EUR. Header freight is allocated proportionally across signed
   line totals: inventory118.03093, negative expense−11.03093, net107.
3. Change the fixture's payables default. Create/post a EUR117.70 supplier
   Disbursement at rate1.1 against this invoice. Verify original AP107 relieved,
   invoice Paid, source principal117.70 and FX0.
4. Void payment; invoice returns Open with107 base. Void invoice; group every
   original/reversal journal by account and verify net0. Owned item/cost layers
   net0. `get_ap_tie_out` variance must remain0.

## Receipt-owned costs and purchase units

1. Create the PO with actual `insertPurchaseOrder` service/API; never insert the
   PO header directly. Add two lines with purchase quantities2 and1, factor5,
   unit price55, line shipping5.5, supplier tax2.2, rate1.1; header freight11.
2. Call actual `finalizePurchaseOrder`, then `create` with
   `type: receiptFromPurchaseOrder`. The create endpoint returns `{id}` without
   a `success` field. Post that receipt.
3. Verify15 inventory units and174 base cost /191.40 EUR. Create/post a matching
   purchase invoice; verify zero PPV and no duplicate invoice-owned cost/item rows.
4. Void invoice. Receipt-owned inventory/cost records must be unchanged, PO
   `quantityInvoiced` must be0 in purchase units, and invoice journals must net0.

## Supplier applications

1. Prepare invoice100 and draft supplier Disbursement90. Post the real
   `/x/payments/{id}/applications/set` action with applied90, discount5, writeoff5,
   source/target rate1 and exact source90. Verify the saved settlement, post, and
   verify Paid, cash−90, supplier discount expense−5, writeoff revenue+5.
2. Prepare a posted supplier Debit memo30, invoice50, and draft Disbursement0.
   Submit `/x/payments/{id}/credits/set` with memoId, invoiceId, amount30 and
   sourceAmount30. Post; invoice becomes Partially Paid with20 remaining.
3. Source memo void must be refused while consumed. Void consumer and verify
   invoice50 restored, then void memo and invoice. Final AP tie-out variance0.

## Actual IC posting, matching and elimination

1. Seller acquires3 tracked units at60 each using real purchase posting. Seller
   invoices the IC customer `3 × 100.005`; buyer purchases the same trade from
   its IC supplier. Both actual `intercompanyTransaction.amount` values must be
   exactly300.015 (matching uses internal precision).
2. Run `matchIntercompanyTransactions` for the owned group. Verify reciprocal
   source/target journal anchors and Matched status. Run `generateEliminationEntries`.
   Verify IC Balance and IC Revenue journals balance by account-class signs;
   revenue300.015, COGS180 and buyer inventory margin120.015 are eliminated.
3. Sell1.5 of the buyer's3 units externally through real sales posting. Explicitly
   regenerate eliminations; all previous entries are reversed, remaining deferred
   profit is60.0075. A normal rerun creates0 entries; repeated regeneration changes
   no net account balance.
4. Repeat with two merchandise lines100/50, line shipping5/2, tax percent0.1,
   header shipping8. Supplier tax amounts are10.5/5.2. Verify matching key157,
   both controls180.70, seller captured revenue165, external tax15.70 excluded,
   buyer capitalization180.70 and all lines included in balanced eliminations.
5. Repeat a100 transfer with seller group cost60 and a buyer Fixed Asset line.
   Actual purchase activates100 acquisition and captures the buyer asset account.
   Elimination removes40 margin from that account. The engine creates one shared
   balance journal per pair and one revenue journal per trade; retries add no net
   duplicates.

## Evidence

The 2026-09-09 isolated fixture IDs, exact HTTP results, original/reversal GL rows,
matching/capture IDs and final assertions are in
`.context/accounting/e2e-20260909/purchase-ic-results.md` and its linked JSON files.

## Payment fixes verified 2026-09-09

The prior supplier refund and final-cent memo failures are fixed. Reuse `.context/accounting/e2e-20260909/fix-supplier-live.ts` as a reference for new uniquely named fixtures; the recorded fixtures are already voided and must not be replayed as fresh documents.

- Published `applyCreditsToInvoices` accepts omitted `createdBy` and injects the API-key actor. A EUR160.01 memo/invoice at rate16000 posts source160/base.01 and then source.01/base0 successfully.
- Published `replaceInvoiceSettlements` accepts supplier Receipt refunds with `targetMemoId`. Refund EUR22 at rate1.25 against a EUR55 memo at1.1 posts AP20, bank17.6, FX loss2.4 and leaves exact memo principal33/base30. Final refund33 clears the memo; every stage has AP tie-out variance0.
- Memo void is blocked while posted refunds consume it. Void the refund payments, then the memo. Exact reversal restores the books.
- An unallocated supplier Receipt EUR55 at1.1 appears as AP+50 in both aging and tie-out; void restores0.
- Pure/transaction verification: post-payment + post-memo Deno directories69/69; ERP settlement service55/55. Evidence and IDs: `.context/accounting/e2e-20260909/fix-payments-results.md` and `fix-supplier-live-evidence.json`.
