// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { counterWriteRelative } from "./counter-write-relative";

const COUNTER_SERVICE = "apps/erp/app/modules/inventory/inventory.service.ts";

const COUNTER_TYPES = new Map<string, Map<string, string>>([
  [
    "jobMaterial",
    new Map([
      ["id", "string"],
      ["quantityIssued", "number"],
      ["estimatedQuantity", "number"]
    ])
  ],
  ["jobOperation", new Map([["quantityComplete", "number"]])],
  [
    "purchaseOrderLine",
    new Map([
      ["quantityReceived", "number | null"],
      ["receivedComplete", "boolean"]
    ])
  ]
]);

const counterScan = (ts: string) =>
  counterWriteRelative.find({
    files: [{ file: COUNTER_SERVICE, contents: ts }],
    columnTypes: COUNTER_TYPES
  });
const counterSnippets = (ts: string) => counterScan(ts).map((v) => v.snippet);

// The function head both parents share, from `git show
// ca513209d8^:apps/erp/app/modules/inventory/inventory.service.ts` (lines
// 21713–21741).
const HEAD = `async function issueJobOperationMaterials(
  trx: Transaction<KyselyDatabase>,
  {
    jobOperationId,
    quantity,
    companyId,
    userId,
    postingStatus,
    accountDefaults,
    dimensionMap,
    db,
    dryRun = false,
    plannedElsewhere = []
  }: {
    jobOperationId: string;
    quantity: number;
    companyId: string;
    userId: string;
    // Provisional before the company's accounting cutover, Posted after it.
    postingStatus: AutomaticJournalStatus;
    accountDefaults: ConsumeAccountDefaults;
    dimensionMap: Map<string, string>;
    db: Kysely<KyselyDatabase>;
    // Throw DryRunRollback after the strict check, before any ledger row.
    dryRun?: boolean;
    // Rows earlier operations of the same dry run plan to draw, so operations
    // sharing a bin are checked against their combined demand.
    plannedElsewhere?: ItemLedgerInsert[];
  }
) {
`;

// The job material read, unchanged in every revision (21742–21752).
const READ = `  const materialsToIssue = await trx
    .selectFrom("jobMaterial")
    .where("jobOperationId", "=", jobOperationId)
    .where("companyId", "=", companyId)
    .where("itemType", "in", ["Material", "Part", "Consumable"])
    .where("methodType", "!=", "Make to Order")
    .where("estimatedQuantity", ">", 0)
    .where("requiresBatchTracking", "=", false)
    .where("requiresSerialTracking", "=", false)
    .selectAll()
    .execute();
`;

// ca513209d8^, lines 21850–21864 and 22019–22030: the loop computes the issue
// from the read above and writes quantityIssued as that read plus the issue.
// Two completions of one operation both read the same quantityIssued.
const CA513209D8_PARENT = `${HEAD}${READ}
  for await (const material of materialsToIssue) {
    const demandQuantity = Number(material.quantity) * quantity;
    const remainingQuantity = Math.max(
      Number(material.estimatedQuantity ?? 0) -
        Number(material.quantityIssued ?? 0),
      0
    );
    const quantityToIssue = Math.min(demandQuantity, remainingQuantity);

    if (quantityToIssue <= 0) continue;

    await trx
      .updateTable("jobMaterial")
      .set({
        quantityIssued: round(
          round(Number(material.quantityIssued) ?? 0) + round(quantityToIssue)
        )
      })
      .where("id", "=", material.id)
      .where("companyId", "=", companyId)
      .execute();
  }
}
`;

// ca513209d8 added this lock of the OPERATION before the read (21743–21754).
const CA513209D8_LOCK = `  if (!dryRun) {
    await trx
      .selectFrom("jobOperation")
      .select("id")
      .where("id", "=", jobOperationId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();
  }

`;

