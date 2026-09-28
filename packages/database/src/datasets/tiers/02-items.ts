import { resolveDate, resolveTimestamp } from "../dates.ts";
import { inspectionPlan } from "../helpers/inspection.ts";
import { addBomLine, addBopOperation, createItem } from "../helpers/items.ts";
import { insertId, insertRow, need, one, rows } from "../sql.ts";
import type {
  AssemblySpec,
  Ctx,
  EnforcementRuleSpec,
  InspectionPlanSpec,
  ItemRef,
  RuleConditionValue
} from "../types.ts";

// A file-less plan document + its features, the shape post-receipt leaves.
async function seedInspectionPlan(
  ctx: Ctx,
  spec: InspectionPlanSpec
): Promise<string> {
  const rule = inspectionPlan(spec);
  const documentId = await insertId(ctx, "inspectionDocument", {
    partId: need(ctx.refs.items, spec.item).id,
    drawingNumber: spec.drawingNumber,
    samplingPlanType: rule.type,
    samplingAql: rule.aql,
    samplingInspectionLevel: rule.inspectionLevel,
    samplingSeverity: rule.severity
  });
  for (const feature of spec.features) {
    await insertRow(ctx, "inspectionFeature", {
      inspectionDocumentId: documentId,
      pageNumber: 1,
      label: feature.label,
      description: feature.description,
      nominalValue: feature.nominalValue,
      tolerancePlus: feature.tolerancePlus,
      toleranceMinus: feature.toleranceMinus,
      unit: feature.unit,
      type: "Measurement"
    });
  }
  return documentId;
}

