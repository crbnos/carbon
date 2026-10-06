// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type {
  ItemEdit,
  ItemFieldSnapshot,
  OnshapeBomNode,
  OwnedFieldChange,
  ProposedItem
} from "@carbon/ee";
import {
  bomLineItemType,
  defaultUnitOfMeasureCode,
  externalIdForAssembly,
  externalIdForBomLine,
  flattenNodes,
  mappedFieldValues,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  mergeExistingItemEdits,
  normalizeConfiguration,
  ownedCustomFieldsDiffer,
  pickReuseRow,
  proposeItem
} from "@carbon/ee";
import type { ManualLineRow, MappedLineRow } from "@carbon/ee/onshape";
import {
  chunkFilterValues,
  loadActiveMakeMethods,
  loadMethodLineOwnership,
  loadReusableDrafts,
  ONSHAPE_V2_INTEGRATION_ID,
  peekPanelPlan,
  selectInBatches,
  takePanelPlan
} from "@carbon/ee/onshape";
import { requireOnshapePanelPermissions } from "@carbon/ee/onshape/panel-session.server";
import { trigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertPart } from "~/modules/items";
import { ensureDraftMakeMethod } from "~/modules/settings/onshape-draft-method.server";
import {
  applyItemManufacturingEdits,
  claimManualMethodLine,
  insertOwnedMethodLines,
  type OwnedMethodLine,
  swapItemMapping
} from "~/modules/settings/onshape-push.server";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

// Values are validated by mergeItemEdits so a bad one is a 422 naming the row.
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
  edits: z.record(z.string(), itemEditSchema).default({}),
  excluded: z.array(z.string().min(1)).default([])
});

type PushSummary = {
  assemblyItemId: string | null;
  itemsCreated: number;
  itemsReused: number;
  linesWritten: number;
  linesUnchanged: number;
  /** Manual lines now following Onshape; also counted in `linesWritten`. */
  linesTakenOver: number;
  descriptionsUpdated: number;
  methodsTouched: number;
  /** Levels written into a new Draft; nothing is live until someone releases it. */
  draftVersionsCreated: string[];
  skipped: string[];
  errors: string[];
};

type ItemRow = {
  id: string;
  readableId: string;
  revision: string | null;
  active?: boolean | null;
  type: string | null;
  defaultMethodType: string | null;
  unitOfMeasureCode: string | null;
};

