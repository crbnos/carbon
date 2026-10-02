// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { resolveDate } from "../dates.ts";
import { bootstrapIdByName } from "../helpers/bootstrap-lookup.ts";
import { addBomLine, createItem } from "../helpers/items.ts";
import { copyMethodToMethod } from "../helpers/method-copy.ts";
import {
  insertId,
  insertRow,
  need,
  nextSequence,
  one,
  RICH,
  rows
} from "../sql.ts";
import type { ChangeOrderSpec, Ctx, ItemRef } from "../types.ts";

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

// Assess an actual producing Job, not a hand-written approximation of its
// snapshot. The same source fields and root method are read by the ERP writer.
async function seedImpactJob(
  ctx: Ctx,
  changeNoticeId: string,
  affectedIds: Map<string, string>,
  impact: NonNullable<ChangeOrderSpec["impactJobs"]>[number],
  sortOrder: number
): Promise<void> {
  const jobId = need(ctx.refs.documents, `job:${impact.job}`, "job");
  const matches = await rows<{
    sourceItemId: string;
    affectedItemLabel: string;
    snapshot: Record<string, unknown>;
  }>(
    ctx.client,
    `SELECT j."itemId" AS "sourceItemId",
            COALESCE(i."readableIdWithRevision", i."readableId", i.name)
              AS "affectedItemLabel",
            jsonb_build_object(
              'schema', 'JOB_SNAPSHOT_V1',
              'jobId', j.id,
              'itemId', j."itemId",
              'itemRevision', i.revision,
              'status', j.status,
              'plannedQuantity', j.quantity,
              'completedQuantity', j."quantityComplete",
              'remainingQuantity', GREATEST(j.quantity - j."quantityComplete", 0),
              'quantityShipped', j."quantityShipped",
              'quantityReceivedToInventory', j."quantityReceivedToInventory",
              'dueDate', j."dueDate"::text,
              'effectiveMethodId', root.id,
              'effectiveMethodVersion', root.version,
              'unitOfMeasureCode', j."unitOfMeasureCode",
              'eligibilityBasis', 'activeProducingJob'
            ) AS snapshot
     FROM job j
     JOIN item i ON i.id = j."itemId" AND i."companyId" = j."companyId"
     JOIN "jobMakeMethod" root ON root."jobId" = j.id
       AND root."companyId" = j."companyId"
       AND root."itemId" = j."itemId" AND root."parentMaterialId" IS NULL
     WHERE j.id = $1 AND j."companyId" = $2
       AND j.status IN ('Ready', 'In Progress')`,
    [jobId, ctx.companyId]
  );
  const source = matches[0];
  if (matches.length !== 1 || !source) {
    throw new Error(`Seed: expected one eligible root for job:${impact.job}`);
  }
  const affectedItemId = affectedIds.get(source.sourceItemId);
  if (!affectedItemId) {
    throw new Error(
      `Seed: job:${impact.job} item is not affected by this notice`
    );
  }
  const snapshot = JSON.stringify(source.snapshot);
  const decisionId = await insertId(ctx, "changeOrderImpactDecision", {
    changeNoticeId,
    targetType: "job",
    targetId: jobId,
    decisionStatus: "Action required",
    rationale: impact.rationale,
    assessmentSnapshot: snapshot,
    assessedBy: ctx.userId
  });
  await insertRow(ctx, "changeOrderImpactDecisionAffectedItem", {
    decisionId,
    affectedItemId,
    affectedItemSourceId: source.sourceItemId,
    affectedItemLabel: source.affectedItemLabel,
    startedBy: ctx.userId
  });
  await insertRow(ctx, "changeOrderImpactDecisionHistory", {
    decisionId,
    targetType: "job",
    targetId: jobId,
    eventType: "Decision created",
    newStatus: "Action required",
    newSnapshot: snapshot,
    rationale: impact.rationale
  });
  await insertRow(ctx, "changeOrderImpactDecisionHistory", {
    decisionId,
    targetType: "job",
    targetId: jobId,
    eventType: "Provenance started",
    newStatus: "Action required",
    newSnapshot: snapshot,
    rationale: impact.rationale,
    relatedAffectedItemId: affectedItemId
  });
  const taskId = await insertId(ctx, "changeOrderActionTask", {
    changeOrderId: changeNoticeId,
    name: impact.taskName,
    status: "Pending",
    actionTypeId: null,
    taskOrigin: "Impact follow-up",
    sortOrder
  });
  await insertRow(ctx, "changeOrderImpactDecisionActionTask", {
    decisionId,
    actionTaskId: taskId
  });
  await insertRow(ctx, "changeOrderImpactDecisionHistory", {
    decisionId,
    targetType: "job",
    targetId: jobId,
    eventType: "Task linked",
    relatedActionTaskId: taskId
  });
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
      openDate: resolveDate(ctx.anchor, spec.openDateOffset),
      changeOrderTypeId:
        spec.changeOrderType === undefined
          ? undefined
          : await bootstrapIdByName(
              ctx,
              "changeOrderType",
              spec.changeOrderType
            ),
      priority: spec.priority,
      dueDate:
        spec.dueDateOffset === undefined
          ? undefined
          : resolveDate(ctx.anchor, spec.dueDateOffset),
      reasonForChange:
        spec.reasonForChange === undefined
          ? undefined
          : RICH(spec.reasonForChange),
      nonConformanceId:
        spec.nonConformance === undefined
          ? undefined
          : need(ctx.refs.documents, spec.nonConformance, "NCR")
    });

    // Action tasks as setChangeNoticeActionTasks instantiates them from the
    // required-action templates: template id + name, 1-based sortOrder.
    for (const [taskIndex, task] of (spec.actionTasks ?? []).entries()) {
      await insertRow(ctx, "changeOrderActionTask", {
        changeOrderId: changeOrder,
        actionTypeId: await bootstrapIdByName(
          ctx,
          "changeOrderRequiredAction",
          task.action
        ),
        name: task.action,
        status: task.status,
        sortOrder: taskIndex + 1,
        assignee: task.status === "In Progress" ? ctx.userId : undefined,
        dueDate:
          task.dueDateOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, task.dueDateOffset),
        completedDate:
          task.completedOffset === undefined
            ? undefined
            : resolveDate(ctx.anchor, task.completedOffset)
      });
    }

    const affectedIds = new Map<string, string>();
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
          // both ends. A still-Draft base is promoted to Active first, as
          // createChangeNoticeDraftMethod does — otherwise the notice's higher
          // version outranks it in `activeMakeMethods` and its unreleased edits
          // reach quotes, jobs and MRP.
          await ctx.client.query(
            `UPDATE "makeMethod" SET status = 'Active', "updatedBy" = $3
     WHERE id = $1 AND "companyId" = $2 AND status = 'Draft'`,
            [base.id, ctx.companyId, ctx.userId]
          );
          const draftVersion = Number(base.version) + 1;
          const draft = await insertId(ctx, "makeMethod", {
            itemId: item.id,
            version: draftVersion,
            status: "Draft",
            changeOrderId: changeOrder
          });
          await copyMethodToMethod(ctx, base.id, draft);
          ctx.log(`  ${item.readableId} draft method v${draftVersion}`);
          draftMakeMethodId = draft;
          baseMakeMethodId = base.id;
          break;
        }

        case "Revision": {
          // A Revision mints a new revision of the item (HARNESS-001.A) and edits ITS
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
            // A new revision starts at its predecessor's cost.
            standardCost: item.unitCost,
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
          await copyMethodToMethod(ctx, base.id, draft);
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

      const affectedId = await insertId(ctx, "changeOrderAffectedItem", {
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
      affectedIds.set(item.id, affectedId);
    }

    for (const [impactIndex, impact] of (spec.impactJobs ?? []).entries()) {
      await seedImpactJob(
        ctx,
        changeOrder,
        affectedIds,
        impact,
        (spec.actionTasks?.length ?? 0) + impactIndex + 1
      );
    }

    ctx.refs.documents[spec.ref] = changeOrder;
  }
}