// `_templates/` paths resolve via getDatasetAssetUrl, not the storage proxy: the
// modelUpload row points at a bundled file, so nothing is uploaded and the assembler never runs.
async function seedAssembly(ctx: Ctx, spec: AssemblySpec): Promise<void> {
  const { industryId } = ctx.dataset;
  if (!industryId) return;

  const base = `_templates/${industryId}/models/${spec.model}`;
  const modelUploadId = await insertId(ctx, "modelUpload", {
    name: `${spec.name}.glb`,
    // Already converted, so the source and the render artifact are the same file.
    modelPath: `${base}.glb`,
    glbPath: `${base}.glb`,
    graphPath: `${base}.graph.json`,
    componentCount: spec.componentCount,
    processingStatus: "Success",
    processedAt: resolveTimestamp(ctx.anchor, 0, "09:00")
  });

  const item = spec.item ? need(ctx.refs.items, spec.item) : undefined;
  const itemId = item?.id;
  // Published is what the floor runs; editing it means cutting a new version.
  const instructionId = await insertId(ctx, "assemblyInstruction", {
    name: spec.name,
    modelUploadId,
    itemId: itemId ?? null,
    status: "Published",
    version: 1,
    publishedAt: resolveTimestamp(ctx.anchor, -1, "16:00:00")
  });

  let sortOrder = 1;
  for (const step of spec.steps) {
    const stepId = await insertId(ctx, "assemblyInstructionStep", {
      assemblyInstructionId: instructionId,
      title: step.title,
      instructionText: step.instruction ?? step.title,
      componentNodeIds: step.componentNodeIds,
      sortOrder: sortOrder++
    });
    for (const [index, material] of (step.materials ?? []).entries()) {
      await insertRow(ctx, "assemblyInstructionStepMaterial", {
        stepId,
        itemId: need(ctx.refs.items, material.item).id,
        quantity: material.quantity,
        sortOrder: index + 1
      });
    }
    for (const [index, tool] of (step.tools ?? []).entries()) {
      await insertRow(ctx, "assemblyInstructionStepTool", {
        stepId,
        itemId: need(ctx.refs.items, tool.item).id,
        quantity: tool.quantity,
        sortOrder: index + 1
      });
    }
  }

  for (const mapping of spec.componentMappings) {
    await insertRow(ctx, "assemblyComponentMapping", {
      modelUploadId,
      geometryHash: mapping.geometryHash,
      itemId: need(ctx.refs.items, mapping.item).id,
      confidence: "high"
    });
  }

  if (itemId) {
    await ctx.client.query(
      `UPDATE "item" SET "modelUploadId" = $1 WHERE "id" = $2 AND "companyId" = $3`,
      [modelUploadId, itemId, ctx.companyId]
    );
  }

  // The method's Assembly operation plays this instruction in the MES. Linked
  // before release, so quote lines (tier 04) and jobs (tier 06) copy it.
  if (!item?.makeMethodId) {
    throw new Error(
      `Seed: assembly "${spec.name}" needs an item with a make method to link operation ${spec.operation} to`
    );
  }
  const operations = await rows<{ id: string }>(
    ctx.client,
    `SELECT id FROM "methodOperation"
     WHERE "makeMethodId" = $1 AND "companyId" = $2
     ORDER BY "order"`,
    [item.makeMethodId, ctx.companyId]
  );
  const operation = operations[spec.operation - 1];
  if (!operation) {
    throw new Error(
      `Seed: assembly "${spec.name}" names operation ${spec.operation}, but ${spec.item} has only ${operations.length}`
    );
  }
  await ctx.client.query(
    `UPDATE "methodOperation" SET "assemblyInstructionId" = $1
     WHERE id = $2 AND "companyId" = $3`,
    [instructionId, operation.id, ctx.companyId]
  );
}

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

  const inspectionPlanIds: Record<string, string> = {};
  for (const plan of data.inspectionPlans) {
    ctx.log(`inspection plan ${plan.drawingNumber}`);
    inspectionPlanIds[plan.key] = await seedInspectionPlan(ctx, plan);
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
            : undefined,
          inspectionDocumentId: op.inspectionPlan
            ? need(inspectionPlanIds, op.inspectionPlan, "inspection plan")
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

  if (data.assembly) {
    ctx.log(`assembly ${data.assembly.name}`);
    await seedAssembly(ctx, data.assembly);
  }

  // Authored methods are released: Active is what job creation copies and what
  // the change notices (tier 08) cut their Draft versions from.
  await ctx.client.query(
    `UPDATE "makeMethod" SET status = 'Active', "updatedBy" = $3
     WHERE id = ANY($1) AND "companyId" = $2`,
    [
      data.methods.map((method) => needMM(i, method.readableId)),
      ctx.companyId,
      ctx.userId
    ]
  );

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

  ctx.log("customer part numbers");
  for (const spec of data.customerParts) {
    await insertRow(ctx, "customerPartToItem", {
      itemId: needItem(spec.item).id,
      customerId: need(ctx.refs.customers, spec.customer, "customer"),
      customerPartId: spec.customerPartId,
      customerPartRevision: spec.customerRevision ?? null
    });
  }

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

  ctx.log("pricing rules");
  for (const spec of data.pricingRules) {
    await insertRow(ctx, "pricingRule", {
      name: spec.name,
      ruleType: spec.ruleType,
      amountType: spec.amountType,
      amount: spec.amount,
      priority: spec.priority,
      customerIds: spec.customer
        ? [need(ctx.refs.customers, spec.customer, "customer")]
        : undefined,
      customerTypeIds: spec.customerType
        ? [need(ctx.refs.misc, `ctype:${spec.customerType}`, "customer type")]
        : undefined,
      itemIds: spec.items?.map((item) => needItem(item).id),
      minQuantity: spec.minQuantity
    });
  }

  // requiresConfiguration is what shows the Configure button and the rules
  // panel; a rule's field is `${field}:${methodRowId}`, as the BoM/BoP
  // editors key it.
  ctx.log("configuration parameters + rules");
  const cfg = data.configuration;
  const cfgItem = needItem(cfg.item);
  const flagged = await ctx.client.query(
    `UPDATE "itemReplenishment" SET "requiresConfiguration" = true, "updatedBy" = $3
     WHERE "itemId" = $1 AND "companyId" = $2`,
    [cfgItem.id, ctx.companyId, ctx.userId]
  );
  if (flagged.rowCount !== 1) {
    throw new Error(`Seed: "${cfg.item}" has no itemReplenishment row`);
  }
  const groupId = await insertId(ctx, "configurationParameterGroup", {
    itemId: cfgItem.id,
    name: cfg.group,
    sortOrder: 1
  });
  for (const [index, parameter] of cfg.parameters.entries()) {
    await insertRow(ctx, "configurationParameter", {
      itemId: cfgItem.id,
      configurationParameterGroupId: groupId,
      key: parameter.key,
      label: parameter.label,
      dataType: parameter.dataType,
      listOptions: parameter.listOptions ?? null,
      sortOrder: index + 1
    });
  }
  const cfgMethodId = needMM(i, cfg.item);
  for (const rule of cfg.rules) {
    const row =
      "component" in rule.target
        ? await one<{ id: string }>(
            ctx.client,
            `SELECT id FROM "methodMaterial"
             WHERE "makeMethodId" = $1 AND "itemId" = $2 AND "companyId" = $3`,
            [cfgMethodId, needItem(rule.target.component).id, ctx.companyId]
          )
        : await one<{ id: string }>(
            ctx.client,
            `SELECT id FROM "methodOperation"
             WHERE "makeMethodId" = $1 AND "companyId" = $2
             ORDER BY "order" OFFSET $3 LIMIT 1`,
            [cfgMethodId, ctx.companyId, rule.target.operation - 1]
          );
    await insertRow(ctx, "configurationRule", {
      itemId: cfgItem.id,
      field: `${rule.field}:${row.id}`,
      code: rule.code,
      updatedBy: ctx.userId
    });
  }

  ctx.log("enforcement rules");
  for (const spec of data.enforcementRules) {
    await seedEnforcementRule(ctx, spec);
  }

  ctx.log("batch properties");
  const nextSortOrder = new Map<string, number>();
  for (const property of data.batchProperties) {
    const sortOrder = (nextSortOrder.get(property.item) ?? 0) + 1;
    nextSortOrder.set(property.item, sortOrder);
    await insertRow(ctx, "batchProperty", {
      itemId: needItem(property.item).id,
      label: property.label,
      dataType: property.dataType,
      listOptions: property.listOptions ?? null,
      sortOrder
    });
  }
}

