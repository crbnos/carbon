import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildSupersessionRedirectMap,
  consumableInWholeAssemblies,
  pullBackQuantities,
  type SupersessionRow,
  withoutStockedConsumeFirst,
  buildConsumeFirstRules,
  consumeFirstStockItems,
  keepsLineOnPredecessor,
  settleConsumeFirstLine,
  buildConsumeFirstHops,
  firstStockedInConsumeFirstChain,
  resolveMadeLinePull,
  type SupersessionMode,
  reserveConsumeFirstStock,
} from "./supersession-pick.ts";

// `buildSupersessionRedirectMap` is the single source of truth for "should this
// component be swapped for its successor", shared by the MRP engine (planning)
// and the get-method edge function (job creation) so the two can never disagree.
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
  ...overrides,
});

Deno.test("redirects for Consume First", () => {
  const map = buildSupersessionRedirectMap([row()], ASOF);
  assertEquals(map.get("A"), { to: "B", factor: 1 });
});

Deno.test("redirects for Prefer New", () => {
  const map = buildSupersessionRedirectMap(
    [row({ supersessionMode: "Prefer New" })],
    ASOF
  );
  assertEquals(map.get("A"), { to: "B", factor: 1 });
});

Deno.test("redirects for Stock Only", () => {
  const map = buildSupersessionRedirectMap(
    [row({ supersessionMode: "Stock Only" })],
    ASOF
  );
  assertEquals(map.get("A"), { to: "B", factor: 1 });
});

Deno.test("does not redirect for No Stock", () => {
  const map = buildSupersessionRedirectMap(
    [row({ supersessionMode: "No Stock", successorItemId: null })],
    ASOF
  );
  assertEquals(map.size, 0);
});

Deno.test("does not redirect without a successor", () => {
  const map = buildSupersessionRedirectMap(
    [row({ successorItemId: null })],
    ASOF
  );
  assertEquals(map.size, 0);
});

Deno.test("carries the conversion factor", () => {
  const map = buildSupersessionRedirectMap([row({ conversionFactor: 2.5 })], ASOF);
  assertEquals(map.get("A"), { to: "B", factor: 2.5 });
});

// NUMERIC arrives as a string from some drivers, and a null/0 factor would
// silently zero a job's quantities — both coerce to 1.
Deno.test("coerces a string factor and falls back to 1", () => {
  assertEquals(
    buildSupersessionRedirectMap([row({ conversionFactor: "3" })], ASOF).get("A"),
    { to: "B", factor: 3 }
  );
  for (const conversionFactor of [null, 0]) {
    assertEquals(
      buildSupersessionRedirectMap([row({ conversionFactor })], ASOF).get("A"),
      { to: "B", factor: 1 },
      String(conversionFactor)
    );
  }
});

Deno.test("a null effectivity date is effective immediately", () => {
  const map = buildSupersessionRedirectMap(
    [row({ successorEffectivityDate: null })],
    ASOF
  );
  assertEquals(map.get("A"), { to: "B", factor: 1 });
});

// Lexicographic compare on "YYYY-MM-DD" — the boundary day itself is effective.
Deno.test("effectivity gates on the as-of date, inclusive", () => {
  const cases: [string, boolean][] = [
    ["2026-08-17", true],
    [ASOF, true],
    ["2026-08-19", false],
  ];
  for (const [successorEffectivityDate, effective] of cases) {
    const map = buildSupersessionRedirectMap(
      [row({ successorEffectivityDate })],
      ASOF
    );
    assertEquals(map.size, effective ? 1 : 0, successorEffectivityDate);
  }
});

// A->B->C collapses to A->C so a caller never has to walk the chain itself.
Deno.test("collapses a multi-hop chain and multiplies the factors", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "C", conversionFactor: 3 }),
    ],
    ASOF
  );
  assertEquals(map.get("A"), { to: "C", factor: 6 });
  assertEquals(map.get("B"), { to: "C", factor: 3 });
});

// A hop that is not yet effective ends the chain there rather than being
// skipped over — demand stops at the last part actually in service.
Deno.test("stops a chain at the first ineffective hop", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({
        itemId: "B",
        successorItemId: "C",
        conversionFactor: 3,
        successorEffectivityDate: "2026-12-01",
      }),
    ],
    ASOF
  );
  assertEquals(map.get("A"), { to: "B", factor: 2 });
  assertEquals(map.has("B"), false);
});

