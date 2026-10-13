---
paths:
  - "packages/ee/src/contract-financing/**"
  - "apps/erp/app/routes/x+/contract+/$id.financing*.tsx"
  - "apps/erp/app/modules/sales/ui/Contracts/ContractFinancing*.ee.tsx"
  - "apps/erp/app/routes/file+/contract+/financing.$requestId[.]pdf.tsx"
  - "packages/database/src/deposit-scope.ts"
  - "packages/utils/src/payment-funding.ts"
---

# Contract financing (progress payments and PBP)

Customary progress payments (FAR 32.5, SF 1443) and performance-based payments
(FAR 32.10) on a customer contract. Spec
`.ai/specs/2026-10-12-wbs-interop-and-contract-financing.md` (Phase B); plan
`.ai/plans/2026-10-12-wbs-interop-and-contract-financing.md` (Tasks 10–17 and
their *Execution notes*); research `.ai/research/wbs-interop-and-contract-financing.md`.

## Commercial, and where the code lives

Feature `GOVERNMENT_CONTRACTING`. The engine is ee code:

| Module | What it holds |
|---|---|
| `@carbon/ee/contract-financing` (`index.ts`) | Client-safe: the pure engine (`compute.ts`: `computeSf1443`, `lossRatio`, `rateOn`, `expectedLiquidation`, `unliquidatedBalance`, `buildPbpRequest`), validators and labels (`models.ts`), row types (`types.ts`, from `@carbon/database` only) |
| `@carbon/ee/contract-financing.server` (`server.ts`) | Authoring (each calls `requireEntitlement` first), the readers `getContractFinancing`, `getFinancingRequest`, `loadSf1443Inputs`, and the degrading `getExpectedLiquidation` |

Refusals are `FinancingError`; the routes flash its message. The UI is
`ContractFinancing.ee.tsx` (terms, rates, events, requests) and
`ContractFinancingRequest.ee.tsx` (the request drawer). A gated company sees
`UpgradeOverlaySection`. The contract header shows the **Financing** tab when
`useGovernmentContracting()` is true.

## Tables

`customerContractFinancing` (1 per contract: method, price, award date,
small business, maximum PBP share, `nextRequestNumber`),
`customerContractFinancingRate` (rate history, unique per effective date),
`contractFinancingRequest`, `performanceBasedPaymentEvent`,
`contractFinancingRequestEvent`. RLS `company("sales", { read: "sales_view" })`.
Migration `20261013001522_contract-financing.sql`.

## The request

- Draft → Submitted → Approved → Paid, or Withdrawn from Submitted. A Draft
  has no number (CHECK ties a null number to Draft), so withdrawing a Draft
  deletes it. **Submit** takes `nextRequestNumber`; a Withdrawn request keeps its
  number, so the series has no gap.
- `lines` holds the COMPUTED SF 1443 lines (plus `6A`, `6B`, `lossRatio`,
  `hasSection3`); `overrides` holds `{ value, reason, by, at }` per line;
  `requestedAmount` is line 26 with the overrides applied. Overrides are
  allowed on 12b, 14a, 14b, 14d, 20a, 21a, 21d, 23 and 26, Draft only.
- Line 11 = allowable `projectLedger` cost (burden included) of the contract's
  project and its Fixed lines' projects, through the costs-through date; 12a
  adds the unallowable rows. 20a defaults to `11 × 21a ÷ 5`. 21d is 0.
- A PBP request bills complete events no live request billed; a Cumulative
  event waits for every earlier event. It never reads the ledger for its
  amount: value 2 (incurred cost) is information only.

## Payment and liquidation (community code)

The government's payment is a customer deposit held against the contract:
`payment.customerContractId`, the third deposit scope beside the sales order
and the rental agreement (`payment_deposit_document_check` allows one). It
posts to `accountDefault.prepaymentAccount` like any deposit
(`journal-input.ts` `isDeposit`).

A contract's invoices are those with the contract on the header, on a line,
or on a line of the contract's own sales order (`customerContract.salesOrderId`).
`loadSalesInvoiceDocumentIds` (deposit scope), the ERP's open-invoice reader and
`loadContractInvoiceIds` (financing) all use that one definition.
`checkDepositDocument` checks the contract's customer and status.

**Record Payment** redirects to New Payment with `customerContractId`,
`financingRequestId` and the approved amount; the create action links the
payment (`linkFinancingPayment`) and the post action marks the request Paid
(`markFinancingRequestsPaid`, no entitlement: it records a fact).

Liquidation is the deposit applied to a delivery invoice. The expected
liquidation of a posted unpaid invoice is the lesser of rate × subtotal and
the unliquidated balance less the expected liquidation of the earlier unpaid
invoices (`expectedLiquidation`). The invoice stays gross (DFAS); the invoice
page shows the expected amount.

## Known gaps

- The sales invoice PDF does not print the expected liquidation (template engine).
- The payment form does not prefill the deposit credit with the expected liquidation.
- No EDI 810P / WAWF export: print only.
- The demo datasets seed no financing.
