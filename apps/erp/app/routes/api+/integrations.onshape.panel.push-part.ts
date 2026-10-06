// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import type {
  ItemEdit,
  PartPlan,
  PartPlanRow,
  PlanItemRow,
  ProposedItem
} from "@carbon/ee";
import {
  externalIdForPart,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  mergeExistingItemEdits,
  pickAdoptTarget,
  proposeItem
} from "@carbon/ee";
import {
  peekPanelPlan,
  selectInBatches,
  takePanelPlan
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { trigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertPart } from "~/modules/items";
import {
  applyItemManufacturingEdits,
  swapItemMapping
} from "~/modules/settings/onshape-push.server";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

// Loose on purpose: mergeItemEdits validates and answers 422 with per-row
// field errors, which a strict zod enum would turn into a bare 400.
const itemEditSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  replenishmentSystem: z.string().optional(),
  defaultMethodType: z.string().optional(),
  itemTrackingType: z.string().optional(),
  unitOfMeasureCode: z.string().optional()
});

const payloadSchema = z.object({
  planId: z.string().min(1),
  selected: z.array(z.string().min(1)).min(1).max(50),
  edits: z.record(z.string(), itemEditSchema).default({})
});

type ApplyResult = {
  partId: string;
  action: "created" | "adopted" | "updated" | "unchanged" | "skipped" | "error";
  itemId?: string;
  readableId?: string;
  message?: string;
};

