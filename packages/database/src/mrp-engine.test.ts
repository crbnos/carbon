// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  type BomChild,
  computeLowLevelCodes,
  explodeBom,
  makeActualKey,
  makeKey,
  makeLocationItemKey,
  netConsumeFirstContributors,
  splitActualKey,
  splitKey
} from "./mrp-engine.ts";

// Ids are caller-supplied TEXT: bulk imports mint UUIDs, so every id position
// must survive hyphens. The old "-"-joined keys truncated a UUID itemId to its
// first segment on parse, collapsing distinct (item, period) pairs into
// duplicate upsert rows (Postgres 21000) — MRP failed outright for those
// tenants.
const UUID_ITEM = "0107b4c3-a1ce-5c84-ae99-6d3c505f4a48";
const UUID_ITEM_2 = "0107b4c3-a1ce-9999-bb00-000000000000"; // same first segments
const UUID_LOCATION = "b81f0b70-9d05-4c1e-8339-000000000001";

it("makeKey/splitKey round-trip hyphenated ids in every position", () => {
  const key = makeKey(UUID_LOCATION, "period-1", UUID_ITEM);
  expect(splitKey(key)).toEqual([UUID_LOCATION, "period-1", UUID_ITEM]);
});

it("keys for distinct items never collide on shared id prefixes", () => {
  const a = makeKey(UUID_LOCATION, "p1", UUID_ITEM);
  const b = makeKey(UUID_LOCATION, "p1", UUID_ITEM_2);
  expect(a !== b).toBeTruthy();
});

it("makeActualKey/splitActualKey round-trip with source types containing spaces", () => {
  const key = makeActualKey(UUID_ITEM, UUID_LOCATION, "p1", "Sales Order");
  expect(splitActualKey(key)).toEqual([
    UUID_ITEM,
    UUID_LOCATION,
    "p1",
    "Sales Order"
  ]);
});

it("makeLocationItemKey is unambiguous for hyphenated pairs", () => {
  // "-"-joined keys could not distinguish (a-b, c) from (a, b-c).
  expect(
    makeLocationItemKey("a-b", "c") !== makeLocationItemKey("a", "b-c")
  ).toBeTruthy();
});

it("explodeBom nets and explodes demand for UUID-id items", () => {
  const parent = UUID_ITEM;
  const child = UUID_LOCATION.replace("b81f", "c81f"); // another hyphenated id
  const location = UUID_LOCATION;
  const periods = [{ id: "p1" }, { id: "p2" }];

  const bomByItem = new Map<string, BomChild[]>([
    [
      parent,
      [{ itemId: child, quantity: 2, methodType: "Pull from Inventory" }]
    ]
  ]);

  const { bomDerivedDemand } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p2", parent), 10]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      [parent, "Make"],
      [child, "Buy"]
    ]),
    leadTimeByItem: new Map([[child, 7]]),
    periods,
    onHandByLocationItem: new Map([[makeLocationItemKey(location, parent), 4]]),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map()
  });

  // 10 demanded - 4 on hand = 6 to make; child qty 2 => 12, pulled one week
  // earlier by the 7-day lead time.
  const childKey = makeKey(location, "p1", child);
  expect(bomDerivedDemand.get(childKey)).toEqual(12);
  // The key parses back to the full hyphenated ids, not truncated segments.
  expect(splitKey(childKey)).toEqual([location, "p1", child]);
});

it("computeLowLevelCodes handles hyphenated ids and shared subassemblies", () => {
  const bomByItem = new Map<string, BomChild[]>([
    [
      "top",
      [
        { itemId: UUID_ITEM, quantity: 1, methodType: "Make to Order" },
        { itemId: "mid", quantity: 1, methodType: "Make to Order" }
      ]
    ],
    [
      "mid",
      [{ itemId: UUID_ITEM, quantity: 1, methodType: "Pull from Inventory" }]
    ]
  ]);
  const { llc, cycleItemIds } = computeLowLevelCodes(bomByItem);
  expect(llc.get("top")).toEqual(0);
  expect(llc.get("mid")).toEqual(1);
  // Deepest occurrence wins: UUID item appears at level 1 (under top) and
  // level 2 (under mid).
  expect(llc.get(UUID_ITEM)).toEqual(2);
  expect(cycleItemIds.size).toEqual(0);
});

