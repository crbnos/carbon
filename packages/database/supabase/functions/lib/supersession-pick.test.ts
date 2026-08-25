import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  buildSupersessionRedirectMap,
  type SupersessionRow,
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

// Stock Only keeps its successor as a reserve-governed reference and No Stock
// has no successor to move demand to — neither redirects. Seeding a test with
// one of these modes is the easiest way to "prove" a swap works when nothing
// swapped at all.
Deno.test("does not redirect for Stock Only or No Stock", () => {
  for (const supersessionMode of ["Stock Only", "No Stock"]) {
    const map = buildSupersessionRedirectMap([row({ supersessionMode })], ASOF);
    assertEquals(map.size, 0, supersessionMode);
  }
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