/**
 * Apply a reviewed part plan: create or link the kept items, write the
 * mappings and queue the model export. Makes no Onshape call.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      create: "parts",
      update: "parts"
    }
  );

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { planId } = parsed.data;
  const selected = [...new Set(parsed.data.selected)];
  const edits = parsed.data.edits as Record<string, ItemEdit>;

  // Peek, not take: a 422 below must leave the plan in place for a retry.
  const stored = await peekPanelPlan(planId, { companyId, userId });
  if (!stored) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }
  if (stored.plan.kind !== "part") {
    return data({ error: "This review is not a part push" }, { status: 400 });
  }
  const plan: PartPlan = stored.plan;
  const { documentId, wv, wvId, elementId, options } = plan;
  const configuration = plan.configuration ?? null;

  const rowByPartId = new Map(plan.rows.map((row) => [row.partId, row]));
  const selectedRows = selected
    .map((partId) => rowByPartId.get(partId))
    .filter((row): row is PartPlanRow => !!row);

  const merged = mergeEditsForCreates(
    selectedRows
      .filter((row) => row.action === "create" && row.partNumber)
      .map((row) => ({ key: row.partId, proposed: proposedFor(row, plan) })),
    edits,
    options
  );
  const fieldErrors = merged.errors;
  if (fieldErrors.length > 0) {
    return data(
      { error: "Some edits are not valid", fieldErrors },
      { status: 422 }
    );
  }

  // One-shot from here: a concurrent apply of the same review finds nothing.
  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  // Re-resolve: a create whose number now exists adopts it instead, because
  // upsertPart reads its id back by readableId and can get another revision.
  const partNumbers = [
    ...new Set(
      selectedRows
        .map((row) => row.partNumber)
        .filter((number): number is string => !!number)
    )
  ];
  const targetItemIds = [
    ...new Set(
      selectedRows
        .filter((row) => row.action === "adopt" || row.action === "update")
        .map((row) => row.itemId)
        .filter((id): id is string => !!id)
    )
  ];
  const [byNumber, byId] = await Promise.all([
    selectInBatches(partNumbers, (batch) =>
      client
        .from("item")
        .select("id, readableId, revision, active, name, type")
        .eq("companyId", companyId)
        .in("readableId", batch)
        .order("revision")
    ),
    selectInBatches(targetItemIds, (batch) =>
      client
        .from("item")
        .select("id, readableId, revision, active, name, type")
        .eq("companyId", companyId)
        .in("id", batch)
    )
  ]);
  if (byNumber.error || byId.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const rowsByReadableId = new Map<string, PlanItemRow[]>();
  for (const item of (byNumber.data ?? []) as PlanItemRow[]) {
    const list = rowsByReadableId.get(item.readableId) ?? [];
    list.push(item);
    rowsByReadableId.set(item.readableId, list);
  }
  const itemById = new Map(
    ((byId.data ?? []) as PlanItemRow[]).map((item) => [item.id, item])
  );

  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();

  const resolveTarget = (row: PartPlanRow): PlanItemRow | undefined => {
    let target: PlanItemRow | undefined;
    if (row.action === "adopt" || row.action === "update") {
      target = row.itemId ? itemById.get(row.itemId) : undefined;
    }
    if (!target && row.partNumber) {
      target = pickAdoptTarget(
        rowsByReadableId.get(row.partNumber) ?? [],
        row.revision
      );
    }
    return target;
  };

  // part.id is the item's readableId, shared across revisions. The map is kept
  // current as the loop writes, so a later row cannot clobber a create.
  const partCustomFieldsByReadableId = new Map<string, unknown>();
  const ownedReadableIds = [
    ...new Set(
      selectedRows.flatMap((row) => {
        if (ownedCustomFieldValues(row) === null) return [];
        const ids: string[] = [];
        if (row.partNumber) ids.push(row.partNumber);
        const target = row.itemId ? itemById.get(row.itemId) : undefined;
        if (target) ids.push(target.readableId);
        return ids;
      })
    )
  ];
  const partRows = await selectInBatches(ownedReadableIds, (batch) =>
    client
      .from("part")
      .select("id, customFields")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (partRows.error) {
    return data({ error: "Failed to read Carbon parts" }, { status: 500 });
  }
  for (const partRow of partRows.data) {
    partCustomFieldsByReadableId.set(partRow.id, partRow.customFields);
  }

  const results: ApplyResult[] = [];

  for (const partId of selected) {
    const row = rowByPartId.get(partId);
    if (!row) {
      results.push({
        partId,
        action: "error",
        message: "Part is not in this review"
      });
      continue;
    }

    if (row.action === "skip-no-part-number") {
      results.push({
        partId,
        action: "skipped",
        message: "Set a part number in Onshape first"
      });
      continue;
    }

    if (row.action === "unchanged") {
      // The CAD is unchanged, but a reviewer edit to a manufacturing field is
      // still a real update. No mapping re-stamp and no export.
      const mfg = row.current
        ? mergeExistingItemEdits(row.current, edits[partId])
        : null;
      if (mfg && !mfg.ok) {
        results.push({
          partId,
          action: "error",
          message: mfg.errors.join("; ")
        });
        continue;
      }
      if (mfg?.ok && Object.keys(mfg.changed).length > 0 && row.itemId) {
        const error = await applyItemManufacturingEdits(client, db, {
          itemId: row.itemId,
          companyId,
          userId,
          changed: mfg.changed
        });
        if (error) {
          results.push({ partId, action: "error", message: error });
          continue;
        }
        results.push({
          partId,
          action: "updated",
          itemId: row.itemId,
          readableId: row.item?.readableId
        });
        continue;
      }
      results.push({
        partId,
        action: "unchanged",
        itemId: row.itemId ?? undefined,
        readableId: row.item?.readableId
      });
      continue;
    }

    const target = resolveTarget(row);
    const resolved: "create" | "adopt" | "update" = target
      ? row.action === "update" && target.id === row.itemId
        ? "update"
        : "adopt"
      : "create";

    let itemId: string;
    let readableId: string;
    if (resolved === "create") {
      const item = merged.items.get(row.partId) ?? proposedFor(row, plan);
      const fieldValues = planCustomFieldValues(row);
      const created = await upsertPart(client, {
        id: item.readableId,
        name: item.name,
        description: item.description ?? undefined,
        revision: item.revision,
        replenishmentSystem: item.replenishmentSystem,
        defaultMethodType: item.defaultMethodType,
        itemTrackingType: item.itemTrackingType,
        unitOfMeasureCode: item.unitOfMeasureCode,
        companyId,
        createdBy: userId,
        ...(Object.keys(fieldValues).length > 0 && {
          customFields: fieldValues
        })
        // partValidator carries many optional form-only fields the panel never sets
      } as any);
      if (created.error || !created.data) {
        results.push({
          partId,
          action: "error",
          message: created.error?.message ?? "Failed to create the item"
        });
        continue;
      }
      itemId = created.data.id as string;
      readableId = item.readableId;
      // A later row with the same number adopts this item, not a second create.
      rowsByReadableId.set(readableId, [
        ...(rowsByReadableId.get(readableId) ?? []),
        {
          id: itemId,
          readableId,
          revision: item.revision,
          name: item.name,
          type: "Part"
        }
      ]);
      if (Object.keys(fieldValues).length > 0) {
        partCustomFieldsByReadableId.set(readableId, fieldValues);
      }
    } else {
      itemId = (target as PlanItemRow).id;
      readableId = (target as PlanItemRow).readableId;
      const mfg = row.current
        ? mergeExistingItemEdits(row.current, edits[partId])
        : null;
      if (mfg && !mfg.ok) {
        results.push({
          partId,
          action: "error",
          message: mfg.errors.join("; ")
        });
        continue;
      }
      const updated = await client
        .from("item")
        .update({ ...ownedFields(row), updatedBy: userId })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (updated.error) {
        results.push({
          partId,
          action: "error",
          message: updated.error.message
        });
        continue;
      }
      if (mfg?.ok && Object.keys(mfg.changed).length > 0) {
        const error = await applyItemManufacturingEdits(client, db, {
          itemId,
          companyId,
          userId,
          changed: mfg.changed
        });
        if (error) {
          results.push({ partId, action: "error", message: error });
          continue;
        }
      }
      const owned = ownedCustomFieldValues(row);
      if (owned) {
        const mergedFields = mergeCustomFieldValues(
          partCustomFieldsByReadableId.get(readableId),
          owned.values,
          owned.fieldIds
        );
        const partUpdate = await client
          .from("part")
          .update({
            customFields: mergedFields as Json,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .eq("id", readableId)
          .eq("companyId", companyId);
        if (partUpdate.error) {
          results.push({
            partId,
            action: "error",
            message: partUpdate.error.message
          });
          continue;
        }
        partCustomFieldsByReadableId.set(readableId, mergedFields);
      }
    }

    const externalId = externalIdForPart(
      documentId,
      elementId,
      partId,
      configuration
    );
    const now = datetime.timestamp();
    const linked = await swapItemMapping(db, {
      companyId,
      userId,
      itemId,
      externalId,
      metadata: {
        documentId,
        elementId,
        partId,
        configuration,
        wv,
        wvId,
        // The reviewed microversion: a later plan's only "unchanged" signal.
        microversionId: row.microversionId,
        partNumber: row.partNumber,
        name: row.name,
        revision: row.revision,
        pushedBy: userId,
        pushedAt: now,
        planId
      }
    });
    if (linked.error !== null) {
      results.push({
        partId,
        action: "error",
        message: "Item saved but the Onshape link failed; push again"
      });
      continue;
    }

    if (row.cadUnchanged && resolved === "update") {
      results.push({ partId, action: "updated", itemId, readableId });
      continue;
    }

    // Deterministic id: a retried apply cannot queue the export twice.
    try {
      await trigger(
        "onshape-panel-sync",
        {
          companyId,
          userId,
          itemId,
          documentId,
          wvm: wv,
          wvmId: wvId,
          elementId,
          elementKind: "partstudio",
          partId,
          ...(configuration ? { configuration } : {}),
          ...(wv === "w" && row.microversionId
            ? { microversionId: row.microversionId }
            : {}),
          assetBaseName: row.partNumber ?? row.name
        },
        { id: `${planId}:${itemId}:${elementId}` }
      );
    } catch (error) {
      // Roll the mapping back so the next plan does not read "unchanged" and
      // skip the export. Delete by id, not externalId: a concurrent push may
      // already have replaced this row with its own.
      const rolledBack = await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .eq("companyId", companyId)
        .eq("id", linked.id);
      results.push({
        partId,
        action: "error",
        itemId,
        readableId,
        message: rolledBack.error
          ? `Item saved but the model export could not be queued, and the Onshape link could not be rolled back (${rolledBack.error.message}); detach this item before pushing again`
          : `Item saved but the model export could not be queued; push again (${
              error instanceof Error ? error.message : "event send failed"
            })`
      });
      continue;
    }

    results.push({
      partId,
      action:
        resolved === "create"
          ? "created"
          : resolved === "adopt"
            ? "adopted"
            : "updated",
      itemId,
      readableId
    });
  }

  return data(
    { results },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}

/** The plan's proposal, or one built from the row when the target vanished. */
function proposedFor(row: PartPlanRow, plan: PartPlan): ProposedItem {
  if (row.proposed) return row.proposed;
  return proposeItem(
    {
      partNumber: row.partNumber as string,
      name: row.name,
      description: row.description,
      revision: row.revision
    },
    plan.options
  );
}

