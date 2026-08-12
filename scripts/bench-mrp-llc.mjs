// Measures MRP's low-level-code computation against REAL BOM data.
//
// computeLowLevelCodes (packages/database/supabase/functions/lib/mrp-engine.ts)
// walks every root-to-node PATH rather than every node, copying the `visited`
// Set at each child. On a BOM where subassemblies are shared (the normal case --
// common hardware, fasteners, reused subassemblies) the number of paths grows
// multiplicatively with that sharing, while the graph itself stays small.
//
// This compares it against the textbook equivalent -- longest path in a DAG via
// Kahn's topological order, O(nodes + edges) -- and asserts the two agree.
//
// Usage: node scripts/bench-mrp-llc.mjs <bom.json>
//   where bom.json is {companyId: {itemId: [{itemId, quantity, methodType}]}}

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// CURRENT implementation, copied verbatim from mrp-engine.ts
// ---------------------------------------------------------------------------
function computeLowLevelCodes(bomByItem) {
  const llc = new Map();

  function assignLevel(itemId, level, visited) {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const currentLLC = llc.get(itemId) ?? -1;
    if (level > currentLLC) {
      llc.set(itemId, level);
    }

    const children = bomByItem.get(itemId) ?? [];
    for (const child of children) {
      assignLevel(child.itemId, level + 1, new Set(visited));
    }
  }

  for (const itemId of bomByItem.keys()) {
    assignLevel(itemId, 0, new Set());
  }

  return llc;
}

// ---------------------------------------------------------------------------
// PROPOSED: longest path in a DAG (Kahn). Each edge is relaxed exactly once.
// Cycle-safe: nodes still holding in-degree at the end are reported rather than
// silently truncated (the current version hides them behind `visited`).
// ---------------------------------------------------------------------------
function computeLowLevelCodesKahn(bomByItem) {
  const indegree = new Map();
  const nodes = new Set();

  for (const [parent, children] of bomByItem) {
    nodes.add(parent);
    if (!indegree.has(parent)) indegree.set(parent, 0);
    for (const child of children) {
      nodes.add(child.itemId);
      indegree.set(child.itemId, (indegree.get(child.itemId) ?? 0) + 1);
    }
  }

  const llc = new Map();
  const queue = [];
  for (const n of nodes) {
    if ((indegree.get(n) ?? 0) === 0) {
      llc.set(n, 0);
      queue.push(n);
    }
  }

  let head = 0;
  let visitedCount = 0;
  while (head < queue.length) {
    const item = queue[head++];
    visitedCount++;
    const level = llc.get(item) ?? 0;
    for (const child of bomByItem.get(item) ?? []) {
      const next = level + 1;
      if (next > (llc.get(child.itemId) ?? -1)) llc.set(child.itemId, next);
      const remaining = (indegree.get(child.itemId) ?? 0) - 1;
      indegree.set(child.itemId, remaining);
      if (remaining === 0) queue.push(child.itemId);
    }
  }

  const inCycle = visitedCount !== nodes.size;
  return { llc, inCycle, nodes: nodes.size };
}

function edgeCount(bomByItem) {
  let e = 0;
  for (const children of bomByItem.values()) e += children.length;
  return e;
}

// `computeLowLevelCodes` only records a level for items it reaches as a BOM
// parent OR child; compare only the keys both produce, and report differences.
function compare(a, b) {
  const diffs = [];
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv !== v) diffs.push({ item: k, current: v, kahn: bv });
  }
  return diffs;
}

const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));

console.log(
  [
    "company".padEnd(24),
    "items".padStart(7),
    "edges".padStart(7),
    "current ms".padStart(12),
    "kahn ms".padStart(9),
    "speedup".padStart(9),
    "agree",
  ].join(" ")
);
console.log("-".repeat(85));

for (const [companyId, bom] of Object.entries(raw)) {
  const bomByItem = new Map(Object.entries(bom).map(([k, v]) => [k, v]));
  if (bomByItem.size === 0) continue;

  const t0 = process.hrtime.bigint();
  const current = computeLowLevelCodes(bomByItem);
  const t1 = process.hrtime.bigint();
  const { llc: kahn, inCycle, nodes } = computeLowLevelCodesKahn(bomByItem);
  const t2 = process.hrtime.bigint();

  const currentMs = Number(t1 - t0) / 1e6;
  const kahnMs = Number(t2 - t1) / 1e6;
  const diffs = compare(current, kahn);

  console.log(
    [
      companyId.padEnd(24),
      String(nodes).padStart(7),
      String(edgeCount(bomByItem)).padStart(7),
      currentMs.toFixed(2).padStart(12),
      kahnMs.toFixed(3).padStart(9),
      (kahnMs > 0 ? (currentMs / kahnMs).toFixed(1) + "x" : "-").padStart(9),
      diffs.length === 0 ? "yes" : `NO (${diffs.length})`,
      inCycle ? "  [BOM CYCLE DETECTED]" : "",
    ].join(" ")
  );

  if (diffs.length > 0) {
    for (const d of diffs.slice(0, 3)) {
      console.log(
        `    ${d.item}: current=${d.current} kahn=${d.kahn}`
      );
    }
  }
}
