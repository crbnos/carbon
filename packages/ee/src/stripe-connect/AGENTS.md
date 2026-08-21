# @carbon/ee/stripe-connect

Stripe Connect integration for Carbon: onboarding connected accounts, resolving
Stripe customers for sales invoices, recording payments into the Carbon GL, and
syncing missed payments via a background sweep.

## Always

- **Import `recordStripeConnectPayment` only from `@carbon/ee/stripe-connect.server`** —
  it is the single authority for writing Stripe payments into Carbon. Both the
  webhook handler and the pull sweep call it; adding a third call site MUST go
  through the same function.
- **`recordStripeConnectPayment` is idempotent on Stripe invoice id, but NOT
  limited to one payment per invoice** — a duplicate delivery of the SAME
  `amount_paid` loses the race at the DB via the partial unique index on
  `externalIntegrationMapping` (`INTEGRATION="stripe-connect"`,
  `entityType="payment"`, `allowDuplicateExternalId=false`). A delivery with a
  HIGHER cumulative `amount_paid` than what's already recorded (installment /
  partial-payment invoices) instead records a new payment for just the delta,
  linked with `allowDuplicateExternalId: true` — so one Stripe invoice can map
  to several Carbon payments. Never guard with an ad-hoc SELECT before calling
  it, and never assume `getByExternalId` (singular) sees every payment for an
  invoice — use `mappingService.getAllByExternalId` for that.
- **`voidStripeConnectPayment` reverses every non-Voided payment mapped to an
  invoice** — it's a FULL reversal only (via `post-payment`'s `void` op,
  which mirrors every journal line including the fee). There is no partial
  reversal capability; a partial refund is logged, not acted on.
- **All external-ID links go through `createMappingService` from `@carbon/ee/accounting`** —
  `mappingService.getByExternalId`, `mappingService.getEntityId`, `mappingService.link`.
  Do not add per-entity `externalId` columns.
- **Hooks must stay in `hooks.server.ts`** — registered under `"stripe-connect"`
  in `packages/ee/src/hooks.server.ts`. Server-only imports (e.g. `@carbon/stripe/connect.server`)
  must not appear in `config.tsx` (bundled for client).
- **`StripeConnect` config and `StripeConnectSettingsSchema` are exported from `@carbon/ee`**
  (the root barrel) — the integration framework reads them there. Do not re-export
  from a separate subpath.

## Ask First

- Changing the accounting accounts that are used for FX gain/loss or service-charge
  fees — these are read from `accountDefault` at record time and affect live GL entries.
- Adding or removing Stripe capabilities on the account-creation constants in
  `@carbon/stripe/connect.constants.ts`.
- Making `stripeConnectOnInstall` or `stripeConnectOnUninstall` non-stubs — currently
  no-ops; any side effects must be reviewed against the install lifecycle.

## Never

- **Do not call `serviceRole.from("payment").delete(...)` outside of `recordStripeConnectPayment`** —
  the rollback path inside that function is the only place that deletes a payment
  row; orphaning `invoiceSettlement` rows by deleting their payment elsewhere will
  corrupt the AR ledger.
- **Do not advance a pull-sweep cursor on `paid_at` when the Stripe query filters on `created`** —
  invoices created before the cursor window but paid after it are permanently missed.
  Advance the cursor on the same field used in the list filter (`invoice.created`).
- **Do not surface post-send cleanup failures (PDF storage, notes append) as Stripe
  send failures** — the invoice is already sent to the customer. Log and continue;
  returning `success: false` after a sent invoice causes the caller to retry and
  create a duplicate Stripe invoice.

## Validation Commands

```bash
pnpm --filter @carbon/ee typecheck
pnpm --filter @carbon/ee test
```

## Key Exports

| Subpath | Provides |
|---|---|
| `@carbon/ee` (root) | `StripeConnect` integration definition, `StripeConnectSettingsSchema` |
| `@carbon/ee/stripe-connect.server` | `recordStripeConnectPayment`, `StripeConnectPaymentResult`, `voidStripeConnectPayment`, `StripeConnectVoidResult` |

## Key Functions

