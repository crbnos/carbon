import { Time, toCalendarDateTime } from "@internationalized/date";
import { resolveDate, resolveTimestamp } from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import {
  copyMethodToJob,
  type JobOperationStatus
} from "../helpers/method-copy.ts";
import {
  insertId,
  insertRow,
  maybeOne,
  need,
  nextSequence,
  rows
} from "../sql.ts";
import type {
  Ctx,
  DayOffset,
  JobSpec,
  PickingListSpec,
  ProductionData
} from "../types.ts";

type RootOperation = {
  id: string;
  workCenterId: string | null;
  processId: string;
  order: number;
};

// Root operations in "order" order. Specs address them by 1-based position,
// not raw order value, so 10/20/30 resolves the same as 1/2/3.
async function rootOperations(
  ctx: Ctx,
  jobId: string
): Promise<RootOperation[]> {
  return rows<RootOperation>(
    ctx.client,
    `SELECT jo.id, jo."workCenterId", jo."processId", jo."order"
     FROM "jobOperation" jo
     JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
     WHERE jo."jobId" = $1 AND jmm."parentMaterialId" IS NULL
       AND jo."companyId" = $2
     ORDER BY jo."order"`,
    [jobId, ctx.companyId]
  );
}

function rootOperationAt(
  operations: RootOperation[],
  position: number,
  what: string
): RootOperation {
  const operation = operations[position - 1];
  if (!operation) {
    throw new Error(
      `Seed: ${what} names root operation position ${position}, but the job has only ${operations.length}`
    );
  }
  return operation;
}

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
      // Make-to-stock jobs carry none of the three.
      customerId: optionalRef(ctx.refs.customers, spec.customer),
      salesOrderId: optionalRef(ctx.refs.documents, spec.salesOrder),
      salesOrderLineId: optionalRef(ctx.refs.documents, spec.salesOrderLine),
      priority: spec.priority,
      assignee: spec.assignee === "self" ? ctx.userId : null,
      deadlineType: spec.deadlineType ?? "Hard Deadline",
      // A "No Deadline" job has no due date; the UI renders none on that path.
      dueDate:
        spec.dueDateOffset === undefined
          ? null
          : resolveDate(ctx.anchor, spec.dueDateOffset),
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

    await applyOperationDepth(ctx, id, spec);
    if (spec.loggedTime) await seedLoggedTime(ctx, id, spec);

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

  // Job refs only exist from here on, so this favorite isn't tier 04's.
  // jobFavorite has no companyId/createdBy, so audit injection no-ops.
  await insertRow(ctx, "jobFavorite", {
    jobId: need(ctx.refs.documents, `job:${data.eventsJobKey}`),
    userId: ctx.userId
  });

  await seedProductionEvents(ctx, data);
  await seedOpenEvent(ctx, data);
  await seedStepRecords(ctx);
  await seedBatch(ctx, data);
  await seedRework(ctx, data);
  await seedGenealogy(ctx, data);
  await seedPickingLists(ctx, data);
}