/**
 * Apply a reviewed assembly plan (`plan-assembly`) to Carbon without calling Onshape.
 * Items are re-resolved by part number first: `upsertPart` reads the new id back by
 * readableId, so a number that appeared since the plan must become a reuse.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requireOnshapePanelPermissions(
    request,
    {
      create: "parts",
      update: "parts",
      // Re-pushing replaces the BOM lines an earlier push wrote.
      delete: "parts"
    }
  );

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { planId } = parsed.data;
  const edits = parsed.data.edits as Record<string, ItemEdit>;
  const excluded = new Set(parsed.data.excluded);

  // Peek, not take: a 422 on the edits must leave the plan for a retry.
  const stored = await peekPanelPlan(planId, { companyId, userId });
  if (!stored) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }
  if (stored.plan.kind !== "assembly") {
    return data(
      { error: "This review is not an assembly push" },
      { status: 400 }
    );
  }
  const plan = stored.plan;
  const { documentId, wv, wvId, elementId, root, options } = plan;
  const configuration = plan.configuration ?? null;

  if (excluded.has(root.partNumber)) {
    return data(
      { error: "The assembly itself cannot be excluded" },
      { status: 400 }
    );
  }

  // ---- Merge edits before any write ----
  const creates: Array<{ key: string; proposed: ProposedItem }> = [];
  if (root.action === "create" && root.proposed) {
    creates.push({ key: root.partNumber, proposed: root.proposed });
  }
  for (const item of plan.items) {
    if (
      item.action === "create" &&
      item.proposed &&
      !excluded.has(item.partNumber)
    ) {
      creates.push({ key: item.partNumber, proposed: item.proposed });
    }
  }
  const merged = mergeEditsForCreates(creates, edits, options);
  const rootFields = root.customFields ?? [];
  const rootFieldValues = mappedFieldValues(rootFields);
  if (merged.errors.length > 0) {
    return data(
      { error: "Some edits are not valid", fieldErrors: merged.errors },
      { status: 422 }
    );
  }

  if (!(await takePanelPlan(planId, { companyId, userId }))) {
    return data(
      { error: "This review has expired — review again" },
      { status: 410 }
    );
  }

  const summary: PushSummary = {
    assemblyItemId: null,
    itemsCreated: 0,
    itemsReused: 0,
    linesWritten: 0,
    linesUnchanged: 0,
    linesTakenOver: 0,
    descriptionsUpdated: 0,
    methodsTouched: 0,
    draftVersionsCreated: [],
    skipped: [...plan.skipped],
    errors: []
  };
  for (const item of plan.items) {
    if (excluded.has(item.partNumber)) {
      summary.skipped.push(`${item.partNumber}: excluded`);
    }
  }

  // ---- Re-resolve, then ensure items ----
  const includedItems = plan.items.filter(
    (item) => !excluded.has(item.partNumber)
  );
  const partNumbers = [
    ...new Set([root.partNumber, ...includedItems.map((i) => i.partNumber)])
  ];
  const existing = await selectInBatches(partNumbers, (batch) =>
    client
      .from("item")
      .select(
        "id, readableId, revision, active, type, defaultMethodType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  const rowsByReadableId = new Map<string, ItemRow[]>();
  for (const row of (existing.data ?? []) as ItemRow[]) {
    const list = rowsByReadableId.get(row.readableId) ?? [];
    list.push(row);
    rowsByReadableId.set(row.readableId, list);
  }

  // A reuse whose row vanished becomes a create, described from the BOM row.
  const allNodes = flattenNodes(plan.nodes);
  const nodeByPartNumber = new Map<string, OnshapeBomNode>();
  for (const node of allNodes) {
    if (node.partNumber && !nodeByPartNumber.has(node.partNumber)) {
      nodeByPartNumber.set(node.partNumber, node);
    }
  }

  const itemByReadableId = new Map<string, ItemRow>();
  const fallbackUnit = defaultUnitOfMeasureCode(options);

  const currentByPartNumber = new Map<string, ItemFieldSnapshot>();
  if (root.current) currentByPartNumber.set(root.partNumber, root.current);
  for (const item of plan.items) {
    if (item.current) currentByPartNumber.set(item.partNumber, item.current);
  }
  const textByPartNumber = new Map<
    string,
    { itemId: string | null; text: { name?: string; description?: string } }
  >();
  const plannedText = (changes: OwnedFieldChange[] | undefined) => {
    const text: { name?: string; description?: string } = {};
    for (const change of changes ?? []) {
      if (change.to !== null) text[change.field] = change.to;
    }
    return text;
  };
  if (root.changes?.length) {
    textByPartNumber.set(root.partNumber, {
      itemId: root.itemId,
      text: plannedText(root.changes)
    });
  }
  for (const item of plan.items) {
    if (item.changes?.length) {
      textByPartNumber.set(item.partNumber, {
        itemId: item.itemId,
        text: plannedText(item.changes)
      });
    }
  }

  const ensureItem = async (
    partNumber: string,
    plannedItemId: string | null,
    propose: () => ProposedItem,
    customFields?: Record<string, unknown>
  ): Promise<ItemRow | null> => {
    const rows = rowsByReadableId.get(partNumber) ?? [];
    const found =
      rows.find((row) => row.id === plannedItemId) ??
      pickReuseRow(rows) ??
      null;
    if (found) {
      itemByReadableId.set(partNumber, found);
      summary.itemsReused += 1;
      if (plannedItemId === null) {
        summary.skipped.push(
          `${partNumber}: added to Carbon since the review; reused as is`
        );
      }
      // A reused item still takes the reviewer's manufacturing edits and the
      // reviewed descriptions, but only on the row the review was about.
      const baseline = currentByPartNumber.get(partNumber);
      const mfg = baseline
        ? mergeExistingItemEdits(baseline, edits[partNumber])
        : null;
      if (mfg && !mfg.ok) {
        summary.errors.push(`${partNumber}: ${mfg.errors.join("; ")}`);
      }
      const planned = textByPartNumber.get(partNumber);
      const text = planned && planned.itemId === found.id ? planned.text : {};
      if (Object.keys(text).length > 0) {
        const updated = await client
          .from("item")
          .update({ ...text, updatedBy: userId })
          .eq("id", found.id)
          .eq("companyId", companyId);
        if (updated.error) {
          summary.errors.push(`${partNumber}: ${updated.error.message}`);
        } else {
          summary.descriptionsUpdated += 1;
        }
      }
      if (mfg?.ok && Object.keys(mfg.changed).length > 0) {
        const error = await applyItemManufacturingEdits(client, db, {
          itemId: found.id,
          companyId,
          userId,
          changed: mfg.changed
        });
        if (error) summary.errors.push(`${partNumber}: ${error}`);
      }
      return found;
    }

    const item = merged.items.get(partNumber) ?? propose();
    const created = await upsertPart(client, {
      id: item.readableId,
      name: item.name,
      description: item.description ?? undefined,
      revision: item.revision,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      itemTrackingType: item.itemTrackingType,
      unitOfMeasureCode: item.unitOfMeasureCode,
      ...(customFields && Object.keys(customFields).length > 0
        ? { customFields: customFields as Json }
        : {}),
      companyId,
      createdBy: userId
      // partValidator carries many optional form-only fields the panel never sets
    } as any);
    if (created.error || !created.data) {
      summary.errors.push(
        `${partNumber}: ${created.error?.message ?? "failed to create"}`
      );
      return null;
    }
    const row: ItemRow = {
      id: created.data.id as string,
      readableId: partNumber,
      revision: item.revision,
      type: "Part",
      defaultMethodType: item.defaultMethodType,
      unitOfMeasureCode: item.unitOfMeasureCode
    };
    itemByReadableId.set(partNumber, row);
    summary.itemsCreated += 1;
    return row;
  };

  // ---- Root custom fields (children get theirs from their own part push) ----
  // Mirrors ensureItem's row pick so the values are known before any write.
  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();
  const rootRows = rowsByReadableId.get(root.partNumber) ?? [];
  const rootWillReuse = Boolean(
    rootRows.find((row) => row.id === root.itemId) ?? pickReuseRow(rootRows)
  );
  const rootOwnedFieldIds = new Set(
    rootFields
      .filter((field) => field.mode === "owned")
      .map((field) => field.fieldId)
  );
  const rootAllFieldIds = new Set(rootFields.map((field) => field.fieldId));
  const rootValuesToWrite = mergeCustomFieldValues(
    {},
    rootFieldValues,
    rootWillReuse ? rootOwnedFieldIds : rootAllFieldIds
  );

  const rootItem = await ensureItem(
    root.partNumber,
    root.itemId,
    () =>
      proposeItem(
        {
          partNumber: root.partNumber,
          name: root.name,
          description: root.description,
          revision: root.revision,
          purchased: false
        },
        options
      ),
    rootValuesToWrite
  );
  if (!rootItem) {
    return data(
      { error: summary.errors.join("; ") || "Failed to create the assembly" },
      { status: 500 }
    );
  }
  summary.assemblyItemId = rootItem.id;

  // `part` is keyed by readableId. Owned fields with no Onshape value still
  // run, because the merge clears them.
  if (rootWillReuse && rootOwnedFieldIds.size > 0) {
    const currentPart = await client
      .from("part")
      .select("customFields")
      .eq("id", root.partNumber)
      .eq("companyId", companyId)
      .maybeSingle();
    if (currentPart.error) {
      summary.errors.push(
        `${root.partNumber}: failed to read custom fields (${currentPart.error.message})`
      );
    } else if (
      ownedCustomFieldsDiffer(currentPart.data?.customFields, rootFields)
    ) {
      const mergedRootFields = mergeCustomFieldValues(
        currentPart.data?.customFields,
        rootFieldValues,
        rootOwnedFieldIds
      );
      const updatedPart = await client
        .from("part")
        .update({
          customFields: mergedRootFields as Json,
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .eq("id", root.partNumber)
        .eq("companyId", companyId);
      if (updatedPart.error) {
        summary.errors.push(
          `${root.partNumber}: failed to write custom fields (${updatedPart.error.message})`
        );
      }
    }
  }

  for (const item of includedItems) {
    await ensureItem(item.partNumber, item.itemId, () =>
      proposeItem(
        {
          partNumber: item.partNumber,
          name: item.name,
          description: nodeByPartNumber.get(item.partNumber)?.description,
          revision: item.revision,
          // Sub-assemblies are made even when the BOM row says purchased, as in the plan.
          purchased: item.purchased && !item.isAssembly
        },
        options
      )
    );
  }

  // ---- Apply BOM lines to make methods, one level at a time ----
  const isAssemblyByPartNumber = new Map(
    plan.items.map((item) => [item.partNumber, item.isAssembly])
  );

  // Sub-assemblies are included even without lines this push: a line points at
  // its child's method, and a null pointer would flatten a `top` push's tree.
  const parentItemIds = [
    ...new Set(
      [
        ...plan.methods.map(
          (method) => itemByReadableId.get(method.parentPartNumber)?.id
        ),
        ...plan.items
          .filter((item) => item.isAssembly)
          .map((item) => itemByReadableId.get(item.partNumber)?.id)
      ].filter((id): id is string => !!id)
    )
  ];
  // A failed read must stop the writes, or a `top` push writes null child pointers.
  let methodByItemId: Awaited<ReturnType<typeof loadActiveMakeMethods>>;
  try {
    methodByItemId = await loadActiveMakeMethods(
      client,
      companyId,
      parentItemIds
    );
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the make methods"
      },
      { status: 500 }
    );
  }
  // Resolve each level's target method before reading ownership. A released
  // method is never edited, so the push writes into a Draft, and ownership is
  // keyed by method id: a Draft made after that read would duplicate every line.
  const targetMethodByItemId = new Map<string, string>();
  const methodErrorByItemId = new Map<string, string>();
  const activeMethodIdByItemId = new Map<string, string>();
  for (const planned of plan.methods) {
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    const method = parentItem ? methodByItemId.get(parentItem.id) : undefined;
    if (parentItem && method?.status === "Active") {
      activeMethodIdByItemId.set(parentItem.id, method.id);
    }
  }
  let reusableDraftByItemId: Awaited<ReturnType<typeof loadReusableDrafts>>;
  try {
    reusableDraftByItemId = await loadReusableDrafts(
      client,
      serviceRole,
      companyId,
      activeMethodIdByItemId
    );
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error ? error.message : "Failed to read the Drafts"
      },
      { status: 500 }
    );
  }
  for (const planned of plan.methods) {
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    if (!parentItem) continue;
    if (targetMethodByItemId.has(parentItem.id)) continue;
    const method = methodByItemId.get(parentItem.id);
    if (!method) continue; // reported in the write loop
    if (method.status !== "Active") {
      targetMethodByItemId.set(parentItem.id, method.id);
      continue;
    }
    const draft = await ensureDraftMakeMethod(client, {
      itemId: parentItem.id,
      activeMethodId: method.id,
      companyId,
      userId,
      reusableDraft: reusableDraftByItemId.get(parentItem.id) ?? null
    });
    if (!draft.ok) {
      methodErrorByItemId.set(parentItem.id, draft.error);
      continue;
    }
    targetMethodByItemId.set(parentItem.id, draft.id);
    if (draft.created) {
      summary.draftVersionsCreated.push(
        draft.version === null
          ? planned.parentPartNumber
          : `${planned.parentPartNumber} (version ${draft.version})`
      );
    }
  }

  // A failed read must stop the writes, or every Onshape line is duplicated.
  let ownership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    ownership = await loadMethodLineOwnership(client, serviceRole, companyId, [
      ...new Set([
        ...[...methodByItemId.values()].map((method) => method.id),
        ...targetMethodByItemId.values()
      ])
    ]);
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to read the existing BOM lines"
      },
      { status: 500 }
    );
  }

  for (const planned of plan.methods) {
    const parentLabel = planned.parentPartNumber;
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    if (!parentItem) continue;

    const method = methodByItemId.get(parentItem.id);
    if (!method) {
      summary.errors.push(`${parentLabel}: no make method found`);
      continue;
    }
    const methodId = targetMethodByItemId.get(parentItem.id);
    if (!methodId) {
      summary.errors.push(
        `${parentLabel}: ${methodErrorByItemId.get(parentItem.id) ?? "no make method to write to"}`
      );
      continue;
    }

    // Owned lines are reconciled in place, not rebuilt, so Carbon-owned columns
    // (operation, scrap, tags, kit, customFields) survive. They pair by item id,
    // FIFO, so a component listed twice keeps both lines.
    const reusableByItemId = new Map<string, MappedLineRow[]>();
    for (const row of ownership.mappedRows.get(methodId) ?? []) {
      const queue = reusableByItemId.get(row.itemId) ?? [];
      queue.push(row);
      reusableByItemId.set(row.itemId, queue);
    }
    // Manual lines pair by part number in line order, as `pairManualLines` did.
    const manualByReadableId = new Map<string, ManualLineRow[]>();
    for (const row of ownership.manualRows.get(methodId) ?? []) {
      const queue = manualByReadableId.get(row.readableId) ?? [];
      queue.push(row);
      manualByReadableId.set(row.readableId, queue);
    }
    // Mapping rows this method still owns; any other is cleared as an orphan.
    const liveMappingIds: string[] = [];
    const pendingInserts: Array<{
      row: OwnedMethodLine["row"];
      metadata: Record<string, unknown>;
    }> = [];

    summary.methodsTouched += 1;

    let order = 0;
    for (const write of planned.writes) {
      if (excluded.has(write.partNumber)) continue;
      const childItem = itemByReadableId.get(write.partNumber);
      if (!childItem) continue;

      const itemType = bomLineItemType(childItem);
      if (!itemType) {
        summary.errors.push(
          `${parentLabel} → ${write.partNumber}: a ${childItem.type ?? "Part"} cannot be a BOM line`
        );
        continue;
      }

      const childMade = isAssemblyByPartNumber.get(write.partNumber) === true;
      const childMethod = childMade ? methodByItemId.get(childItem.id) : null;
      const lineSyncedAt = datetime.timestamp();
      const lineMetadata = {
        makeMethodId: methodId,
        documentId,
        elementId,
        partNumber: write.partNumber,
        index: write.index
      };

      // Only quantity, order and the child-method pointer are Onshape's.
      // `methodType` and `unitOfMeasureCode` come from the item, at create only.
      const reuse = reusableByItemId.get(childItem.id)?.shift();
      if (reuse) {
        // Skip unchanged lines so the audit trail does not show an edit.
        const unchanged =
          reuse.quantity === write.quantity &&
          reuse.order === order &&
          reuse.materialMakeMethodId === (childMethod?.id ?? null);
        if (unchanged) {
          liveMappingIds.push(reuse.mappingId);
          order += 1;
          summary.linesUnchanged += 1;
          continue;
        }
        const updated = await client
          .from("methodMaterial")
          .update({
            quantity: write.quantity,
            materialMakeMethodId: childMethod?.id ?? null,
            order,
            updatedBy: userId,
            updatedAt: lineSyncedAt
          })
          .eq("id", reuse.lineId)
          .eq("companyId", companyId);
        if (updated.error) {
          summary.errors.push(
            `${parentLabel} → ${write.partNumber}: ${updated.error.message}`
          );
          // Keep its ownership row, or the next push reads it as manual.
          liveMappingIds.push(reuse.mappingId);
          order += 1;
          continue;
        }
        const remapped = await serviceRole
          .from("externalIntegrationMapping")
          .update({
            metadata: lineMetadata,
            lastSyncedAt: lineSyncedAt,
            updatedBy: userId,
            updatedAt: lineSyncedAt
          })
          .eq("id", reuse.mappingId)
          .eq("companyId", companyId);
        if (remapped.error) {
          summary.errors.push(
            `${parentLabel} → ${write.partNumber}: line updated but its Onshape link was not refreshed (${remapped.error.message})`
          );
        }
        liveMappingIds.push(reuse.mappingId);
        order += 1;
        summary.linesWritten += 1;
        continue;
      }

      // Same item type only: a Material sharing a Part's number is a different item.
      const queue = manualByReadableId.get(write.partNumber);
      const claimIndex =
        queue?.findIndex((row) => !row.itemType || row.itemType === itemType) ??
        -1;
      const claim =
        queue && claimIndex >= 0 ? queue.splice(claimIndex, 1)[0] : undefined;
      if (claim) {
        const claimed = await claimManualMethodLine(db, {
          companyId,
          userId,
          lineId: claim.lineId,
          update: {
            itemId: childItem.id,
            quantity: write.quantity,
            order,
            materialMakeMethodId: childMethod?.id ?? null
          },
          metadata: lineMetadata
        });
        if (claimed.error !== null) {
          summary.errors.push(
            `${parentLabel} → ${write.partNumber}: the line added by hand was not taken over (${claimed.error})`
          );
          continue;
        }
        liveMappingIds.push(claimed.mappingId);
        order += 1;
        summary.linesWritten += 1;
        summary.linesTakenOver += 1;
        continue;
      }

      pendingInserts.push({
        row: {
          itemId: childItem.id,
          quantity: write.quantity,
          makeMethodId: methodId,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as OwnedMethodLine["row"]["methodType"]) ??
            (write.purchased ? "Pull from Inventory" : "Make to Order"),
          order,
          itemType,
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? fallbackUnit
        },
        metadata: lineMetadata
      });
      order += 1;
    }

    if (pendingInserts.length > 0) {
      const written = await insertOwnedMethodLines(db, {
        companyId,
        userId,
        lines: pendingInserts.map((pending) => ({
          row: pending.row,
          metadata: pending.metadata
        }))
      });
      if (written.error !== null) {
        summary.errors.push(
          `${parentLabel}: ${pendingInserts.length} new lines were not written (${written.error})`
        );
      } else {
        summary.linesWritten += pendingInserts.length;
        liveMappingIds.push(...written.mappingIds);
      }
    }

    // Anything still queued is a component the Onshape BOM no longer has.
    const removed = [...reusableByItemId.values()].flat();
    if (removed.length > 0) {
      for (const batch of chunkFilterValues(removed.map((row) => row.lineId))) {
        const removedLines = await client
          .from("methodMaterial")
          .delete()
          .eq("companyId", companyId)
          .in("id", batch);
        if (removedLines.error) {
          summary.errors.push(
            `${parentLabel}: could not remove the lines Onshape no longer lists (${removedLines.error.message})`
          );
          // Keep their mapping rows, or the leftover lines look manual and stay forever.
          const failed = new Set(batch);
          for (const row of removed) {
            if (failed.has(row.lineId)) liveMappingIds.push(row.mappingId);
          }
        }
      }
    }

    // Orphans are found here, not with a `not in` filter, which would put every
    // live id in the URL and outgrow the request line.
    const methodMappings = await serviceRole
      .from("externalIntegrationMapping")
      .select("id")
      .eq("companyId", companyId)
      .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
      .eq("entityType", "methodMaterial")
      .eq("metadata->>makeMethodId", methodId);
    if (methodMappings.error) {
      summary.errors.push(
        `${parentLabel}: could not read the existing line ownership records (${methodMappings.error.message})`
      );
    } else {
      const live = new Set(liveMappingIds);
      const orphaned = (methodMappings.data ?? [])
        .map((row) => row.id)
        .filter((id) => !live.has(id));
      for (const batch of chunkFilterValues(orphaned)) {
        const clearedMappings = await serviceRole
          .from("externalIntegrationMapping")
          .delete()
          .eq("companyId", companyId)
          .in("id", batch);
        if (clearedMappings.error) {
          summary.errors.push(
            `${parentLabel}: could not clear orphaned line ownership records (${clearedMappings.error.message})`
          );
        }
      }
    }
  }

  // ---- Assembly item mapping + child part links ----
  const pushedAt = datetime.timestamp();
  const assemblyExternalId = externalIdForAssembly(
    documentId,
    elementId,
    configuration
  );
  const assemblyMapping = await swapItemMapping(db, {
    companyId,
    userId,
    itemId: rootItem.id,
    externalId: assemblyExternalId,
    metadata: {
      documentId,
      elementId,
      configuration,
      wv,
      wvId,
      kind: "assembly",
      partNumber: root.partNumber,
      name: root.name,
      pushedBy: userId,
      pushedAt,
      planId
    }
  });
  if (assemblyMapping.error !== null) {
    summary.errors.push(
      `${root.partNumber}: pushed, but not linked to Onshape (${assemblyMapping.error}); the next push will not recognise it`
    );
  }

  const childLinkProblems = await linkChildParts(client, serviceRole, {
    companyId,
    userId,
    nodes: allNodes,
    itemByReadableId
  });
  summary.errors.push(...childLinkProblems);

  // The event id dedupes a retried apply. The writes have landed, so a queue
  // failure is a partial success.
  try {
    await trigger(
      "onshape-panel-sync",
      {
        companyId,
        userId,
        itemId: rootItem.id,
        documentId,
        wvm: wv,
        wvmId: wvId,
        elementId,
        elementKind: "assembly",
        ...(configuration ? { configuration } : {}),
        assetBaseName: root.partNumber
      },
      { id: `${planId}:${rootItem.id}:${elementId}` }
    );
  } catch {
    summary.errors.push(
      `${root.partNumber}: pushed, but the model export couldn't be queued. Push again to retry the export.`
    );
  }

  return data({ summary }, { headers: { "Cache-Control": "no-store" } });
}

async function linkChildParts(
  client: SupabaseClient<Database>,
  serviceRole: SupabaseClient<Database>,
  input: {
    companyId: string;
    userId: string;
    nodes: OnshapeBomNode[];
    itemByReadableId: Map<string, { id: string; readableId: string }>;
  }
) {
  // An item with any Onshape link keeps it (a part push owns that link), and an
  // externalId already in use is never claimed twice.
  const candidates: Array<{
    itemId: string;
    externalId: string;
    partNumber: string;
    source: NonNullable<OnshapeBomNode["itemSource"]>;
  }> = [];
  const seen = new Set<string>();
  for (const node of input.nodes) {
    const source = node.itemSource;
    if (!node.partNumber) continue;
    const externalId = externalIdForBomLine(source);
    if (!source || !externalId) continue;
    const item = input.itemByReadableId.get(node.partNumber);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    candidates.push({
      itemId: item.id,
      externalId,
      partNumber: node.partNumber,
      source
    });
  }
  if (candidates.length === 0) return [];

  // One Onshape source claimed by two items is reported, not guessed at.
  const itemsByExternalId = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const items = itemsByExternalId.get(candidate.externalId) ?? new Set();
    items.add(candidate.itemId);
    itemsByExternalId.set(candidate.externalId, items);
  }
  const problems: string[] = [];
  const ambiguous = new Set(
    [...itemsByExternalId.entries()]
      .filter(([, items]) => items.size > 1)
      .map(([externalId]) => externalId)
  );
  for (const externalId of ambiguous) {
    const numbers = candidates
      .filter((candidate) => candidate.externalId === externalId)
      .map((candidate) => candidate.partNumber);
    problems.push(
      `${numbers.join(" and ")} come from the same Onshape part, so neither was linked to it`
    );
  }
  const unambiguous = candidates.filter(
    (candidate) => !ambiguous.has(candidate.externalId)
  );
  if (unambiguous.length === 0) return problems;

  const [byEntity, byExternal] = await Promise.all([
    selectInBatches(
      unambiguous.map((candidate) => candidate.itemId),
      (batch) =>
        serviceRole
          .from("externalIntegrationMapping")
          .select("entityId")
          .eq("companyId", input.companyId)
          .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
          .eq("entityType", "item")
          .in("entityId", batch)
    ),
    selectInBatches(
      unambiguous.map((candidate) => candidate.externalId),
      (batch) =>
        serviceRole
          .from("externalIntegrationMapping")
          .select("externalId")
          .eq("companyId", input.companyId)
          .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
          .eq("entityType", "item")
          .in("externalId", batch)
    )
  ]);
  // These reads are guards: treating a failed read as empty would claim links
  // a part push already owns.
  if (byEntity.error || byExternal.error) {
    return [
      ...problems,
      `child parts were not linked to Onshape: ${
        (byEntity.error ?? byExternal.error)?.message ?? "lookup failed"
      }`
    ];
  }
  const linkedItemIds = new Set(
    (byEntity.data ?? []).map((row) => row.entityId)
  );
  const usedExternalIds = new Set(
    (byExternal.data ?? []).map((row) => row.externalId)
  );

  const linkedAt = datetime.timestamp();
  const rows = unambiguous
    .filter(
      (candidate) =>
        !linkedItemIds.has(candidate.itemId) &&
        !usedExternalIds.has(candidate.externalId)
    )
    .map((candidate) => ({
      entityType: "item" as const,
      entityId: candidate.itemId,
      integration: ONSHAPE_V2_INTEGRATION_ID,
      externalId: candidate.externalId,
      metadata: {
        documentId: candidate.source.documentId,
        elementId: candidate.source.elementId,
        partId: candidate.source.partId ?? null,
        configuration: normalizeConfiguration(candidate.source.configuration),
        kind: candidate.source.partId ? "part" : "assembly",
        partNumber: candidate.partNumber,
        viaAssemblyPush: true,
        pushedBy: input.userId,
        pushedAt: linkedAt
      },
      lastSyncedAt: linkedAt,
      companyId: input.companyId,
      createdBy: input.userId
    }));
  if (rows.length === 0) return problems;

  // The bulk insert is all-or-nothing, so on refusal retry row by row: one
  // rejected row (say a concurrent push's link) must not unlink the rest.
  const linked = await client.from("externalIntegrationMapping").insert(rows);
  if (!linked.error) return problems;

  const failed: string[] = [];
  for (const row of rows) {
    const single = await client.from("externalIntegrationMapping").insert(row);
    if (single.error) failed.push(row.metadata.partNumber);
  }
  if (failed.length > 0) {
    problems.push(
      `${failed.length} part${failed.length === 1 ? "" : "s"} could not be linked to Onshape (${failed
        .slice(0, 5)
        .join(", ")}${failed.length > 5 ? ", …" : ""}); push again to retry`
    );
  }
  return problems;
}
