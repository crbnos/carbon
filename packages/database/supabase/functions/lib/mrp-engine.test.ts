import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  computeLowLevelCodes,
  explodeBom,
  makeActualKey,
  makeKey,
  makeLocationItemKey,
  splitActualKey,
  splitKey,
  type BomChild,
} from "./mrp-engine.ts";

// Ids are caller-supplied TEXT: bulk imports mint UUIDs, so every id position
// must survive hyphens. The old "-"-joined keys truncated a UUID itemId to its
// first segment on parse, collapsing distinct (item, period) pairs into
// duplicate upsert rows (Postgres 21000) — MRP failed outright for those
// tenants.
const UUID_ITEM = "0107b4c3-a1ce-5c84-ae99-6d3c505f4a48";
const UUID_ITEM_2 = "0107b4c3-a1ce-9999-bb00-000000000000"; // same first segments
const UUID_LOCATION = "b81f0b70-9d05-4c1e-8339-000000000001";

Deno.test("makeKey/splitKey round-trip hyphenated ids in every position", () => {
  const key = makeKey(UUID_LOCATION, "period-1", UUID_ITEM);
  assertEquals(splitKey(key), [UUID_LOCATION, "period-1", UUID_ITEM]);
});

Deno.test("keys for distinct items never collide on shared id prefixes", () => {
  const a = makeKey(UUID_LOCATION, "p1", UUID_ITEM);
  const b = makeKey(UUID_LOCATION, "p1", UUID_ITEM_2);
  assert(a !== b);
});

Deno.test("makeActualKey/splitActualKey round-trip with source types containing spaces", () => {
  const key = makeActualKey(UUID_ITEM, UUID_LOCATION, "p1", "Sales Order");
  assertEquals(splitActualKey(key), [
    UUID_ITEM,
    UUID_LOCATION,
    "p1",
    "Sales Order",
  ]);
});

Deno.test("makeLocationItemKey is unambiguous for hyphenated pairs", () => {
  // "-"-joined keys could not distinguish (a-b, c) from (a, b-c).
  assert(
    makeLocationItemKey("a-b", "c") !== makeLocationItemKey("a", "b-c")
  );
});

Deno.test("explodeBom nets and explodes demand for UUID-id items", () => {
  const parent = UUID_ITEM;
  const child = UUID_LOCATION.replace("b81f", "c81f"); // another hyphenated id
  const location = UUID_LOCATION;
  const periods = [{ id: "p1" }, { id: "p2" }];

  const bomByItem = new Map<string, BomChild[]>([
    [parent, [{ itemId: child, quantity: 2, methodType: "Pull from Inventory" }]],
  ]);

  const { bomDerivedDemand } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p2", parent), 10]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      [parent, "Make"],
      [child, "Buy"],
    ]),
    leadTimeByItem: new Map([[child, 7]]),
    periods,
    onHandByLocationItem: new Map([[makeLocationItemKey(location, parent), 4]]),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map(),
  });

  // 10 demanded - 4 on hand = 6 to make; child qty 2 => 12, pulled one week
  // earlier by the 7-day lead time.
  const childKey = makeKey(location, "p1", child);
  assertEquals(bomDerivedDemand.get(childKey), 12);
  // The key parses back to the full hyphenated ids, not truncated segments.
  assertEquals(splitKey(childKey), [location, "p1", child]);
});

Deno.test("computeLowLevelCodes handles hyphenated ids and shared subassemblies", () => {
  const bomByItem = new Map<string, BomChild[]>([
    ["top", [
      { itemId: UUID_ITEM, quantity: 1, methodType: "Make to Order" },
      { itemId: "mid", quantity: 1, methodType: "Make to Order" },
    ]],
    ["mid", [{ itemId: UUID_ITEM, quantity: 1, methodType: "Pull from Inventory" }]],
  ]);
  const llc = computeLowLevelCodes(bomByItem);
  assertEquals(llc.get("top"), 0);
  assertEquals(llc.get("mid"), 1);
  // Deepest occurrence wins: UUID item appears at level 1 (under top) and
  // level 2 (under mid).
  assertEquals(llc.get(UUID_ITEM), 2);
});
