import { addBomLine, createItem } from "../helpers/items.ts";
import type { Row } from "../sql.ts";
import {
  insertId,
  insertRow,
  need,
  nextSequence,
  one,
  quote,
  rows,
  sharedColumns
} from "../sql.ts";
import type { Ctx, ItemRef } from "../types.ts";

// Columns never copied verbatim when a change notice clones a method's BoM/BoP:
// the row's own identity, its parent method (the clone's whole point), tenancy +
// audit (re-stamped by insertRow) and methodMaterial's generated
// productionQuantity. Everything else comes from sharedColumns, so a migration
// that adds a column can't silently drop it from the clone.
const CLONE_EXCLUDE = [
  "id",
  "makeMethodId",
  "companyId",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "productionQuantity"
];

// The item's current (highest-version) make method — what a change notice clones
// its draft from, and what the release diff reads as the base.
async function baseMakeMethod(
  ctx: Ctx,
  item: ItemRef
): Promise<{ id: string; version: string }> {
  return one<{ id: string; version: string }>(
    ctx.client,
    `SELECT id, version FROM "makeMethod"
     WHERE "itemId" = $1 AND "companyId" = $2
     ORDER BY version DESC
     LIMIT 1`,
    [item.id, ctx.companyId]
  );
}

/**
 * Copy one method's BoM/BoP onto another (what `copyMakeMethod` does in the app).
 * Operations are cloned first so each material's methodOperationId can be remapped
 * onto the cloned operation. Operation children (steps / parameters / tools) are
 * not copied — no tier writes any.
 */
async function cloneMethodRows(
  ctx: Ctx,
  sourceMakeMethodId: string,
  targetMakeMethodId: string
): Promise<void> {
  const operationColumns = await sharedColumns(
    ctx.client,
    "methodOperation",
    "methodOperation",
    CLONE_EXCLUDE
  );
  const sourceOperations = await rows<Row>(
    ctx.client,
    `SELECT "id", ${operationColumns.map(quote).join(", ")}
     FROM "methodOperation"
     WHERE "makeMethodId" = $1 AND "companyId" = $2
     ORDER BY "order"`,
    [sourceMakeMethodId, ctx.companyId]
  );

  const operationIds = new Map<string, string>();
  for (const { id, ...operation } of sourceOperations) {
    const cloned = await insertId(ctx, "methodOperation", {
      ...operation,
      makeMethodId: targetMakeMethodId
    });
    operationIds.set(id as string, cloned);
  }

  const materialColumns = await sharedColumns(
    ctx.client,
    "methodMaterial",
    "methodMaterial",
    CLONE_EXCLUDE
  );
  const sourceMaterials = await rows<Row>(
    ctx.client,
    `SELECT ${materialColumns.map(quote).join(", ")}
     FROM "methodMaterial"
     WHERE "makeMethodId" = $1 AND "companyId" = $2
     ORDER BY "order"`,
    [sourceMakeMethodId, ctx.companyId]
  );

  for (const material of sourceMaterials) {
    const operationId = material.methodOperationId;
    await insertRow(ctx, "methodMaterial", {
      ...material,
      makeMethodId: targetMakeMethodId,
      methodOperationId:
        typeof operationId === "string"
          ? (operationIds.get(operationId) ?? null)
          : null
    });
  }
}