/** Operation overrides, quantities and notes; all address root ops by 1-based position. */
async function applyOperationDepth(
  ctx: Ctx,
  jobId: string,
  spec: JobSpec
): Promise<void> {
  if (!spec.operationOverrides && !spec.quantities && !spec.operationNotes) {
    return;
  }
  const operations = await rootOperations(ctx, jobId);

  for (const override of spec.operationOverrides ?? []) {
    const operation = rootOperationAt(
      operations,
      override.order,
      `job "${spec.key}" operationOverrides`
    );
    if (override.status) {
      await ctx.client.query(
        `UPDATE "jobOperation" SET status = $1 WHERE id = $2 AND "companyId" = $3`,
        [override.status, operation.id, ctx.companyId]
      );
    }
    if (override.assignee === "self") {
      await ctx.client.query(
        `UPDATE "jobOperation" SET assignee = $1 WHERE id = $2 AND "companyId" = $3`,
        [ctx.userId, operation.id, ctx.companyId]
      );
    }
    if (override.running) {
      if (override.status !== "In Progress" || !operation.workCenterId) {
        throw new Error(
          `Seed: job "${spec.key}" operation ${override.order} is running, so it must be "In Progress" at a work center`
        );
      }
      // The open timer MES's Active list, the work-center display and the
      // board's running dot all read.
      await insertRow(ctx, "productionEvent", {
        jobOperationId: operation.id,
        type: override.running.type,
        startTime: resolveTimestamp(
          ctx.anchor,
          0,
          override.running.startTimeOfDay
        ),
        endTime: null,
        employeeId: ctx.userId,
        workCenterId: operation.workCenterId,
        postedToGL: false
      });
    }
  }

  for (const quantity of spec.quantities ?? []) {
    const operation = rootOperationAt(
      operations,
      quantity.order,
      `job "${spec.key}" quantities`
    );
    await insertId(ctx, "productionQuantity", {
      jobOperationId: operation.id,
      type: quantity.type,
      quantity: quantity.quantity,
      scrapReasonId:
        quantity.scrapReason === undefined
          ? null
          : await bootstrapIdByName(ctx, "scrapReason", quantity.scrapReason)
    });
  }

  for (const note of spec.operationNotes ?? []) {
    const operation = rootOperationAt(
      operations,
      note.order,
      `job "${spec.key}" operationNotes`
    );
    // jobOperationNote.note is plain text (the MES operation chat), not TipTap.
    await insertRow(ctx, "jobOperationNote", {
      jobOperationId: operation.id,
      note: note.note
    });
  }
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
  const jobId = need(ctx.refs.documents, `job:${data.eventsJobKey}`);
  const eventsJobSpec = data.jobs.find((job) => job.key === data.eventsJobKey);

  const operations = (await rootOperations(ctx, jobId)).slice(0, 2);
  if (operations.length === 0) return;

  if (data.shifts.length === 0) return;

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

    // A job that authors its own productionQuantity rows (JobSpec.quantities)
    // replaces this legacy Production-1 default entirely.
    if (!eventsJobSpec?.quantities) {
      await insertId(ctx, "productionQuantity", {
        jobOperationId: operation.id,
        type: "Production",
        quantity: 1
      });
    }
  }
}

/** An open Setup event (no endTime) — what makes MES's active-operation UI render. */
async function seedOpenEvent(ctx: Ctx, data: ProductionData): Promise<void> {
  const jobId = need(ctx.refs.documents, `job:${data.eventsJobKey}`);
  const operations = await rootOperations(ctx, jobId);
  const operation = rootOperationAt(
    operations,
    data.openEvent.operationOrder,
    "production.openEvent"
  );

  ctx.log("open production event");
  await insertRow(ctx, "productionEvent", {
    jobOperationId: operation.id,
    type: "Setup",
    startTime: resolveTimestamp(ctx.anchor, 0, "08:00:00"),
    endTime: null,
    employeeId: ctx.userId,
    workCenterId: operation.workCenterId,
    postedToGL: false
  });
}

/**
 * As batch-operations' "create" with release: the process must be batchable,
 * the header adopts the members' shared work center, then the members are
 * stamped and the batch timer started.
 */
async function seedBatch(ctx: Ctx, data: ProductionData): Promise<void> {
  const members: RootOperation[] = [];
  for (const member of data.batch.members) {
    const jobId = need(ctx.refs.documents, `job:${member.job}`);
    members.push(
      rootOperationAt(
        await rootOperations(ctx, jobId),
        member.order,
        `production.batch member "${member.job}"`
      )
    );
  }
  const processId = members[0]?.processId;
  if (!processId || members.some((op) => op.processId !== processId)) {
    throw new Error(`Seed: production.batch members must share one process`);
  }
  const workCenters = new Set(members.map((op) => op.workCenterId));

  ctx.log(`job operation batch — ${members.length} members`);
  await ctx.client.query(
    `UPDATE process SET batchable = true WHERE id = $1 AND "companyId" = $2`,
    [processId, ctx.companyId]
  );
  const batchId = await insertId(ctx, "jobOperationBatch", {
    readableId: await nextSequence(ctx, "jobOperationBatch"),
    processId,
    workCenterId: workCenters.size === 1 ? [...workCenters][0] : null,
    locationId: ctx.refs.locations.Plant ?? ctx.locationId,
    status: "Active",
    mergeOutput: false
  });
  await ctx.client.query(
    `UPDATE "jobOperation" SET "jobOperationBatchId" = $1, status = 'In Progress'
     WHERE id = ANY($2) AND "companyId" = $3`,
    [batchId, members.map((op) => op.id), ctx.companyId]
  );
  // The batch timer: one event tagged with the batch, on the operation the
  // operator opened (batch-operations slices it per member at completion).
  const lead = members[0]!;
  if (!lead.workCenterId) {
    throw new Error(`Seed: production.batch's first member has no work center`);
  }
  await insertRow(ctx, "productionEvent", {
    jobOperationId: lead.id,
    jobOperationBatchId: batchId,
    type: data.batch.running.type,
    startTime: resolveTimestamp(
      ctx.anchor,
      0,
      data.batch.running.startTimeOfDay
    ),
    endTime: null,
    employeeId: ctx.userId,
    workCenterId: lead.workCenterId,
    postedToGL: false
  });
}

