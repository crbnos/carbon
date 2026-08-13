import { resolveDate, resolveTimestamp } from "../dates.ts";
import {
  copyMethodToJob,
  type JobOperationStatus
} from "../helpers/job-method.ts";
import { insertId, insertRow, need, nextSequence, rows } from "../sql.ts";
import type { Ctx, ProductionData } from "../types.ts";

// A job's operations open in the state its own status implies — a Draft job's
// work has not been handed to the floor, a released one's has.
function operationStatusFor(jobStatus: string): JobOperationStatus {
  switch (jobStatus) {
    case "Draft":
    case "Planned":
      return "Todo";
    case "Completed":
    case "Closed":
      return "Done";
    case "Cancelled":
      return "Canceled";
    case "Paused":
      return "Paused";
    default:
      return "Ready";
  }
}

export async function runTier6(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.production;
  const { locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  for (const spec of data.jobs) {
    ctx.log(`job ${spec.item} — ${spec.status}`);
    const item = need(ctx.refs.items, spec.item);
    const jobId = await nextSequence(ctx, "job");
    const id = await insertId(ctx, "job", {
      jobId,
      itemId: item.id,
      unitOfMeasureCode: "EA",
      locationId: plantId,
      status: spec.status,
      quantity: spec.quantity,
      quantityComplete: spec.quantityComplete ?? 0,
      scrapQuantity: 0,
      customerId: need(ctx.refs.customers, spec.customer),
      salesOrderId: need(ctx.refs.documents, spec.salesOrder),
      salesOrderLineId: need(ctx.refs.documents, spec.salesOrderLine),
      deadlineType: "Hard Deadline",
      dueDate: resolveDate(ctx.anchor, spec.dueDateOffset),
      releasedDate:
        spec.releasedDateOffset === undefined
          ? null
          : resolveDate(ctx.anchor, spec.releasedDateOffset),
      completedDate:
        spec.completedDateOffset === undefined
          ? null
          : resolveDate(ctx.anchor, spec.completedDateOffset)
    });
    ctx.refs.documents[`job:${spec.key}`] = id;

    // The interceptor gives the job a bare root jobMakeMethod; this is what
    // fills it in, and it is the whole reason the job pages, the method
    // explorer and the MES board have anything to show.
    const copied = await copyMethodToJob(
      ctx,
      id,
      spec.quantity,
      operationStatusFor(spec.status)
    );
    ctx.log(
      `  method: ${copied.operations} operations, ${copied.materials} materials, ${copied.levels} levels`
    );

    // The interceptor's reserved entity for the unit being built has no
    // readableId, so the MES assembly view labels the first serial with a raw
    // id. Name it after the job.
    await ctx.client.query(
      `UPDATE "trackedEntity" te SET "readableId" = $3
       FROM "jobMakeMethod" jmm
       WHERE jmm.id = te.attributes->>'Job Make Method'
         AND jmm."jobId" = $1 AND jmm."parentMaterialId" IS NULL
         AND te."companyId" = $2 AND te."readableId" IS NULL`,
      [id, ctx.companyId, `${jobId}-01`]
    );
  }

  await seedProductionEvents(ctx, data);
  await seedGenealogy(ctx, data);
}

/**
 * Logged time on the in-progress job. Without these the job's Events tab and
 * every WIP cost the docs describe are empty, because cost is posted per
 * production event at the work center's rates.
 */
async function seedProductionEvents(
  ctx: Ctx,
  data: ProductionData
): Promise<void> {
  const jobId = need(ctx.refs.documents, "job:in-progress");

  const operations = await rows<{
    id: string;
    workCenterId: string | null;
    order: number;
  }>(
    ctx.client,
    `SELECT jo.id, jo."workCenterId", jo."order"
     FROM "jobOperation" jo
     JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
     WHERE jo."jobId" = $1 AND jmm."parentMaterialId" IS NULL
       AND jo."companyId" = $2
     ORDER BY jo."order"
     LIMIT 2`,
    [jobId, ctx.companyId]
  );
  if (operations.length === 0) return;

  ctx.log("production events");
  for (const [index, operation] of operations.entries()) {
    const events = data.shifts[index] ?? data.shifts[0]!;

    for (const event of events) {
      await insertRow(ctx, "productionEvent", {
        jobOperationId: operation.id,
        type: event.type,
        startTime: resolveTimestamp(
          ctx.anchor,
          event.startOffset,
          event.startTimeOfDay
        ),
        // `duration` is a generated column — Postgres derives it from the range.
        endTime: resolveTimestamp(
          ctx.anchor,
          event.endOffset,
          event.endTimeOfDay
        ),
        employeeId: ctx.userId,
        workCenterId: operation.workCenterId,
        postedToGL: false
      });
    }

    await insertId(ctx, "productionQuantity", {
      jobOperationId: operation.id,
      type: "Production",
      quantity: 1
    });
  }
}

/**
 * As-built genealogy for the first satellite off the in-progress job.
 *
 * The traceability graph is drawn from activities, not from entities: each
 * consumed component is the INPUT of a Consume activity whose OUTPUT is the
 * parent being built. Seeding entities alone leaves the graph empty, which is
 * what it was.
 */
async function seedGenealogy(ctx: Ctx, data: ProductionData): Promise<void> {
  const assembly = data.genealogyAssembly;
  const jobId = need(ctx.refs.documents, "job:in-progress");
  const satellite = ctx.refs.items[assembly.item];
  if (!satellite) return;

  const assemblyOperation = await rows<{ id: string }>(
    ctx.client,
    `SELECT jo.id
     FROM "jobOperation" jo
     JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
     WHERE jo."jobId" = $1 AND jmm."parentMaterialId" IS NULL
       AND jo."companyId" = $2
     ORDER BY jo."order"
     LIMIT 1`,
    [jobId, ctx.companyId]
  );
  const operationId = assemblyOperation[0]?.id;
  if (!operationId) return;

  ctx.log("as-built genealogy");

  const serialId = await insertId(ctx, "trackedEntity", {
    quantity: assembly.serial.quantity,
    status: assembly.serial.status,
    sourceDocument: assembly.serial.sourceDocument,
    sourceDocumentId: jobId,
    sourceDocumentReadableId: assembly.serial.sourceDocumentReadableId,
    readableId: assembly.serial.readableId,
    itemId: satellite.id,
    attributes: JSON.stringify({ Job: jobId }),
    updatedBy: ctx.userId
  });
  ctx.refs.documents[assembly.ref] = serialId;

  // The unit exists because the operation produced it.
  const produceId = await insertId(ctx, "trackedActivity", {
    type: assembly.produce.type,
    sourceDocument: assembly.produce.sourceDocument,
    sourceDocumentId: operationId,
    sourceDocumentReadableId: assembly.produce.sourceDocumentReadableId,
    attributes: JSON.stringify({
      "Job Operation": operationId,
      Employee: ctx.userId,
      Quantity: assembly.produce.quantity
    }),
    updatedBy: ctx.userId
  });
  await insertRow(ctx, "trackedActivityOutput", {
    trackedActivityId: produceId,
    trackedEntityId: serialId,
    quantity: assembly.produce.quantity,
    updatedBy: ctx.userId
  });

  for (const input of data.genealogyInputs) {
    const item = ctx.refs.items[input.item];
    if (!item) continue;

    const childId = await insertId(ctx, "trackedEntity", {
      quantity: input.quantity,
      status: assembly.consume.entityStatus,
      sourceDocument: assembly.consume.entitySourceDocument,
      sourceDocumentId: item.id,
      sourceDocumentReadableId: item.readableId,
      readableId: input.readableId,
      itemId: item.id,
      attributes: JSON.stringify({ Job: jobId }),
      updatedBy: ctx.userId
    });

    const consumeId = await insertId(ctx, "trackedActivity", {
      type: assembly.consume.type,
      sourceDocument: assembly.consume.sourceDocument,
      sourceDocumentId: jobId,
      sourceDocumentReadableId: item.readableId,
      attributes: JSON.stringify({ Job: jobId, Employee: ctx.userId }),
      updatedBy: ctx.userId
    });
    await insertRow(ctx, "trackedActivityInput", {
      trackedActivityId: consumeId,
      trackedEntityId: childId,
      quantity: input.quantity,
      updatedBy: ctx.userId
    });
    await insertRow(ctx, "trackedActivityOutput", {
      trackedActivityId: consumeId,
      trackedEntityId: serialId,
      quantity: assembly.consume.parentQuantity,
      updatedBy: ctx.userId
    });
  }
}
