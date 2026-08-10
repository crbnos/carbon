import { insertId, nextSequence, one } from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier7(ctx: Ctx): Promise<void> {
  const { client, companyId, locationId } = ctx;
  const plantId = ctx.refs.locations.Plant ?? locationId;

  // Grab the first nonConformanceType available for this company
  const nct = await one<{ id: string }>(
    client,
    `SELECT id FROM "nonConformanceType" WHERE "companyId" = $1 LIMIT 1`,
    [companyId]
  );

  // ── NCR 1: In Progress — EPS wiring harness short ─────────────────────────
  ctx.log("NCR 1 — In Progress");
  const ncr1Id = await nextSequence(ctx, "nonConformance");
  const ncr1 = await insertId(ctx, "nonConformance", {
    nonConformanceId: ncr1Id,
    name: "EPS wiring harness short detected",
    source: "Internal",
    status: "In Progress",
    locationId: plantId,
    nonConformanceTypeId: nct.id,
    openDate: "2025-10-05",
    quantity: 1,
    priority: "High",
    companyId
  });
  ctx.refs.documents["ncr:eps"] = ncr1;

  // ── NCR 2: Registered — Fastener torque spec non-conformance ─────────────
  ctx.log("NCR 2 — Registered");
  const ncr2Id = await nextSequence(ctx, "nonConformance");
  const ncr2 = await insertId(ctx, "nonConformance", {
    nonConformanceId: ncr2Id,
    name: "Fastener torque below spec on panel section 4C",
    source: "Internal",
    status: "Registered",
    locationId: plantId,
    nonConformanceTypeId: nct.id,
    openDate: "2025-11-01",
    quantity: 12,
    priority: "Medium",
    companyId
  });
  ctx.refs.documents["ncr:fastener"] = ncr2;
}
