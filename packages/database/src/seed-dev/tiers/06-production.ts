import { insertId, maybeOne, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier6(ctx: Ctx): Promise<void> {
  const { client, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  const satItem = ctx.refs.items["SAT-1000"]!;
  const busItem = ctx.refs.items["BUS-STR-001"]!;
  const epsItem = ctx.refs.items["EPS-001"]!;

  const procAssembly = ctx.refs.processes["Mechanical Assembly"];
  const procTest = ctx.refs.processes["System Test"];
  const wcFab = ctx.refs.workCenters["Fabrication Bay"];
  const wcClean = ctx.refs.workCenters["Clean Room"];

  // ── Job 1: SAT-1000 — In Progress ─────────────────────────────────────────
  ctx.log("job 1 — SAT-1000 In Progress");
  const j1Id = await nextSequence(ctx, "job");
  const j1 = await insertId(ctx, "job", {
    jobId: j1Id,
    itemId: satItem.id,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    status: "In Progress",
    quantity: 1,
    scrapQuantity: 0
  });
  // Adopt the auto-created jobMakeMethod
  const jmm1 = await maybeOne<{ id: string }>(
    client,
    `SELECT id FROM "jobMakeMethod" WHERE "jobId" = $1 AND "parentMaterialId" IS NULL LIMIT 1`,
    [j1]
  );
  if (jmm1 && procAssembly && wcFab) {
    await insertId(ctx, "jobOperation", {
      jobId: j1,
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
      jobId: j1,
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
  ctx.refs.documents["job:sat1"] = j1;

  // ── Job 2: BUS-STR-001 — Ready ────────────────────────────────────────────
  ctx.log("job 2 — BUS-STR-001 Ready");
  const j2Id = await nextSequence(ctx, "job");
  const j2 = await insertId(ctx, "job", {
    jobId: j2Id,
    itemId: busItem.id,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    status: "Ready",
    quantity: 2,
    scrapQuantity: 0
  });
  ctx.refs.documents["job:bus"] = j2;

  // ── Job 3: EPS-001 — Draft ────────────────────────────────────────────────
  ctx.log("job 3 — EPS-001 Draft");
  const j3Id = await nextSequence(ctx, "job");
  const j3 = await insertId(ctx, "job", {
    jobId: j3Id,
    itemId: epsItem.id,
    unitOfMeasureCode: "EA",
    locationId: plantId,
    status: "Draft",
    quantity: 3,
    scrapQuantity: 0
  });
  ctx.refs.documents["job:eps"] = j3;
}