// The DB CHECK and the zod validator both only block a SELF-reference, so a
// two-row cycle (A->B plus B->A) is fully writable from the UI. A cycle has no
// meaningful terminal successor, so the only safe answer is to redirect
// neither part — an item that supersedes itself would be inserted with
// substitutedFromItemId pointing at its own id and its quantity multiplied by
// the cycle's factor product, which no downstream step can detect or repair.
Deno.test("drops a two-item cycle instead of redirecting to self", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "A", conversionFactor: 3 }),
    ],
    ASOF
  );
  assertEquals(map.has("A"), false);
  assertEquals(map.has("B"), false);
});

Deno.test("drops a three-item cycle", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "C", conversionFactor: 2 }),
      row({ itemId: "C", successorItemId: "A", conversionFactor: 2 }),
    ],
    ASOF
  );
  assertEquals(map.size, 0);
});

// A chain that FEEDS a cycle must not inherit the cycle's spun-up factor. The
// tail is unresolvable, so the entry that leads into it goes too.
Deno.test("drops a chain that terminates in a cycle", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
      row({ itemId: "B", successorItemId: "C", conversionFactor: 3 }),
      row({ itemId: "C", successorItemId: "B", conversionFactor: 5 }),
    ],
    ASOF
  );
  assertEquals(map.has("A"), false);
  assertEquals(map.has("B"), false);
  assertEquals(map.has("C"), false);
});

// The collapse walk reads the uncollapsed map and writes into a separate one, so
// no entry can observe another's already-collapsed factor. Row order must not
// change the answer — mutating in place is what made it order-dependent.
Deno.test("chain collapse is independent of row order", () => {
  const rows = [
    row({ itemId: "A", successorItemId: "B", conversionFactor: 2 }),
    row({ itemId: "B", successorItemId: "C", conversionFactor: 3 }),
    row({ itemId: "C", successorItemId: "D", conversionFactor: 5 }),
  ];
  const forward = buildSupersessionRedirectMap(rows, ASOF);
  const reversed = buildSupersessionRedirectMap([...rows].reverse(), ASOF);

  assertEquals(forward.get("A"), { to: "D", factor: 30 });
  assertEquals(reversed.get("A"), forward.get("A"));
  assertEquals(reversed.get("B"), forward.get("B"));
  assertEquals(reversed.get("C"), forward.get("C"));
});

// One row per item is guaranteed by the PK (itemSupersession_pkey is on
// "itemId" alone), but the builder is fed whatever the caller read.
Deno.test("last row wins for a duplicated itemId", () => {
  const map = buildSupersessionRedirectMap(
    [
      row({ itemId: "A", successorItemId: "B" }),
      row({ itemId: "A", successorItemId: "C" }),
    ],
    ASOF
  );
  assertEquals(map.get("A"), { to: "C", factor: 1 });
});

Deno.test("returns an empty map for no rows", () => {
  assertEquals(buildSupersessionRedirectMap([], ASOF).size, 0);
});

Deno.test("withoutStockedConsumeFirst keeps a stocked Consume First predecessor", () => {
  const rows = [
    row({ itemId: "A", successorItemId: "B" }),
    row({ itemId: "B", successorItemId: "C" }),
    row({ itemId: "D", successorItemId: "E", supersessionMode: "Prefer New" }),
  ];
  const map = buildSupersessionRedirectMap(
    withoutStockedConsumeFirst(rows, new Set(["A", "D"])),
    ASOF
  );
  assertEquals(map.has("A"), false);
  assertEquals(map.get("B"), { to: "C", factor: 1 });
  assertEquals(map.get("D"), { to: "E", factor: 1 });
});

Deno.test("withoutStockedConsumeFirst redirects once the predecessor is out", () => {
  const map = buildSupersessionRedirectMap(
    withoutStockedConsumeFirst([row()], new Set()),
    ASOF
  );
  assertEquals(map.get("A"), { to: "B", factor: 1 });
});