it("computeLowLevelCodes reports cycles instead of silently truncating", () => {
  // Real production shape (tenant "Farm it"): seeds -> flower -> bouquet -> seeds.
  const bomByItem = new Map<string, BomChild[]>([
    ["seeds", [{ itemId: "flower", quantity: 1, methodType: "Make to Order" }]],
    [
      "flower",
      [{ itemId: "bouquet", quantity: 1, methodType: "Make to Order" }]
    ],
    [
      "bouquet",
      [{ itemId: "seeds", quantity: 1, methodType: "Make to Order" }]
    ],
    // an untangled item alongside the cycle still levels normally
    [
      "clean",
      [{ itemId: "leaf", quantity: 1, methodType: "Pull from Inventory" }]
    ]
  ]);
  const { llc, cycleItemIds } = computeLowLevelCodes(bomByItem);
  expect([...cycleItemIds].sort()).toEqual(["bouquet", "flower", "seeds"]);
  expect(llc.get("clean")).toEqual(0);
  expect(llc.get("leaf")).toEqual(1);
});

it("explodeBom plans around a cycle instead of hanging or failing", () => {
  const location = "loc-1";
  const bomByItem = new Map<string, BomChild[]>([
    ["seeds", [{ itemId: "flower", quantity: 1, methodType: "Make to Order" }]],
    ["flower", [{ itemId: "seeds", quantity: 2, methodType: "Make to Order" }]]
  ]);

  const { bomDerivedDemand, cycleItemIds } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p1", "flower"), 5]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      ["seeds", "Make"],
      ["flower", "Make"]
    ]),
    leadTimeByItem: new Map(),
    periods: [{ id: "p1" }],
    onHandByLocationItem: new Map(),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map()
  });

  expect([...cycleItemIds].sort()).toEqual(["flower", "seeds"]);
  // Cycle members are treated as leaves: no demand explodes through them.
  expect(bomDerivedDemand.size).toEqual(0);
});

it("explodeBom does not mutate the caller's bomByItem", () => {
  const bomByItem = new Map<string, BomChild[]>([
    ["a", [{ itemId: "b", quantity: 1, methodType: "Make to Order" }]],
    ["b", [{ itemId: "a", quantity: 1, methodType: "Make to Order" }]]
  ]);
  const sizeBefore = bomByItem.size;

  explodeBom({
    grossDemand: new Map([[makeKey("loc", "p1", "a"), 1]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      ["a", "Make"],
      ["b", "Make"]
    ]),
    leadTimeByItem: new Map(),
    periods: [{ id: "p1" }],
    onHandByLocationItem: new Map(),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map()
  });

  expect(bomByItem.size).toEqual(sizeBefore);
  expect(bomByItem.has("a") && bomByItem.has("b")).toBeTruthy();
});

it("a clean parent still explodes onto a cycle item, but nothing explodes onward", () => {
  const loc = "loc";
  // clean -> cyc1; cyc1 <-> cyc2 form a cycle. The corrupt loop must not cost
  // the clean part of the graph its planning.
  const bomByItem = new Map<string, BomChild[]>([
    [
      "clean",
      [{ itemId: "cyc1", quantity: 1, methodType: "Pull from Inventory" }]
    ],
    ["cyc1", [{ itemId: "cyc2", quantity: 1, methodType: "Make to Order" }]],
    ["cyc2", [{ itemId: "cyc1", quantity: 1, methodType: "Make to Order" }]]
  ]);

  const { bomDerivedDemand, cycleItemIds } = explodeBom({
    grossDemand: new Map([[makeKey(loc, "p1", "clean"), 10]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      ["clean", "Make"],
      ["cyc1", "Make"],
      ["cyc2", "Make"]
    ]),
    leadTimeByItem: new Map(),
    periods: [{ id: "p1" }],
    onHandByLocationItem: new Map(),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map()
  });

  expect(cycleItemIds.has("cyc1") && cycleItemIds.has("cyc2")).toBeTruthy();
  // The clean parent plans normally: its demand reaches cyc1.
  expect(bomDerivedDemand.get(makeKey(loc, "p1", "cyc1"))).toEqual(10);
  // cyc1 is a leaf, so no phantom demand is manufactured around the loop.
  expect(bomDerivedDemand.get(makeKey(loc, "p1", "cyc2"))).toEqual(undefined);
});

