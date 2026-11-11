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
- **`voidStripeConnectPayment` reverses whole payments only** (via
  `post-payment`'s `void` op, which mirrors every journal line including the
  fee). For a voided invoice it reverses every Posted payment mapped to it; for
  a full refund or a lost dispute (`chargeId`) only the payment that first
  recorded that charge (`refundedChargePayments`, `refund-attribution.ts`), and
  a payment that recorded several charges at once is left for a person. A
  partial refund is logged, not acted on. Stripe keeps its fee on a refund and
  a lost dispute, so those voids pass `retainFee`: `post-payment` books the fee
  again, paid from the bank, and the books show the whole receipt leaving.
  Stripe's separate dispute fee is not booked.
- **One delivery per Stripe invoice at a time.** Recording and voiding run
  under an owner-bound Redis lease keyed by company and Stripe invoice
  (`withStripeInvoiceLease`), so `invoice.paid` + `invoice.payment_succeeded`
  together, or a webhook overlapping the sweep, cannot record one installment
  twice. A delivery that cannot get the lease within about five seconds, or
  finds Redis down, throws so it is retried.
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
- Changing `dashboard` or `responsibilities` in the same constants. Today they are
  `full` / `fees_collector: stripe` / `losses_collector: stripe`: the seller pays
  Stripe's fees and Stripe carries negative balances, because Carbon uses direct
  charges with no application fee. Stripe refuses an Express dashboard unless
  the platform collects fees and carries losses
  (`account_controller_express_dash_without_application_losses_or_fees`).
  Stripe fixes all three when it creates an account, so a change applies only to
  accounts created after it.
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
  (missing bank account, missing fee account, missing sequence) and on a
  transient Stripe failure reading the fee (rate limit, outage, dropped
  connection), so Stripe retries.
  Reconciles against every prior mapping for the invoice before doing anything:
  a mapped payment still `Draft` (a prior delivery that inserted the payment +
  mapping but crashed before settlement/posting) is RESUMED at its own already-
  recorded amount; otherwise the delta between the invoice's current
  `amount_paid` and the sum already recorded is what gets recorded (0 or
  negative → skipped), with the processing fee prorated to that delta's share.
  Voided payments count toward what is recorded, so a refunded payment is
  never recorded again (Stripe leaves the invoice `paid`). Also skipped: an
  invoice paid outside Stripe (every invoice payment has no charge or payment
  intent) and one whose charges were all refunded before Carbon recorded it.
  A settlement or posting that fails after the Draft is written throws, and
  the retry resumes the Draft. The amount recorded is what moved through
  Stripe: `amount_paid` less `amount_paid_off_stripe` (a dahlia field; an
  older webhook payload omits it). Each mapping marks its `exchangeRate` with
  `exchangeRateDirection: "foreign-per-base"`; a resumed Draft whose mapping has
  no marker was recorded before the rate fix, so its rate is converted from
  Stripe's direction and the Draft corrected before it posts.
  The fee is the `fee` on the charge's balance transaction on the connected
  account, so the bank line is the net amount that reached the seller's Stripe
  balance. On accounts with `fees_collector: stripe` (every account created
  since the switch to the full dashboard) that fee is Stripe's processing fee,
  which the seller pays. On older Express accounts the platform pays Stripe,
  and the fee is whatever Stripe recorded on the connected account.
  The realized settlement-date exchange rate drives `invoiceSettlement.sourceExchangeRate`
  and `payment.exchangeRate`. Stripe's `balance_transaction.exchange_rate`
  (`getConnectInvoicePaymentDetails().exchangeRate`) is settlement units per
  charge unit, the opposite of Carbon's foreign-per-base rate, so
  `carbonSettlementRate` (`settlement-rate.ts`) inverts it, and uses it only
  when Stripe settled into the company's base currency (otherwise the payment
  is booked at the invoice's rate); the invoice's own booked rate stays on
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
  completes. It also saves the live `chargesEnabled` / `payoutsEnabled` when
  they differ from the stored ones: the send gate reads the stored flags, and
  the `account.updated` webhook is not proven to arrive for v2 accounts.
  `companyIntegration.active` goes `true` as soon as the Stripe
  account is created (see `getOrCreateConnectAccount`), before onboarding
  finishes, so it does NOT gate this neutral state — `getStripeConnectAccountId`
  (`packages/stripe/src/send-sales-invoice.server.ts`) additionally
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