Deno.test("pullBackQuantities converts the target and re-derives scrap at the predecessor's rate", () => {
  const result = pullBackQuantities(
    { quantity: 2, estimatedQuantity: 11, scrapQuantity: 1 },
    0.5,
    0.2
  );
  assertEquals(result.quantity, 1);
  assertEquals(result.scrapQuantity, 1); // ceil(5 * 0.2)
  assertEquals(result.estimatedQuantity, 6);
});

Deno.test("pullBackQuantities with no predecessor scrap carries none over", () => {
  const result = pullBackQuantities(
    { quantity: "2", estimatedQuantity: "11", scrapQuantity: "1" },
    0.5,
    0
  );
  assertEquals(result, { quantity: 1, estimatedQuantity: 5, scrapQuantity: 0 });
});

Deno.test("consumableInWholeAssemblies rounds stock down to whole assemblies", () => {
  assertEquals(consumableInWholeAssemblies(3, 2), 2);
  assertEquals(consumableInWholeAssemblies(1, 2), 0);
  assertEquals(consumableInWholeAssemblies(4, 2), 4);
  assertEquals(consumableInWholeAssemblies(10, 3), 9);
  assertEquals(consumableInWholeAssemblies(0, 2), 0);
  assertEquals(consumableInWholeAssemblies(-2, 2), 0);
});

Deno.test("consumableInWholeAssemblies handles fractional and missing per-assembly quantities", () => {
  assertEquals(consumableInWholeAssemblies(0.3, 0.1), 0.3);
  assertEquals(consumableInWholeAssemblies(1.25, 0.5), 1);
  assertEquals(consumableInWholeAssemblies(3, 0), 3);
  assertEquals(consumableInWholeAssemblies(3, Number.NaN), 3);
});


const CF_ROWS = [
  {
    itemId: "old",
    successorItemId: "new",
    successorEffectivityDate: null,
    conversionFactor: 1,
  },
];
const cfRules = () => buildConsumeFirstRules(CF_ROWS, "2026-09-16");
const stock = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

Deno.test("keepsLineOnPredecessor is one whole assembly, never a unit", () => {
  assertEquals(keepsLineOnPredecessor(3, 1), true);
  assertEquals(keepsLineOnPredecessor(3, 2), true); // one pair, one odd part left
  assertEquals(keepsLineOnPredecessor(1, 2), false); // half a pair is nothing
  assertEquals(keepsLineOnPredecessor(0, 1), false);
  assertEquals(keepsLineOnPredecessor(undefined, 1), false);
});

Deno.test("buildConsumeFirstRules indexes both directions and gates on effectivity", () => {
  const rules = buildConsumeFirstRules(
    [
      ...CF_ROWS,
      {
        itemId: "older",
        successorItemId: "new",
        successorEffectivityDate: "2026-10-01",
        conversionFactor: "2",
      },
      { itemId: "loose", successorItemId: null, successorEffectivityDate: null, conversionFactor: 1 },
    ],
    "2026-09-16"
  );
  assertEquals(rules.successorByPredecessor.get("old"), { itemId: "new", factor: 1 });
  assertEquals(rules.successorByPredecessor.has("older"), false); // not yet effective
  assertEquals(rules.successorByPredecessor.has("loose"), false); // no successor
  assertEquals(rules.predecessorsBySuccessor.get("new"), [{ itemId: "old", factor: 1 }]);
});

Deno.test("case 17: a made line swapped at creation is reverted onto a stocked predecessor", () => {
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: "old" };
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 3 })), {
    kind: "revert",
    toItemId: "old",
    factor: 1,
  });
});

Deno.test("case 18: a swapped line stays on the successor when the predecessor is empty", () => {
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: "old" };
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 0 })), null);
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({})), null);
});

Deno.test("case 19: no whole assembly in stock pushes a kept line to the successor", () => {
  const line = { itemId: "old", quantity: 2, substitutedFromItemId: null };
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 1 })), {
    kind: "push",
    toItemId: "new",
    factor: 1,
  });
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 3 })), null);
});

Deno.test("case 20: a line the BOM names by the successor is pulled back onto a stocked predecessor", () => {
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: null };
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 3 })), {
    kind: "pullBack",
    toItemId: "old",
    factor: 1,
  });
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 0 })), null);
});