it("Consume First made predecessor: stock covers first, only the successor's BOM explodes for the shortfall", () => {
  const top = "top",
    oldPart = "old-bracket",
    newPart = "new-bracket";
  const plateA = "plate-a",
    plateB = "plate-b";
  const location = "loc";
  const periods = [{ id: "p1" }];
  const noLead = new Map([
    [oldPart, 0],
    [newPart, 0],
    [plateA, 0],
    [plateB, 0]
  ]);

  const bomByItem = new Map<string, BomChild[]>([
    [
      top,
      [{ itemId: oldPart, quantity: 1, methodType: "Pull from Inventory" }]
    ],
    [
      oldPart,
      [{ itemId: plateA, quantity: 1, methodType: "Purchase to Order" }]
    ],
    [
      newPart,
      [{ itemId: plateB, quantity: 1, methodType: "Purchase to Order" }]
    ]
  ]);

  const { bomDerivedDemand, demandContributors } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p1", top), 10]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      [top, "Make"],
      [oldPart, "Make"],
      [newPart, "Make"],
      [plateA, "Buy"],
      [plateB, "Buy"]
    ]),
    leadTimeByItem: noLead,
    periods,
    onHandByLocationItem: new Map([
      [makeLocationItemKey(location, oldPart), 3]
    ]),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map([
      [
        makeKey(location, "p1", top),
        [
          {
            sourceType: "Sales Order" as const,
            salesOrderLineId: "so-1",
            parentItemId: top,
            quantity: 10
          }
        ]
      ]
    ]),
    consumeFirstRedirect: new Map([[oldPart, { to: newPart, factor: 1 }]])
  });

  expect(bomDerivedDemand.get(makeKey(location, "p1", oldPart))).toEqual(3);
  expect(bomDerivedDemand.get(makeKey(location, "p1", newPart))).toEqual(7);
  expect(bomDerivedDemand.get(makeKey(location, "p1", plateB))).toEqual(7);
  expect(bomDerivedDemand.get(makeKey(location, "p1", plateA))).toEqual(
    undefined
  );
  const moved = demandContributors.get(makeKey(location, "p1", newPart)) ?? [];
  expect(moved.length).toEqual(1);
  expect(moved[0]!.quantity).toEqual(7);
  expect(moved[0]!.redirectedFromItemId).toEqual(oldPart);
  const plateBContributors =
    demandContributors.get(makeKey(location, "p1", plateB)) ?? [];
  expect(plateBContributors[0]!.redirectedFromItemId).toEqual(oldPart);
});

it("Consume First nets in whole assemblies per contributor and converts the shortfall by the factor", () => {
  const top = "top",
    oldPart = "old",
    newPart = "new";
  const location = "loc";
  const periods = [{ id: "p1" }];

  const bomByItem = new Map<string, BomChild[]>([
    [top, [{ itemId: oldPart, quantity: 2, methodType: "Pull from Inventory" }]]
  ]);

  const { bomDerivedDemand, demandContributors } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p1", top), 5]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      [top, "Make"],
      [oldPart, "Buy"],
      [newPart, "Buy"]
    ]),
    leadTimeByItem: new Map([[oldPart, 0]]),
    periods,
    onHandByLocationItem: new Map([
      [makeLocationItemKey(location, oldPart), 3]
    ]),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map([
      [
        makeKey(location, "p1", top),
        [
          {
            sourceType: "Job Material" as const,
            jobId: "job-1",
            parentItemId: top,
            quantity: 5
          }
        ]
      ]
    ]),
    consumeFirstRedirect: new Map([[oldPart, { to: newPart, factor: 2 }]])
  });

  expect(bomDerivedDemand.get(makeKey(location, "p1", oldPart))).toEqual(2);
  expect(bomDerivedDemand.get(makeKey(location, "p1", newPart))).toEqual(16);
  const kept = demandContributors.get(makeKey(location, "p1", oldPart)) ?? [];
  expect(kept.map((c) => c.quantity)).toEqual([2]);
  const moved = demandContributors.get(makeKey(location, "p1", newPart)) ?? [];
  expect(moved.map((c) => c.quantity)).toEqual([16]);
});

