import { insertId, nextSequence } from "../sql.ts";
import type { Ctx } from "../types.ts";

export async function runTier8(ctx: Ctx): Promise<void> {
  const satItem = ctx.refs.items["SAT-1000"]!;
  const epsItem = ctx.refs.items["EPS-001"]!;
  const busItem = ctx.refs.items["BUS-STR-001"]!;

  // ── CO 1: Draft — version bump on SAT-1000 ───────────────────────────────
  ctx.log("change order 1 — Draft");
  const co1Id = await nextSequence(ctx, "changeOrder");
  const co1 = await insertId(ctx, "changeOrder", {
    changeOrderId: co1Id,
    name: "SAT-1000 Rev A — antenna pointing mechanism update",
    type: "Engineering",
    status: "Draft",
    openDate: "2025-09-01"
  });
  await insertId(ctx, "changeOrderAffectedItem", {
    changeOrderId: co1,
    itemId: satItem.id,
    changeType: "Version",
    sortOrder: 1
  });
  ctx.refs.documents["co:draft"] = co1;

  // ── CO 2: Implementation — revision on EPS-001 ───────────────────────────
  ctx.log("change order 2 — Implementation");
  const co2Id = await nextSequence(ctx, "changeOrder");
  const co2 = await insertId(ctx, "changeOrder", {
    changeOrderId: co2Id,
    name: "EPS-001 harness connector revision — short circuit mitigation",
    type: "Engineering",
    status: "Implementation",
    openDate: "2025-10-10"
  });
  await insertId(ctx, "changeOrderAffectedItem", {
    changeOrderId: co2,
    itemId: epsItem.id,
    changeType: "Revision",
    sortOrder: 1
  });
  ctx.refs.documents["co:impl"] = co2;

  // ── CO 3: Done — new part added for bus structure ─────────────────────────
  ctx.log("change order 3 — Done");
  const co3Id = await nextSequence(ctx, "changeOrder");
  const co3 = await insertId(ctx, "changeOrder", {
    changeOrderId: co3Id,
    name: "Add thermal doubler to bus primary structure",
    type: "Engineering",
    status: "Done",
    openDate: "2025-08-01"
  });
  await insertId(ctx, "changeOrderAffectedItem", {
    changeOrderId: co3,
    itemId: busItem.id,
    changeType: "New Part",
    sortOrder: 1
  });
  ctx.refs.documents["co:done"] = co3;
}
