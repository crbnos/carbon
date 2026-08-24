// Unit tests for the pull sweep's cursor arithmetic. These two functions are
// pure and import-light on purpose so the regression this plan fixes — the
// cursor advancing on `paid_at` while the Stripe query filters on `created` —
// is directly testable without booting Inngest, Stripe, or a database.
import { describe, expect, it } from "vitest";
import {
  nextPullCursor,
  pullWindowStart
} from "./stripe-connect-pull-sweep-cursor";

const DAY = 60 * 60 * 24;
const LOOKBACK = 30 * DAY;

describe("pullWindowStart", () => {
  it("subtracts the lookback window from the stored cursor", () => {
    // A realistic Unix-seconds cursor, well past the 30-day lookback, so the
    // floor-at-0 case (tested separately below) doesn't mask the arithmetic.
    const since = 1_700_000_000;
    expect(pullWindowStart(since)).toBe(since - LOOKBACK);
  });

  it("floors at 0 instead of going negative for an early cursor", () => {
    expect(pullWindowStart(100)).toBe(0);
  });
});

describe("nextPullCursor", () => {
  it("advances to the latest created timestamp + 1 seen this run", () => {
    const since = 1_000_000;
    const latestCreated = since + 5 * DAY;
    expect(nextPullCursor(latestCreated, since, false)).toBe(latestCreated + 1);
  });

  it(
    "picks up an invoice created BEFORE the cursor but paid AFTER it — " +
      "the regression this plan fixes. The list query re-scans from " +
      "pullWindowStart(since), so an invoice with created < since can still " +
      "appear in this run's batch and drive the next cursor forward",
    () => {
      const since = 1_000_000;
      // An invoice created 10 days before the cursor, paid after it, shows
      // up in this run because the query window looks back 30 days.
      const createdBeforeCursor = since - 10 * DAY;
      expect(pullWindowStart(since)).toBeLessThanOrEqual(createdBeforeCursor);

      // Advancing on `created` (not `paid_at`) means this invoice's OWN
      // `created` timestamp does not push the cursor forward past invoices
      // created after it but not yet paid — it only advances as far as the
      // latest `created` actually seen and successfully processed.
      const latestCreatedThisRun = since + 2 * DAY;
      expect(nextPullCursor(latestCreatedThisRun, since, false)).toBe(
        latestCreatedThisRun + 1
      );
    }
  );

  it("does not advance when nothing newer than the cursor was seen", () => {
    const since = 1_000_000;
    expect(nextPullCursor(since, since, false)).toBeNull();
    expect(nextPullCursor(since - 1, since, false)).toBeNull();
  });

  it("does not advance when no invoices were found at all", () => {
    expect(nextPullCursor(null, 1_000_000, false)).toBeNull();
  });

  it("holds the cursor when any invoice in the batch errored, even if others succeeded", () => {
    const since = 1_000_000;
    const latestCreated = since + 5 * DAY;
    expect(nextPullCursor(latestCreated, since, true)).toBeNull();
  });
});