function optionalRef(
  map: Record<string, string>,
  key: string | undefined
): string | null {
  return key === undefined ? null : need(map, key);
}

// makeDurations (ERP utils/duration.ts): milliseconds one time/unit pair adds.
const MS_PER_PIECE: Record<string, number> = {
  "Hours/Piece": 3_600_000,
  "Hours/100 Pieces": 36_000,
  "Hours/1000 Pieces": 3_600,
  "Minutes/Piece": 60_000,
  "Minutes/100 Pieces": 600,
  "Minutes/1000 Pieces": 60,
  "Seconds/Piece": 1_000
};
function estimateMs(time: number, unit: string, quantity: number): number {
  switch (unit) {
    case "Total Hours":
      return time * 3_600_000;
    case "Total Minutes":
      return time * 60_000;
    case "Pieces/Hour":
      return time > 0 ? (quantity / time) * 3_600_000 : 0;
    case "Pieces/Minute":
      return time > 0 ? (quantity / time) * 60_000 : 0;
    default:
      return time * quantity * (MS_PER_PIECE[unit] ?? 0);
  }
}

/**
 * A completed job's actuals: Setup, then Labor and Machine side by side, on
 * every staffed operation (subassemblies first), back to back from 07:00 UTC,
 * each closed by a Production quantity for the full operation quantity.
 */
async function seedLoggedTime(
  ctx: Ctx,
  jobId: string,
  spec: JobSpec
): Promise<void> {
  const logged = spec.loggedTime;
  if (!logged) return;
  if (spec.completedDateOffset === undefined) {
    throw new Error(
      `Seed: job "${spec.key}" logs time but has no completedDate`
    );
  }
  const operations = await rows<{
    id: string;
    workCenterId: string;
    setupTime: string;
    setupUnit: string;
    laborTime: string;
    laborUnit: string;
    machineTime: string;
    machineUnit: string;
    operationQuantity: string | null;
  }>(
    ctx.client,
    `SELECT jo.id, jo."workCenterId", jo."setupTime", jo."setupUnit"::text,
            jo."laborTime", jo."laborUnit"::text, jo."machineTime",
            jo."machineUnit"::text, jo."operationQuantity"
     FROM "jobOperation" jo
     JOIN "jobMakeMethod" jmm ON jmm.id = jo."jobMakeMethodId"
     WHERE jo."jobId" = $1 AND jo."companyId" = $2 AND jo."workCenterId" IS NOT NULL
     ORDER BY (jmm."parentMaterialId" IS NULL), jmm.id, jo."order"`,
    [jobId, ctx.companyId]
  );

  ctx.log(`  logged time on ${operations.length} operations`);
  const at = (offset: DayOffset) =>
    toCalendarDateTime(ctx.anchor.add({ days: offset }), new Time(7));
  const stamp = (moment: ReturnType<typeof at>) => `${moment.toString()}Z`;
  let cursor = at(logged.startOffset);
  for (const op of operations) {
    const quantity = Number(op.operationQuantity ?? 0);
    const seconds = (time: string, unit: string) =>
      Math.round(
        (estimateMs(Number(time), unit, quantity) * logged.efficiency) / 1000
      );
    const setup = seconds(op.setupTime, op.setupUnit);
    const labor = seconds(op.laborTime, op.laborUnit);
    const machine = seconds(op.machineTime, op.machineUnit);
    const runStart = cursor.add({ seconds: setup });
    const events: Array<[string, typeof cursor, number]> = [
      ["Setup", cursor, setup],
      ["Labor", runStart, labor],
      ["Machine", runStart, machine]
    ];
    for (const [type, start, duration] of events) {
      if (duration <= 0) continue;
      await insertRow(ctx, "productionEvent", {
        jobOperationId: op.id,
        type,
        startTime: stamp(start),
        endTime: stamp(start.add({ seconds: duration })),
        employeeId: ctx.userId,
        workCenterId: op.workCenterId,
        postedToGL: false
      });
    }
    cursor = runStart.add({ seconds: Math.max(labor, machine) });
    // What the operator records at the end of the run (the job's Quantities tab).
    if (quantity > 0) {
      await insertId(ctx, "productionQuantity", {
        jobOperationId: op.id,
        type: "Production",
        quantity,
        createdAt: stamp(cursor)
      });
    }
  }

  // completedDate is midnight of its day; the work has to be done by then.
  if (cursor.compare(at(spec.completedDateOffset).set({ hour: 0 })) > 0) {
    throw new Error(
      `Seed: job "${spec.key}" logged time runs to ${stamp(cursor)}, past its completedDate — start it earlier`
    );
  }
}

