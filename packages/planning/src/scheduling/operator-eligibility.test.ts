import { parseAbsolute } from "@internationalized/date";
import { it } from "vitest";
import { toIsoDate } from "./date-utils.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee
} from "./operator-eligibility.ts";
import { assert, assertEquals } from "./test-helpers.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();

const opStart = utc("2026-07-17T08:00:00.000Z");

function employee(
  overrides: Partial<QualifiedEmployee> = {}
): QualifiedEmployee {
  return {
    employeeId: "emp-1",
    expiresAt: null,
    ...overrides
  };
}

it("expired-as-of-op-start is excluded from the pool", () => {
  const expired = employee({ expiresAt: "2026-07-07" });
  assertEquals(isEligibleOperator(expired, opStart), false);
});

it("expiring after the op start still counts", () => {
  const stillValid = employee({ expiresAt: "2026-07-20" });
  assertEquals(isEligibleOperator(stillValid, opStart), true);
});

it("expiring exactly on the op start date is excluded (strict >)", () => {
  const expiresToday = employee({ expiresAt: "2026-07-17" });
  assertEquals(isEligibleOperator(expiresToday, opStart), false);
});

it("null expiry never expires", () => {
  assertEquals(isEligibleOperator(employee(), opStart), true);
});

it("regression: pg DATE object stringified via String() defeated the expiry check; toIsoDate restores it", () => {
  const pgDateExpired = new Date(2026, 6, 7); // DATE '2026-07-07' as returned by pg

  // Pre-fix behavior: String(...) made the expired welder eligible
  const broken = employee({ expiresAt: String(pgDateExpired) });
  assertEquals(isEligibleOperator(broken, opStart), true);

  // Post-fix behavior: normalized date excludes them
  const normalized = employee({ expiresAt: toIsoDate(pgDateExpired) });
  assertEquals(isEligibleOperator(normalized, opStart), false);
  assert(toIsoDate(pgDateExpired) === "2026-07-07");
});

it("expiry boundary respects the factory time zone", () => {
  const employee: QualifiedEmployee = {
    employeeId: "emp-1",
    expiresAt: "2026-07-21"
  };
  // 20:00 UTC on the 20th is already the 21st in India: the qualification
  // expiring on the 21st is expired-as-of-start there, but not in UTC.
  const start = utc("2026-07-20T20:00:00.000Z");
  assert(isEligibleOperator(employee, start, "UTC"));
  assert(!isEligibleOperator(employee, start, "Asia/Kolkata"));
});