it("a Consume First successor that sits shallower in another BOM still receives the redirected demand", () => {
  const top = "top",
    sub = "sub",
    other = "other";
  const oldPart = "old",
    newPart = "new",
    plateB = "plate-b";
  const location = "loc";
  const periods = [{ id: "p1" }];

  const bomByItem = new Map<string, BomChild[]>([
    [top, [{ itemId: sub, quantity: 1, methodType: "Make to Order" }]],
    [
      sub,
      [{ itemId: oldPart, quantity: 1, methodType: "Pull from Inventory" }]
    ],
    [
      other,
      [{ itemId: newPart, quantity: 1, methodType: "Pull from Inventory" }]
    ],
    [
      newPart,
      [{ itemId: plateB, quantity: 1, methodType: "Purchase to Order" }]
    ]
  ]);

  const { bomDerivedDemand } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p1", top), 4]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      [top, "Make"],
      [sub, "Make"],
      [other, "Make"],
      [oldPart, "Make"],
      [newPart, "Make"],
      [plateB, "Buy"]
    ]),
    leadTimeByItem: new Map([
      [sub, 0],
      [oldPart, 0],
      [newPart, 0],
      [plateB, 0]
    ]),
    periods,
    onHandByLocationItem: new Map(),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map(),
    consumeFirstRedirect: new Map([[oldPart, { to: newPart, factor: 1 }]])
  });

  expect(bomDerivedDemand.get(makeKey(location, "p1", oldPart))).toEqual(
    undefined
  );
  expect(bomDerivedDemand.get(makeKey(location, "p1", newPart))).toEqual(4);
  expect(bomDerivedDemand.get(makeKey(location, "p1", plateB))).toEqual(4);
});

it("Consume First: a bought successor of inline made demand is planned as forecast", () => {
  const top = "top",
    oldPart = "old",
    newPart = "new";
  const location = "loc";
  const periods = [{ id: "p1" }];

  const bomByItem = new Map<string, BomChild[]>([
    [top, [{ itemId: oldPart, quantity: 1, methodType: "Make to Order" }]]
  ]);

  const { bomDerivedDemand } = explodeBom({
    grossDemand: new Map([[makeKey(location, "p1", top), 6]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      [top, "Make"],
      [oldPart, "Make"],
      [newPart, "Buy"]
    ]),
    leadTimeByItem: new Map([[oldPart, 0]]),
    periods,
    onHandByLocationItem: new Map([
      [makeLocationItemKey(location, oldPart), 2]
    ]),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map(),
    consumeFirstRedirect: new Map([[oldPart, { to: newPart, factor: 1 }]])
  });

  expect(bomDerivedDemand.get(makeKey(location, "p1", oldPart))).toEqual(
    undefined
  );
  expect(bomDerivedDemand.get(makeKey(location, "p1", newPart))).toEqual(4);
});

function trialBom() {
  return new Map<string, BomChild[]>([
    [
      "top",
      [{ itemId: "old", quantity: 1, methodType: "Pull from Inventory" }]
    ],
    [
      "old",
      [{ itemId: "plate-a", quantity: 1, methodType: "Purchase to Order" }]
    ],
    [
      "new",
      [{ itemId: "plate-b", quantity: 1, methodType: "Purchase to Order" }]
    ]
  ]);
}
const trialReplenishment = () =>
  new Map<string, "Make" | "Buy">([
    ["top", "Make"],
    ["old", "Make"],
    ["new", "Make"],
    ["plate-a", "Buy"],
    ["plate-b", "Buy"]
  ]);
const noLead = () =>
  new Map([
    ["old", 0],
    ["new", 0],
    ["plate-a", 0],
    ["plate-b", 0],
    ["sub", 0]
  ]);

function runTrial(args: {
  demand: number;
  oldOnHand?: number;
  oldSupply?: number;
  bomByItem?: Map<string, BomChild[]>;
  replenishment?: Map<string, "Make" | "Buy">;
}) {
  const location = "loc";
  const key = (item: string) => makeKey(location, "p1", item);
  const out = explodeBom({
    grossDemand: new Map([[key("top"), args.demand]]),
    bomByItem: args.bomByItem ?? trialBom(),
    replenishmentSystemByItem: args.replenishment ?? trialReplenishment(),
    leadTimeByItem: noLead(),
    periods: [{ id: "p1" }],
    onHandByLocationItem: new Map([
      [makeLocationItemKey(location, "old"), args.oldOnHand ?? 0]
    ]),
    jobSupplyByLocationPeriodItem: new Map(
      args.oldSupply ? [[key("old"), args.oldSupply]] : []
    ),
    topLevelContributors: new Map([
      [
        key("top"),
        [
          {
            sourceType: "Sales Order" as const,
            salesOrderLineId: "so-1",
            parentItemId: "top",
            quantity: args.demand
          }
        ]
      ]
    ]),
    consumeFirstRedirect: new Map([["old", { to: "new", factor: 1 }]])
  });
  const q = (item: string) => out.bomDerivedDemand.get(key(item));
  return { q };
}