// f92d1b24fa^ (lines 28418–28421 and 28566–28575): the same write, now
// collected for updateRowsById. The operation lock is still there, and the
// draw locks are taken later, after the read.
const F92D1B24FA_PARENT = `${HEAD}${CA513209D8_LOCK}${READ}
  const materialIssuedUpdates: {
    id: string;
    data: { quantityIssued: number };
  }[] = [];
  for await (const material of materialsToIssue) {
    materialIssuedUpdates.push({
      id: material.id,
      data: {
        quantityIssued: round(
          round(Number(material.quantityIssued) ?? 0) + round(quantityToIssue)
        )
      }
    });
  }
  await updateRowsById(trx, "jobMaterial", companyId, materialIssuedUpdates);
}
`;

// f92d1b24fa (lines 28307–28332): take the draw locks the backflush takes,
// then read quantityIssued again under them.
const F92D1B24FA_RELOCK = `  if (!dryRun) {
    await lockUntrackedDraws(trx, {
      companyId,
      locationId: job.locationId,
      itemIds: pluckUnique(materialsToIssue, (m) => m.itemId)
    });
    const issued = await trx
      .selectFrom("jobMaterial")
      .select(["id", "quantityIssued"])
      .where(
        "id",
        "in",
        materialsToIssue.map((m) => m.id)
      )
      .where("companyId", "=", companyId)
      .execute();
    const issuedById = new Map(
      issued.map((row) => [row.id, row.quantityIssued])
    );
    for (const material of materialsToIssue) {
      material.quantityIssued =
        issuedById.get(material.id) ?? material.quantityIssued;
    }
  }
`;

const F92D1B24FA_FIX = F92D1B24FA_PARENT.replace(
  "\n  const materialIssuedUpdates",
  `\n${F92D1B24FA_RELOCK}\n  const materialIssuedUpdates`
);

describe("counterWriteRelative: the shipped bugs", () => {
  it("flags the write from before ca513209d8", () => {
    const v = counterScan(CA513209D8_PARENT);
    expect(v.map((x) => x.snippet)).toEqual([
      "issueJobOperationMaterials: jobMaterial.quantityIssued"
    ]);
    expect(v[0]?.message).toContain(`sql\`"quantityIssued" + \${delta}\``);
    expect(v[0]?.message).toContain("forUpdate()");
  });

  it("still flags ca513209d8's fix: its operation lock did not cover the backflush (f92d1b24fa)", () => {
    const fixed = CA513209D8_PARENT.replace(READ, `${CA513209D8_LOCK}${READ}`);
    expect(counterSnippets(fixed)).toEqual([
      "issueJobOperationMaterials: jobMaterial.quantityIssued"
    ]);
  });

  it("flags the updateRowsById write from before f92d1b24fa", () => {
    expect(counterSnippets(F92D1B24FA_PARENT)).toEqual([
      "issueJobOperationMaterials: jobMaterial.quantityIssued"
    ]);
  });

  it("passes the f92d1b24fa fix", () => {
    expect(counterScan(F92D1B24FA_FIX)).toEqual([]);
  });
});