- **`recordStripeConnectPayment`** (`payment.server.ts`) — records a paid Stripe
  invoice as a Carbon `payment` row, settles it against the `salesInvoice`,
  posts the journal entry (bank debit, AR credit, service-charge expense via the
  `fee` field on `post-payment`), and writes to `externalIntegrationMapping`.
  Returns `{ status: "recorded" | "skipped" }`. Throws on fixable config errors
  (missing bank account, missing fee account, missing sequence) so Stripe retries.
  Reconciles against every prior mapping for the invoice before doing anything:
  a mapped payment still `Draft` (a prior delivery that inserted the payment +
  mapping but crashed before settlement/posting) is RESUMED at its own already-
  recorded amount; otherwise the delta between the invoice's current
  `amount_paid` and the sum already recorded is what gets recorded (0 or
  negative → skipped), with the processing fee prorated to that delta's share.
  The realized settlement-date exchange rate (`getConnectInvoicePaymentDetails().exchangeRate`,
  from Stripe's `balance_transaction.exchange_rate`) drives `invoiceSettlement.sourceExchangeRate`
  and `payment.exchangeRate`; the invoice's own booked rate stays on
  `targetExchangeRate` — this is what makes `totalFxImpact` in `post-payment`
  non-zero for a real FX payment instead of structurally suppressed.
- **`voidStripeConnectPayment`** (`payment.server.ts`) — reverses every
  non-Voided payment mapped to a Stripe invoice via `post-payment`'s `void` op
  (a full reversal that mirrors every journal line, fee included). Called on
  `charge.refunded` (full only), `charge.dispute.closed` (status `lost`), and
  `invoice.voided`. Returns `{ status: "voided", paymentIds } | { status: "skipped", reason }`;
  throws on a `post-payment` failure so the webhook returns 500 and Stripe retries.
- **`stripeConnectHealthcheck`** (`hooks.server.ts`) — called by the integration
  health system; returns `true` only when `chargesEnabled && payoutsEnabled` on
  the connected account. Returns `false` for missing accounts, Stripe errors,
  requirement errors, AND the normal mid-onboarding case (account exists, no
  errors yet, just not fully enabled) — the return type is a plain `boolean`,
  so a mid-onboarding account reads as unhealthy (red badge) until onboarding
  completes. `companyIntegration.active` goes `true` as soon as the Stripe
  account is created (see `getOrCreateConnectAccount`), before onboarding
  finishes, so it does NOT gate this neutral state — `getStripeConnectAccountId`
  (`apps/erp/app/modules/invoicing/stripe-customer.server.ts`) additionally
  checks `metadata.chargesEnabled` for exactly this reason.
- **`stripeConnectOnInstall` / `stripeConnectOnUninstall`** (`hooks.server.ts`) — 
  currently no-ops; registered because the `IntegrationServerHooks` contract
  requires them.

## Tables Touched by `recordStripeConnectPayment`

| Table | Operation |
|---|---|
| `salesInvoices` | SELECT — look up the Carbon invoice by id |
| `accountDefault` | SELECT — resolve GL accounts for bank, AR, service charge |
| `companySettings` | SELECT — currency and payment sequence settings |
| `payment` | INSERT (and DELETE on rollback within the same function), plus a SELECT across all mapped payments for the invoice to compute the resume/delta decision |
| `invoiceSettlement` | DELETE + INSERT (Kysely transaction) — replace settlements |
| `externalIntegrationMapping` | SELECT (all mappings for the invoice) + INSERT — links a Stripe invoice to one or more payments |

## Cross-References

- `.claude/rules/billing-system.md` — plan/edition gating (`INTEGRATION_WHITELIST`, `FEATURE_PLANS`)
- `packages/stripe/AGENTS.md` — `@carbon/stripe/connect.server` API (`getConnectAccountStatus`,
  `getConnectInvoicePaymentDetails`, `fromStripeAmount`)
- `packages/ee/AGENTS.md` — `createMappingService` pattern, `externalIntegrationMapping` table
- `packages/jobs/src/inngest/functions/integrations/stripe-connect-pull-sweep.ts` — background
  sweep that calls `recordStripeConnectPayment` for invoices missed by webhooks
- `apps/erp/app/routes/api+/webhook.stripe-connect.ts` — real-time webhook caller;
  also handles `charge.refunded`, `charge.dispute.closed`, `invoice.voided`
  (→ `voidStripeConnectPayment`) and `account.updated` (→ refreshes
  `chargesEnabled`/`payoutsEnabled`/requirement errors via `getConnectAccountStatus`)
