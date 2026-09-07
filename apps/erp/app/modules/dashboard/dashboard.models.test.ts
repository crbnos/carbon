import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGETS,
  dashboardLayoutValidator,
  dashboardPreferenceValidator,
  percentChange,
  ratioPercent,
  resolveDashboardLayout,
  resolveDashboardRange
} from "./dashboard.models";

describe("resolveDashboardRange", () => {
  it("30d ends today and spans 30 inclusive days, previous window abuts it", () => {
    expect(resolveDashboardRange("30d", "2026-09-05")).toEqual({
      start: "2026-08-07",
      end: "2026-09-05",
      previousStart: "2026-07-08",
      previousEnd: "2026-08-06",
      bucket: "day"
    });
  });

  it("qtd starts on the first day of the calendar quarter", () => {
    expect(resolveDashboardRange("qtd", "2026-09-05").start).toBe("2026-07-01");
    expect(resolveDashboardRange("qtd", "2026-01-15").start).toBe("2026-01-01");
    expect(resolveDashboardRange("qtd", "2026-12-31").start).toBe("2026-10-01");
  });

  it("mtd and ytd start on the 1st", () => {
    expect(resolveDashboardRange("mtd", "2026-09-05").start).toBe("2026-09-01");
    expect(resolveDashboardRange("ytd", "2026-09-05").start).toBe("2026-01-01");
  });

  it("12m spans a year and buckets by month", () => {
    const w = resolveDashboardRange("12m", "2026-09-05");
    expect(w.start).toBe("2025-09-06");
    expect(w.bucket).toBe("month");
  });

  it("90d buckets by day, crossing a year boundary without drift", () => {
    const w = resolveDashboardRange("90d", "2026-02-15");
    expect(w.start).toBe("2025-11-18");
    expect(w.bucket).toBe("day");
  });
});

describe("resolveDashboardLayout", () => {
  const canSalesOnly = (_a: "view", module: string) => module === "sales";

  it("returns only widgets the user may view, in registry order", () => {
    const widgets = resolveDashboardLayout(canSalesOnly, []);
    expect(widgets.length).toBeGreaterThan(0);
    expect(widgets.every((w) => w.module === "sales")).toBe(true);
    expect(widgets.map((w) => w.key)).toEqual(
      DASHBOARD_WIDGETS.filter((w) => w.module === "sales").map((w) => w.key)
    );
  });

  it("uses defaultVisible when there is no row", () => {
    const widgets = resolveDashboardLayout(canSalesOnly, []);
    const open = widgets.find((w) => w.key === "sales.openOrders");
    const mine = widgets.find((w) => w.key === "sales.assignedToMe");
    expect(open?.visible).toBe(true);
    expect(mine?.visible).toBe(false);
  });

  it("honours an explicit row and ignores unknown keys and bad ranges", () => {
    const widgets = resolveDashboardLayout(canSalesOnly, [
      { widgetKey: "sales.openOrders", visible: false, range: "7d" },
      { widgetKey: "sales.revenue", visible: true, range: "bogus" },
      { widgetKey: "does.notExist", visible: true, range: null }
    ]);
    const open = widgets.find((w) => w.key === "sales.openOrders");
    const revenue = widgets.find((w) => w.key === "sales.revenue");
    expect(open?.visible).toBe(false);
    expect(open?.range).toBe("7d");
    expect(revenue?.range).toBeNull();
    expect(widgets.some((w) => w.key === "does.notExist")).toBe(false);
  });

  it("returns nothing for a user with no module permissions", () => {
    expect(resolveDashboardLayout(() => false, [])).toEqual([]);
  });

  it("applies a saved order, then registry order for unlisted keys", () => {
    const registry = DASHBOARD_WIDGETS.filter((w) => w.module === "sales").map(
      (w) => w.key
    );
    const [a, b, c, ...rest] = registry;
    const widgets = resolveDashboardLayout(canSalesOnly, [], [c, a]);
    expect(widgets.map((w) => w.key)).toEqual([c, a, b, ...rest]);
  });

  it("ignores unknown and unpermitted keys in the saved order", () => {
    const registry = DASHBOARD_WIDGETS.filter((w) => w.module === "sales").map(
      (w) => w.key
    );
    const widgets = resolveDashboardLayout(
      canSalesOnly,
      [],
      ["does.notExist", "production.activeJobs", registry[1]]
    );
    expect(widgets.map((w) => w.key)).toEqual([
      registry[1],
      registry[0],
      ...registry.slice(2)
    ]);
  });
});

describe("dashboardPreferenceValidator", () => {
  it("accepts a range, an order, or both — but not neither", () => {
    expect(
      dashboardPreferenceValidator.safeParse({ range: "7d" }).success
    ).toBe(true);
    expect(
      dashboardPreferenceValidator.safeParse({
        order: ["sales.revenue", "sales.openOrders"]
      }).success
    ).toBe(true);
    expect(dashboardPreferenceValidator.safeParse({}).success).toBe(false);
  });
  it("rejects unknown keys in the order", () => {
    expect(
      dashboardPreferenceValidator.safeParse({ order: ["nope"] }).success
    ).toBe(false);
  });
});

describe("percentChange / ratioPercent", () => {
  it("computes the delta vs the prior period", () => {
    expect(percentChange(10000, 8000)).toBe(25);
    expect(percentChange(8000, 10000)).toBe(-20);
  });
  it("is null with no prior value", () => {
    expect(percentChange(5, 0)).toBeNull();
  });
  it("ratioPercent handles empty denominators and rounds at internal scale", () => {
    expect(ratioPercent(0, 0)).toBe(0);
    expect(ratioPercent(6, 6)).toBe(100);
    expect(ratioPercent(4, 6)).toBe(66.66667);
    expect(ratioPercent(90, 105)).toBe(85.71429);
  });
});

describe("dashboardLayoutValidator", () => {
  it("rejects unknown keys and ranges", () => {
    expect(
      dashboardLayoutValidator.safeParse({
        widgets: [{ key: "nope", visible: true, range: null }]
      }).success
    ).toBe(false);
    expect(
      dashboardLayoutValidator.safeParse({
        widgets: [{ key: "sales.openOrders", visible: true, range: "1d" }]
      }).success
    ).toBe(false);
  });
  it("accepts a valid layout", () => {
    expect(
      dashboardLayoutValidator.safeParse({
        widgets: [{ key: "sales.openOrders", visible: false, range: "7d" }]
      }).success
    ).toBe(true);
  });
});
