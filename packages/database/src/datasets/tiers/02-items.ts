import { addBomLine, addBopOperation, createItem } from "../helpers/items.ts";
import { insertId, insertRow, need } from "../sql.ts";
import type { Ctx, ItemRef } from "../types.ts";

export async function runTier2(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.items;

  // ── Buy parts ─────────────────────────────────────────────────────────────
  ctx.log("buy parts");
  for (const spec of data.buyParts) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  ctx.log("materials");
  for (const spec of data.materials) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Consumables ───────────────────────────────────────────────────────────
  ctx.log("consumables");
  for (const spec of data.consumables) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  ctx.log("tools");
  for (const spec of data.tools) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Services ──────────────────────────────────────────────────────────────
  ctx.log("services");
  for (const spec of data.services) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── Make parts ────────────────────────────────────────────────────────────
  ctx.log("make parts");
  for (const spec of data.makeParts) {
    const ref = await createItem(ctx, spec);
    ctx.refs.items[spec.readableId] = ref;
  }

  // ── BOMs and BOPs ─────────────────────────────────────────────────────────
  ctx.log("BOMs and BOPs");
  const i = ctx.refs.items;
  const wc = ctx.refs.workCenters;
  const pr = ctx.refs.processes;

  function needItem(id: string): ItemRef {
    const ref = i[id];
    if (!ref) throw new Error(`Seed: item "${id}" not in refs`);
    return ref;
  }

  for (const method of data.methods) {
    const mm = needMM(i, method.readableId);
    for (const line of method.bom) {
      await addBomLine(
        ctx,
        mm,
        needItem(line.component),
        line.quantity,
        line.order,
        {
          methodType: line.methodType,
          kit: line.kit
        }
      );
    }
    for (const op of method.bop) {
      await addBopOperation(
        ctx,
        mm,
        need(pr, op.process),
        op.workCenter ? need(wc, op.workCenter) : undefined,
        op.description,
        op.order,
        {
          laborTime: op.laborTime,
          laborUnit: op.laborUnit,
          setupTime: op.setupTime,
          machineTime: op.machineTime,
          operationType: op.operationType,
          // An Outside Processing step with no supplier process blocks job release,
          // so an unresolved name must stop the seed rather than write null.
          operationSupplierProcessId: op.supplierProcess
            ? need(ctx.refs.misc, op.supplierProcess)
            : undefined,
          operationLeadTime: op.operationLeadTime,
          operationUnitCost: op.operationUnitCost,
          procedureId: op.procedure
            ? need(ctx.refs.misc, op.procedure)
            : undefined
        }
      );
    }
  }

  // ── Supplier parts (which supplier can supply what) ────────────────────────
  ctx.log("supplier parts");
  for (const sl of data.supplierLinks) {
    const itemRef = needItem(sl.item);
    const supplierId = need(ctx.refs.suppliers, sl.supplier);

    const spId = await insertId(ctx, "supplierPart", {
      itemId: itemRef.id,
      supplierId,
      unitPrice: sl.price,
      minimumOrderQuantity: 1
    });
    await insertRow(ctx, "supplierPartPrice", {
      supplierPartId: spId,
      quantity: 1,
      unitPrice: sl.price,
      leadTime: sl.leadTime,
      sourceType: "Manual Entry"
    });
  }
}

function needMM(items: Record<string, ItemRef>, readableId: string): string {
  const ref = items[readableId];
  if (!ref) throw new Error(`Seed: item "${readableId}" not in refs`);
  if (!ref.makeMethodId)
    throw new Error(`Seed: item "${readableId}" has no makeMethodId`);
  return ref.makeMethodId;
}
