import { describe, expect, it } from "vitest";
import type { ChartPeriodSeries } from "../../types";
import { computeExecutivePnl, type ExecutivePnlRowKey } from "./executivePnl";

// Minimal leaf-account factory — only the fields computeExecutivePnl reads.
function leaf(
  partial: Partial<ChartPeriodSeries> & {
    accountType: ChartPeriodSeries["accountType"];
    class: ChartPeriodSeries["class"];
    periods: ChartPeriodSeries["periods"];
  }
): ChartPeriodSeries {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    isGroup: false,
    ...partial
  } as ChartPeriodSeries;
}

const BUCKETS = ["2026-01"];

function valuesByKey(accounts: ChartPeriodSeries[]) {
  const rows = computeExecutivePnl(accounts, BUCKETS);
  const map = {} as Record<ExecutivePnlRowKey, number>;
  for (const row of rows) map[row.key] = row.values["2026-01"]!;
  return { rows, map };
}

describe("computeExecutivePnl", () => {
  it("rolls leaves into categories and derives the subtotals", () => {
    const accounts = [
      leaf({
        accountType: "Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 1000, balanceAtDate: 1000 } }
      }),
      leaf({
        accountType: "Cost of Goods Sold",
        class: "Expense",
        periods: { "2026-01": { netChange: 400, balanceAtDate: 400 } }
      }),
      leaf({
        accountType: "Expense",
        class: "Expense",
        periods: { "2026-01": { netChange: 200, balanceAtDate: 200 } }
      }),
      leaf({
        accountType: "Other Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 50, balanceAtDate: 50 } }
      }),
      leaf({
        accountType: "Other Expense",
        class: "Expense",
        periods: { "2026-01": { netChange: 30, balanceAtDate: 30 } }
      }),
      leaf({
        accountType: "Tax",
        class: "Expense",
        periods: { "2026-01": { netChange: 100, balanceAtDate: 100 } }
      })
    ];

    const { map } = valuesByKey(accounts);

    expect(map.revenue).toBe(1000);
    expect(map.cogs).toBe(400);
    expect(map.grossProfit).toBe(600); // 1000 − 400
    expect(map.operatingExpenses).toBe(200);
    expect(map.operatingIncome).toBe(400); // 600 − 200
    expect(map.otherIncome).toBe(50);
    expect(map.otherExpense).toBe(30);
    expect(map.tax).toBe(100);
    expect(map.netIncome).toBe(320); // 400 + 50 − 30 − 100
  });

  it("translated: uses the translated period delta, not the cumulative balance", () => {
    // balanceAtDate is fiscal-YTD cumulative and differs from the period's
    // netChange; translatedBalance (cumulative × rate) must NOT leak into the P&L.
    const accounts = [
      leaf({
        accountType: "Income",
        class: "Revenue",
        periods: {
          "2026-01": {
            netChange: 1000,
            balanceAtDate: 3000,
            translatedNetChange: 1500, // 1000 × 1.5
            translatedBalance: 4500 // 3000 × 1.5
          }
        }
      }),
      leaf({
        accountType: "Cost of Goods Sold",
        class: "Expense",
        periods: {
          "2026-01": {
            netChange: 400,
            balanceAtDate: 1200,
            translatedNetChange: 600, // 400 × 1.5
            translatedBalance: 1800
          }
        }
      })
    ];

    const rows = computeExecutivePnl(accounts, BUCKETS, {
      showTranslated: true
    });
    const map = {} as Record<ExecutivePnlRowKey, number>;
    for (const row of rows) map[row.key] = row.values["2026-01"]!;

    expect(map.revenue).toBe(1500); // translatedNetChange, not 4500 (balance)
    expect(map.cogs).toBe(600);
    expect(map.grossProfit).toBe(900); // 1500 − 600
  });

  it("translated: falls back to untranslated netChange when no translated delta", () => {
    const accounts = [
      leaf({
        accountType: "Income",
        class: "Revenue",
        // showTranslated requested but the cell carries no translatedNetChange.
        periods: { "2026-01": { netChange: 800, balanceAtDate: 2400 } }
      })
    ];

    const rows = computeExecutivePnl(accounts, BUCKETS, {
      showTranslated: true
    });
    expect(rows.find((r) => r.key === "revenue")?.values["2026-01"]).toBe(800);
  });

  it("ties Net Income out to the class-based root (rootSignMultiplier)", () => {
    const accounts = [
      leaf({
        accountType: "Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 1200, balanceAtDate: 1200 } }
      }),
      leaf({
        accountType: "Cost of Goods Sold",
        class: "Expense",
        periods: { "2026-01": { netChange: 500, balanceAtDate: 500 } }
      }),
      leaf({
        accountType: "Expense",
        class: "Expense",
        periods: { "2026-01": { netChange: 150, balanceAtDate: 150 } }
      }),
      leaf({
        accountType: "Other Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 75, balanceAtDate: 75 } }
      }),
      leaf({
        accountType: "Tax",
        class: "Expense",
        periods: { "2026-01": { netChange: 60, balanceAtDate: 60 } }
      })
    ];

    const { map } = valuesByKey(accounts);

    // rootSignMultiplier: Revenue +1, Expense −1
    const rootNet = 1200 + 75 - (500 + 150 + 60); // = 565
    expect(map.netIncome).toBe(rootNet);
  });

  it("folds uncategorized income-statement leaves into a bucket by class", () => {
    const accounts = [
      leaf({
        accountType: "Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 800, balanceAtDate: 800 } }
      }),
      // An income-statement expense leaf with no P&L-specific accountType.
      leaf({
        accountType: null,
        class: "Expense",
        periods: { "2026-01": { netChange: 90, balanceAtDate: 90 } }
      }),
      // A revenue-class leaf with no P&L-specific accountType.
      leaf({
        accountType: null,
        class: "Revenue",
        periods: { "2026-01": { netChange: 40, balanceAtDate: 40 } }
      })
    ];

    const { map } = valuesByKey(accounts);

    expect(map.revenue).toBe(840); // 800 + 40 (class fallback)
    expect(map.operatingExpenses).toBe(90); // class fallback
    expect(map.netIncome).toBe(750); // 840 − 90
  });

  it("skips group rows and the synthetic Net Income line", () => {
    const accounts = [
      leaf({
        id: "grp",
        isGroup: true,
        accountType: "Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 9999, balanceAtDate: 9999 } }
      }),
      leaf({
        id: "net-income",
        accountType: null,
        class: "Equity",
        periods: { "2026-01": { netChange: 5555, balanceAtDate: 5555 } }
      }),
      leaf({
        accountType: "Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 100, balanceAtDate: 100 } }
      })
    ];

    const { map } = valuesByKey(accounts);
    expect(map.revenue).toBe(100);
  });

  it("marks margins null when revenue is zero", () => {
    const accounts = [
      leaf({
        accountType: "Expense",
        class: "Expense",
        periods: { "2026-01": { netChange: 200, balanceAtDate: 200 } }
      })
    ];
    const rows = computeExecutivePnl(accounts, BUCKETS);
    const netIncome = rows.find((r) => r.key === "netIncome")!;
    expect(netIncome.margins?.["2026-01"]).toBeNull();
    expect(netIncome.values["2026-01"]).toBe(-200);
  });

  it("computes margins as a fraction of revenue", () => {
    const accounts = [
      leaf({
        accountType: "Income",
        class: "Revenue",
        periods: { "2026-01": { netChange: 1000, balanceAtDate: 1000 } }
      }),
      leaf({
        accountType: "Cost of Goods Sold",
        class: "Expense",
        periods: { "2026-01": { netChange: 250, balanceAtDate: 250 } }
      })
    ];
    const rows = computeExecutivePnl(accounts, BUCKETS);
    const grossProfit = rows.find((r) => r.key === "grossProfit")!;
    expect(grossProfit.margins?.["2026-01"]).toBeCloseTo(0.75); // 750 / 1000
  });
});
