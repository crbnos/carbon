import { insertId, maybeOne, need, nextSequence } from "../sql.ts";
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

export async function runTier6(ctx: Ctx): Promise<void> {
  const { client, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  const procAssembly = ctx.refs.processes["Mechanical Assembly"];
  const procTest = ctx.refs.processes["System Test"];
  const wcFab = ctx.refs.workCenters["Fabrication Bay"];
  const wcClean = ctx.refs.workCenters["Clean Room"];

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
  }

  // Operations on the in-progress job, adopting its auto-created jobMakeMethod.
  const inProgressJob = need(ctx.refs.documents, "job:in-progress");
  const jmm1 = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM "jobMakeMethod" WHERE "jobId" = $1 AND "parentMaterialId" IS NULL LIMIT 1`,
    [inProgressJob]
  );
  if (jmm1 && procAssembly && wcFab) {
    await insertId(ctx, "jobOperation", {
      jobId: inProgressJob,
      jobMakeMethodId: jmm1.id,
      order: 1,
      processId: procAssembly,
      workCenterId: wcFab,
      description: "Structural Integration",
      setupTime: 2,
      laborTime: 16,
      status: "In Progress"
    });
    await insertId(ctx, "jobOperation", {
      jobId: inProgressJob,
      jobMakeMethodId: jmm1.id,
      order: 2,
      processId: procTest,
      workCenterId: wcClean ?? wcFab,
      description: "Functional Test",
      setupTime: 1,
      laborTime: 8,
      status: "Todo"
    });
  }
}
