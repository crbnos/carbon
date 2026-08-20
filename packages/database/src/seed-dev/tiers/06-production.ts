import {
  copyMethodToJob,
  type JobOperationStatus
} from "../helpers/job-method.ts";
import { insertId, insertRow, need, nextSequence, rows } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Every non-deprecated jobStatus, each one hanging off a real salesOrderLine, so
// the sales order → job link is exercised at every stage of the lifecycle.
// "Overdue" / "Due Today" are deliberately absent: they are deprecated stored
// statuses that the UI derives from dueDate instead.
type JobSpec = {
  key: string;
  item: string;
  status: string;
  quantity: number;
  quantityComplete?: number;
  // Ref keys written by tier 4.
  salesOrder: string;
  salesOrderLine: string;
  customer: string;
  dueDate: string;
  releasedDate?: string;
  completedDate?: string;
};

const JOBS: JobSpec[] = [
  {
    key: "in-progress",
    item: "SAT-1000",
    status: "In Progress",
    quantity: 3,
    quantityComplete: 1,
    salesOrder: "so:orbsec",
    salesOrderLine: "soline:orbsec:sat",
    customer: "ORBSEC Defense",
    dueDate: "2026-02-27",
    releasedDate: "2025-10-20"
  },
  {
    key: "ready",
    item: "SAT-1000",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:polar",
    salesOrderLine: "soline:polar:sat",
    customer: "PolarView Earth",
    dueDate: "2026-03-13",
    releasedDate: "2025-12-05"
  },
  {
    key: "planned",
    item: "BUS-STR-001",
    status: "Planned",
    quantity: 1,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "NovaSat Networks",
    dueDate: "2026-05-15"
  },
  {
    key: "draft",
    item: "EPS-001",
    status: "Draft",
    quantity: 1,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Apex Space Research",
    dueDate: "2026-04-10"
  },
  {
    key: "paused",
    item: "ADCS-001",
    status: "Paused",
    quantity: 1,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "ORBSEC Defense",
    dueDate: "2026-03-27",
    releasedDate: "2025-11-20"
  },
  {
    key: "completed",
    item: "COMMS-001",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:completed",
    salesOrderLine: "soline:completed",
    customer: "PolarView Earth",
    dueDate: "2025-09-19",
    releasedDate: "2025-06-05",
    completedDate: "2025-09-15"
  },
  {
    key: "closed",
    item: "PROP-001",
    status: "Closed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:closed",
    salesOrderLine: "soline:closed",
    customer: "NovaSat Networks",
    dueDate: "2025-08-15",
    releasedDate: "2025-05-16",
    completedDate: "2025-08-11"
  },
  {
    key: "cancelled",
    item: "HARNESS-001",
    status: "Cancelled",
    quantity: 1,
    salesOrder: "so:cancelled",
    salesOrderLine: "soline:cancelled",
    customer: "Apex Space Research",
    dueDate: "2025-10-03",
    releasedDate: "2025-09-10"
  }
];

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
  const { locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  for (const spec of JOBS) {
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
      dueDate: spec.dueDate,
      releasedDate: spec.releasedDate ?? null,
      completedDate: spec.completedDate ?? null
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

  await seedProductionEvents(ctx);
  await seedGenealogy(ctx);
}

/**
 * Logged time on the in-progress job. Without these the job's Events tab and
 * every WIP cost the docs describe are empty, because cost is posted per
 * production event at the work center's rates.
 */
async function seedProductionEvents(ctx: Ctx): Promise<void> {
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

  // Literal start/end pairs — the seed must produce identical rows on every run,
  // and this repo does not use JS Date for time arithmetic.
  const shifts: Array<Array<{ type: string; start: string; end: string }>> = [
    [
      {
        type: "Setup",
        start: "2026-08-04T13:00:00Z",
        end: "2026-08-04T13:45:00Z"
      },
      {
        type: "Labor",
        start: "2026-08-04T13:45:00Z",
        end: "2026-08-04T17:45:00Z"
      },
      {
        type: "Machine",
        start: "2026-08-04T13:45:00Z",
        end: "2026-08-04T17:45:00Z"
      }
    ],
    [
      {
        type: "Setup",
        start: "2026-08-05T13:00:00Z",
        end: "2026-08-05T13:20:00Z"
      },
      {
        type: "Labor",
        start: "2026-08-05T13:20:00Z",
        end: "2026-08-05T16:20:00Z"
      },
      {
        type: "Machine",
        start: "2026-08-05T13:20:00Z",
        end: "2026-08-05T16:20:00Z"
      }
    ]
  ];

  ctx.log("production events");
  for (const [index, operation] of operations.entries()) {
    const events = shifts[index] ?? shifts[0]!;

    for (const event of events) {
      await insertRow(ctx, "productionEvent", {
        jobOperationId: operation.id,
        type: event.type,
        startTime: event.start,
        // `duration` is a generated column — Postgres derives it from the range.
        endTime: event.end,
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

// Tracked components consumed into the first satellite. Item, lot/serial id,
// and how many of that lot went in.
const GENEALOGY_INPUTS: Array<{
  item: string;
  readableId: string;
  quantity: number;
}> = [
  { item: "MAT-AL7075-PLT", readableId: "LOT-AL7075-2607", quantity: 4.5 },
  { item: "BAT-LIION-48V", readableId: "LOT-BAT-2606", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0041", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0042", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0043", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0044", quantity: 1 }
];

/**
 * As-built genealogy for the first satellite off the in-progress job.
 *
 * The traceability graph is drawn from activities, not from entities: each
 * consumed component is the INPUT of a Consume activity whose OUTPUT is the
 * parent being built. Seeding entities alone leaves the graph empty, which is
 * what it was.
 */
async function seedGenealogy(ctx: Ctx): Promise<void> {
  const jobId = need(ctx.refs.documents, "job:in-progress");
  const satellite = ctx.refs.items["SAT-1000"];
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
    quantity: 1,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentId: jobId,
    sourceDocumentReadableId: "SAT-1000",
    readableId: "SAT1000-SN-0001",
    itemId: satellite.id,
    attributes: JSON.stringify({ Job: jobId }),
    updatedBy: ctx.userId
  });
  ctx.refs.documents["trackedEntity:sat-0001"] = serialId;

  // The unit exists because the operation produced it.
  const produceId = await insertId(ctx, "trackedActivity", {
    type: "Produce",
    sourceDocument: "Job Operation",
    sourceDocumentId: operationId,
    sourceDocumentReadableId: "SAT-1000",
    attributes: JSON.stringify({
      "Job Operation": operationId,
      Employee: ctx.userId,
      Quantity: 1
    }),
    updatedBy: ctx.userId
  });
  await insertRow(ctx, "trackedActivityOutput", {
    trackedActivityId: produceId,
    trackedEntityId: serialId,
    quantity: 1,
    updatedBy: ctx.userId
  });

  for (const input of GENEALOGY_INPUTS) {
    const item = ctx.refs.items[input.item];
    if (!item) continue;

    const childId = await insertId(ctx, "trackedEntity", {
      quantity: input.quantity,
      status: "Consumed",
      sourceDocument: "Item",
      sourceDocumentId: item.id,
      sourceDocumentReadableId: item.readableId,
      readableId: input.readableId,
      itemId: item.id,
      attributes: JSON.stringify({ Job: jobId }),
      updatedBy: ctx.userId
    });

    const consumeId = await insertId(ctx, "trackedActivity", {
      type: "Consume",
      sourceDocument: "Job Material",
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
      quantity: 1,
      updatedBy: ctx.userId
    });
  }
}
