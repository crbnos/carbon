# @carbon/ee/stripe-connect

Stripe Connect integration for Carbon: onboarding connected accounts, resolving
Stripe customers for sales invoices, recording payments into the Carbon GL, and
syncing missed payments via a background sweep.

## Always

- **Import `recordStripeConnectPayment` only from `@carbon/ee/stripe-connect.server`** —
  it is the single authority for writing Stripe payments into Carbon. Both the
  webhook handler and the pull sweep call it; adding a third call site MUST go
  through the same function.
- **`recordStripeConnectPayment` is idempotent on Stripe invoice id** — the
  partial unique index on `externalIntegrationMapping` (`INTEGRATION="stripe-connect"`,
  `entityType="payment"`) ensures a duplicate delivery loses the race at the DB,
  not in application code. Never guard with an ad-hoc SELECT before calling it.
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
| `@carbon/ee/stripe-connect.server` | `recordStripeConnectPayment`, `StripeConnectPaymentResult` |

## Key Functions

- **`recordStripeConnectPayment`** (`payment.server.ts`) — records a paid Stripe
  invoice as a Carbon `payment` row, settles it against the `salesInvoice`,
  posts the journal entry (bank debit, AR credit, service-charge expense via the
  `fee` field on `post-payment`), and writes to `externalIntegrationMapping`.
  Returns `{ status: "recorded" | "skipped" }`. Throws on fixable config errors
  (missing bank account, missing fee account, missing sequence) so Stripe retries.
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
| `payment` | INSERT (and DELETE on rollback within the same function) |
| `invoiceSettlement` | DELETE + INSERT (Kysely transaction) — replace settlements |
| `externalIntegrationMapping` | INSERT — idempotency record linking Stripe invoice to payment |

## Cross-References

- `.claude/rules/billing-system.md` — plan/edition gating (`INTEGRATION_WHITELIST`, `FEATURE_PLANS`)
- `packages/stripe/AGENTS.md` — `@carbon/stripe/connect.server` API (`getConnectAccountStatus`,
  `getConnectInvoicePaymentDetails`, `fromStripeAmount`)
- `packages/ee/AGENTS.md` — `createMappingService` pattern, `externalIntegrationMapping` table
- `packages/jobs/src/inngest/functions/integrations/stripe-connect-pull-sweep.ts` — background
  sweep that calls `recordStripeConnectPayment` for invoices missed by webhooks
- `apps/erp/app/routes/api+/webhook.stripe-connect.ts` — real-time webhook caller