export async function runTier8(ctx: Ctx): Promise<void> {
  const satItem = need(ctx.refs.items, "SAT-1000");
  const epsItem = need(ctx.refs.items, "EPS-001");
  const busItem = need(ctx.refs.items, "BUS-STR-001");

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

  // A Version stays on the same item: the notice owns a new Draft method version
  // cloned from the active one, and the affected item points at both ends.
  const satBase = await baseMakeMethod(ctx, satItem);
  const satDraftVersion = Number(satBase.version) + 1;
  const satDraft = await insertId(ctx, "makeMethod", {
    itemId: satItem.id,
    version: satDraftVersion,
    status: "Draft",
    changeOrderId: co1
  });
  await cloneMethodRows(ctx, satBase.id, satDraft);
  ctx.log(`  SAT-1000 draft method v${satDraftVersion}`);

  await insertId(ctx, "changeOrderAffectedItem", {
    changeOrderId: co1,
    itemId: satItem.id,
    changeType: "Version",
    draftMakeMethodId: satDraft,
    baseMakeMethodId: satBase.id,
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

  // A Revision mints a new revision of the item (EPS-001.A) and edits ITS method.
  // The revision stays hidden — inactive, notice-owned — until release.
  const epsBase = await baseMakeMethod(ctx, epsItem);
  const epsRevision = await createItem(ctx, {
    readableId: epsItem.readableId,
    revision: "A",
    name: epsItem.name,
    type: "Part",
    replenishment: "Make",
    standardCost: 0,
    unitSalePrice: 120000,
    description:
      "Rev A — potted connector backshells and a revised harness remove the short-circuit path"
  });
  const epsDraft = epsRevision.makeMethodId;
  if (!epsDraft) {
    throw new Error("Seed: EPS-001.A has no make method to use as the draft");
  }
  await ctx.client.query(
    `UPDATE item SET active = false, "changeOrderId" = $2, "updatedBy" = $3
     WHERE id = $1`,
    [epsRevision.id, co2, ctx.userId]
  );
  await ctx.client.query(
    `UPDATE "makeMethod" SET status = 'Draft', "changeOrderId" = $2, "updatedBy" = $3
     WHERE id = $1`,
    [epsDraft, co2, ctx.userId]
  );
  await cloneMethodRows(ctx, epsBase.id, epsDraft);
  ctx.log("  EPS-001.A draft method");

  // The engineering edits themselves — without them the draft mirrors its base
  // and the release diff has nothing to show.
  await ctx.client.query(
    `DELETE FROM "methodMaterial" WHERE "makeMethodId" = $1 AND "itemId" = $2`,
    [epsDraft, need(ctx.refs.items, "MAT-KAPTON").id]
  );
  await ctx.client.query(
    `UPDATE "methodMaterial" SET quantity = 2, "updatedBy" = $3
     WHERE "makeMethodId" = $1 AND "itemId" = $2`,
    [epsDraft, need(ctx.refs.items, "BAT-LIION-48V").id, ctx.userId]
  );
  await addBomLine(ctx, epsDraft, need(ctx.refs.items, "HARNESS-001"), 1, 5);
  await ctx.client.query(
    `UPDATE "methodOperation"
     SET description = $2, "laborTime" = 3, "updatedBy" = $3
     WHERE "makeMethodId" = $1 AND "order" = 2`,
    [epsDraft, "EPS functional & hipot test", ctx.userId]
  );
  ctx.log("  EPS-001.A draft edits (−1 line, +1 line, 2 modified)");

  await insertId(ctx, "changeOrderAffectedItem", {
    changeOrderId: co2,
    itemId: epsItem.id,
    changeType: "Revision",
    draftMakeMethodId: epsDraft,
    baseMakeMethodId: epsBase.id,
    newItemId: epsRevision.id,
    supersessionMode: "Consume First",
    discontinuationDate: "2026-09-30",
    successorEffectivityDate: "2026-10-01",
    sortOrder: 1
  });
  ctx.refs.documents["co:impl"] = co2;

  // ── CO 3: Done — bus structure introduced under change control ────────────
  ctx.log("change order 3 — Done");
  const co3Id = await nextSequence(ctx, "changeOrder");
  const co3 = await insertId(ctx, "changeOrder", {
    changeOrderId: co3Id,
    name: "Introduce bus primary structure under change control",
    type: "Engineering",
    status: "Done",
    openDate: "2025-08-01"
  });

  // Released: a New Part has no predecessor (baseMakeMethodId null, newItemId is
  // the item itself), its draft is now the item's live method with the notice
  // link cleared, and item.changeOrderId is the permanent back-link release writes.
  const busBase = await baseMakeMethod(ctx, busItem);
  await ctx.client.query(
    `UPDATE item SET "changeOrderId" = $2, "updatedBy" = $3 WHERE id = $1`,
    [busItem.id, co3, ctx.userId]
  );
  await insertId(ctx, "changeOrderAffectedItem", {
    changeOrderId: co3,
    itemId: busItem.id,
    changeType: "New Part",
    draftMakeMethodId: busBase.id,
    newItemId: busItem.id,
    sortOrder: 1
  });
  ctx.refs.documents["co:done"] = co3;
}
