// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type {
  ItemEdit,
  ItemFieldSnapshot,
  MappedRowPlan,
  OnshapeBomNode,
  OwnedFieldChange,
  ProposedItem
} from "@carbon/ee";
import {
  bomLineItemType,
  createdItemExtras,
  defaultUnitOfMeasureCode,
  externalIdForAssembly,
  externalIdForBomLine,
  flattenNodes,
  mappedFieldValues,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  normalizeConfiguration,
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
import {
  ensureDraftMakeMethod,
  loadMethodWriteRefusals
} from "~/modules/settings/onshape-draft-method.server";
import {
  applyExistingItemFields,
  applyItemFieldWrites,
  claimManualMethodLine,
  insertOwnedMethodLines,
  type OwnedMethodLine,
  swapItemMapping
} from "~/modules/settings/onshape-push.server";
import { getDatabaseClient } from "~/services/database.server";

export const config = {
  runtime: "nodejs"
};

// Shape only: `mergeItemEdits` validates values, so a bad one is a 422 naming the row.
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
  /** Reused items whose mapped fields this push wrote. */
  fieldsUpdated: number;
  methodsTouched: number;
  /** Parent part numbers whose BOM went into a new Draft. */
  draftVersionsCreated: string[];
  skipped: string[];
  errors: string[];
};

type ItemRow = {
  id: string;
  readableId: string;
  revision: string | null;
  /** Absent on an item this push created (Design). */
  revisionStatus?: Database["public"]["Enums"]["itemRevisionStatus"] | null;
  active?: boolean | null;
  type: string | null;
  defaultMethodType: string | null;
  sourcingType: string | null;
  unitOfMeasureCode: string | null;
};

