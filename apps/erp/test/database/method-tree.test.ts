// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack; skipped without one. The method tree read
// through PostgREST, which returns at most 1000 rows a request (max_rows).

import { sql } from "kysely";
import { expect } from "vitest";
import { fixture, test } from "./fixtures/purchasing";
import { localServiceRoleClient } from "./fixtures/local-supabase";

const { getMethodTree, getMethodTreeArray } = await import(
  "../../app/modules/items/items.service"
);

const LINES = 1100;

test("the method tree reads every row past the row cap and keeps the made copy", async () => {
  const f = await fixture();
  const client = localServiceRoleClient()!;
  try {
    const top = `${f.ids.item}-top`;
    const sub = `${f.ids.item}-sub`;
    const part = `${f.ids.item}-part`;
    // Inserted with the triggers on: they add the make methods and the item
    // costs the method tree joins.
    await sql`
      INSERT INTO "item" (id, "readableId", name, type, "replenishmentSystem", "defaultMethodType",
        "itemTrackingType", "unitOfMeasureCode", "companyId", "createdBy") VALUES
        (${top}, 'TOP-1', 'Top', 'Part', 'Make', 'Make to Order', 'Inventory', 'EA', ${f.companyId}, 'system'),
        (${sub}, 'SUB-1', 'Sub', 'Part', 'Make', 'Make to Order', 'Inventory', 'EA', ${f.companyId}, 'system'),
        (${part}, 'PART-1', 'Part', 'Part', 'Buy', 'Pull from Inventory', 'Inventory', 'EA', ${f.companyId}, 'system')
    `.execute(f.db);
    const methods = await f.db
      .selectFrom("makeMethod")
      .select(["id", "itemId"])
      .where("itemId", "in", [top, sub])
      .execute();
    const methodOf = (itemId: string) =>
      methods.find((m) => m.itemId === itemId)!.id;

    // Every line at order 1, so only the tie-breakers order the pages; the
    // sub-assembly is under the top twice, made and pulled from stock.
    await sql`
      INSERT INTO "methodMaterial" ("makeMethodId", "itemId", "itemType", quantity, "methodType",
        "unitOfMeasureCode", "order", "companyId", "createdBy")
      SELECT ${methodOf(top)}, ${part}, 'Part', 1, 'Pull from Inventory', 'EA', 1, ${f.companyId}, 'system'
      FROM generate_series(1, ${LINES})
    `.execute(f.db);
    // Fixed ids, so the pulled branch's copy of the shared line always sorts
    // after the made one: keeping the last copy would then keep the wrong one.
    await sql`
      INSERT INTO "methodMaterial" (id, "makeMethodId", "itemId", "itemType", quantity, "methodType",
        "materialMakeMethodId", "unitOfMeasureCode", "order", "companyId", "createdBy") VALUES
        (${`${f.ids.item}-a-made`}, ${methodOf(top)}, ${sub}, 'Part', 1, 'Make to Order', ${methodOf(sub)}, 'EA', 1, ${f.companyId}, 'system'),
        (${`${f.ids.item}-z-pulled`}, ${methodOf(top)}, ${sub}, 'Part', 1, 'Pull from Inventory', ${methodOf(sub)}, 'EA', 1, ${f.companyId}, 'system')
    `.execute(f.db);
    await sql`
      INSERT INTO "methodMaterial" ("makeMethodId", "itemId", "itemType", quantity, "methodType",
        "unitOfMeasureCode", "order", "companyId", "createdBy")
      VALUES (${methodOf(sub)}, ${part}, 'Part', 2, 'Pull from Inventory', 'EA', 1, ${f.companyId}, 'system')
    `.execute(f.db);

    // Every row, straight from SQL; one PostgREST call stops at 1000.
    const { rows: all } = await sql<{
      methodMaterialId: string;
      parentMaterialId: string;
      isPickDescendant: boolean;
    }>`SELECT * FROM get_method_tree(${methodOf(top)})`.execute(f.db);
    expect(all.length).toBeGreaterThan(1000);
    const one = await client.rpc("get_method_tree", { uid: methodOf(top) });
    expect(one.data?.length).toBe(1000);

    const paged = await getMethodTreeArray(client, methodOf(top));
    expect(paged.error).toBeNull();
    const key = (r: {
      methodMaterialId: string;
      parentMaterialId: string;
      isPickDescendant: boolean;
    }) => `${r.methodMaterialId}|${r.parentMaterialId}|${r.isPickDescendant}`;
    expect((paged.data ?? []).map(key).sort()).toEqual(all.map(key).sort());

    // The sub-assembly's line comes once per branch; its one node keeps the
    // made branch's copy, whichever row came last.
    expect(
      (paged.data ?? [])
        .filter((r) => r.makeMethodId === methodOf(sub))
        .map((r) => r.isPickDescendant)
        .sort()
    ).toEqual([false, true]);
    const tree = await getMethodTree(client, methodOf(top));
    expect(tree.error).toBeNull();
    type Node = {
      data: { makeMethodId: string; isPickDescendant: boolean };
      children: Node[];
    };
    const subLines: Node[] = [];
    const walk = (nodes: Node[]) => {
      for (const node of nodes) {
        if (node.data.makeMethodId === methodOf(sub)) subLines.push(node);
        walk(node.children);
      }
    };
    walk((tree.data ?? []) as unknown as Node[]);
    expect(subLines.length).toBe(2);
    expect(subLines.map((n) => n.data.isPickDescendant)).toEqual([
      false,
      false
    ]);
  } finally {
    await f.cleanup();
  }
});
