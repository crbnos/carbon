// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  buildConsumeFirstHops,
  buildConsumeFirstRules,
  buildSupersessionRedirectMap,
  consumableInWholeAssemblies,
  consumeFirstStockItems,
  firstStockedInConsumeFirstChain,
  keepsLineOnPredecessor,
  pullBackQuantities,
  reserveConsumeFirstStock,
  resolveMadeLinePull,
  type SupersessionMode,
  type SupersessionRow,
  settleConsumeFirstLine,
  withoutStockedConsumeFirst
} from "./supersession-pick.ts";

// `buildSupersessionRedirectMap` is the single source of truth for "should this
// component be swapped for its successor", shared by the MRP engine (planning)
// and the get-method server function (job creation) so the two can never disagree.
// A divergence between them is invisible in the app — the plan and the job it
// produces simply disagree about which part to consume — so the contract is
// pinned here rather than by running either caller.
//
// Four things it owns: mode gating, effectivity-date gating, multi-hop chain
// collapse with the factor product, and cycle handling.

const ASOF = "2026-08-18";

const row = (overrides: Partial<SupersessionRow> = {}): SupersessionRow => ({
  itemId: "A",
  supersessionMode: "Consume First",
  successorItemId: "B",
  successorEffectivityDate: null,
  conversionFactor: 1,
  ...overrides
});

it("redirects for Consume First", () => {
  const map = buildSupersessionRedirectMap([row()], ASOF);
  expect(map.get("A")).toEqual({ to: "B", factor: 1 });
});

it("redirects for Prefer New", () => {
  const map = buildSupersessionRedirectMap(
    [row({ supersessionMode: "Prefer New" })],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "B", factor: 1 });
});

it("redirects for Stock Only", () => {
  const map = buildSupersessionRedirectMap(
    [row({ supersessionMode: "Stock Only" })],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "B", factor: 1 });
});

it("does not redirect for No Stock", () => {
  const map = buildSupersessionRedirectMap(
    [row({ supersessionMode: "No Stock", successorItemId: null })],
    ASOF
  );
  expect(map.size).toEqual(0);
});

it("does not redirect without a successor", () => {
  const map = buildSupersessionRedirectMap(
    [row({ successorItemId: null })],
    ASOF
  );
  expect(map.size).toEqual(0);
});

it("carries the conversion factor", () => {
  const map = buildSupersessionRedirectMap(
    [row({ conversionFactor: 2.5 })],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "B", factor: 2.5 });
});

// NUMERIC arrives as a string from some drivers, and a null/0 factor would
// silently zero a job's quantities — both coerce to 1.
it("coerces a string factor and falls back to 1", () => {
  expect(
    buildSupersessionRedirectMap([row({ conversionFactor: "3" })], ASOF).get(
      "A"
    )
  ).toEqual({ to: "B", factor: 3 });
  for (const conversionFactor of [null, 0]) {
    expect(
      buildSupersessionRedirectMap([row({ conversionFactor })], ASOF).get("A")
    ).toEqual({ to: "B", factor: 1 });
  }
});

it("a null effectivity date is effective immediately", () => {
  const map = buildSupersessionRedirectMap(
    [row({ successorEffectivityDate: null })],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "B", factor: 1 });
});

// Lexicographic compare on "YYYY-MM-DD" — the boundary day itself is effective.
it("effectivity gates on the as-of date, inclusive", () => {
  const cases: [string, boolean][] = [
    ["2026-08-17", true],
    [ASOF, true],
    ["2026-08-19", false]
  ];
  for (const [successorEffectivityDate, effective] of cases) {
    const map = buildSupersessionRedirectMap(
      [row({ successorEffectivityDate })],
      ASOF
    );
    expect(map.size).toEqual(effective ? 1 : 0);
  }
});

// A->B->C collapses to A->C so a caller never has to walk the chain itself.
it("collapses a multi-hop chain and multiplies the factors", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "C", conversionFactor: 3 })
    ],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "C", factor: 6 });
  expect(map.get("B")).toEqual({ to: "C", factor: 3 });
});

// A hop that is not yet effective ends the chain there rather than being
// skipped over — demand stops at the last part actually in service.
it("stops a chain at the first ineffective hop", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({
        itemId: "B",
        successorItemId: "C",
        conversionFactor: 3,
        successorEffectivityDate: "2026-12-01"
      })
    ],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "B", factor: 2 });
  expect(map.has("B")).toEqual(false);
});