it("case 6: no old stock — everything is built as NEW", () => {
  const { q } = runTrial({ demand: 10, oldOnHand: 0 });
  expect(q("old")).toEqual(undefined);
  expect(q("new")).toEqual(10);
  expect(q("plate-b")).toEqual(10);
  expect(q("plate-a")).toEqual(undefined);
});

it("case 7: old stock covers everything — nothing moves to NEW", () => {
  const { q } = runTrial({ demand: 10, oldOnHand: 12 });
  expect(q("old")).toEqual(10);
  expect(q("new")).toEqual(undefined);
  expect(q("plate-b")).toEqual(undefined);
  expect(q("plate-a")).toEqual(undefined);
});

it("case 16: an open job producing OLD counts as available before redirecting", () => {
  const { q } = runTrial({ demand: 10, oldOnHand: 0, oldSupply: 4 });
  expect(q("old")).toEqual(4);
  expect(q("new")).toEqual(6);
  expect(q("plate-b")).toEqual(6);
});

it("case 11: bought predecessor and successor net the same way and never explode", () => {
  const replenishment = trialReplenishment();
  replenishment.set("old", "Buy");
  replenishment.set("new", "Buy");
  const { q } = runTrial({ demand: 10, oldOnHand: 3, replenishment });
  expect(q("old")).toEqual(3);
  expect(q("new")).toEqual(7);
  expect(q("plate-a")).toEqual(undefined);
  expect(q("plate-b")).toEqual(undefined);
});

it("nested: a Consume First sub-sub-assembly nets its stock two levels down", () => {
  const bomByItem = new Map<string, BomChild[]>([
    ["top", [{ itemId: "sub", quantity: 1, methodType: "Make to Order" }]],
    [
      "sub",
      [{ itemId: "old", quantity: 2, methodType: "Pull from Inventory" }]
    ],
    [
      "old",
      [{ itemId: "plate-a", quantity: 1, methodType: "Purchase to Order" }]
    ],
    [
      "new",
      [{ itemId: "plate-b", quantity: 1, methodType: "Purchase to Order" }]
    ]
  ]);
  const replenishment = trialReplenishment();
  replenishment.set("sub", "Make");
  const { q } = runTrial({ demand: 4, oldOnHand: 5, bomByItem, replenishment });
  expect(q("old")).toEqual(4);
  expect(q("new")).toEqual(4);
  expect(q("plate-b")).toEqual(4);
  expect(q("plate-a")).toEqual(undefined);
});

it("fix 3: the successor's shortfall is pulled earlier by its own longer lead time, never later", () => {
  const location = "loc";
  const key = (item: string, p: string) => makeKey(location, p, item);
  const run = (leads: Record<string, number>) =>
    explodeBom({
      grossDemand: new Map([[key("top", "p3"), 4]]),
      bomByItem: trialBom(),
      replenishmentSystemByItem: trialReplenishment(),
      leadTimeByItem: new Map(
        Object.entries({ "plate-a": 0, "plate-b": 0, ...leads })
      ),
      periods: [{ id: "p0" }, { id: "p1" }, { id: "p2" }, { id: "p3" }],
      onHandByLocationItem: new Map(),
      jobSupplyByLocationPeriodItem: new Map(),
      topLevelContributors: new Map(),
      consumeFirstRedirect: new Map([["old", { to: "new", factor: 1 }]])
    }).bomDerivedDemand;

  const slower = run({ old: 7, new: 14 });
  expect(slower.get(key("new", "p1"))).toEqual(4);
  expect(slower.get(key("new", "p2"))).toEqual(undefined);

  const faster = run({ old: 14, new: 7 });
  expect(faster.get(key("new", "p1"))).toEqual(4);
  expect(faster.get(key("new", "p2"))).toEqual(undefined);
});