function resolveRuleValue(
  ctx: Ctx,
  value: RuleConditionValue | undefined
): unknown {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) return value;
  if ("storageType" in value) {
    return need(
      ctx.refs.misc,
      `storagetype:${value.storageType}`,
      "storage type"
    );
  }
  if ("customerTypes" in value) {
    return value.customerTypes.map((name) =>
      need(ctx.refs.misc, `ctype:${name}`, "customer type")
    );
  }
  return need(ctx.refs.locations, value.location, "location");
}

// The row upsertEnforcementRule writes, plus the assignment rows the item /
// work-center rules panels list.
async function seedEnforcementRule(
  ctx: Ctx,
  spec: EnforcementRuleSpec
): Promise<void> {
  const targetType = spec.family === "sales" ? "item" : spec.targetType;
  const ruleId = await insertId(ctx, "enforcementRule", {
    family: spec.family,
    name: spec.name,
    description: spec.description,
    message: spec.message,
    severity: spec.severity,
    conditionAst: JSON.stringify({
      kind: spec.match,
      conditions: spec.conditions.map((condition) => ({
        field: condition.field,
        op: condition.op,
        ...(condition.value === undefined
          ? {}
          : { value: resolveRuleValue(ctx, condition.value) })
      }))
    }),
    surfaces: spec.surfaces,
    targetType,
    active: true
  });
  if ("workCenters" in spec) {
    for (const workCenter of spec.workCenters) {
      await insertRow(ctx, "enforcementRuleWorkCenterAssignment", {
        ruleId,
        workCenterId: need(ctx.refs.workCenters, workCenter, "work center")
      });
    }
    return;
  }
  for (const item of spec.items) {
    await insertRow(ctx, "enforcementRuleItemAssignment", {
      ruleId,
      itemId: need(ctx.refs.items, item, "item").id
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