// The DB CHECK and the zod validator both only block a SELF-reference, so a
// two-row cycle (A->B plus B->A) is fully writable from the UI. A cycle has no
// meaningful terminal successor, so the only safe answer is to redirect
// neither part — an item that supersedes itself would be inserted with
// substitutedFromItemId pointing at its own id and its quantity multiplied by
// the cycle's factor product, which no downstream step can detect or repair.
it("drops a two-item cycle instead of redirecting to self", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "A", conversionFactor: 3 })
    ],
    ASOF
  );
  expect(map.has("A")).toEqual(false);
  expect(map.has("B")).toEqual(false);
});

it("drops a three-item cycle", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "C", conversionFactor: 2 }),
      row({ itemId: "C", successorItemId: "A", conversionFactor: 2 })
    ],
    ASOF
  );
  expect(map.size).toEqual(0);
});

// A chain that FEEDS a cycle must not inherit the cycle's spun-up factor. The
// tail is unresolvable, so the entry that leads into it goes too.
it("drops a chain that terminates in a cycle", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "C", conversionFactor: 3 }),
      row({ itemId: "C", successorItemId: "B", conversionFactor: 5 })
    ],
    ASOF
  );
  expect(map.has("A")).toEqual(false);
  expect(map.has("B")).toEqual(false);
  expect(map.has("C")).toEqual(false);
});

// The collapse walk reads the uncollapsed map and writes into a separate one, so
// no entry can observe another's already-collapsed factor. Row order must not
// change the answer — mutating in place is what made it order-dependent.
it("chain collapse is independent of row order", () => {
  const rows = [
    row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
    row({ itemId: "B", successorItemId: "C", conversionFactor: 3 }),
    row({ itemId: "C", successorItemId: "D", conversionFactor: 5 })
  ];
  const forward = buildSupersessionRedirectMap(rows, ASOF);
  const reversed = buildSupersessionRedirectMap([...rows].reverse(), ASOF);

  expect(forward.get("A")).toEqual({ to: "D", factor: 30 });
  expect(reversed.get("A")).toEqual(forward.get("A"));
  expect(reversed.get("B")).toEqual(forward.get("B"));
  expect(reversed.get("C")).toEqual(forward.get("C"));
});

// One row per item is guaranteed by the PK (itemSupersession_pkey is on
// "itemId" alone), but the builder is fed whatever the caller read.
it("last row wins for a duplicated itemId", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B" }),
      row({ itemId: "A", successorItemId: "C" })
    ],
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "C", factor: 1 });
});

it("returns an empty map for no rows", () => {
  expect(buildSupersessionRedirectMap([], ASOF).size).toEqual(0);
});

it("withoutStockedConsumeFirst keeps a stocked Consume First predecessor", () => {
  const rows = [
    row({ itemId: "A", successorItemId: "B" }),
    row({ itemId: "B", successorItemId: "C" }),
    row({ itemId: "D", successorItemId: "E", supersessionMode: "Prefer New" })
  ];
  const map = buildSupersessionRedirectMap(
    withoutStockedConsumeFirst(rows, new Set(["A", "D"])),
    ASOF
  );
  expect(map.has("A")).toEqual(false);
  expect(map.get("B")).toEqual({ to: "C", factor: 1 });
  expect(map.get("D")).toEqual({ to: "E", factor: 1 });
});

it("withoutStockedConsumeFirst redirects once the predecessor is out", () => {
  const map = buildSupersessionRedirectMap(
    withoutStockedConsumeFirst([row()], new Set()),
    ASOF
  );
  expect(map.get("A")).toEqual({ to: "B", factor: 1 });
});

it("pullBackQuantities converts the target and re-derives scrap at the predecessor's rate", () => {
  const result = pullBackQuantities(
    { quantity: 2, estimatedQuantity: 11, scrapQuantity: 1 },
    0.5,
    0.2
  );
  expect(result.quantity).toEqual(1);
  expect(result.scrapQuantity).toEqual(1); // ceil(5 * 0.2)
  expect(result.estimatedQuantity).toEqual(6);
});