Deno.test("case 22: the factor converts the per-assembly quantity before the whole-assembly test", () => {
  const rules = buildConsumeFirstRules(
    [{ ...CF_ROWS[0]!, conversionFactor: 2 }],
    "2026-09-16"
  );
  const line = { itemId: "new", quantity: 2, substitutedFromItemId: "old" };
  assertEquals(settleConsumeFirstLine(line, rules, stock({ old: 1 })), {
    kind: "revert",
    toItemId: "old",
    factor: 0.5,
  });
  const kept = { itemId: "old", quantity: 1, substitutedFromItemId: null };
  assertEquals(settleConsumeFirstLine(kept, rules, stock({ old: 0 })), {
    kind: "push",
    toItemId: "new",
    factor: 2,
  });
});

Deno.test("case 21 (quantities): a revert recovers the target and re-derives scrap at the predecessor's rate", () => {
  assertEquals(
    pullBackQuantities({ quantity: 1, estimatedQuantity: 5, scrapQuantity: 0 }, 1, 0.1),
    { quantity: 1, estimatedQuantity: 6, scrapQuantity: 1 }
  );
});

Deno.test("a swapped row's provenance only counts when the predecessor's rule names this row's item", () => {
  const rules = buildConsumeFirstRules(
    [...CF_ROWS, { itemId: "older", successorItemId: "other", successorEffectivityDate: null, conversionFactor: 1 }],
    "2026-09-16"
  );
  const line = { itemId: "new", quantity: 1, substitutedFromItemId: "older" };
  assertEquals(settleConsumeFirstLine(line, rules, stock({ older: 5, old: 5 })), {
    kind: "pullBack",
    toItemId: "old",
    factor: 1,
  });
});

Deno.test("a line with no Consume First relation is left alone", () => {
  const line = { itemId: "unrelated", quantity: 1, substitutedFromItemId: null };
  assertEquals(settleConsumeFirstLine(line, cfRules(), stock({ old: 9 })), null);
});

Deno.test("consumeFirstStockItems names every item whose stock decides the line", () => {
  const rules = cfRules();
  assertEquals(consumeFirstStockItems({ itemId: "old", substitutedFromItemId: null }, rules), ["old"]);
  assertEquals(consumeFirstStockItems({ itemId: "new", substitutedFromItemId: null }, rules), ["old"]);
  assertEquals(consumeFirstStockItems({ itemId: "new", substitutedFromItemId: "old" }, rules), ["old"]);
  assertEquals(consumeFirstStockItems({ itemId: "x", substitutedFromItemId: null }, rules), []);
});


const cfRow = (
  itemId: string,
  successorItemId: string | null,
  supersessionMode: SupersessionMode = "Consume First",
  conversionFactor: number | string | null = 1,
  successorEffectivityDate: string | null = null
) => ({ itemId, successorItemId, supersessionMode, conversionFactor, successorEffectivityDate });

Deno.test("buildConsumeFirstHops stops at the next Consume First item instead of collapsing", () => {
  const hops = buildConsumeFirstHops(
    [cfRow("old", "mid"), cfRow("mid", "new")],
    "2026-09-16"
  );
  assertEquals(hops.get("old"), { to: "mid", factor: 1 });
  assertEquals(hops.get("mid"), { to: "new", factor: 1 });
  assertEquals(
    buildSupersessionRedirectMap([cfRow("old", "mid"), cfRow("mid", "new")], "2026-09-16").get("old"),
    { to: "new", factor: 1 }
  );
});

Deno.test("buildConsumeFirstHops collapses THROUGH a non-Consume-First hop and multiplies its factor", () => {
  const hops = buildConsumeFirstHops(
    [cfRow("old", "mid", "Consume First", 2), cfRow("mid", "new", "Prefer New", 3)],
    "2026-09-16"
  );
  assertEquals(hops.get("old"), { to: "new", factor: 6 });
  assertEquals(hops.has("mid"), false);
});

Deno.test("buildConsumeFirstHops honours effectivity per hop and drops cycles", () => {
  const hops = buildConsumeFirstHops(
    [
      cfRow("old", "mid", "Consume First", 1, "2026-10-01"), // not yet
      cfRow("mid", "new"),
      cfRow("a", "b"),
      cfRow("b", "a"),
    ],
    "2026-09-16"
  );
  assertEquals(hops.has("old"), false);
  assertEquals(hops.get("mid"), { to: "new", factor: 1 });
  assertEquals(hops.has("a"), false);
  assertEquals(hops.has("b"), false);
});