/**
 * What an operator typing through the Instructions tab leaves behind, on every
 * Done operation with steps. File steps need an upload, so they stay empty.
 */
async function seedStepRecords(ctx: Ctx): Promise<void> {
  const steps = await rows<{
    id: string;
    type: string;
    minValue: string | null;
    maxValue: string | null;
    listValues: string[] | null;
    recordedAt: string | null;
  }>(
    ctx.client,
    `SELECT s.id, s.type::text, s."minValue", s."maxValue", s."listValues",
            to_char(COALESCE(
              (SELECT max(pe."endTime") FROM "productionEvent" pe
               WHERE pe."jobOperationId" = jo.id AND pe."companyId" = $1),
              j."completedDate", j."releasedDate"
            ) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "recordedAt"
     FROM "jobOperationStep" s
     JOIN "jobOperation" jo ON jo.id = s."operationId" AND jo."companyId" = $1
     JOIN job j ON j.id = jo."jobId" AND j."companyId" = $1
     WHERE s."companyId" = $1 AND jo.status = 'Done' AND s.type <> 'File'
     ORDER BY jo.id, s."sortOrder"`,
    [ctx.companyId]
  );
  if (steps.length === 0) return;

  ctx.log(`step records — ${steps.length}`);
  for (const step of steps) {
    const record: Record<string, unknown> = {
      jobOperationStepId: step.id,
      index: 0
    };
    switch (step.type) {
      case "Measurement": {
        const min = step.minValue === null ? null : Number(step.minValue);
        const max = step.maxValue === null ? null : Number(step.maxValue);
        record.numericValue =
          min !== null && max !== null ? (min + max) / 2 : (min ?? max ?? 1);
        break;
      }
      case "Value":
        record.value = "OK";
        break;
      case "List":
        record.value = step.listValues?.[0] ?? "OK";
        break;
      case "Person":
        record.userValue = ctx.userId;
        break;
      case "Timestamp":
        record.value =
          step.recordedAt ?? resolveTimestamp(ctx.anchor, -1, "15:00:00");
        break;
      default:
        // Task, Checkbox, Inspection: ticked.
        record.booleanValue = true;
    }
    await insertRow(ctx, "jobOperationStepRecord", record);
  }
}

/** Mirrors trigger-rework; left open (no completedAt) since the job is still In Progress. */
async function seedRework(ctx: Ctx, data: ProductionData): Promise<void> {
  const jobId = need(ctx.refs.documents, `job:${data.eventsJobKey}`);
  const operations = await rootOperations(ctx, jobId);
  const target = rootOperationAt(
    operations,
    data.rework.targetOperationOrder,
    "production.rework target"
  );
  const triggeredAt = rootOperationAt(
    operations,
    data.rework.triggeredAtOperationOrder,
    "production.rework triggeredAt"
  );

  ctx.log("rework");
  await insertRow(ctx, "rework", {
    jobId,
    quantity: data.rework.quantity,
    reason: data.rework.reason,
    requestedById: ctx.userId,
    targetJobOperationId: target.id,
    triggeredAtJobOperationId: triggeredAt.id
  });
}

