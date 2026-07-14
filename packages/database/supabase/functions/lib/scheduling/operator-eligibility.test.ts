import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { toIsoDate } from "./date-utils.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee,
} from "./operator-eligibility.ts";

const opStart = new Date("2026-07-17T08:00:00.000Z");

function employee(
  overrides: Partial<QualifiedEmployee> = {}
): QualifiedEmployee {
  return {
    employeeId: "emp-1",
    active: true,
    trainingCompleted: true,
    expiresAt: null,
    ...overrides,
  };
}

Deno.test("expired-as-of-op-start is excluded from the pool", () => {
  const expired = employee({ expiresAt: "2026-07-07" });
  assertEquals(isEligibleOperator(expired, opStart), false);
});

Deno.test("expiring after the op start still counts", () => {
  const stillValid = employee({ expiresAt: "2026-07-20" });
  assertEquals(isEligibleOperator(stillValid, opStart), true);
});

Deno.test("expiring exactly on the op start date is excluded (strict >)", () => {
  const expiresToday = employee({ expiresAt: "2026-07-17" });
  assertEquals(isEligibleOperator(expiresToday, opStart), false);
});

Deno.test("null expiry never expires", () => {
  assertEquals(isEligibleOperator(employee(), opStart), true);
});

Deno.test("inactive or not-training-completed are excluded regardless of expiry", () => {
  assertEquals(isEligibleOperator(employee({ active: false }), opStart), false);
  assertEquals(
    isEligibleOperator(employee({ trainingCompleted: false }), opStart),
    false
  );
});

Deno.test("regression: pg DATE object stringified via String() defeated the expiry check; toIsoDate restores it", () => {
  const pgDateExpired = new Date(2026, 6, 7); // DATE '2026-07-07' as returned by pg

  // Pre-fix behavior: String(...) made the expired welder eligible
  const broken = employee({ expiresAt: String(pgDateExpired) });
  assertEquals(isEligibleOperator(broken, opStart), true);

  // Post-fix behavior: normalized date excludes them
  const normalized = employee({ expiresAt: toIsoDate(pgDateExpired) });
  assertEquals(isEligibleOperator(normalized, opStart), false);
  assert(toIsoDate(pgDateExpired) === "2026-07-07");
});
