import { resolveDate } from "../dates.ts";
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
      const operationId = await addBopOperation(
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
      for (const tool of op.tools ?? []) {
        await insertRow(ctx, "methodOperationTool", {
          operationId,
          toolId: needItem(tool.tool).id,
          quantity: tool.quantity
        });
      }
      for (const parameter of op.parameters ?? []) {
        await insertRow(ctx, "methodOperationParameter", {
          operationId,
          key: parameter.key,
          value: parameter.value
        });
      }
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

  // ── Revision ladder ────────────────────────────────────────────────────────
  // The active revision is the released one, so it goes to Production (locking
  // its BOM/BOP in the app). The rungs share its readableId and stay out of
  // ctx.refs.items so later tiers keep resolving the active revision.
  ctx.log("revision ladder");
  const allItemSpecs = [
    ...data.buyParts,
    ...data.materials,
    ...data.consumables,
    ...data.tools,
    ...data.services,
    ...data.makeParts
  ];
  for (const ladder of data.revisionLadder) {
    const baseSpec = allItemSpecs.find(
      (spec) => spec.readableId === ladder.item
    );
    if (!baseSpec) {
      throw new Error(
        `Seed: revisionLadder item "${ladder.item}" is not a seeded item spec`
      );
    }
    await ctx.client.query(
      `UPDATE item SET "revisionStatus" = 'Production'
       WHERE id = $1 AND "companyId" = $2`,
      [needItem(ladder.item).id, ctx.companyId]
    );
    await createItem(ctx, {
      ...baseSpec,
      revision: ladder.obsoleteRevision,
      active: false,
      revisionStatus: "Obsolete",
      description: `Rev ${ladder.obsoleteRevision} — superseded; kept for historical jobs`
    });
    await createItem(ctx, {
      ...baseSpec,
      revision: ladder.nextRevision,
      active: false,
      revisionStatus: ladder.nextStatus,
      description: `Rev ${ladder.nextRevision} — in work, not yet released`
    });
  }

  // ── Supersessions (live phase-out pairs) ──────────────────────────────────
  // PK is itemId ALONE — the row lives on the predecessor.
  ctx.log("supersessions");
  for (const spec of data.supersessions) {
    await insertRow(ctx, "itemSupersession", {
      itemId: needItem(spec.predecessor).id,
      successorItemId: needItem(spec.successor).id,
      supersessionMode: spec.mode,
      // undefined keys are dropped, keeping the column default (1).
      conversionFactor: spec.conversionFactor,
      successorEffectivityDate:
        spec.successorEffectivityOffset !== undefined
          ? resolveDate(ctx.anchor, spec.successorEffectivityOffset)
          : undefined,
      discontinuationDate:
        spec.discontinuationOffset !== undefined
          ? resolveDate(ctx.anchor, spec.discontinuationOffset)
          : undefined
    });
  }

  // ── Customer part numbers ──────────────────────────────────────────────────
  ctx.log("customer part numbers");
  for (const spec of data.customerParts) {
    await insertRow(ctx, "customerPartToItem", {
      itemId: needItem(spec.item).id,
      customerId: need(ctx.refs.customers, spec.customer, "customer"),
      customerPartId: spec.customerPartId,
      customerPartRevision: spec.customerRevision ?? null
    });
  }

  // ── Customer price overrides ───────────────────────────────────────────────
  ctx.log("customer price overrides");
  for (const spec of data.priceOverrides) {
    const overrideId = await insertId(ctx, "customerItemPriceOverride", {
      itemId: needItem(spec.item).id,
      customerId: need(ctx.refs.customers, spec.customer, "customer"),
      notes: spec.notes ?? null
    });
    for (const priceBreak of spec.breaks) {
      await insertRow(ctx, "customerItemPriceOverrideBreak", {
        customerItemPriceOverrideId: overrideId,
        quantity: priceBreak.quantity,
        overridePrice: priceBreak.overridePrice
      });
    }
  }

  // ── Pricing rules ──────────────────────────────────────────────────────────
  ctx.log("pricing rules");
  for (const spec of data.pricingRules) {
    await insertRow(ctx, "pricingRule", {
      name: spec.name,
      ruleType: "Discount",
      amountType: "Percentage",
      amount: spec.percent,
      customerIds: [need(ctx.refs.customers, spec.customer, "customer")],
      minQuantity: spec.minQuantity
    });
  }

  // ── Configurable item showcase ────────────────────────────────────────────
  // Display-only depth: a parameter group + parameters, no configurationRule.
  if (data.configuration) {
    ctx.log("configuration parameters");
    const cfg = data.configuration;
    const itemId = needItem(cfg.item).id;
    const groupId = await insertId(ctx, "configurationParameterGroup", {
      itemId,
      name: cfg.group,
      sortOrder: 1
    });
    for (const [index, parameter] of cfg.parameters.entries()) {
      await insertRow(ctx, "configurationParameter", {
        itemId,
        configurationParameterGroupId: groupId,
        key: parameter.key,
        label: parameter.label,
        dataType: parameter.dataType,
        listOptions: parameter.listOptions ?? null,
        sortOrder: index + 1
      });
    }
  }
}

function needMM(items: Record<string, ItemRef>, readableId: string): string {
  const ref = items[readableId];
  if (!ref) throw new Error(`Seed: item "${readableId}" not in refs`);
  if (!ref.makeMethodId)
    throw new Error(`Seed: item "${readableId}" has no makeMethodId`);
  return ref.makeMethodId;
}
