---
paths: []
triggers: []
promoted: null
---
# An incremental pull-sweep cursor must advance on the SAME field the query filters on

**Context:** The Stripe Connect payment pull sweep (`stripe-connect-pull-sweep.ts`) queried Stripe with `invoices.list({ status: "paid", created: { gte: since } })` but advanced the cursor to `latest status_transitions.paid_at + 1`. An invoice created before the cursor but paid after it (a normal case — invoices are created, then paid later) would never be returned by a future `created`-filtered query once the cursor passed its `paid_at`, so it was permanently skipped with no error, no log, and no retry.

**Problem:** The query filters on one field (`created`) while the cursor tracks a different field (`paid_at`) that moves independently of it. Any record whose "when it changed" timestamp and "when it was created" timestamp can diverge — which is true of nearly all incremental-sync designs (a row's `updated_at` also isn't its `created_at`) — silently falls outside the next window once the cursor advances past its create time but the record itself hasn't changed since.

**Rule:** An incremental cursor MUST advance on the exact field the list query filters on, never a related-but-different timestamp. When the two are genuinely different concerns (created vs. paid, created vs. updated), either filter on the field you actually care about, or carry a trailing lookback window (`pullWindowStart` re-scans `since - CURSOR_LOOKBACK_SECONDS`) so a bounded re-scan catches what a pure cursor would miss — cheap when the record-processing step is idempotent (here, `recordStripeConnectPayment` is idempotent on the Stripe invoice id via a partial unique index, so re-scanning already-recorded invoices is a free no-op). Extract cursor arithmetic into an import-light pure module (`stripe-connect-pull-sweep-cursor.ts`) so the regression is unit-testable without booting Stripe/Inngest/DB.

**Applies to:** `packages/jobs/src/inngest/functions/integrations/*-pull-sweep.ts`, any incremental sync reading `since`/cursor state against an external API's list filter.
