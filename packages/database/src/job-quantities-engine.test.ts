// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import {
  computeJobQuantities,
  flattenJobQuantityTree,
  type JobQuantityTreeNode
} from "./job-quantities-engine.ts";

const node = (
  id: string,
  data: Partial<JobQuantityTreeNode["data"]>,
  children: JobQuantityTreeNode[] = []
): JobQuantityTreeNode => ({
  id,
  data: {
    isRoot: false,
    itemId: `item-${id}`,
    quantity: 1,
    methodType: "Pull from Inventory",
    jobMaterialMakeMethodId: null,
    ...data
  },
  children
});

it("root uses parent quantity directly; children multiply by the parent's total", () => {
  // root (Make, qty 10) -> child (Pick, 2 per parent) -> grandchild (Buy, 3 per parent)
  const tree = node("root", { isRoot: true, methodType: "Make to Order" }, [
    node(
      "child",
      {
        quantity: 2,
        jobMaterialMakeMethodId: "mm-child",
        methodType: "Make to Order"
      },
      [node("grand", { quantity: 3 })]
    )
  ]);
  const { computed, cycleNodeIds } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map([
      ["child", 0],
      ["grand", 0]
    ]),
    replenishmentScrapByItemId: new Map()
  });

  expect(cycleNodeIds.size).toEqual(0);
  const byId = new Map(computed.map((c) => [c.id, c]));
  expect(byId.get("root")!.targetQuantity).toEqual(10);
  // child: parent's totalWithScrap (10) * 2
  expect(byId.get("child")!.targetQuantity).toEqual(20);
  // grandchild: child's totalWithScrap (20) * 3
  expect(byId.get("grand")!.targetQuantity).toEqual(60);
});

it("Make estimatedQuantity excludes scrap; Buy/Pick includes it", () => {
  // 10% scrap on 10 units -> whole-unit allowance of 1
  const tree = node("root", { isRoot: true, methodType: "Make to Order" }, [
    node("buy", { quantity: 1 })
  ]);
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map([["buy", 0.1]]),
    replenishmentScrapByItemId: new Map([["item-root", 0.1]])
  });
  const byId = new Map(computed.map((c) => [c.id, c]));
  // Make root: estimated = good quantity, total carries the scrap
  expect(byId.get("root")!.estimatedQuantity).toEqual(10);
  expect(byId.get("root")!.scrapQuantity).toEqual(1);
  expect(byId.get("root")!.totalWithScrap).toEqual(11);
  // Buy child (target 11 * 1, 10% scrap -> +2 whole units): estimated includes scrap
  expect(byId.get("buy")!.targetQuantity).toEqual(11);
  expect(byId.get("buy")!.estimatedQuantity).toEqual(
    byId.get("buy")!.totalWithScrap
  );
});

it("a stored 0 scrap is respected; only NULL falls back to replenishment", () => {
  const tree = node("root", { isRoot: true }, [
    node("stored-zero", {}),
    node("null-fallback", {})
  ]);
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map<string, number | null>([
      ["stored-zero", 0],
      ["null-fallback", null]
    ]),
    replenishmentScrapByItemId: new Map([
      ["item-stored-zero", 0.5],
      ["item-null-fallback", 0.5]
    ])
  });
  const byId = new Map(computed.map((c) => [c.id, c]));
  expect(byId.get("stored-zero")!.scrapQuantity).toEqual(0);
  expect(byId.get("null-fallback")!.scrapQuantity > 0).toBeTruthy();
});

it("root has no jobMaterial row: hasJobMaterial false, fallback scrap", () => {
  const tree = node("root", { isRoot: true });
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 4,
    storedScrapById: new Map(),
    replenishmentScrapByItemId: new Map([["item-root", 0.25]])
  });
  expect(computed[0]!.hasJobMaterial).toEqual(false);
  expect(computed[0]!.scrapQuantity).toEqual(1); // scrapAllowance(4, 0.25)
});

it("a recalculated sub-assembly does not report its own quantity per parent", () => {
  // The sub-assembly's parent needs 2 of it. Recalculated alone, it is the
  // tree's root, whose row carries a placeholder quantity of 1.
  const tree = node(
    "sub",
    {
      isRoot: true,
      quantity: 1,
      methodType: "Make to Order",
      jobMaterialMakeMethodId: "mm-sub"
    },
    [
      node("child", {
        quantity: 3,
        methodType: "Make to Order",
        jobMaterialMakeMethodId: "mm-child"
      })
    ]
  );
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map([["child", 0]]),
    replenishmentScrapByItemId: new Map()
  });

  const byId = new Map(computed.map((c) => [c.id, c]));
  expect(byId.get("sub")!.quantityPerParent).toBeNull();
  expect(byId.get("sub")!.targetQuantity).toEqual(10);
  expect(byId.get("child")!.quantityPerParent).toEqual(3);
});

it("a cyclic tree is reported and skipped, not recursed forever", () => {
  const a = node("a", { isRoot: true });
  const b = node("b", { quantity: 2 });
  a.children = [b];
  b.children = [a]; // corrupt data: a -> b -> a

  const flat = flattenJobQuantityTree(a);
  expect(flat.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  expect([...flat.cycleNodeIds]).toEqual(["a"]);

  const { computed, cycleNodeIds } = computeJobQuantities({
    tree: a,
    parentEstimatedQuantity: 1,
    storedScrapById: new Map([["b", 0]]),
    replenishmentScrapByItemId: new Map()
  });
  expect(computed.length).toEqual(2); // each node computed exactly once
  expect([...cycleNodeIds]).toEqual(["a"]);
});

it("a shared (diamond) subtree is computed once per path, matching the historical recursion", () => {
  // Two parents referencing the same child object is not a cycle — the
  // per-node recursion visited it once per path, and so does the engine.
  const shared = node("shared", { quantity: 1 });
  const tree = node("root", { isRoot: true }, [
    node("p1", { quantity: 1 }, [shared]),
    node("p2", { quantity: 1 }, [shared])
  ]);
  const { computed, cycleNodeIds } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 1,
    storedScrapById: new Map([
      ["p1", 0],
      ["p2", 0],
      ["shared", 0]
    ]),
    replenishmentScrapByItemId: new Map()
  });
  expect(cycleNodeIds.size).toEqual(0);
  expect(computed.filter((c) => c.id === "shared").length).toEqual(2);
});