Deno.test("firstStockedInConsumeFirstChain returns the first hop with a whole assembly, at the cumulative factor", () => {
  const hops = buildConsumeFirstHops(
    [cfRow("old", "mid", "Consume First", 2), cfRow("mid", "new")],
    "2026-09-16"
  );
  const onHand = (m: Record<string, number>) => new Map(Object.entries(m));
  assertEquals(firstStockedInConsumeFirstChain("old", 1, hops, onHand({ old: 1, mid: 9 })), {
    itemId: "old",
    factor: 1,
  });
  assertEquals(firstStockedInConsumeFirstChain("old", 1, hops, onHand({ old: 0, mid: 2 })), {
    itemId: "mid",
    factor: 2,
  });
  assertEquals(firstStockedInConsumeFirstChain("old", 1, hops, onHand({ old: 0, mid: 1 })), null);
  assertEquals(firstStockedInConsumeFirstChain("old", 1, hops, onHand({ new: 50 })), null);
  assertEquals(firstStockedInConsumeFirstChain("lonely", 1, hops, onHand({ lonely: 5 })), null);
});

Deno.test("resolveMadeLinePull: stocked chain first, then a bought successor, else build", () => {
  const rows = [cfRow("old", "new")];
  const ctx = {
    redirect: buildSupersessionRedirectMap(rows, "2026-09-16"),
    consumeFirstHops: buildConsumeFirstHops(rows, "2026-09-16"),
    consumeFirstOnHand: new Map([["old", 0]]),
    boughtSuccessors: new Set<string>(),
  };
  assertEquals(resolveMadeLinePull("old", 1, ctx), null);
  assertEquals(
    resolveMadeLinePull("old", 1, { ...ctx, consumeFirstOnHand: new Map([["old", 2]]) }),
    { itemId: "old", factor: 1 }
  );
  assertEquals(
    resolveMadeLinePull("old", 1, { ...ctx, boughtSuccessors: new Set(["new"]) }),
    { itemId: "new", factor: 1 }
  );
  assertEquals(resolveMadeLinePull("other", 1, { ...ctx, boughtSuccessors: new Set(["new"]) }), null);
});

Deno.test("reserveConsumeFirstStock: a settled line draws its whole assemblies down for the next line", () => {
  const rules = buildConsumeFirstRules([cfRow("old", "new")], "2026-09-16");
  const onHand = new Map([["old", 6]]);
  const first = { itemId: "old", quantity: 4, estimatedQuantity: 4, scrapQuantity: 0, substitutedFromItemId: null };
  const second = { ...first };
  const s1 = settleConsumeFirstLine(first, rules, onHand);
  reserveConsumeFirstStock(first, s1, rules, onHand);
  assertEquals(s1, null);
  assertEquals(onHand.get("old"), 2);
  assertEquals(settleConsumeFirstLine(second, rules, onHand), { kind: "push", toItemId: "new", factor: 1 });
});

Deno.test("reserveConsumeFirstStock: a revert reserves in the predecessor's units and a push reserves nothing", () => {
  const rules = buildConsumeFirstRules([cfRow("old", "new", "Consume First", 2)], "2026-09-16");
  const onHand = new Map([["old", 3]]);
  const swapped = { itemId: "new", quantity: 2, estimatedQuantity: 8, scrapQuantity: 0, substitutedFromItemId: "old" };
  const s = settleConsumeFirstLine(swapped, rules, onHand);
  assertEquals(s, { kind: "revert", toItemId: "old", factor: 0.5 });
  reserveConsumeFirstStock(swapped, s, rules, onHand);
  assertEquals(onHand.get("old"), 0);
  const kept = { itemId: "old", quantity: 1, estimatedQuantity: 2, scrapQuantity: 0, substitutedFromItemId: null };
  const s3 = settleConsumeFirstLine(kept, rules, onHand);
  assertEquals(s3, { kind: "push", toItemId: "new", factor: 2 });
  reserveConsumeFirstStock(kept, s3, rules, onHand);
  assertEquals(onHand.get("old"), 0);
});
