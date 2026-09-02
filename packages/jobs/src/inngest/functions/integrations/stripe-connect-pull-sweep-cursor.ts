/**
 * Pure cursor arithmetic for the Stripe Connect pull sweep, split out of
 * `stripe-connect-pull-sweep.ts` so it stays import-light (no `@carbon/auth`,
 * no Stripe client, no Inngest) and directly unit-testable — same pattern as
 * `accounting-sync-operations.ts` for the accounting sweeps.
 */

// How far behind the stored cursor each sweep re-scans. An invoice created
// before the cursor but paid after it would otherwise never be listed again,
// since the query filters on `created`, not `paid_at`. 30 days comfortably
// covers realistic invoice payment terms; the re-scan is free because
// `recordStripeConnectPayment` is idempotent on the Stripe invoice id.
export const CURSOR_LOOKBACK_SECONDS = 60 * 60 * 24 * 30;

/**
 * The Stripe `created` timestamp to query from for a given stored cursor —
 * `since - CURSOR_LOOKBACK_SECONDS`, floored at 0.
 */
export function pullWindowStart(since: number): number {
  return Math.max(0, since - CURSOR_LOOKBACK_SECONDS);
}

/**
 * The next cursor value given the latest `created` timestamp seen this run,
 * the current cursor, and whether any invoice in the batch errored. Returns
 * `null` when the cursor should not advance (nothing newer seen, or a
 * partial failure held it back for retry).
 */
export function nextPullCursor(
  latestCreated: number | null,
  since: number,
  anyError: boolean
): number | null {
  if (anyError || latestCreated === null || latestCreated <= since) {
    return null;
  }
  return latestCreated + 1;
}
