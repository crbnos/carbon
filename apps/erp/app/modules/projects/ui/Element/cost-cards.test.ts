// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  costDescriptionKey,
  isOverBudget,
  keyOwners,
  ledgerLineType,
  matchesSearch,
  planProgress,
  sortActualCards,
  sortPlanCards
} from "./cost-cards";

const figures = (
  key: string,
  plannedAmount: number | null,
  actualAmount: number,
  plannedQuantity: number | null = null,
  actualQuantity: number | null = null
) => ({ key, plannedAmount, actualAmount, plannedQuantity, actualQuantity });

const keys = (cards: { key: string }[]) => cards.map((card) => card.key);

describe("keyOwners", () => {
  it("gives a shared key to its oldest line", () => {
    const lines = [
      { id: "b", createdAt: "2026-10-02T00:00:00+00:00", itemId: "x" },
      { id: "a", createdAt: "2026-10-01T00:00:00+00:00", itemId: "x" },
      { id: "c", createdAt: "2026-10-03T00:00:00+00:00", itemId: "y" }
    ];
    expect(keyOwners(lines, (line) => line.itemId)).toEqual(
      new Set(["a", "c"])
    );
  });

  it("breaks a createdAt tie by id", () => {
    const lines = [
      { id: "m2", createdAt: "2026-10-01T00:00:00+00:00" },
      { id: "m1", createdAt: "2026-10-01T00:00:00+00:00" }
    ];
    expect(keyOwners(lines, () => "same")).toEqual(new Set(["m1"]));
  });
});

describe("costDescriptionKey", () => {
  it("matches the SQL grouping: trimmed, lower case", () => {
    expect(costDescriptionKey("  Chamber Rental ")).toBe("chamber rental");
  });
});

describe("ledgerLineType", () => {
  it("maps cost types onto the three card types", () => {
    expect(ledgerLineType("Material")).toBe("material");
    expect(ledgerLineType("Material Variance")).toBe("material");
    expect(ledgerLineType("Labor")).toBe("labor");
    expect(ledgerLineType("Other Direct")).toBe("cost");
    expect(ledgerLineType("Burden")).toBe("cost");
  });
});

describe("matchesSearch", () => {
  it("needs every word somewhere in the texts", () => {
    expect(
      matchesSearch(["ST-050", "Star tracker optics"], "st-050 optics")
    ).toBe(true);
    expect(matchesSearch(["ST-050", "Star tracker optics"], "lens")).toBe(
      false
    );
    expect(matchesSearch([null, undefined], "  ")).toBe(true);
  });
});

describe("isOverBudget and planProgress", () => {
  it("compares money when the line has a planned amount", () => {
    expect(isOverBudget(figures("a", 500, 600, 10, 4))).toBe(true);
    expect(isOverBudget(figures("a", 500, 500, 10, 12))).toBe(false);
  });

  it("falls back to quantity without a planned amount", () => {
    expect(isOverBudget(figures("a", null, 0, 10, 11))).toBe(true);
  });

  it("measures progress in quantity first, capped at 1", () => {
    expect(planProgress(figures("a", 500, 100, 10, 4))).toBe(0.4);
    expect(planProgress(figures("a", 2000, 500))).toBe(0.25);
    expect(planProgress(figures("a", 500, 900, 10, 30))).toBe(1);
    expect(planProgress(figures("a", null, 0))).toBe(0);
  });
});

describe("sortPlanCards", () => {
  const cards = [
    figures("m1", 500, 200),
    figures("l1", 4800, 5000),
    figures("c1", 2000, 0)
  ];

  it("keeps plan order", () => {
    expect(keys(sortPlanCards(cards, "plan"))).toEqual(["m1", "l1", "c1"]);
  });

  it("sorts by estimate and by what is left", () => {
    expect(keys(sortPlanCards(cards, "amount"))).toEqual(["l1", "c1", "m1"]);
    expect(keys(sortPlanCards(cards, "remaining"))).toEqual(["c1", "m1", "l1"]);
  });

  it("puts lines over their estimate first", () => {
    expect(keys(sortPlanCards(cards, "over"))).toEqual(["l1", "m1", "c1"]);
  });
});

describe("sortActualCards", () => {
  const cards = [
    { key: "c", date: "2026-10-03", amount: 10 },
    { key: "b", date: "2026-10-02", amount: -300 },
    { key: "a", date: "2026-10-01", amount: 50 }
  ];

  it("reverses the newest-first order for oldest", () => {
    expect(keys(sortActualCards(cards, "newest"))).toEqual(["c", "b", "a"]);
    expect(keys(sortActualCards(cards, "oldest"))).toEqual(["a", "b", "c"]);
  });

  it("sorts by the size of the amount", () => {
    expect(keys(sortActualCards(cards, "amount"))).toEqual(["b", "a", "c"]);
  });
});