it("pullBackQuantities with no predecessor scrap carries none over", () => {
  const result = pullBackQuantities(
    { quantity: "2", estimatedQuantity: "11", scrapQuantity: "1" },
    0.5,
    0
  );
  expect(result).toEqual({
    quantity: 1,
    estimatedQuantity: 5,
    scrapQuantity: 0
  });
});

it("consumableInWholeAssemblies rounds stock down to whole assemblies", () => {
  expect(consumableInWholeAssemblies(3, 2)).toEqual(2);
  expect(consumableInWholeAssemblies(1, 2)).toEqual(0);
  expect(consumableInWholeAssemblies(4, 2)).toEqual(4);
  expect(consumableInWholeAssemblies(10, 3)).toEqual(9);
  expect(consumableInWholeAssemblies(0, 2)).toEqual(0);
  expect(consumableInWholeAssemblies(-2, 2)).toEqual(0);
});

it("consumableInWholeAssemblies handles fractional and missing per-assembly quantities", () => {
  expect(consumableInWholeAssemblies(0.3, 0.1)).toEqual(0.3);
  expect(consumableInWholeAssemblies(1.25, 0.5)).toEqual(1);
  expect(consumableInWholeAssemblies(3, 0)).toEqual(3);
  expect(consumableInWholeAssemblies(3, Number.NaN)).toEqual(3);
});

const CF_ROWS = [
  {
    itemId: "old",
    successorItemId: "new",
    successorEffectivityDate: null,
    conversionFactor: 1
  }
];
const cfRules = () => buildConsumeFirstRules(CF_ROWS, "2026-09-16");
const stock = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

it("keepsLineOnPredecessor is one whole assembly, never a unit", () => {
  expect(keepsLineOnPredecessor(3, 1)).toEqual(true);
  expect(keepsLineOnPredecessor(3, 2)).toEqual(true); // one pair, one odd part left
  expect(keepsLineOnPredecessor(1, 2)).toEqual(false); // half a pair is nothing
  expect(keepsLineOnPredecessor(0, 1)).toEqual(false);
  expect(keepsLineOnPredecessor(undefined, 1)).toEqual(false);
});

it("buildConsumeFirstRules indexes both directions and gates on effectivity", () => {
  const rules = buildConsumeFirstRules(
    [
      ...CF_ROWS,
      {
        itemId: "older",
        successorItemId: "new",
        successorEffectivityDate: "2026-10-01",
        conversionFactor: "2"
      },
      {
        itemId: "loose",
        successorItemId: null,
        successorEffectivityDate: null,
        conversionFactor: 1
      }
    ],
    "2026-09-16"
  );
  expect(rules.successorByPredecessor.get("old")).toEqual({
    itemId: "new",
    factor: 1
  });
  expect(rules.successorByPredecessor.has("older")).toEqual(false); // not yet effective
  expect(rules.successorByPredecessor.has("loose")).toEqual(false); // no successor
  expect(rules.predecessorsBySuccessor.get("new")).toEqual([
    { itemId: "old", factor: 1 }
  ]);
});

it("case 17: a made line swapped at creation is reverted onto a stocked predecessor", () => {
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: "old" };
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 3 }))).toEqual({
    kind: "revert",
    toItemId: "old",
    factor: 1
  });
});

it("case 18: a swapped line stays on the successor when the predecessor is empty", () => {
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: "old" };
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 0 }))).toEqual(
    null
  );
  expect(settleConsumeFirstLine(line, cfRules(), stock({}))).toEqual(null);
});

it("case 19: no whole assembly in stock pushes a kept line to the successor", () => {
  const line = { itemId: "old", quantity: 2, substitutedFromItemId: null };
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 1 }))).toEqual({
    kind: "push",
    toItemId: "new",
    factor: 1
  });
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 3 }))).toEqual(
    null
  );
});

it("case 20: a line the BOM names by the successor is pulled back onto a stocked predecessor", () => {
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: null };
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 3 }))).toEqual({
    kind: "pullBack",
    toItemId: "old",
    factor: 1
  });
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 0 }))).toEqual(
    null
  );
});

