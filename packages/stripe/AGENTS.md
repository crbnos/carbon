# @carbon/stripe

Stripe billing integration — checkout, subscriptions, webhooks, and customer sync. **Cloud edition only.**

## Always

- **Route all subscription state writes through `syncStripeDataToKV()`** — it's the single writer of `companyPlan` from Stripe; both webhook and GET re-sync funnel through it
- **Use `normalizePlanId()` before comparing plans** — DB stores partner tiers as `PARTNER-300/400/500`; normalize collapses onto `Plan.Partner`
- **Query `companyPlan` by `.eq("id", companyId)`** — the `id` column IS the company id (not a generated `id('cplan')`)
- **Guard for null `stripe` client** — `stripe` is `null` when `STRIPE_SECRET_KEY` is unset (non-Cloud); all functions must handle this

## Ask First

- Adding new Stripe webhook event handlers (coordinate with `processStripeEvent` flow)
- Changing plan catalog (`plan` table seeds) or price IDs
- Modifying the bypass mechanism (`STRIPE_BYPASS_COMPANY_IDS/USER_IDS`)

## Never

- Add subscription-status logic outside `syncStripeDataToKV` — it's the one source of truth
- Commit real Stripe price IDs or secrets — use test-mode overrides from `database/src/seed/stripe.ts`
- Skip signature verification in the webhook handler

## Validation Commands

```bash
pnpm --filter @carbon/stripe typecheck   # tsgo --noEmit
pnpm --filter @carbon/stripe dev:stripe  # local Stripe listener (dev)
```

## Key Patterns

- **Single export**: `@carbon/stripe/stripe.server` — all functions server-only
- **Redis cache**: subscription state cached by customer ID; `companyPlan` is the durable mirror
- **GTM forwarding**: `gtm-events.server.ts` forwards invoice events to Google Tag Manager
- **User-based pricing**: `updateSubscriptionQuantityForCompany()` syncs active user count (excludes `@carbon.ms`)
- **Stripe API version**: `2025-06-30.basil`

## Cross-References

- `.ai/rules/billing-system.md` — full billing architecture
- `packages/ee/src/plan.ts` + `plan.server.ts` — feature/plan gating (`FEATURE_PLANS`)
- `apps/erp/app/routes/api+/webhook.stripe.ts` — webhook route
- `packages/database/supabase/migrations/*billing*.sql` — schema
