import { it } from "vitest";
import { businessDay, toIsoDate } from "./date-utils.ts";
import { assert, assertEquals } from "./test-helpers.ts";

it("toIsoDate converts a pg DATE (local-midnight Date object) to YYYY-MM-DD", () => {
  // node-postgres constructs DATE columns as new Date(y, m, d) — LOCAL midnight
  const localMidnight = new Date(2026, 6, 7);
  assertEquals(toIsoDate(localMidnight), "2026-07-07");
});

it("toIsoDate is stable across month/day padding", () => {
  assertEquals(toIsoDate(new Date(2026, 0, 3)), "2026-01-03");
  assertEquals(toIsoDate(new Date(2026, 11, 31)), "2026-12-31");
});

it("toIsoDate passes date strings through", () => {
  assertEquals(toIsoDate("2026-07-07"), "2026-07-07");
  // timestamps are truncated to the date part
  assertEquals(toIsoDate("2026-07-07T00:00:00.000Z"), "2026-07-07");
});

it("toIsoDate maps null/undefined to null", () => {
  assertEquals(toIsoDate(null), null);
  assertEquals(toIsoDate(undefined), null);
});

it("regression: String(Date) breaks lexicographic date comparison; toIsoDate fixes it", () => {
  const expiredDate = new Date(2026, 6, 7); // expired 2026-07-07
  const opStart = "2026-07-17";

  // The bug: "Tue Jul 07 2026 ..." > "2026-07-17" (letters sort after digits),
  // so an EXPIRED qualification passed an `expiresAt > startDate` check.
  assert(String(expiredDate) > opStart);

  // Normalized, the comparison is correct: expired-as-of-start fails the check.
  assert(!(toIsoDate(expiredDate)! > opStart));
});

it("businessDay: the factory's calendar day, not UTC's", () => {
  // Pack's real case: ends 2026-07-20 21:34 UTC = 2026-07-21 03:04 IST.
  // The message must say the 21st for an Indian factory, the 20th for UTC.
  const packEnd = "2026-07-20T21:34:00.000Z";
  assertEquals(businessDay(packEnd, "Asia/Kolkata"), "2026-07-21");
  assertEquals(businessDay(packEnd, "UTC"), "2026-07-20");
  // Zones behind UTC flip the other way
  assertEquals(
    businessDay("2026-07-21T02:00:00.000Z", "America/New_York"),
    "2026-07-20"
  );
});
