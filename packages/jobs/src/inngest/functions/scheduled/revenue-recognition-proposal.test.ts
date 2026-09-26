import { describe, expect, it, vi } from "vitest";
import { priorMonthEnd } from "./revenue-recognition-proposal";

// priorMonthEnd is pure, but its module's neighbors are not:
// @carbon/auth/client.server pulls in @carbon/env, which validates required
// vars at module scope. vi.mock hoists above the imports, so the module under
// test never needs a configured environment.
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

describe("priorMonthEnd", () => {
  it("returns the last day of the previous month on the 1st", () => {
    expect(priorMonthEnd("2026-10-01")).toBe("2026-09-30");
  });

  it("returns a 28-day February from mid-March", () => {
    expect(priorMonthEnd("2026-03-15")).toBe("2026-02-28");
  });

  it("returns the 29th for a leap-year February", () => {
    expect(priorMonthEnd("2028-03-01")).toBe("2028-02-29");
  });

  it("crosses the year boundary from January", () => {
    expect(priorMonthEnd("2026-01-10")).toBe("2025-12-31");
  });
});