it("case 22: the factor converts the per-assembly quantity before the whole-assembly test", () => {
  const rules = buildConsumeFirstRules(
    [{ ...CF_ROWS[0]!, conversionFactor: 2 }],
    "2026-09-16"
  );
  const line = { itemId: "new", quantity: 2, substitutedFromItemId: "old" };
  expect(settleConsumeFirstLine(line, rules, stock({ old: 1 }))).toEqual({
    kind: "revert",
    toItemId: "old",
    factor: 0.5
  });
  const kept = { itemId: "old", quantity: 1, substitutedFromItemId: null };
  expect(settleConsumeFirstLine(kept, rules, stock({ old: 0 }))).toEqual({
    kind: "push",
    toItemId: "new",
    factor: 2
  });
});

it("case 21 (quantities): a revert recovers the target and re-derives scrap at the predecessor's rate", () => {
  expect(
    pullBackQuantities(
      { quantity: 1, estimatedQuantity: 5, scrapQuantity: 0 },
      1,
      0.1
    )
  ).toEqual({ quantity: 1, estimatedQuantity: 6, scrapQuantity: 1 });
});

it("a swapped row's provenance only counts when the predecessor's rule names this row's item", () => {
  const rules = buildConsumeFirstRules(
    [
      ...CF_ROWS,
      {
        itemId: "older",
        successorItemId: "other",
        successorEffectivityDate: null,
        conversionFactor: 1
      }
    ],
    "2026-09-16"
  );
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: "older" };
  expect(
    settleConsumeFirstLine(line, rules, stock({ older: 5, old: 5 }))
  ).toEqual({
    kind: "pullBack",
    toItemId: "old",
    factor: 1
  });
});

it("a line with no Consume First relation is left alone", () => {
  const line = {
    itemId: "unrelated",
    quantity: 1,
    substitutedFromItemId: null
  };
  expect(settleConsumeFirstLine(line, cfRules(), stock({ old: 9 }))).toEqual(
    null
  );
});

it("consumeFirstStockItems names every item whose stock decides the line", () => {
  const rules = cfRules();
  expect(
    consumeFirstStockItems(
      { itemId: "old", substitutedFromItemId: null },
      rules
    )
  ).toEqual(["old"]);
  expect(
    consumeFirstStockItems(
      { itemId: "new", substitutedFromItemId: null },
      rules
    )
  ).toEqual(["old"]);
  expect(
    consumeFirstStockItems(
      { itemId: "new", substitutedFromItemId: "old" },
      rules
    )
  ).toEqual(["old"]);
  expect(
    consumeFirstStockItems({ itemId: "x", substitutedFromItemId: null }, rules)
  ).toEqual([]);
});

const cfRow = (
  itemId: string,
  successorItemId: string | null,
  supersessionMode: SupersessionMode = "Consume First",
  conversionFactor: number | string | null = 1,
  successorEffectivityDate: string | null = null
) => ({
  itemId,
  successorItemId,
  supersessionMode,
  conversionFactor,
  successorEffectivityDate
});

it("buildConsumeFirstHops stops at the next Consume First item instead of collapsing", () => {
  const hops = buildConsumeFirstHops(
    [cfRow("old", "mid"), cfRow("mid", "new")],
    "2026-09-16"
  );
  expect(hops.get("old")).toEqual({ to: "mid", factor: 1 });
  expect(hops.get("mid")).toEqual({ to: "new", factor: 1 });
  expect(
    buildSupersessionRedirectMap(
      [cfRow("old", "mid"), cfRow("mid", "new")],
      "2026-09-16"
    ).get("old")
  ).toEqual({ to: "new", factor: 1 });
});

it("buildConsumeFirstHops collapses THROUGH a non-Consume-First hop and multiplies its factor", () => {
  const hops = buildConsumeFirstHops(
    [
      cfRow("old", "mid", "Consume First", 2),
      cfRow("mid", "new", "Prefer New", 3)
    ],
    "2026-09-16"
  );
  expect(hops.get("old")).toEqual({ to: "new", factor: 6 });
  expect(hops.has("mid")).toEqual(false);
});

it("buildConsumeFirstHops honours effectivity per hop and drops cycles", () => {
  const hops = buildConsumeFirstHops(
    [
      cfRow("old", "mid", "Consume First", 1, "2026-10-01"), // not yet
      cfRow("mid", "new"),
      cfRow("a", "b"),
      cfRow("b", "a")
    ],
    "2026-09-16"
  );
  expect(hops.has("old")).toEqual(false);
  expect(hops.get("mid")).toEqual({ to: "new", factor: 1 });
  expect(hops.has("a")).toEqual(false);
  expect(hops.has("b")).toEqual(false);
});

