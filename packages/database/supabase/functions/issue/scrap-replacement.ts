import { Transaction } from "kysely";
import { DB } from "../lib/database.ts";

// Reopen + capacity top-up after scrapping units of a make method, so the
// replacement units can run the FULL routing (spec
// .ai/specs/2026-08-06-scrap-unscrap-flow.md §1.6).
//
// - Done operations reopen to Ready (never Canceled); the quantity-sync
//   interceptor re-flips them once good quantity reaches targetQuantity —
//   which scrap no longer counts toward (20260807090629).
// - targetQuantity is NEVER written: it is the good quantity to produce.
// - operationQuantity (capacity incl. planned scrap allowance) is topped up
//   only when cumulative actual scrap exceeds the allowance:
//   needed = targetQuantity + totalScrapped; bump = max(0, needed − current).
// - job.scrapQuantity mirrors the same monotonic rule for the ROOT make
//   method so the generated job.productionQuantity stays coherent.
// - jobMaterial estimates grow by their per-parent quantity × the bump so
//   backflush caps (estimatedQuantity − quantityIssued) cover the
//   replacement units. Make-to-Order children are excluded (their capacity
//   is their own make method's).
export async function applyScrapReplacement(
  trx: Transaction<DB>,
  args: {
    jobMakeMethodId: string;
    jobId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ addedQuantity: number }> {
  const { jobMakeMethodId, jobId, companyId, userId } = args;

  const operations = await trx
    .selectFrom("jobOperation")
    .select(["id", "status", "operationQuantity", "targetQuantity"])
    .where("jobMakeMethodId", "=", jobMakeMethodId)
    .where("companyId", "=", companyId)
    .execute();
  if (operations.length === 0) return { addedQuantity: 0 };

  // Cumulative actual scrap for this make method, read from productionQuantity
  // directly so the math is independent of interceptor timing.
  const scrapTotal = await trx
    .selectFrom("productionQuantity")
    .select((eb) => eb.fn.sum("quantity").as("quantity"))
    .where("type", "=", "Scrap")
    .where("companyId", "=", companyId)
    .where(
      "jobOperationId",
      "in",
      operations.map((op) => op.id)
    )
    .executeTakeFirst();
  const totalScrapped = Number(scrapTotal?.quantity ?? 0);

  await trx
    .updateTable("jobOperation")
    .set({
      status: "Ready",
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .where("jobMakeMethodId", "=", jobMakeMethodId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Done")
    .execute();

  let addedQuantity = 0;
  for (const operation of operations) {
    const target = Number(operation.targetQuantity ?? 0);
    if (target <= 0) continue;
    const current = Number(operation.operationQuantity ?? 0);
    const needed = target + totalScrapped;
    const bump = Math.max(0, needed - current);
    if (bump <= 0) continue;
    addedQuantity = Math.max(addedQuantity, bump);
    await trx
      .updateTable("jobOperation")
      .set({
        operationQuantity: needed,
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      })
      .where("id", "=", operation.id)
      .execute();
  }

  if (addedQuantity > 0) {
    // Root make method drives the job header's planned-scrap bucket.
    const makeMethod = await trx
      .selectFrom("jobMakeMethod")
      .select(["parentMaterialId"])
      .where("id", "=", jobMakeMethodId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (makeMethod && makeMethod.parentMaterialId === null) {
      const job = await trx
        .selectFrom("job")
        .select(["scrapQuantity"])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      const currentScrapQuantity = Number(job?.scrapQuantity ?? 0);
      if (totalScrapped > currentScrapQuantity) {
        await trx
          .updateTable("job")
          .set({
            scrapQuantity: totalScrapped,
            updatedBy: userId,
            updatedAt: new Date().toISOString(),
          })
          .where("id", "=", jobId)
          .where("companyId", "=", companyId)
          .execute();
      }
    }

    // Grow material requirements for the replacement units (mirrors
    // recalculateJobRequirements' per-parent math, which is ERP-side and
    // unavailable in Deno).
    const materials = await trx
      .selectFrom("jobMaterial")
      .select(["id", "quantity", "estimatedQuantity"])
      .where("jobMakeMethodId", "=", jobMakeMethodId)
      .where("companyId", "=", companyId)
      .where("methodType", "!=", "Make to Order")
      .execute();
    for (const material of materials) {
      const perParent = Number(material.quantity) || 0;
      if (perParent <= 0) continue;
      await trx
        .updateTable("jobMaterial")
        .set({
          estimatedQuantity:
            Number(material.estimatedQuantity ?? 0) +
            perParent * addedQuantity,
        })
        .where("id", "=", material.id)
        .execute();
    }
  }

  return { addedQuantity };
}