describe("counterWriteRelative", () => {
  it("passes a relative write in SQL", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: sql\`"quantityIssued" + \${delta}\` }).where("id", "=", id).execute();
  await trx.updateTable("jobMaterial").set({ quantityIssued: (eb) => eb("quantityIssued", "+", delta) }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("passes a total read under a lock of the same table", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("does not take a named lock without a read after it", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await lockUntrackedDraws(trx, { companyId, locationId, itemIds });
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterSnippets(ts)).toEqual(["issue: jobMaterial.quantityIssued"]);
  });

  it("follows the total through locals", () => {
    const ts = `export async function receive(client, line, received) {
  const current = line.quantityReceived ?? 0;
  const next = current + received;
  await client.from("purchaseOrderLine").update({ quantityReceived: next }).eq("id", line.id);
}`;
    expect(counterSnippets(ts)).toEqual([
      "receive: purchaseOrderLine.quantityReceived"
    ]);
  });

  it("stops following the total after three locals", () => {
    const ts = `export async function receive(client, line, received) {
  const a = line.quantityReceived ?? 0;
  const b = a + received;
  const c = round(b);
  const d = Math.max(c, 0);
  await client.from("purchaseOrderLine").update({ quantityReceived: d }).eq("id", line.id);
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("does not take a read of another table after the named lock", () => {
    const ts = `export async function issue(trx, id, delta) {
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await lockUntrackedDraws(trx, { companyId, locationId, itemIds });
  const operation = await trx.selectFrom("jobOperation").select(["id", "quantityIssued"]).executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterSnippets(ts)).toEqual(["issue: jobMaterial.quantityIssued"]);
  });

  it("passes a total read with selectAll after a named lock", () => {
    const ts = `export async function issue(trx, id, delta) {
  await lockUntrackedDraws(trx, { companyId, locationId, itemIds });
  const line = await trx.selectFrom("jobMaterial").selectAll().where("id", "=", id).executeTakeFirst();
  await trx.updateTable("jobMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("skips a table the generated types do not have", () => {
    const ts = `export async function issue(trx, id, delta) {
  await trx.updateTable("legacyMaterial").set({ quantityIssued: line.quantityIssued + delta }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("skips a counter name that is not a numeric column of the written table", () => {
    const ts = `export async function complete(trx, operation, delta) {
  await trx.updateTable("jobOperation").set({ quantityIssued: operation.quantityIssued + delta }).where("id", "=", operation.id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("passes a relative SQL write whose delta is the difference of two reads", () => {
    const ts = `export async function issue(trx, id, before, after) {
  await trx.updateTable("jobMaterial").set({ quantityIssued: (eb) => eb("quantityIssued", "+", after.quantityIssued - before.quantityIssued) }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("reads rows collected in a map for updateRowsById", () => {
    const ts = `export async function postReceipt(trx, lines) {
  const updates = lines.reduce((acc, line) => {
    const newQuantityReceived = (line.quantityReceived ?? 0) + line.received;
    return {
      ...acc,
      [line.id]: { quantityReceived: newQuantityReceived, receivedComplete: true }
    };
  }, {});
  await updateRowsById(trx, "purchaseOrderLine", companyId, Object.entries(updates).map(([id, data]) => ({ id, data })));
}`;
    expect(counterSnippets(ts)).toEqual([
      "postReceipt: purchaseOrderLine.quantityReceived"
    ]);
  });

  it("passes a total that does not read the counter back", () => {
    const ts = `export async function setIssued(trx, id, issued) {
  const quantityIssued = issued * 2;
  await trx.updateTable("jobMaterial").set({ quantityIssued }).where("id", "=", id).execute();
  await trx.updateTable("jobMaterial").set({ quantityIssued: 0 }).where("id", "=", id).execute();
  await trx.updateTable("jobMaterial").set({ estimatedQuantity: line.estimatedQuantity + 1 }).where("id", "=", id).execute();
}`;
    expect(counterScan(ts)).toEqual([]);
  });

  it("does not read a for-of loop body as the loop variable's value", () => {
    // postPurchaseInvoice's void: the rows destructure \`purchaseOrderId\`,
    // which an earlier loop also declares; its body is a projection, not a
    // write.
    const ts = `export async function voidInvoice(trx, lines, received) {
  const updates = { [id]: { quantityReceived: received, purchaseOrderId } };
  for (const purchaseOrderId of orderIds) {
    const projected = lines.map((line) => ({ ...line, quantityReceived: line.quantityReceived }));
  }
  await updateRowsById(trx, "purchaseOrderLine", companyId, Object.entries(updates).map(([id, { purchaseOrderId: _p, ...data }]) => ({ id, data })));
}`;
    expect(counterScan(ts)).toEqual([]);
  });
});