/**
 * Header status is inserted directly: update_picking_list_status fires only on
 * line UPDATE. Picked lines on a Completed list write post-picking's ledger pair.
 */
async function seedPickingLists(ctx: Ctx, data: ProductionData): Promise<void> {
  for (const spec of data.pickingLists) {
    await seedPickingList(ctx, spec);
  }
}

async function seedPickingList(ctx: Ctx, spec: PickingListSpec): Promise<void> {
  ctx.log(`picking list ${spec.key} — ${spec.status}`);
  const plantId = ctx.refs.locations.Plant ?? ctx.locationId;
  const jobId = need(ctx.refs.documents, `job:${spec.job}`);
  const operations = await rootOperations(ctx, jobId);
  const staffedOperation = operations.find((op) => op.workCenterId !== null);
  if (!staffedOperation) {
    throw new Error(
      `Seed: picking list "${spec.key}": job "${spec.job}" has no root operation with a work center to stage material at`
    );
  }
  const lineside = await maybeOne<{ id: string }>(
    ctx.client,
    `SELECT id FROM "storageUnit"
     WHERE "workCenterId" = $1 AND "isWorkCenterDefault" = true AND "companyId" = $2
     LIMIT 1`,
    [staffedOperation.workCenterId, ctx.companyId]
  );
  if (!lineside) {
    throw new Error(
      `Seed: picking list "${spec.key}": no floor storage unit for the job's work center`
    );
  }

  const pickingListId = await insertId(ctx, "pickingList", {
    pickingListId: await nextSequence(ctx, "pickingList"),
    locationId: plantId,
    status: spec.status,
    dueDate: resolveDate(ctx.anchor, spec.dateOffset),
    assignee: ctx.userId
  });

  for (const line of spec.lines) {
    const item = need(ctx.refs.items, line.item);
    const fromShelfId = need(ctx.refs.shelves, line.fromShelf, "shelf");
    const material = await maybeOne<{
      id: string;
      jobOperationId: string | null;
    }>(
      ctx.client,
      `SELECT id, "jobOperationId" FROM "jobMaterial"
       WHERE "jobId" = $1 AND "itemId" = $2 AND "companyId" = $3
       ORDER BY "order", id
       LIMIT 1`,
      [jobId, item.id, ctx.companyId]
    );
    if (!material) {
      throw new Error(
        `Seed: picking list "${spec.key}": item "${line.item}" is not a jobMaterial of job "${spec.job}"`
      );
    }

    await insertRow(ctx, "pickingListLine", {
      pickingListId,
      jobId,
      jobMaterialId: material.id,
      jobOperationId: material.jobOperationId,
      itemId: item.id,
      quantityToPick: line.quantityRequired,
      quantityPicked: line.quantityPicked,
      status: line.status,
      storageUnitId: fromShelfId,
      toStorageUnitId: lineside.id
    });

    // Only a Picked line has moved stock; the paired Transfer rows mirror
    // post-picking's writes exactly (same entryType/documentType/documentId).
    if (line.status === "Picked" && line.quantityPicked > 0) {
      const postingDate = resolveDate(ctx.anchor, spec.dateOffset);
      await insertRow(ctx, "itemLedger", {
        postingDate,
        itemId: item.id,
        quantity: -line.quantityPicked,
        locationId: plantId,
        storageUnitId: fromShelfId,
        entryType: "Transfer",
        documentType: "Direct Transfer",
        documentId: pickingListId
      });
      await insertRow(ctx, "itemLedger", {
        postingDate,
        itemId: item.id,
        quantity: line.quantityPicked,
        locationId: plantId,
        storageUnitId: lineside.id,
        entryType: "Transfer",
        documentType: "Direct Transfer",
        documentId: pickingListId
      });
    }
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
  const jobId = need(ctx.refs.documents, `job:${data.genealogyJobKey}`);
  const satellite = need(ctx.refs.items, assembly.item, "item");

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
    const item = need(ctx.refs.items, input.item, "item");

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
