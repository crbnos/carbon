import { resolveDate } from "../dates.ts";
import {
  insertId,
  insertRow,
  maybeOne,
  need,
  nextSequence,
  one
} from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier7(ctx: Ctx): Promise<void> {
  const { client, companyId, locationId } = ctx;
  const data = ctx.dataset.quality;
  const plantId = ctx.refs.locations.Plant ?? locationId;

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
    const ncr = await insertId(ctx, "nonConformance", {
      nonConformanceId,
      name: spec.name,
      source: spec.source,
      status: spec.status,
      locationId: plantId,
      nonConformanceTypeId: nct.id,
      openDate: resolveDate(ctx.anchor, spec.openDateOffset),
      quantity: spec.quantity,
      priority: spec.priority,
      companyId
    });
    ctx.refs.documents[spec.ref] = ncr;
    ncrIds.push(ncr);
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
    if (!operation) continue;

    ctx.log(`NCR ${index + 1} — job operation association`);
    await insertRow(ctx, "nonConformanceJobOperation", {
      nonConformanceId: ncrIds[index],
      jobOperationId: operation.id,
      jobId,
      jobReadableId: operation.jobReadableId
    });

    for (const line of spec.items ?? []) {
      const item = need(ctx.refs.items, line.item, "item");
      await insertRow(ctx, "nonConformanceItem", {
        nonConformanceId: ncrIds[index],
        itemId: item.id,
        quantity: line.quantity
      });
    }
  }
}
