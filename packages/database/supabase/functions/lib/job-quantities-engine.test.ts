import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  computeJobQuantities,
  flattenJobQuantityTree,
  type JobQuantityTreeNode,
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
    ...data,
  },
  children,
});

Deno.test("root uses parent quantity directly; children multiply by the parent's total", () => {
  // root (Make, qty 10) -> child (Pick, 2 per parent) -> grandchild (Buy, 3 per parent)
  const tree = node(
    "root",
    { isRoot: true, methodType: "Make to Order" },
    [
      node("child", { quantity: 2, jobMaterialMakeMethodId: "mm-child", methodType: "Make to Order" }, [
        node("grand", { quantity: 3 }),
      ]),
    ]
  );
  const { computed, cycleNodeIds } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map([
      ["child", 0],
      ["grand", 0],
    ]),
    replenishmentScrapByItemId: new Map(),
  });

  assertEquals(cycleNodeIds.size, 0);
  const byId = new Map(computed.map((c) => [c.id, c]));
  assertEquals(byId.get("root")!.targetQuantity, 10);
  // child: parent's totalWithScrap (10) * 2
  assertEquals(byId.get("child")!.targetQuantity, 20);
  // grandchild: child's totalWithScrap (20) * 3
  assertEquals(byId.get("grand")!.targetQuantity, 60);
});

Deno.test("Make estimatedQuantity excludes scrap; Buy/Pick includes it", () => {
  // 10% scrap on 10 units -> whole-unit allowance of 1
  const tree = node("root", { isRoot: true, methodType: "Make to Order" }, [
    node("buy", { quantity: 1 }),
  ]);
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map([["buy", 0.1]]),
    replenishmentScrapByItemId: new Map([["item-root", 0.1]]),
  });
  const byId = new Map(computed.map((c) => [c.id, c]));
  // Make root: estimated = good quantity, total carries the scrap
  assertEquals(byId.get("root")!.estimatedQuantity, 10);
  assertEquals(byId.get("root")!.scrapQuantity, 1);
  assertEquals(byId.get("root")!.totalWithScrap, 11);
  // Buy child (target 11 * 1, 10% scrap -> +2 whole units): estimated includes scrap
  assertEquals(byId.get("buy")!.targetQuantity, 11);
  assertEquals(
    byId.get("buy")!.estimatedQuantity,
    byId.get("buy")!.totalWithScrap
  );
});

Deno.test("a stored 0 scrap is respected; only NULL falls back to replenishment", () => {
  const tree = node("root", { isRoot: true }, [
    node("stored-zero", {}),
    node("null-fallback", {}),
  ]);
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 10,
    storedScrapById: new Map<string, number | null>([
      ["stored-zero", 0],
      ["null-fallback", null],
    ]),
    replenishmentScrapByItemId: new Map([
      ["item-stored-zero", 0.5],
      ["item-null-fallback", 0.5],
    ]),
  });
  const byId = new Map(computed.map((c) => [c.id, c]));
  assertEquals(byId.get("stored-zero")!.scrapQuantity, 0);
  assert(byId.get("null-fallback")!.scrapQuantity > 0);
});

Deno.test("root has no jobMaterial row: hasJobMaterial false, fallback scrap", () => {
  const tree = node("root", { isRoot: true });
  const { computed } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 4,
    storedScrapById: new Map(),
    replenishmentScrapByItemId: new Map([["item-root", 0.25]]),
  });
  assertEquals(computed[0]!.hasJobMaterial, false);
  assertEquals(computed[0]!.scrapQuantity, 1); // scrapAllowance(4, 0.25)
});

Deno.test("a cyclic tree is reported and skipped, not recursed forever", () => {
  const a = node("a", { isRoot: true });
  const b = node("b", { quantity: 2 });
  a.children = [b];
  b.children = [a]; // corrupt data: a -> b -> a

  const flat = flattenJobQuantityTree(a);
  assertEquals(flat.nodes.map((n) => n.id), ["a", "b"]);
  assertEquals([...flat.cycleNodeIds], ["a"]);

  const { computed, cycleNodeIds } = computeJobQuantities({
    tree: a,
    parentEstimatedQuantity: 1,
    storedScrapById: new Map([["b", 0]]),
    replenishmentScrapByItemId: new Map(),
  });
  assertEquals(computed.length, 2); // each node computed exactly once
  assertEquals([...cycleNodeIds], ["a"]);
});

Deno.test("a shared (diamond) subtree is computed once per path, matching the historical recursion", () => {
  // Two parents referencing the same child object is not a cycle — the
  // per-node recursion visited it once per path, and so does the engine.
  const shared = node("shared", { quantity: 1 });
  const tree = node("root", { isRoot: true }, [
    node("p1", { quantity: 1 }, [shared]),
    node("p2", { quantity: 1 }, [shared]),
  ]);
  const { computed, cycleNodeIds } = computeJobQuantities({
    tree,
    parentEstimatedQuantity: 1,
    storedScrapById: new Map([
      ["p1", 0],
      ["p2", 0],
      ["shared", 0],
    ]),
    replenishmentScrapByItemId: new Map(),
  });
  assertEquals(cycleNodeIds.size, 0);
  assertEquals(computed.filter((c) => c.id === "shared").length, 2);
});