/** Apply a reviewed assembly plan: items, BOM lines per method, links, model export. */
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

  // Peek, not take: a 422 on the edits leaves the plan for a retry.
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
    fieldsUpdated: 0,
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
        "id, readableId, revision, revisionStatus, active, type, defaultMethodType, sourcingType, unitOfMeasureCode"
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

  const serviceRole = getCarbonServiceRole();
  const db = getDatabaseClient();

  type PlannedItem = MappedRowPlan & {
    itemId: string | null;
    current?: ItemFieldSnapshot | null;
    changes?: OwnedFieldChange[];
  };

  const customFieldReadIds = [root, ...includedItems]
    .filter(
      (row) =>
        row.action === "reuse" &&
        mappedFieldValues(row.customFields ?? [], false).fieldIds.size > 0
    )
    .map((row) => row.partNumber);
  const heldParts = await selectInBatches(customFieldReadIds, (batch) =>
    client
      .from("part")
      .select("id, customFields")
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (heldParts.error) {
    return data({ error: "Failed to read Carbon parts" }, { status: 500 });
  }
  const heldCustomFields = new Map<string, unknown>(
    (heldParts.data ?? []).map((part) => [part.id, part.customFields])
  );

  const ensureItem = async (
    partNumber: string,
    planned: PlannedItem,
    propose: () => ProposedItem
  ): Promise<ItemRow | null> => {
    const rows = rowsByReadableId.get(partNumber) ?? [];
    const found =
      rows.find((row) => row.id === planned.itemId) ??
      pickReuseRow(rows) ??
      null;
    if (found) {
      summary.itemsReused += 1;
      if (planned.itemId === null) {
        summary.skipped.push(
          `${partNumber}: added to Carbon since the review; reused as is`
        );
      }
      // Only the row the review was about takes its values and edits.
      if (planned.itemId !== found.id) {
        itemByReadableId.set(partNumber, found);
        return found;
      }
      const applied = await applyExistingItemFields(client, db, {
        itemId: found.id,
        companyId,
        userId,
        current: planned.current,
        target: planned.target,
        edit: edits[partNumber],
        descriptions: planned.changes
      });
      let fieldsWritten = false;
      if (applied.error) {
        summary.errors.push(`${partNumber}: ${applied.error}`);
      } else {
        if (planned.changes?.length) summary.descriptionsUpdated += 1;
        fieldsWritten = (planned.itemFieldChanges?.length ?? 0) > 0;
      }
      const values = mappedFieldValues(planned.customFields ?? [], false);
      if (values.fieldIds.size > 0) {
        const updatedPart = await client
          .from("part")
          .update({
            customFields: mergeCustomFieldValues(
              heldCustomFields.get(partNumber),
              values.values,
              values.fieldIds
            ) as Json,
            updatedAt: datetime.timestamp(),
            updatedBy: userId
          })
          .eq("id", partNumber)
          .eq("companyId", companyId);
        if (updatedPart.error) {
          summary.errors.push(
            `${partNumber}: failed to write custom fields (${updatedPart.error.message})`
          );
        } else {
          fieldsWritten = true;
        }
      }
      if (fieldsWritten) summary.fieldsUpdated += 1;
      const row: ItemRow = applied.values
        ? {
            ...found,
            defaultMethodType: applied.values.defaultMethodType,
            sourcingType: applied.values.sourcingType ?? found.sourcingType,
            unitOfMeasureCode:
              applied.values.unitOfMeasureCode ?? found.unitOfMeasureCode
          }
        : found;
      itemByReadableId.set(partNumber, row);
      return row;
    }

    const item = merged.items.get(partNumber) ?? propose();
    const customFields = mappedFieldValues(
      planned.customFields ?? [],
      true
    ).values;
    const created = await upsertPart(client, {
      id: item.readableId,
      name: item.name,
      description: item.description ?? undefined,
      revision: item.revision,
      replenishmentSystem: item.replenishmentSystem,
      defaultMethodType: item.defaultMethodType,
      itemTrackingType: item.itemTrackingType,
      unitOfMeasureCode: item.unitOfMeasureCode,
      ...(Object.keys(customFields).length > 0
        ? { customFields: customFields as Json }
        : {}),
      companyId,
      createdBy: userId
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
      sourcingType: item.sourcingType ?? null,
      unitOfMeasureCode: item.unitOfMeasureCode
    };
    const extras = createdItemExtras(item);
    if (Object.keys(extras).length > 0) {
      const error = await applyItemFieldWrites(client, db, {
        itemId: row.id,
        companyId,
        userId,
        changed: extras
      });
      if (error) {
        summary.errors.push(
          `${partNumber}: created, but its mapped fields were not written (${error})`
        );
      }
    }
    itemByReadableId.set(partNumber, row);
    summary.itemsCreated += 1;
    return row;
  };

  const rootItem = await ensureItem(root.partNumber, root, () =>
    proposeItem(
      {
        partNumber: root.partNumber,
        name: root.name,
        description: root.description,
        revision: root.revision
      },
      options
    )
  );
  if (!rootItem) {
    return data(
      { error: summary.errors.join("; ") || "Failed to create the assembly" },
      { status: 500 }
    );
  }
  summary.assemblyItemId = rootItem.id;

  for (const item of includedItems) {
    await ensureItem(item.partNumber, item, () =>
      proposeItem(
        {
          partNumber: item.partNumber,
          name: item.name,
          description: nodeByPartNumber.get(item.partNumber)?.description,
          revision: item.revision,
          hasChildren: item.isAssembly
        },
        options
      )
    );
  }

  const isAssemblyByPartNumber = new Map(
    plan.items.map((item) => [item.partNumber, item.isAssembly])
  );

  // Every sub-assembly, even one this push writes no lines into: its parent's line
  // points at its method, and a null pointer flattens a `top` push's tree.
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
  // A Make to Order line points at its component's make method, as the BOM
  // editor does; this reads it for made parts that are not sub-assemblies.
  const madePartIds = [
    ...new Set(
      plan.items
        .filter((item) => !item.isAssembly && !excluded.has(item.partNumber))
        .map((item) => itemByReadableId.get(item.partNumber))
        .filter(
          (row): row is ItemRow =>
            !!row &&
            row.defaultMethodType === "Make to Order" &&
            !methodByItemId.has(row.id)
        )
        .map((row) => row.id)
    )
  ];
  let madePartMethodByItemId: Awaited<ReturnType<typeof loadActiveMakeMethods>>;
  try {
    madePartMethodByItemId = await loadActiveMakeMethods(
      client,
      companyId,
      madePartIds
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
  const childMethodFor = (childItem: ItemRow, childMade: boolean) =>
    childMade
      ? methodByItemId.get(childItem.id)
      : childItem.defaultMethodType === "Make to Order"
        ? (madePartMethodByItemId.get(childItem.id) ??
          methodByItemId.get(childItem.id))
        : null;

  // Not written: a change notice's Draft, or a released revision under
  // `enforce`. Rechecked here; the plan only listed them.
  const refusalByItemId = await loadMethodWriteRefusals(
    client,
    companyId,
    plan.methods.flatMap((planned) => {
      const parentItem = itemByReadableId.get(planned.parentPartNumber);
      const method = parentItem ? methodByItemId.get(parentItem.id) : undefined;
      return parentItem && method
        ? [
            {
              itemId: parentItem.id,
              method,
              revisionStatus: parentItem.revisionStatus
            }
          ]
        : [];
    })
  );

  // An Active method is written through a Draft, made before ownership is read:
  // ownership is keyed by method id, so a later Draft's lines would read as manual.
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
  // An Active method whose Onshape lines already match gets no Draft. The
  // check pairs lines as the write loop does.
  let activeOwnership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    activeOwnership = await loadMethodLineOwnership(
      client,
      serviceRole,
      companyId,
      [...activeMethodIdByItemId.entries()]
        .filter(([itemId]) => !reusableDraftByItemId.has(itemId))
        .map(([, methodId]) => methodId)
    );
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
  const linesWouldChange = (
    planned: (typeof plan.methods)[number],
    methodId: string
  ) => {
    const reusable = new Map<string, MappedLineRow[]>();
    for (const row of activeOwnership.mappedRows.get(methodId) ?? []) {
      const queue = reusable.get(row.itemId) ?? [];
      queue.push(row);
      reusable.set(row.itemId, queue);
    }
    let order = 0;
    for (const write of planned.writes) {
      if (excluded.has(write.partNumber)) continue;
      const childItem = itemByReadableId.get(write.partNumber);
      if (!childItem || !bomLineItemType(childItem)) continue;
      const childMethod = childMethodFor(
        childItem,
        isAssemblyByPartNumber.get(write.partNumber) === true
      );
      const reuse = reusable.get(childItem.id)?.shift();
      if (!reuse) return true;
      if (
        reuse.quantity !== write.quantity ||
        reuse.order !== order ||
        reuse.materialMakeMethodId !== (childMethod?.id ?? null)
      ) {
        return true;
      }
      order += 1;
    }
    // A leftover line would be removed.
    return [...reusable.values()].some((queue) => queue.length > 0);
  };
  const unchangedItemIds = new Set<string>();

  for (const planned of plan.methods) {
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    if (!parentItem) continue;
    if (
      targetMethodByItemId.has(parentItem.id) ||
      unchangedItemIds.has(parentItem.id)
    ) {
      continue;
    }
    const method = methodByItemId.get(parentItem.id);
    if (!method) continue; // reported in the write loop
    if (method.status !== "Active") {
      if (!refusalByItemId.has(parentItem.id)) {
        targetMethodByItemId.set(parentItem.id, method.id);
      }
      continue;
    }
    if (
      !reusableDraftByItemId.has(parentItem.id) &&
      !linesWouldChange(planned, method.id)
    ) {
      unchangedItemIds.add(parentItem.id);
      continue;
    }
    // Checked before a Draft is made, so a refusal leaves no Draft behind.
    if (refusalByItemId.has(parentItem.id)) continue;
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
    if (unchangedItemIds.has(parentItem.id)) {
      summary.linesUnchanged += planned.writes.filter(
        (write) => !excluded.has(write.partNumber)
      ).length;
      continue;
    }
    const refusal = refusalByItemId.get(parentItem.id);
    if (refusal) {
      summary.skipped.push(`${parentLabel}: ${refusal}`);
      continue;
    }
    const methodId = targetMethodByItemId.get(parentItem.id);
    if (!methodId) {
      summary.errors.push(
        `${parentLabel}: ${methodErrorByItemId.get(parentItem.id) ?? "no make method to write to"}`
      );
      continue;
    }

    // Owned lines are updated in place so Carbon's columns (operation, scrap,
    // tags, kit, customFields) survive; FIFO per item keeps a repeated component's lines.
    const reusableByItemId = new Map<string, MappedLineRow[]>();
    for (const row of ownership.mappedRows.get(methodId) ?? []) {
      const queue = reusableByItemId.get(row.itemId) ?? [];
      queue.push(row);
      reusableByItemId.set(row.itemId, queue);
    }
    // Manual lines pair by part number in line order, as `pairManualLines` does at plan.
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
      const childMethod = childMethodFor(childItem, childMade);
      const lineSyncedAt = datetime.timestamp();
      const lineMetadata = {
        makeMethodId: methodId,
        documentId,
        elementId,
        partNumber: write.partNumber,
        index: write.index
      };

      // Onshape owns quantity, order and the child-method pointer; method type,
      // sourcing and unit come from the item, at insert only.
      const reuse = reusableByItemId.get(childItem.id)?.shift();
      if (reuse) {
        // Unchanged lines are not written, so the audit log shows no edit.
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
            (childMade ? "Make to Order" : "Pull from Inventory"),
          sourcingType:
            (childItem.sourcingType as OwnedMethodLine["row"]["sourcingType"]) ??
            "Specified",
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
          const failed = new Set(batch);
          for (const row of removed) {
            if (failed.has(row.lineId)) liveMappingIds.push(row.mappingId);
          }
        }
      }
    }

    // Orphans are filtered here: a `not in` filter puts every live id in the URL.
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

  // A root released in Carbon keeps the link and model its release gave it.
  if (root.released) {
    summary.skipped.push(
      `${root.partNumber}: released in Carbon as Rev ${root.released.revision}; its fields, link and model stay as its release left them`
    );
    const childLinkProblems = await linkChildParts(client, serviceRole, {
      companyId,
      userId,
      nodes: allNodes,
      itemByReadableId
    });
    summary.errors.push(...childLinkProblems);
    return data({ summary }, { headers: { "Cache-Control": "no-store" } });
  }
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
  // Links only where neither the item nor the source is linked: a part push owns that link.
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
  // A failed read is not "no links": that would claim links a part push owns.
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

  // The bulk insert is all-or-nothing; on refusal retry row by row, so one
  // conflicting row (a concurrent push's link) does not block the rest.
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