it("firstStockedInConsumeFirstChain returns the first hop with a whole assembly, at the cumulative factor", () => {
  const hops = buildConsumeFirstHops(
    [cfRow("old", "mid", "Consume First", 2), cfRow("mid", "new")],
    "2026-09-16"
  );
  const onHand = (m: Record<string, number>) => new Map(Object.entries(m));
  expect(
    firstStockedInConsumeFirstChain("old", 1, hops, onHand({ old: 1, mid: 9 }))
  ).toEqual({
    itemId: "old",
    factor: 1
  });
  expect(
    firstStockedInConsumeFirstChain("old", 1, hops, onHand({ old: 0, mid: 2 }))
  ).toEqual({
    itemId: "mid",
    factor: 2
  });
  expect(
    firstStockedInConsumeFirstChain("old", 1, hops, onHand({ old: 0, mid: 1 }))
  ).toEqual(null);
  expect(
    firstStockedInConsumeFirstChain("old", 1, hops, onHand({ new: 50 }))
  ).toEqual(null);
  expect(
    firstStockedInConsumeFirstChain("lonely", 1, hops, onHand({ lonely: 5 }))
  ).toEqual(null);
});

it("resolveMadeLinePull: stocked chain first, then a bought successor, else build", () => {
  const rows = [cfRow("old", "new")];
  const ctx = {
    redirect: buildSupersessionRedirectMap(rows, "2026-09-16"),
    consumeFirstHops: buildConsumeFirstHops(rows, "2026-09-16"),
    consumeFirstOnHand: new Map([["old", 0]]),
    boughtSuccessors: new Set<string>()
  };
  expect(resolveMadeLinePull("old", 1, ctx)).toEqual(null);
  expect(
    resolveMadeLinePull("old", 1, {
      ...ctx,
      consumeFirstOnHand: new Map([["old", 2]])
    })
  ).toEqual({ itemId: "old", factor: 1 });
  expect(
    resolveMadeLinePull("old", 1, {
      ...ctx,
      boughtSuccessors: new Set(["new"])
    })
  ).toEqual({ itemId: "new", factor: 1 });
  expect(
    resolveMadeLinePull("other", 1, {
      ...ctx,
      boughtSuccessors: new Set(["new"])
    })
  ).toEqual(null);
});

it("reserveConsumeFirstStock: a settled line draws its whole assemblies down for the next line", () => {
  const rules = buildConsumeFirstRules([cfRow("old", "new")], "2026-09-16");
  const onHand = new Map([["old", 6]]);
  const first = {
    itemId: "old",
    quantity: 4,
    estimatedQuantity: 4,
    scrapQuantity: 0,
    substitutedFromItemId: null
  };
  const second = { ...first };
  const s1 = settleConsumeFirstLine(first, rules, onHand);
  reserveConsumeFirstStock(first, s1, rules, onHand);
  expect(s1).toEqual(null);
  expect(onHand.get("old")).toEqual(2);
  expect(settleConsumeFirstLine(second, rules, onHand)).toEqual({
    kind: "push",
    toItemId: "new",
    factor: 1
  });
});

it("reserveConsumeFirstStock: a revert reserves in the predecessor's units and a push reserves nothing", () => {
  const rules = buildConsumeFirstRules(
    [cfRow("old", "new", "Consume First", 2)],
    "2026-09-16"
  );
  const onHand = new Map([["old", 3]]);
  const swapped = {
    itemId: "new",
    quantity: 2,
    estimatedQuantity: 8,
    scrapQuantity: 0,
    substitutedFromItemId: "old"
  };
  const s = settleConsumeFirstLine(swapped, rules, onHand);
  expect(s).toEqual({ kind: "revert", toItemId: "old", factor: 0.5 });
  reserveConsumeFirstStock(swapped, s, rules, onHand);
  expect(onHand.get("old")).toEqual(0);
  const kept = {
    itemId: "old",
    quantity: 1,
    estimatedQuantity: 2,
    scrapQuantity: 0,
    substitutedFromItemId: null
  };
  const s3 = settleConsumeFirstLine(kept, rules, onHand);
  expect(s3).toEqual({ kind: "push", toItemId: "new", factor: 2 });
  reserveConsumeFirstStock(kept, s3, rules, onHand);
  expect(onHand.get("old")).toEqual(0);
});