/** Onshape owns name and description; adopt/update takes the plan's values. */
function ownedFields(row: PartPlanRow): {
  name: string;
  description: string | null;
} {
  if (row.action === "create") {
    return { name: row.name, description: row.proposed?.description ?? null };
  }
  return { name: row.name, description: row.description };
}

/** Every mapped value a create writes, keyed by field id (nulls dropped). */
function planCustomFieldValues(
  row: PartPlanRow
): Record<string, string | number | boolean | null> {
  const values: Record<string, string | number | boolean | null> = {};
  for (const field of row.customFields ?? []) {
    if (field.value !== null) values[field.fieldId] = field.value;
  }
  return values;
}

/** Owned-mode values for an adopt/update, or null when the row has none. */
function ownedCustomFieldValues(row: PartPlanRow): {
  values: Record<string, string | number | boolean | null>;
  fieldIds: Set<string>;
} | null {
  const values: Record<string, string | number | boolean | null> = {};
  const fieldIds = new Set<string>();
  for (const field of row.customFields ?? []) {
    if (field.mode !== "owned") continue;
    // A null deletes the key, so a value emptied in Onshape empties in Carbon.
    values[field.fieldId] = field.value;
    fieldIds.add(field.fieldId);
  }
  return fieldIds.size > 0 ? { values, fieldIds } : null;
}