it("fix 2: a Consume First chain uses the middle part's stock before moving on", () => {
  const location = "loc";
  const key = (item: string) => makeKey(location, "p1", item);
  const bomByItem = new Map<string, BomChild[]>([
    [
      "top",
      [{ itemId: "old", quantity: 1, methodType: "Pull from Inventory" }]
    ],
    [
      "old",
      [{ itemId: "plate-a", quantity: 1, methodType: "Purchase to Order" }]
    ],
    [
      "mid",
      [{ itemId: "plate-m", quantity: 1, methodType: "Purchase to Order" }]
    ],
    [
      "new",
      [{ itemId: "plate-b", quantity: 1, methodType: "Purchase to Order" }]
    ]
  ]);
  const { bomDerivedDemand } = explodeBom({
    grossDemand: new Map([[key("top"), 10]]),
    bomByItem,
    replenishmentSystemByItem: new Map([
      ["top", "Make"],
      ["old", "Make"],
      ["mid", "Make"],
      ["new", "Make"],
      ["plate-a", "Buy"],
      ["plate-m", "Buy"],
      ["plate-b", "Buy"]
    ]),
    leadTimeByItem: new Map([
      ["old", 0],
      ["mid", 0],
      ["new", 0],
      ["plate-a", 0],
      ["plate-m", 0],
      ["plate-b", 0]
    ]),
    periods: [{ id: "p1" }],
    onHandByLocationItem: new Map([
      [makeLocationItemKey(location, "old"), 2],
      [makeLocationItemKey(location, "mid"), 3]
    ]),
    jobSupplyByLocationPeriodItem: new Map(),
    topLevelContributors: new Map(),
    consumeFirstRedirect: new Map([
      ["old", { to: "mid", factor: 1 }],
      ["mid", { to: "new", factor: 1 }]
    ])
  });
  expect(bomDerivedDemand.get(key("old"))).toEqual(2);
  expect(bomDerivedDemand.get(key("mid"))).toEqual(3);
  expect(bomDerivedDemand.get(key("new"))).toEqual(5);
  expect(bomDerivedDemand.get(key("plate-b"))).toEqual(5);
  expect(bomDerivedDemand.get(key("plate-m"))).toEqual(undefined);
  expect(bomDerivedDemand.get(key("plate-a"))).toEqual(undefined);
});

it("netConsumeFirstContributors nets each job line in whole assemblies and the rest by the unit", () => {
  const job = (
    jobId: string,
    quantity: number,
    perAssemblyQuantity?: number
  ) => ({
    sourceType: "Job Material" as const,
    jobId,
    parentItemId: "asm",
    quantity,
    perAssemblyQuantity
  });
  const out = netConsumeFirstContributors({
    itemId: "old",
    contributors: [job("j1", 4, 2), job("j2", 3)],
    grossQty: 7,
    running: 3,
    factor: 1,
    perAssemblyOf: (c) => c.perAssemblyQuantity ?? 0
  });
  expect(out.consumed).toEqual(3);
  expect(out.running).toEqual(0);
  expect(out.kept.map((c) => c.quantity)).toEqual([2, 1]);
  expect(out.moved.map((c) => [c.quantity, c.redirectedFromItemId])).toEqual([
    [2, "old"],
    [2, "old"]
  ]);
});

it("netConsumeFirstContributors nets demand no contributor accounts for by the unit, after the lines", () => {
  const out = netConsumeFirstContributors({
    itemId: "old",
    contributors: [
      {
        sourceType: "Sales Order",
        salesOrderLineId: "s1",
        parentItemId: "asm",
        quantity: 2,
        perAssemblyQuantity: 2
      }
    ],
    grossQty: 5,
    running: 3,
    factor: 2,
    perAssemblyOf: (c) => c.perAssemblyQuantity ?? 0
  });
  expect(out.consumed).toEqual(3);
  expect(out.kept.map((c) => c.quantity)).toEqual([2]);
  expect(out.moved).toEqual([]);
  expect(out.running).toEqual(0);
});

it("netConsumeFirstContributors keeps the origin and converts the per-assembly quantity when moving", () => {
  const out = netConsumeFirstContributors({
    itemId: "mid",
    contributors: [
      {
        sourceType: "Job Material",
        jobId: "j1",
        parentItemId: "asm",
        quantity: 4,
        perAssemblyQuantity: 2,
        redirectedFromItemId: "old"
      }
    ],
    grossQty: 4,
    running: 0,
    factor: 3,
    perAssemblyOf: (c) => c.perAssemblyQuantity ?? 0
  });
  expect(out.moved).toEqual([
    {
      sourceType: "Job Material",
      jobId: "j1",
      parentItemId: "asm",
      quantity: 12,
      perAssemblyQuantity: 6,
      redirectedFromItemId: "old"
    }
  ]);
});
