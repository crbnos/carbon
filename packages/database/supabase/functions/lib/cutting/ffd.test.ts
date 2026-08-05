import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { optimizeCuts1D, piecesPerStock, usableLength } from "./ffd.ts";

const params = (overrides: Partial<Parameters<typeof optimizeCuts1D>[2]> = {}) => ({
  kerf: 0,
  endTrim: 0,
  gripMargin: 0,
  minRemnantLength: 0,
  ...overrides
});

const bar = (stockId: string, length: number, isRemnant = false) => ({
  stockId,
  trackedEntityId: stockId,
  length,
  isRemnant
});

Deno.test("piecesPerStock accounts for kerf between pieces", () => {
  // 240" bar, 5.7" pieces, 0.06" kerf: 41 fit, not 42.
  assertEquals(
    piecesPerStock(240, 5.7, params({ kerf: 0.06 })),
    41
  );
});

Deno.test("piecesPerStock subtracts trim and grip before fitting", () => {
  // 100 usable becomes 100 - 4 - 6 = 90; 10" pieces → 9.
  assertEquals(
    piecesPerStock(100, 10, params({ endTrim: 4, gripMargin: 6 })),
    9
  );
});

Deno.test("piecesPerStock returns zero when nothing fits", () => {
  assertEquals(piecesPerStock(10, 20, params()), 0);
  assertEquals(piecesPerStock(100, 0, params()), 0);
});

Deno.test("usableLength removes trim and grip", () => {
  assertEquals(
    usableLength(bar("a", 240), params({ endTrim: 2, gripMargin: 3 })),
    235
  );
});

Deno.test("packs pieces into one stock unit when they fit", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 10, quantity: 4 }],
    [bar("s1", 100)],
    params()
  );

  assertEquals(result.patterns.length, 1);
  assertEquals(result.patterns[0].cuts.length, 4);
  assertEquals(result.patterns[0].piecesLength, 40);
  assertEquals(result.unplaced.length, 0);
});

Deno.test("kerf is charged between pieces, not before the first", () => {
  // 3 pieces of 10 with kerf 1 = 10 + 11 + 11 = 32, so a 32 bar holds exactly 3.
  const exact = optimizeCuts1D(
    [{ lineId: "l1", length: 10, quantity: 3 }],
    [bar("s1", 32)],
    params({ kerf: 1 })
  );
  assertEquals(exact.patterns.length, 1);
  assertEquals(exact.patterns[0].cuts.length, 3);

  // One inch shorter and the third piece needs a second bar.
  const tight = optimizeCuts1D(
    [{ lineId: "l1", length: 10, quantity: 3 }],
    [bar("s1", 31), bar("s2", 31)],
    params({ kerf: 1 })
  );
  assertEquals(tight.patterns.length, 2);
});

Deno.test("remnants are consumed before new stock", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 10, quantity: 1 }],
    [bar("full", 240, false), bar("drop", 40, true)],
    params()
  );

  assertEquals(result.patterns.length, 1);
  assertEquals(result.patterns[0].stockId, "drop");
});

Deno.test("the shortest usable remnant goes first", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 10, quantity: 1 }],
    [bar("big-drop", 90, true), bar("small-drop", 30, true)],
    params()
  );

  assertEquals(result.patterns[0].stockId, "small-drop");
});

Deno.test("a piece longer than any stock is reported, not dropped", () => {
  const result = optimizeCuts1D(
    [
      { lineId: "l1", length: 500, quantity: 2 },
      { lineId: "l2", length: 10, quantity: 1 }
    ],
    [bar("s1", 100)],
    params()
  );

  assertEquals(result.unplaced.length, 1);
  assertEquals(result.unplaced[0].lineId, "l1");
  assertEquals(result.unplaced[0].quantity, 2);
  assertEquals(result.unplaced[0].reason, "no-stock-long-enough");
  // The piece that does fit is still planned.
  assertEquals(result.patterns.length, 1);
});

Deno.test("running out of stock is reported separately", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 60, quantity: 3 }],
    [bar("s1", 100)],
    params()
  );

  assertEquals(result.patterns.length, 1);
  assertEquals(result.unplaced[0].reason, "stock-exhausted");
  assertEquals(result.unplaced[0].quantity, 2);
});

Deno.test("leftover at or above the threshold becomes a planned remnant", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 60, quantity: 1 }],
    [bar("s1", 100)],
    params({ minRemnantLength: 20 })
  );

  assertEquals(result.patterns[0].expectedRemnant, 40);
  assertEquals(result.patterns[0].waste, 0);
});

Deno.test("leftover below the threshold is waste, not a remnant", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 90, quantity: 1 }],
    [bar("s1", 100)],
    params({ minRemnantLength: 20 })
  );

  assertEquals(result.patterns[0].expectedRemnant, 0);
  assertEquals(result.patterns[0].waste, 10);
});

Deno.test("trim and grip are charged to waste", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 90, quantity: 1 }],
    [bar("s1", 100)],
    params({ endTrim: 5, gripMargin: 5, minRemnantLength: 1 })
  );

  // 100 - 5 - 5 = 90 usable, exactly one piece, nothing left over.
  assertEquals(result.patterns[0].piecesLength, 90);
  assertEquals(result.patterns[0].expectedRemnant, 0);
  assertEquals(result.patterns[0].waste, 10);
});

Deno.test("yield excludes returnable remnants from consumption", () => {
  const result = optimizeCuts1D(
    [{ lineId: "l1", length: 200, quantity: 1 }],
    [bar("s1", 240)],
    params({ minRemnantLength: 20 })
  );

  // 40 drop returns to stock, so 200 of 200 consumed became parts.
  assertEquals(result.patterns[0].expectedRemnant, 40);
  assertEquals(result.yieldPct, 100);
});

Deno.test("best-fit prefers the tightest open bar", () => {
  // Two bars open with 30 and 12 left; a 10 piece should take the 12.
  const result = optimizeCuts1D(
    [
      { lineId: "big", length: 70, quantity: 1 },
      { lineId: "mid", length: 88, quantity: 1 },
      { lineId: "small", length: 10, quantity: 1 }
    ],
    [bar("s1", 100), bar("s2", 100)],
    params()
  );

  const withSmall = result.patterns.find((p) =>
    p.cuts.some((c) => c.lineId === "small")
  );
  assertEquals(withSmall?.cuts.some((c) => c.lineId === "mid"), true);
});

Deno.test("is deterministic regardless of input ordering", () => {
  const demands = [
    { lineId: "b", length: 30, quantity: 2 },
    { lineId: "a", length: 30, quantity: 2 }
  ];
  const stock = [bar("s1", 100), bar("s2", 100)];

  const first = optimizeCuts1D(demands, stock, params());
  const second = optimizeCuts1D([...demands].reverse(), [...stock].reverse(), params());

  assertEquals(
    JSON.stringify(first.patterns),
    JSON.stringify(second.patterns)
  );
});

Deno.test("no demand yields no patterns and zero yield", () => {
  const result = optimizeCuts1D([], [bar("s1", 100)], params());
  assertEquals(result.patterns.length, 0);
  assertEquals(result.yieldPct, 0);
  assertEquals(result.unplaced.length, 0);
});
