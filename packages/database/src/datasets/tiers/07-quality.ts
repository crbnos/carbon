import { resolveDate, resolveTimestamp } from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import {
  deriveSampleStatus,
  inspectionPlan,
  resolveInspectionPlan,
  SEED_SAMPLING_STANDARD,
  valuateReading
} from "../helpers/inspection.ts";
import {
  insertId,
  insertRow,
  maybeOne,
  need,
  nextSequence,
  one,
  RICH,
  rows
} from "../sql.ts";
import type {
  Ctx,
  InspectionFeatureSpec,
  InspectionSpec,
  JobOperationInspectionSpec,
  ReceiptInspectionSpec,
  RiskSpec
} from "../types.ts";

export async function runTier7(ctx: Ctx): Promise<void> {
  const { client, companyId, locationId } = ctx;
  const data = ctx.dataset.quality;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  // Inspection lots go first so an NCR below can link one.
  await seedInspections(ctx);

  // Issue workflows are the templates the NCRs below were raised from.
  const workflowIds: Record<string, string> = {};
  for (const workflow of data.workflows) {
    ctx.log(`issue workflow "${workflow.name}"`);
    const requiredActionIds: string[] = [];
    for (const action of workflow.requiredActions) {
      requiredActionIds.push(
        await bootstrapIdByName(ctx, "nonConformanceRequiredAction", action)
      );
    }
    workflowIds[workflow.key] = await insertId(ctx, "nonConformanceWorkflow", {
      name: workflow.name,
      description: workflow.description,
      content: RICH(workflow.description),
      priority: workflow.priority,
      source: workflow.source,
      requiredActionIds,
      approvalRequirements: workflow.mrb ? ["MRB"] : [],
      active: true
    });
  }

  // Grab the first nonConformanceType available for this company
  const nct = await one<{ id: string }>(
    client,
    `SELECT id FROM "nonConformanceType" WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );

  const ncrIds: string[] = [];
  for (const [index, spec] of data.nonConformances.entries()) {
    ctx.log(`NCR ${index + 1} — ${spec.status}`);
    const nonConformanceId = await nextSequence(ctx, "nonConformance");
    // Required actions and MRB ride on the NCR as the create form writes them;
    // the task rows below mirror the `create` edge function's derivation.
    const requiredActionIds: string[] = [];
    for (const task of spec.actionTasks ?? []) {
      requiredActionIds.push(
        await bootstrapIdByName(
          ctx,
          "nonConformanceRequiredAction",
          task.action
        )
      );
    }
    const ncr = await insertId(ctx, "nonConformance", {
      nonConformanceId,
      name: spec.name,
      source: spec.source,
      status: spec.status,
      locationId: plantId,
      nonConformanceTypeId:
        spec.type === undefined
          ? nct.id
          : await bootstrapIdByName(ctx, "nonConformanceType", spec.type),
      openDate: resolveDate(ctx.anchor, spec.openDateOffset),
      quantity: spec.quantity,
      priority: spec.priority,
      description: spec.description,
      content:
        spec.description === undefined ? undefined : RICH(spec.description),
      dueDate:
        spec.dueDateOffset === undefined
          ? undefined
          : resolveDate(ctx.anchor, spec.dueDateOffset),
      closeDate:
        spec.closeDateOffset === undefined
          ? undefined
          : resolveDate(ctx.anchor, spec.closeDateOffset),
      requiredActionIds:
        requiredActionIds.length === 0 ? undefined : requiredActionIds,
      approvalRequirements: spec.mrb ? ["MRB"] : undefined,
      nonConformanceWorkflowId:
        spec.workflow === undefined
          ? undefined
          : need(workflowIds, spec.workflow, "issue workflow"),
      assignee: spec.assignee === "self" ? ctx.userId : undefined,
      companyId
    });
    ctx.refs.documents[spec.ref] = ncr;
    ncrIds.push(ncr);

    for (const line of spec.items) {
      const item = need(ctx.refs.items, line.item, "item");
      await insertRow(ctx, "nonConformanceItem", {
        nonConformanceId: ncr,
        itemId: item.id,
        quantity: line.quantity,
        disposition: line.disposition ?? "Pending"
      });
    }

    for (const [taskIndex, task] of (spec.actionTasks ?? []).entries()) {
      const actionTaskId = await insertId(ctx, "nonConformanceActionTask", {
        nonConformanceId: ncr,
        actionTypeId: requiredActionIds[taskIndex],
        sortOrder: taskIndex + 1,
        status: task.status,
        assignee: task.status === "In Progress" ? ctx.userId : undefined,
        dueDate:
          task.dueDateOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, task.dueDateOffset),
        completedDate:
          task.completedOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, task.completedOffset)
      });
      for (const process of task.processes ?? []) {
        await insertRow(ctx, "nonConformanceActionProcess", {
          actionTaskId,
          processId: need(ctx.refs.processes, process, "process")
        });
      }
    }

    if (spec.mrb) {
      await insertRow(ctx, "nonConformanceApprovalTask", {
        nonConformanceId: ncr,
        approvalType: "MRB",
        status: spec.mrb.status,
        assignee: spec.mrb.status === "In Progress" ? ctx.userId : undefined,
        dueDate:
          spec.mrb.dueDateOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, spec.mrb.dueDateOffset),
        completedDate:
          spec.mrb.completedOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, spec.mrb.completedOffset)
      });
      for (const reviewer of spec.mrb.reviewers) {
        await insertRow(ctx, "nonConformanceReviewer", {
          nonConformanceId: ncr,
          title: reviewer.title,
          status: reviewer.status,
          assignee: reviewer.status === "In Progress" ? ctx.userId : undefined,
          completedDate:
            reviewer.completedOffset === undefined
              ? undefined
              : resolveTimestamp(
                  ctx.anchor,
                  reviewer.completedOffset,
                  "16:00:00"
                )
        });
      }
    }
  }

  // ── Associations ──────────────────────────────────────────────────────────
  for (const [index, spec] of data.nonConformances.entries()) {
    if (!spec.jobOperation) continue;

    const jobId = need(ctx.refs.documents, spec.jobOperation.job, "job");

    const operation = await maybeOne<{ id: string; jobReadableId: string }>(
      client,
      `SELECT jo.id, j."jobId" AS "jobReadableId"
       FROM "jobOperation" jo
       JOIN job j ON j.id = jo."jobId"
       JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
       WHERE jo."jobId" = $1 AND jmm."parentMaterialId" IS NULL
         AND jo."companyId" = $2
       ORDER BY jo."order"
       LIMIT 1`,
      [jobId, companyId]
    );
    if (!operation) {
      throw new Error(
        `Seed: NCR "${spec.ref}" names job "${spec.jobOperation.job}", which has no root operation to associate`
      );
    }

    ctx.log(`NCR ${index + 1} — job operation association`);
    await insertRow(ctx, "nonConformanceJobOperation", {
      nonConformanceId: ncrIds[index],
      jobOperationId: operation.id,
      jobId,
      jobReadableId: operation.jobReadableId
    });
  }

  // Associations, in the shapes insertIssue and the association modal write.
  for (const [index, spec] of data.nonConformances.entries()) {
    const nonConformanceId = ncrIds[index];
    if (spec.supplier !== undefined) {
      await insertRow(ctx, "nonConformanceSupplier", {
        nonConformanceId,
        supplierId: need(ctx.refs.suppliers, spec.supplier, "supplier")
      });
    }
    if (spec.purchaseOrderLine !== undefined) {
      const { po, item } = spec.purchaseOrderLine;
      const purchaseOrderId = need(ctx.refs.documents, po, "purchase order");
      const order = await one<{ purchaseOrderId: string }>(
        client,
        `SELECT "purchaseOrderId" FROM "purchaseOrder" WHERE id = $1`,
        [purchaseOrderId]
      );
      await insertRow(ctx, "nonConformancePurchaseOrderLine", {
        nonConformanceId,
        purchaseOrderLineId: need(
          ctx.refs.documents,
          `poline:${po}:${item}`,
          "purchase order line"
        ),
        purchaseOrderId,
        purchaseOrderReadableId: order.purchaseOrderId
      });
    }
    if (spec.customer !== undefined) {
      await insertRow(ctx, "nonConformanceCustomer", {
        nonConformanceId,
        customerId: need(ctx.refs.customers, spec.customer, "customer")
      });
    }
    if (spec.salesOrderLine !== undefined) {
      const salesOrderLineId = need(
        ctx.refs.documents,
        spec.salesOrderLine,
        "sales order line"
      );
      const order = await one<{ id: string; salesOrderId: string }>(
        client,
        `SELECT so.id, so."salesOrderId"
         FROM "salesOrderLine" sol JOIN "salesOrder" so ON so.id = sol."salesOrderId"
         WHERE sol.id = $1`,
        [salesOrderLineId]
      );
      await insertRow(ctx, "nonConformanceSalesOrderLine", {
        nonConformanceId,
        salesOrderLineId,
        salesOrderId: order.id,
        salesOrderReadableId: order.salesOrderId
      });
    }
    if (spec.trackedEntity !== undefined) {
      await insertRow(ctx, "nonConformanceTrackedEntity", {
        nonConformanceId,
        trackedEntityId: need(
          ctx.refs.misc,
          `te:${spec.trackedEntity}`,
          "tracked entity"
        )
      });
    }
    if (spec.salesReturnLine !== undefined) {
      const { salesReturn, line } = spec.salesReturnLine;
      const salesReturnOrderId = need(
        ctx.refs.documents,
        `rma:${salesReturn}`,
        "sales return"
      );
      const order = await one<{ salesReturnOrderId: string }>(
        client,
        `SELECT "salesReturnOrderId" FROM "salesReturnOrder" WHERE id = $1 AND "companyId" = $2`,
        [salesReturnOrderId, ctx.companyId]
      );
      await insertRow(ctx, "nonConformanceSalesReturnOrderLine", {
        nonConformanceId,
        salesReturnOrderLineId: need(
          ctx.refs.documents,
          `rmaline:${salesReturn}:${line}`,
          "sales return line"
        ),
        salesReturnOrderId,
        salesReturnOrderReadableId: order.salesReturnOrderId
      });
    }
    if (spec.purchaseReturnLine !== undefined) {
      const { purchaseReturn, line, quantity } = spec.purchaseReturnLine;
      const purchaseReturnOrderId = need(
        ctx.refs.documents,
        `pret:${purchaseReturn}`,
        "purchase return"
      );
      const order = await one<{ purchaseReturnOrderId: string }>(
        client,
        `SELECT "purchaseReturnOrderId" FROM "purchaseReturnOrder" WHERE id = $1 AND "companyId" = $2`,
        [purchaseReturnOrderId, ctx.companyId]
      );
      await insertRow(ctx, "nonConformancePurchaseReturnOrderLine", {
        nonConformanceId,
        purchaseReturnOrderLineId: need(
          ctx.refs.documents,
          `pretline:${purchaseReturn}:${line}`,
          "purchase return line"
        ),
        purchaseReturnOrderId,
        purchaseReturnOrderReadableId: order.purchaseReturnOrderId,
        quantity
      });
    }
    if (spec.inspection !== undefined) {
      await insertRow(ctx, "nonConformanceInspection", {
        nonConformanceId,
        inspectionId: need(ctx.refs.documents, spec.inspection, "inspection")
      });
    }
  }

  await seedQualityDocuments(ctx);
  await seedGauges(ctx);
  await seedRisks(ctx);
}

async function seedInspections(ctx: Ctx): Promise<void> {
  // One Receipt-usage plan per item (the assignment's PK is (itemId, usage)),
  // shared by every lot of that item.
  const receiptPlans: Record<string, LotPlan> = {};
  for (const spec of ctx.dataset.quality.inspections) {
    const lot =
      spec.source === "Receipt"
        ? await receiptLot(ctx, spec, receiptPlans)
        : await jobOperationLot(ctx, spec);
    await insertLot(ctx, spec, lot);
  }
}

type LotPlan = {
  documentId: string;
  featureIds: Record<string, string>;
  features: InspectionFeatureSpec[];
  aql: number;
};

type LotSource = {
  plan: LotPlan;
  lotSize: number;
  columns: Record<string, unknown>;
  itemId: string;
  supplierId?: string;
};

async function insertPlanDocument(
  ctx: Ctx,
  itemId: string,
  spec: ReceiptInspectionSpec
): Promise<LotPlan> {
  const rule = inspectionPlan(spec);
  const documentId = await insertId(ctx, "inspectionDocument", {
    partId: itemId,
    drawingNumber: spec.drawingNumber,
    samplingPlanType: rule.type,
    samplingAql: rule.aql,
    samplingInspectionLevel: rule.inspectionLevel,
    samplingSeverity: rule.severity
  });
  const featureIds: Record<string, string> = {};
  for (const feature of spec.features) {
    featureIds[feature.label] = await insertId(ctx, "inspectionFeature", {
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
  await insertRow(ctx, "itemInspectionDocumentAssignment", {
    itemId,
    usage: "Receipt",
    inspectionDocumentId: documentId
  });
  return {
    documentId,
    featureIds,
    features: spec.features,
    aql: spec.aql
  };
}

// Mirrors post-receipt's inspection branch (file-less plan document).
async function receiptLot(
  ctx: Ctx,
  spec: ReceiptInspectionSpec,
  plans: Record<string, LotPlan>
): Promise<LotSource> {
  const item = need(ctx.refs.items, spec.item);
  const receiptLineId = need(
    ctx.refs.documents,
    `rline:${spec.receipt}:${spec.item}`,
    "receipt line"
  );
  const line = await one<{
    receiptId: string;
    receiptReadableId: string;
    supplierId: string | null;
    receivedQuantity: string;
  }>(
    ctx.client,
    `SELECT r.id AS "receiptId", r."receiptId" AS "receiptReadableId",
            r."supplierId", rl."receivedQuantity"
     FROM "receiptLine" rl JOIN receipt r ON r.id = rl."receiptId"
     WHERE rl.id = $1 AND rl."companyId" = $2`,
    [receiptLineId, ctx.companyId]
  );
  plans[spec.item] ??= await insertPlanDocument(ctx, item.id, spec);
  return {
    plan: need(plans, spec.item, "receipt inspection plan"),
    lotSize: Number(line.receivedQuantity),
    itemId: item.id,
    supplierId: line.supplierId ?? undefined,
    columns: {
      sourceDocument: "Receipt",
      sourceDocumentId: line.receiptId,
      sourceDocumentLineId: receiptLineId,
      sourceDocumentReadableId: line.receiptReadableId,
      itemId: item.id,
      itemReadableId: item.readableId,
      supplierId: line.supplierId ?? undefined
    }
  };
}

// Mirrors getOrCreateJobOperationInspection: the lot of the job's root
// Inspection operation, under the operation's own plan document.
async function jobOperationLot(
  ctx: Ctx,
  spec: JobOperationInspectionSpec
): Promise<LotSource> {
  const jobId = need(ctx.refs.documents, `job:${spec.job}`, "job");
  const operation = await one<{
    id: string;
    jobReadableId: string;
    operationQuantity: string | null;
    inspectionDocumentId: string | null;
    itemId: string;
    itemReadableId: string;
  }>(
    ctx.client,
    `SELECT jo.id, j."jobId" AS "jobReadableId", jo."operationQuantity",
            jo."inspectionDocumentId", jmm."itemId",
            i."readableIdWithRevision" AS "itemReadableId"
     FROM "jobOperation" jo
     JOIN job j ON j.id = jo."jobId"
     JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
     JOIN item i ON i.id = jmm."itemId"
     WHERE jo."jobId" = $1 AND jo."companyId" = $2
       AND jmm."parentMaterialId" IS NULL AND jo."operationType" = 'Inspection'
     ORDER BY jo."order"
     LIMIT 1`,
    [jobId, ctx.companyId]
  );
  const documentId = operation.inspectionDocumentId;
  if (!documentId) {
    throw new Error(
      `Seed: inspection "${spec.ref}": the Inspection operation of job "${spec.job}" has no plan document`
    );
  }
  const job = need(
    Object.fromEntries(ctx.dataset.production.jobs.map((j) => [j.key, j])),
    spec.job,
    "job spec"
  );
  const planKey = ctx.dataset.items.methods
    .find((method) => method.readableId === job.item)
    ?.bop.find((op) => op.inspectionPlan !== undefined)?.inspectionPlan;
  const planSpec = ctx.dataset.items.inspectionPlans.find(
    (plan) => plan.key === planKey
  );
  if (!planSpec) {
    throw new Error(
      `Seed: inspection "${spec.ref}": "${job.item}" has no inspection plan`
    );
  }
  const features = await rows<{ id: string; label: string }>(
    ctx.client,
    `SELECT id, label FROM "inspectionFeature"
     WHERE "inspectionDocumentId" = $1 AND "companyId" = $2`,
    [documentId, ctx.companyId]
  );
  return {
    plan: {
      documentId,
      featureIds: Object.fromEntries(features.map((f) => [f.label, f.id])),
      features: planSpec.features,
      aql: planSpec.aql
    },
    lotSize: Math.max(1, Math.floor(Number(operation.operationQuantity ?? 1))),
    itemId: operation.itemId,
    columns: {
      sourceDocument: "Job Operation",
      sourceDocumentId: jobId,
      sourceDocumentLineId: operation.id,
      sourceDocumentReadableId: operation.jobReadableId,
      itemId: operation.itemId,
      itemReadableId: operation.itemReadableId
    }
  };
}

async function insertLot(
  ctx: Ctx,
  spec: InspectionSpec,
  source: LotSource
): Promise<void> {
  const { plan: lotPlan, lotSize } = source;
  const rule = inspectionPlan(lotPlan);
  const plan = resolveInspectionPlan(lotPlan, lotSize);
  if (spec.samples.length > plan.sampleSize) {
    throw new Error(
      `Seed: inspection "${spec.ref}" authors ${spec.samples.length} samples for a plan of n=${plan.sampleSize}`
    );
  }
  const dispositioned = spec.status === "Passed" || spec.status === "Partial";
  ctx.log(
    `inspection ${spec.ref} — ${spec.source} lot of ${lotSize}, n=${plan.sampleSize} (${spec.status})`
  );

  const inspectionId = await insertId(ctx, "inspection", {
    inspectionId: await nextSequence(ctx, "inspection"),
    ...source.columns,
    lotSize,
    samplingStandard: SEED_SAMPLING_STANDARD,
    samplingPlanType: rule.type,
    sampleSize: plan.sampleSize,
    acceptanceNumber: plan.acceptance,
    rejectionNumber: plan.rejection,
    aql: rule.aql,
    inspectionLevel: rule.inspectionLevel,
    severity: rule.severity,
    codeLetter: plan.codeLetter ?? undefined,
    inspectionDocumentId: lotPlan.documentId,
    status: spec.status,
    notes: spec.notes,
    dispositionedBy: dispositioned ? ctx.userId : undefined,
    dispositionedAt:
      dispositioned && spec.dispositionOffset !== undefined
        ? resolveTimestamp(ctx.anchor, spec.dispositionOffset, "15:00:00")
        : undefined
  });
  ctx.refs.documents[spec.ref] = inspectionId;

  for (const featureId of Object.values(lotPlan.featureIds)) {
    await insertRow(ctx, "inspectionSamplingPlan", {
      inspectionId,
      inspectionFeatureId: featureId,
      sampleSize: plan.sampleSize,
      acceptanceNumber: plan.acceptance,
      rejectionNumber: plan.rejection,
      codeLetter: plan.codeLetter ?? undefined
    });
  }

  let defects = 0;
  for (const [index, sample] of spec.samples.entries()) {
    const inspectedAt = resolveTimestamp(
      ctx.anchor,
      sample.inspectedOffset,
      `10:${String(10 + index * 5).padStart(2, "0")}:00`
    );
    const status = deriveSampleStatus(lotPlan.features, sample);
    if (status === "Failed") defects += 1;
    const sampleId = await insertId(ctx, "inspectionSample", {
      inspectionId,
      status,
      inspectedBy: status === "Pending" ? undefined : ctx.userId,
      inspectedAt: status === "Pending" ? undefined : inspectedAt
    });
    for (const reading of sample.measurements) {
      const feature = lotPlan.features.find((f) => f.label === reading.feature);
      if (!feature) {
        throw new Error(
          `Seed: inspection sample reads unknown feature "${reading.feature}"`
        );
      }
      await insertRow(ctx, "inspectionMeasurement", {
        inspectionId,
        inspectionSampleId: sampleId,
        inspectionFeatureId: need(lotPlan.featureIds, feature.label, "feature"),
        value: reading.value,
        status: valuateReading(feature, reading.value),
        inspectedBy: ctx.userId,
        inspectedAt
      });
    }
  }

  if (!dispositioned) return;
  await insertRow(ctx, "inspectionHistory", {
    inspectionId,
    itemId: source.itemId,
    supplierId: source.supplierId,
    samplingStandard: SEED_SAMPLING_STANDARD,
    severity: rule.severity,
    inspectionLevel: rule.inspectionLevel,
    aql: rule.aql,
    lotSize,
    sampleSize: plan.sampleSize,
    defectsFound: defects,
    outcome: spec.status === "Passed" ? "Accepted" : "Partial"
  });
}

// Quality documents are plain rows; the archive-on-activate interceptor only
// fires on UPDATE, so inserting an Archived v1 beside an Active v2 is stable.
async function seedQualityDocuments(ctx: Ctx): Promise<void> {
  for (const doc of ctx.dataset.quality.qualityDocuments) {
    ctx.log(`quality document "${doc.name}" v${doc.version} — ${doc.status}`);
    const documentId = await insertId(ctx, "qualityDocument", {
      name: doc.name,
      description: doc.description,
      version: doc.version,
      status: doc.status,
      content: RICH(doc.description)
    });
    for (const [index, step] of doc.steps.entries()) {
      await insertRow(ctx, "qualityDocumentStep", {
        qualityDocumentId: documentId,
        name: step.name,
        description: step.description,
        type: step.type,
        required: step.required,
        sortOrder: index + 1,
        unitOfMeasureCode: step.unitOfMeasureCode,
        minValue: step.minValue,
        maxValue: step.maxValue,
        listValues: step.listValues
      });
    }
  }
}

// Replays records oldest-first as upsertGaugeCalibrationRecord does. An
// out-of-calibration gauge also gets lastCalibrationStatus set, as the nightly
// cleanup leaves it after notifying, so the demo fires no stale alert.
async function seedGauges(ctx: Ctx): Promise<void> {
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;
  for (const gauge of ctx.dataset.quality.gauges) {
    let calibrationStatus = "Pending";
    let lastCalibrationStatus = "Pending";
    for (const record of gauge.calibrations) {
      calibrationStatus =
        record.result === "Pass" ? "In-Calibration" : "Out-of-Calibration";
      if (record.result === "Pass") lastCalibrationStatus = "In-Calibration";
    }
    if (calibrationStatus === "Out-of-Calibration") {
      lastCalibrationStatus = "Out-of-Calibration";
    }
    const latest = gauge.calibrations.at(-1);
    ctx.log(`gauge ${gauge.key} — ${gauge.status}, ${calibrationStatus}`);

    const gaugeId = await insertId(ctx, "gauge", {
      gaugeId: await nextSequence(ctx, "gauge"),
      gaugeTypeId: await bootstrapIdByName(ctx, "gaugeType", gauge.gaugeType),
      description: gauge.description,
      modelNumber: gauge.modelNumber,
      serialNumber: gauge.serialNumber,
      supplierId:
        gauge.supplier === undefined
          ? undefined
          : need(ctx.refs.suppliers, gauge.supplier, "supplier"),
      dateAcquired: resolveDate(ctx.anchor, gauge.acquiredOffset),
      gaugeRole: gauge.role,
      gaugeStatus: gauge.status,
      gaugeCalibrationStatus: calibrationStatus,
      lastCalibrationStatus,
      calibrationIntervalInMonths: gauge.calibrationIntervalInMonths,
      lastCalibrationDate:
        latest === undefined
          ? undefined
          : resolveDate(ctx.anchor, latest.dateOffset),
      nextCalibrationDate:
        latest === undefined
          ? undefined
          : ctx.anchor
              .add({ days: latest.dateOffset })
              .add({ months: gauge.calibrationIntervalInMonths })
              .toString(),
      locationId: plantId,
      storageUnitId:
        gauge.shelf === undefined
          ? undefined
          : need(ctx.refs.shelves, gauge.shelf, "shelf")
    });

    for (const record of gauge.calibrations) {
      await insertRow(ctx, "gaugeCalibrationRecord", {
        gaugeId,
        dateCalibrated: resolveDate(ctx.anchor, record.dateOffset),
        inspectionStatus: record.result,
        requiresAction: record.requiresAction ?? false,
        requiresAdjustment: record.requiresAdjustment ?? false,
        requiresRepair: record.requiresRepair ?? false,
        temperature: record.temperature,
        humidity: record.humidity,
        measurementStandard: record.measurementStandard,
        notes: record.notes === undefined ? undefined : RICH(record.notes),
        approvedBy: ctx.userId
      });
    }
  }
}

// sourceId / itemId exactly as each entity's RiskRegisterCard writes them.
async function riskLinks(
  ctx: Ctx,
  risk: RiskSpec
): Promise<{ sourceId?: string; itemId?: string }> {
  switch (risk.source) {
    case "General":
      return {};
    case "Customer":
      return { sourceId: need(ctx.refs.customers, risk.customer, "customer") };
    case "Supplier":
      return { sourceId: need(ctx.refs.suppliers, risk.supplier, "supplier") };
    case "Work Center":
      return {
        sourceId: need(ctx.refs.workCenters, risk.workCenter, "work center")
      };
    case "Item": {
      const itemId = need(ctx.refs.items, risk.item, "item").id;
      return { sourceId: itemId, itemId };
    }
    case "Job": {
      const jobId = need(ctx.refs.documents, risk.job, "job");
      const job = await one<{ itemId: string }>(
        ctx.client,
        `SELECT "itemId" FROM job WHERE id = $1`,
        [jobId]
      );
      return { sourceId: jobId, itemId: job.itemId };
    }
  }
}

async function seedRisks(ctx: Ctx): Promise<void> {
  for (const risk of ctx.dataset.quality.risks) {
    ctx.log(`risk "${risk.title}" — ${risk.type}, ${risk.status}`);
    await insertRow(ctx, "riskRegister", {
      title: risk.title,
      description: risk.description,
      type: risk.type,
      status: risk.status,
      source: risk.source,
      severity: risk.severity,
      likelihood: risk.likelihood,
      ...(await riskLinks(ctx, risk))
    });
  }
}
