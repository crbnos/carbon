import { resolveDate } from "../dates.ts";
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
  const data = ctx.dataset.changeOrders;

  for (const [index, spec] of data.changeOrders.entries()) {
    ctx.log(`change order ${index + 1} — ${spec.status}`);
    const changeOrderId = await nextSequence(ctx, "changeOrder");
    const changeOrder = await insertId(ctx, "changeOrder", {
      changeOrderId,
      name: spec.name,
      type: spec.type,
      status: spec.status,
      openDate: resolveDate(ctx.anchor, spec.openDateOffset)
    });

    for (const affected of spec.affectedItems) {
      const item = need(ctx.refs.items, affected.item);
      const base = await baseMakeMethod(ctx, item);

      let draftMakeMethodId: string;
      let baseMakeMethodId: string | undefined;
      let newItemId: string | undefined;

      switch (affected.changeType) {
        case "Version": {
          // A Version stays on the same item: the notice owns a new Draft method
          // version cloned from the active one, and the affected item points at
          // both ends.
          const draftVersion = Number(base.version) + 1;
          const draft = await insertId(ctx, "makeMethod", {
            itemId: item.id,
            version: draftVersion,
            status: "Draft",
            changeOrderId: changeOrder
          });
          await cloneMethodRows(ctx, base.id, draft);
          ctx.log(`  ${item.readableId} draft method v${draftVersion}`);
          draftMakeMethodId = draft;
          baseMakeMethodId = base.id;
          break;
        }

        case "Revision": {
          // A Revision mints a new revision of the item (EPS-001.A) and edits ITS
          // method. The revision stays hidden — inactive, notice-owned — until release.
          const revisionSpec = affected.revision;
          if (!revisionSpec) {
            throw new Error(
              `Seed: affected item ${affected.item} is a Revision but has no revision spec`
            );
          }
          const revisionItem = await createItem(ctx, {
            readableId: item.readableId,
            revision: revisionSpec.revision,
            name: item.name,
            type: "Part",
            replenishment: "Make",
            standardCost: 0,
            unitSalePrice: revisionSpec.unitSalePrice,
            description: revisionSpec.description
          });
          const draft = revisionItem.makeMethodId;
          if (!draft) {
            throw new Error(
              `Seed: ${item.readableId}.${revisionSpec.revision} has no make method to use as the draft`
            );
          }
          await ctx.client.query(
            `UPDATE item SET active = false, "changeOrderId" = $2, "updatedBy" = $3
     WHERE id = $1`,
            [revisionItem.id, changeOrder, ctx.userId]
          );
          await ctx.client.query(
            `UPDATE "makeMethod" SET status = 'Draft', "changeOrderId" = $2, "updatedBy" = $3
     WHERE id = $1`,
            [draft, changeOrder, ctx.userId]
          );
          await cloneMethodRows(ctx, base.id, draft);
          ctx.log(
            `  ${revisionItem.readableId}.${revisionItem.revision} draft method`
          );

          // The engineering edits themselves — without them the draft mirrors its
          // base and the release diff has nothing to show.
          for (const edit of revisionSpec.bomEdits) {
            const component = need(ctx.refs.items, edit.component);
            switch (edit.op) {
              case "delete":
                await ctx.client.query(
                  `DELETE FROM "methodMaterial" WHERE "makeMethodId" = $1 AND "itemId" = $2`,
                  [draft, component.id]
                );
                break;
              case "setQuantity":
                await ctx.client.query(
                  `UPDATE "methodMaterial" SET quantity = $3, "updatedBy" = $4
     WHERE "makeMethodId" = $1 AND "itemId" = $2`,
                  [draft, component.id, edit.quantity, ctx.userId]
                );
                break;
              case "add":
                await addBomLine(
                  ctx,
                  draft,
                  component,
                  edit.quantity,
                  edit.order
                );
                break;
            }
          }
          for (const edit of revisionSpec.operationEdits) {
            const params: unknown[] = [draft, ctx.userId];
            const assignments: string[] = [];
            if (edit.description !== undefined) {
              params.push(edit.description);
              assignments.push(`description = $${params.length}`);
            }
            if (edit.laborTime !== undefined) {
              params.push(edit.laborTime);
              assignments.push(`"laborTime" = $${params.length}`);
            }
            if (assignments.length === 0) continue;
            params.push(edit.order);
            await ctx.client.query(
              `UPDATE "methodOperation"
     SET ${assignments.join(", ")}, "updatedBy" = $2
     WHERE "makeMethodId" = $1 AND "order" = $${params.length}`,
              params
            );
          }
          const removed = revisionSpec.bomEdits.filter(
            (edit) => edit.op === "delete"
          ).length;
          const added = revisionSpec.bomEdits.filter(
            (edit) => edit.op === "add"
          ).length;
          const modified =
            revisionSpec.bomEdits.filter((edit) => edit.op === "setQuantity")
              .length + revisionSpec.operationEdits.length;
          ctx.log(
            `  ${revisionItem.readableId}.${revisionItem.revision} draft edits (−${removed} line, +${added} line, ${modified} modified)`
          );

          draftMakeMethodId = draft;
          baseMakeMethodId = base.id;
          newItemId = revisionItem.id;
          break;
        }

        case "New Part": {
          // Released: a New Part has no predecessor (baseMakeMethodId null,
          // newItemId is the item itself), its draft is now the item's live method
          // with the notice link cleared, and item.changeOrderId is the permanent
          // back-link release writes.
          await ctx.client.query(
            `UPDATE item SET "changeOrderId" = $2, "updatedBy" = $3 WHERE id = $1`,
            [item.id, changeOrder, ctx.userId]
          );
          draftMakeMethodId = base.id;
          newItemId = item.id;
          break;
        }
      }

      await insertId(ctx, "changeOrderAffectedItem", {
        changeOrderId: changeOrder,
        itemId: item.id,
        changeType: affected.changeType,
        draftMakeMethodId,
        baseMakeMethodId,
        newItemId,
        supersessionMode: affected.supersessionMode,
        discontinuationDate:
          affected.discontinuationOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, affected.discontinuationOffset),
        successorEffectivityDate:
          affected.successorEffectivityOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, affected.successorEffectivityOffset),
        sortOrder: affected.sortOrder
      });
    }

    ctx.refs.documents[spec.ref] = changeOrder;
  }
}
