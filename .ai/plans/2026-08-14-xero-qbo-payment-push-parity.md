# Plan: Xero + QBO outbound payment write-back (Phase G parity)

Date: 2026-08-14
Branch: feat/rillet
Status: Implemented 2026-08-14 — Xero live-verified on sandbox (bill → PAID); QBO code-complete, payload VERIFY-flagged (no QBO sandbox)

## Goal

A Carbon-born payment (e.g. a bill paid in Carbon) pushes to Xero/QBO — marking the
bill PAID and posting the bank/AP GL effect — exactly as Rillet already does (Phase G).
Today Xero/QBO payments are pull-only, so a Carbon payment's GL never reaches them.

The push engine is **already generic** (`PaymentSyncerBase.pushToAccounting`, the
`reconcilePayment` decision core, fan-out, origin/loop-guard, mapping link with
`origin:"carbon"`, the payment event trigger, ledger + drain). Only Rillet flips the
switches. Parity = per-provider adapter + un-hardcode two Rillet-only gates.

Carry over Rillet's v1 limits (enforced in the shared base): single-settlement,
base-currency (`exchangeRate === 1`), no discount/write-off, no void-echo (voided
Carbon payments Skip with a manual-remediation message).

## Edit sites (from the investigation)

### Shared (un-hardcode the Rillet-only gates)
- [ ] `packages/jobs/src/inngest/functions/integrations/reconcile-executor.ts:355` —
      `providerSupportsPaymentPush: args.providerId === "rillet"` → true for rillet/xero/quickbooks
      (derive from a provider capability, not a string literal).
- [ ] `packages/jobs/src/inngest/functions/integrations/accounting-outbound-sweep.ts:274-291` —
      page posted payments as candidate refs for Xero/QBO too (critical for Xero: the
      outbound sweep is its only periodic drain).

### Subscriptions
- [ ] `packages/ee/src/accounting/core/subscriptions.ts` — add
      `{ table: "payment", operations: ["INSERT","UPDATE"] }` to the Xero and QBO
      `REQUIRED_SYNC_SUBSCRIPTIONS` arrays. (Invariant test already satisfied — payment→payment
      maps and both have a payment syncer.)

### Xero (`providers/xero/`)
- [ ] `provider.ts` — move `payment` from `XERO_PULL_ONLY_ENTITIES` to a new
      `XERO_TWO_WAY_ENTITIES = ["payment"]` forced `direction:"two-way"`, `owner:"accounting"`,
      `enabled:true` in `buildXeroSyncConfig` (mirror Rillet's `RILLET_TWO_WAY_ENTITIES`).
- [ ] `provider.ts` — add `createPayment(payload)` → `request("PUT","/Payments",{body})`;
      return `Payments[0].PaymentID`.
- [ ] `entities/payment.ts` — `supportsPaymentPush = true`; remove the `direction === "push"`
      rejection in `shouldSync`; implement `pushRemotePayment` (mirror Rillet `payment.ts:375-443`):
      resolve doc remote id via mapping (`invoice` for AR / `bill` for AP), resolve bank code via
      `loadAccountCodesById`, **bank-type pre-check** (fail UNMAPPED_ACCOUNTS if the mapped Xero
      account is not BANK/`EnablePaymentsToAccount`), build `{ Payments:[{ Invoice:{InvoiceID},
      Account:{Code|AccountID}, Amount, Date }] }`, call `createPayment`, return `{ remoteId,
      compositeEntityId }` via `getXeroPaymentSyncEntityId`/`getXeroBillPaymentSyncEntityId`.

### QBO (`providers/quickbooks-online/`)
- [ ] `provider.ts` — `payment` two-way (as Xero); add `createBillPayment`/`createPayment` via the
      generic `writeEntity(...)`.
- [ ] `entities/payment.ts` — `supportsPaymentPush = true`; remove push rejection; implement
      `pushRemotePayment`: AP `BillPayment` `{ VendorRef, TotalAmt, TxnDate, PayType, CheckPayment:{
      BankAccountRef }, Line:[{ Amount, LinkedTxn:[{ TxnId, TxnType:"Bill" }] }] }`; AR `Payment`
      `{ CustomerRef, TotalAmt, TxnDate, DepositToAccountRef, Line:[{ Amount, LinkedTxn:[{ TxnId,
      TxnType:"Invoice" }] }] }`. Use `getQbo*PaymentSyncEntityId` builders + `loadQboAccountRefsById`.

### Tests
- [ ] Provider `provider.test.ts`: `payment` two-way (direction/enabled) for Xero + QBO.
- [ ] `subscriptions` invariant test stays green; add payment-subscription assertions.
- [ ] Payment-syncer tests: Xero/QBO `pushRemotePayment` builds the right payload; bank-type
      pre-check warns; pull-side loop-guard still skips a mapped (provider-known) payment.

## VERIFY on the live Xero sandbox (before trusting the push path)
- Xero create verb/body: `PUT` vs `POST /Payments`; `Account` by `AccountID` vs `Code`.
- Xero rejects a non-BANK payment account → confirm the error, keep the pre-check.
- QBO `BillPayment` required `PayType` + bank sub-object; `Payment.DepositToAccountRef`.

## Verify (gates)
```
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
pnpm --filter @carbon/ee test && pnpm --filter @carbon/jobs test
```
Then a live Xero sandbox round-trip: post a Carbon payment against a synced bill, confirm the
Xero bill flips to PAID and a Xero Payment exists.
