# Accounting posting corrections

Last verified: 2026-09-08. Result: PASS on the existing local stack.

Tracking plan: [Accounting Posting Corrections](../plans/2026-09-07-accounting-posting-corrections.md).

## Setup

Use `/auth` with the ERP URL from `.env.local`. Select an isolated company with
accounting enabled, group-scoped currencies, seeded accounts and sequences. Do
not reset the database. Seed only owned fixture records, suppress outbound sync
during fixture setup, and exercise production posting endpoints and route actions.

The verified company was Accounting Corrections Local Test
(`d6f4c9407801436387dc`). Fixture ownership and IDs are in
`.context/accounting/browser-fixture.json` and `payment-browser-fixtures.json`.
The authenticated `accounting-reports` browser session was reused sequentially
after the report workflow, then switched to this company.

## A. Shipping, sales posting, cash and reversals

1. Open `/x/accounting/defaults`. Save and reload Shipping Revenue, seeded as
   account 4040 under Revenue. The actual column is
   `accountDefault.salesShippingRevenueAccount`.
2. Prepare a USD-base/EUR invoice at rate 0.8 with merchandise 100, taxable add-on
   20, non-taxable add-on 3, line shipping 10, tax 10%, and header shipping 5.
   The Service line must reference a valid service item. Posting through the
   actual `post-sales-invoice` endpoint produces AR 151, Sales 123, Shipping 15,
   and Tax Payable 13, with document gross EUR 120.80.
3. Open `/x/sales-invoice/{invoiceId}/details` and click Payment. The new payment
   route is `/x/payments/new`. The loader must seed EUR 120.80 and rate 0.8 from the
   authoritative invoice, even though the link's legacy amount parameter is 151.
   Confirm the amount input shows the EUR symbol; select Bank/Cash and Save.
4. The draft application shows USD 151 and EUR 120.80 with FX 0. Post the payment.
   Verify the invoice is Paid with zero balance, recorded source units 120.80,
   base relief 151 and FX 0, and `get_ar_tie_out` variance 0.
5. Void the payment and verify the invoice returns to Submitted with base 151
   open. In the invoice's More options menu, select Void and confirm Void Invoice.
   Verify both documents are Voided and every original journal account nets to
   zero with its reversal. The AR tie-out still has zero variance.
6. For purchasing, exercise actual receipt/invoice/void endpoints with purchase
   UOM factor 5. The verified matching fixture created 15 inventory units, base 174
   and document 191.40 at rate 1.1, no PPV and no duplicate cost layers. Invoice
   void preserved receipt-owned costs and restored PO invoiced quantities to 0.
   Direct inventory, received/direct asset and buyer IC monetary cases also passed.

Evidence: `sales-http-evidence.json`, `payment-browser-cash-{posted,voided}-evidence.json`,
`payment-browser-cash-payment-voided-evidence.json`, and
`purchase-http-{verified,direct,ic}-evidence.json` under `.context/accounting/`.

## B. Prior credit and exact document remainders

1. Post an unapplied receipt of EUR 100 at rate 1. Create a EUR 50 invoice at rate 2
   (base 25), and a separate zero-cash draft receipt at rate 1.5 for the same customer.
2. On `/x/payments/{consumerId}`, Auto apply and Save applications. Confirm the
   saved application uses original source rate 1 and target rate 2, document 50,
   base 25 and gain 25. Post it; the invoice is Paid and credit availability is
   document 50/base 50.
3. Try to void the original source receipt. The route refuses and both payments
   remain Posted. Void the applying payment instead; the invoice reopens and
   the original credit is restored to document 100/base 100.
4. For another customer, post a EUR 160.01 unapplied receipt at rate 16000.
   Create an invoice with quantity 0.16001 × base unit price 0.0625: raw base total
   0.010000625, document 160.01, booked AR 0.01. Create two zero-cash draft consumers.
5. On the first consumer, manually enter base 0.01, then Save applications. This
   must consume document 160.00. Checkbox/Auto apply intentionally selects the
   entire exact document balance; manual entry must not infer that intention
   from equal rounded base values. Zero discount/write-off edits must preserve
   the partial principal. Post it.
6. Verify Partially Paid, document balance 0.01 and source credit 0.01, with both
   remaining booked base amounts 0. The final consumer still lists the invoice,
   displays USD 0.00/EUR 0.01, and offers EUR 0.01 credit.
7. Auto apply and Save on the final consumer. Verify source 0.01, base 0 and FX 0;
   post it. The invoice is Paid, both document remainders are 0 and tie-out variance
   remains0. Void final and first consumers; the original invoice and source
   document balances return to 160.01, with original carrying 0.01.

Evidence: `payment-browser-normal-{posted,voided}-evidence.json`,
`payment-browser-high-{first,final,restored}-evidence.json`, and screenshots under
`payment-{normal-posted,source-void-refused,final-cent-available,final-cent-posted}/`
in `.context/accounting/`. `payment-browser-assert.ts` checks actual database
statuses, settlements, original account reversals, source carrying and AR tie-out.

## C. Consolidation and CSV

Follow the separately verified [report playbook](accounting-posting-corrections-reports.md).
Identity and foreign translation each passed for subsidiary and All Companies.
Foreign results were Cash 160, Income 120, custom CTA 40, Equity 160 and root 0.
All 54 exported account rows matched both monthly report columns.

## Automation notes and verification limits

- Wait for hydration and completion of the previous action before navigating.
  `requestSubmit()` reliably submits forms; clicking the actual button via DOM
  works for React fetcher actions. Read server/database state after asynchronous
  posts, rather than assuming a click completed them.
- The local CLI sometimes lost numeric fills and returned CDP errors for raw
  keyboard typing. A native input value setter plus bubbling `input` and blur
  events exercised the real React amount handler without changing application
  state directly. Scope selectors by the visible input's aria-label.
- Laptop sleep caused Docker clock drift and auth refresh loops. Runtime restart
  preserved volumes and resynchronized clocks. A bounded keep-awake process
  prevented further drift. Notes/storage also timed out on the invoice page;
  this was captured separately and did not prevent monetary route verification.
- No live provider API writes were made. Confirm Rillet bill rate direction and
  QBO US tax-catalog compatibility independently before enabling those paths.
  Rillet AR_ONLY base FX remains provider-owned.
- Direct fixed-asset invoice void reverses its GL but leaves acquisition state
  Active. This separate lifecycle gap is recorded in the spec, outside this fix.
