import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type { ItemEdit, OnshapeBomNode, ProposedItem } from "@carbon/ee";
import {
  bomLineItemType,
  defaultUnitOfMeasureCode,
  externalIdForAssembly,
  externalIdForPart,
  flattenNodes,
  mergeCustomFieldEdits,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  missingListOptions,
  pickLatestRow,
  proposeItem
} from "@carbon/ee";
import type { MappedLineRow } from "@carbon/ee/onshape";
import {
  chunkFilterValues,
  loadActiveMakeMethods,
  loadMethodLineOwnership,
  loadPartCustomFieldDefinitions,
  peekPanelPlan,
  selectInBatches,
  takePanelPlan
} from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertPart } from "~/modules/items";

export const config = {
  runtime: "nodejs"
};

// Edits are validated by mergeItemEdits (enum membership, the company's units,
// the replenishment/method interlock) so a bad value is a 422 naming the row,
// not a 400 for the whole payload. Unknown keys are dropped here.
const itemEditSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  replenishmentSystem: z.string().optional(),
  defaultMethodType: z.string().optional(),
  itemTrackingType: z.string().optional(),
  unitOfMeasureCode: z.string().optional(),
  // Values stay unknown here: mergeCustomFieldEdits is the validator (per
  // field type coercion, owned-mode refusal) and answers per-row 422s.
  customFields: z.record(z.string(), z.unknown()).optional()
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
  /** Lines already correct, left untouched — reported so a no-op push says so. */
  linesUnchanged: number;
  methodsTouched: number;
  skipped: string[];
  errors: string[];
};

type ItemRow = {
  id: string;
  readableId: string;
  revision: string | null;
  type: string | null;
  defaultMethodType: string | null;
  unitOfMeasureCode: string | null;
};

/**
 * Apply a reviewed assembly plan (`plan-assembly`) to Carbon.
 *
 * Reads nothing from Onshape: the plan carries the parsed BOM, the root's
 * identity and every proposed item, and it is taken one-shot from the store
 * so a double-click cannot write twice. The user's edits apply to creates
 * only; part numbers the user excluded are neither created nor written as
 * lines. Existing items are re-resolved by part number right before writing
 * because `upsertPart` reads the new id back by readableId — a second row
 * for a number that appeared since the plan would be wrong, so such a create
 * becomes a reuse.
 *
 * Methods are applied FLAT over `plan.methods`, each level on its own: a
 * released (Active) parent is refused with the same error as before, but a
 * Draft sub-assembly beneath it still gets its lines — the old recursive walk
 * skipped the whole subtree under a refused parent, which hid work the plan
 * had promised. Status is re-checked here, not trusted from the plan, so a
 * method released between review and apply is refused too. As before, only
 * lines a previous push wrote (mapping rows keyed by makeMethodId) are
 * replaced; manual lines survive. The assembly model export is one
 * background job, idempotent per plan and item.
 *
 * Mapped custom fields touch the ROOT item only: a created root writes every
 * mapped value (after the user's default-mode edits), a reused root merges
 * just the owned-mode values into what Carbon holds, and List options are
 * synced add-only right before the write. Child items are untouched in v1 —
 * their fields land when their own part studio is pushed.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { planId } = parsed.data;
  const edits = parsed.data.edits as Record<string, ItemEdit>;
  const excluded = new Set(parsed.data.excluded);

  // Peek first: a 422 on the edits must leave the plan in place so the user
  // can fix a field and apply again; the plan is taken only once the writes
  // are about to start.
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

  if (excluded.has(root.partNumber)) {
    return data(
      { error: "The assembly itself cannot be excluded" },
      { status: 400 }
    );
  }

  // ---- Merge edits before any write ---------------------------------------
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
  // Custom-field edits are validated in the same peek phase (a 422 must
  // leave the plan in place), and only for the ROOT: child items keep their
  // fields until their own part studio is pushed (v1). An edit to an
  // owned-mode field is refused here — Onshape owns the value.
  const rootFields = root.customFields ?? [];
  const rootFieldMerge = mergeCustomFieldEdits(
    rootFields,
    edits[root.partNumber]?.customFields
  );
  if (!rootFieldMerge.ok) {
    return data(
      {
        error: "Some edits are not valid",
        fieldErrors: [
          ...merged.errors,
          { key: root.partNumber, errors: rootFieldMerge.errors }
        ]
      },
      { status: 422 }
    );
  }
  if (merged.errors.length > 0) {
    return data(
      { error: "Some edits are not valid", fieldErrors: merged.errors },
      { status: 422 }
    );
  }

  // The definitions the list-option sync needs are read while the plan is
  // still peeked: nothing the take produces feeds them, so a failed read must
  // not burn a one-shot review. A root with no mapped field pays nothing.
  let definitions: Awaited<ReturnType<typeof loadPartCustomFieldDefinitions>> =
    [];
  if (rootFields.length > 0) {
    try {
      definitions = await loadPartCustomFieldDefinitions(client, companyId);
    } catch (error) {
      return data(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to read the custom field definitions"
        },
        { status: 500 }
      );
    }
  }

  // One-shot from here: a concurrent apply of the same review finds nothing.
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
    methodsTouched: 0,
    skipped: [...plan.skipped],
    errors: []
  };
  for (const item of plan.items) {
    if (excluded.has(item.partNumber)) {
      summary.skipped.push(`${item.partNumber}: excluded`);
    }
  }

  // ---- Re-resolve, then ensure items --------------------------------------
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
        "id, readableId, revision, type, defaultMethodType, unitOfMeasureCode"
      )
      .eq("companyId", companyId)
      .in("readableId", batch)
      .order("revision")
  );
  if (existing.error) {
    return data({ error: "Failed to read Carbon items" }, { status: 500 });
  }
  // Each batch came back sorted within itself; the pick below wants one
  // ordering over all of them, so re-sort rather than trusting batch order.
  existing.data.sort((a, b) =>
    (a.revision ?? "").localeCompare(b.revision ?? "")
  );
  const rowsByReadableId = new Map<string, ItemRow[]>();
  for (const row of (existing.data ?? []) as ItemRow[]) {
    const list = rowsByReadableId.get(row.readableId) ?? [];
    list.push(row);
    rowsByReadableId.set(row.readableId, list);
  }

  // Descriptions for a reuse that has to become a create (its row vanished
  // since the plan) come from the BOM row; the plan's item list has none.
  const allNodes = flattenNodes(plan.nodes);
  const nodeByPartNumber = new Map<string, OnshapeBomNode>();
  for (const node of allNodes) {
    if (node.partNumber && !nodeByPartNumber.has(node.partNumber)) {
      nodeByPartNumber.set(node.partNumber, node);
    }
  }

  // Only ensured items enter this map: excluded numbers never do, so lines
  // and child links skip them without a second check.
  const itemByReadableId = new Map<string, ItemRow>();
  const fallbackUnit = defaultUnitOfMeasureCode(options);

  /**
   * The row for a part number: the one the plan pinned when it still exists,
   * else the first by revision, else a fresh item from the merged proposal
   * (or, when the plan had none because it expected to reuse, a proposal
   * built the way the plan would have).
   */
  const ensureItem = async (
    partNumber: string,
    plannedItemId: string | null,
    propose: () => ProposedItem,
    customFields?: Record<string, unknown>
  ): Promise<ItemRow | null> => {
    const rows = rowsByReadableId.get(partNumber) ?? [];
    const found =
      rows.find((row) => row.id === plannedItemId) ??
      pickLatestRow(rows) ??
      null;
    if (found) {
      itemByReadableId.set(partNumber, found);
      summary.itemsReused += 1;
      // The review offered an editor for this one; the edits went nowhere.
      if (plannedItemId === null) {
        summary.skipped.push(
          `${partNumber}: added to Carbon since the review; reused as is`
        );
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
      // Mapped custom-field values land on the part row at create; only the
      // root passes any — child items keep theirs until their own part
      // studio is pushed (v1).
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

  // ---- Root custom fields -------------------------------------------------
  // Mirrors the row pick inside ensureItem, over the same re-resolved rows,
  // so the values "about to be written" are exact before any write: a
  // create writes every mapped value, a reuse merges only the Onshape-owned
  // ones. Child items are untouched in v1 — their fields land when their
  // own part studio is pushed.
  const serviceRole = getCarbonServiceRole();
  const rootRows = rowsByReadableId.get(root.partNumber) ?? [];
  const rootWillReuse = Boolean(
    rootRows.find((row) => row.id === root.itemId) ?? pickLatestRow(rootRows)
  );
  const rootOwnedFieldIds = new Set(
    rootFields
      .filter((field) => field.mode === "owned")
      .map((field) => field.fieldId)
  );
  const rootAllFieldIds = new Set(rootFields.map((field) => field.fieldId));
  const rootValuesToWrite = mergeCustomFieldValues(
    {},
    rootFieldMerge.values,
    rootWillReuse ? rootOwnedFieldIds : rootAllFieldIds
  );

  // List options are synced ADD-ONLY, at apply, never at plan: the
  // definitions read above are fresh, so an option edited since the review is
  // unioned with, not clobbered by, what this push is about to write.
  if (Object.keys(rootValuesToWrite).length > 0) {
    for (const definition of definitions) {
      if (!(definition.id in rootValuesToWrite)) continue;
      const missing = missingListOptions(definition, [
        rootFieldMerge.values[definition.id] ?? null
      ]);
      if (missing.length === 0) continue;
      const appended = await serviceRole
        .from("customField")
        .update({
          listOptions: [...(definition.listOptions ?? []), ...missing],
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .eq("id", definition.id)
        .eq("companyId", companyId);
      if (appended.error) {
        // The value is still written below; the option can be added by hand.
        summary.errors.push(
          `${definition.name}: could not add list option ${missing.join(", ")}`
        );
      }
    }
  }

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

  // A reused root takes only its owned-mode values, merged into the stored
  // JSON so every field Carbon owns survives. `part` is keyed by readableId
  // (the parts view joins part.id = item.readableId). Skipped when the root
  // has no owned mapped value — the common case must stay free.
  // Owned fields with no Onshape value still run: the merge clears them.
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
    } else {
      const mergedRootFields = mergeCustomFieldValues(
        currentPart.data?.customFields,
        rootFieldMerge.values,
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
          // Sub-assemblies are made even when the BOM row says purchased —
          // the same call the plan made.
          purchased: item.purchased && !item.isAssembly
        },
        options
      )
    );
  }

  // ---- Apply BOM lines to make methods, one level at a time --------------
  const isAssemblyByPartNumber = new Map(
    plan.items.map((item) => [item.partNumber, item.isAssembly])
  );

  // Parents whose items exist now (created above or reused). Their methods
  // were created with the item, so the status read has to happen here.
  //
  // Sub-assemblies are included even when this push writes no lines for them.
  // A BOM line points at its child's own make method, and that pointer is what
  // makes a multi-level structure compose from levels pushed separately — a
  // `top` push that could not resolve the child's method would write the line
  // with a null pointer and quietly flatten the tree.
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
  const methodByItemId = await loadActiveMakeMethods(
    client,
    companyId,
    parentItemIds
  );
  // A failed read here must stop the line writes: with the existing
  // Onshape-origin lines unknown, a rewrite would duplicate every one.
  let ownership: Awaited<ReturnType<typeof loadMethodLineOwnership>>;
  try {
    ownership = await loadMethodLineOwnership(
      client,
      serviceRole,
      companyId,
      [...methodByItemId.values()].map((method) => method.id)
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

  for (const planned of plan.methods) {
    const parentLabel = planned.parentPartNumber;
    const parentItem = itemByReadableId.get(planned.parentPartNumber);
    // Excluded, or its create failed (already in errors): nothing to apply.
    if (!parentItem) continue;

    const method = methodByItemId.get(parentItem.id);
    if (!method) {
      summary.errors.push(`${parentLabel}: no make method found`);
      continue;
    }
    if (method.status === "Active") {
      summary.errors.push(
        `${parentLabel}: make method is released; pushing to released methods lands with releases`
      );
      continue;
    }

    // Lines a previous push wrote to this method are RECONCILED, not rebuilt:
    // one still in the BOM is updated in place, one no longer in it is
    // deleted, a new component is inserted. Manual lines are untouched
    // throughout.
    //
    // The in-place update is the point. `methodMaterial` has 22 columns and a
    // push is authoritative for four of them; delete-and-reinsert dropped the
    // rest on EVERY push, including one where nothing had changed in Onshape.
    // Measured on an unchanged re-push: the operation a material is consumed
    // at (`methodOperationId`) went to null, leaving the routing intact but
    // disconnected from its materials, and `scrapQuantity`, `tags`, `kit` and
    // the line's own `customFields` were all reset.
    //
    // Components pair by item id, FIFO, so a BOM that lists the same component
    // on two rows keeps both lines and their Carbon-owned data.
    const reusableByItemId = new Map<string, MappedLineRow[]>();
    for (const row of ownership.mappedRows.get(method.id) ?? []) {
      const queue = reusableByItemId.get(row.itemId) ?? [];
      queue.push(row);
      reusableByItemId.set(row.itemId, queue);
    }
    // Every mapping row this method should still own when the loop is done —
    // anything else under this method is an orphan and is cleared at the end.
    const liveMappingIds: string[] = [];
    // New lines are collected and written together at the end of the method:
    // per-line INSERTs cost two round-trips each (the line, then its mapping
    // row), which is the difference between a large assembly taking seconds
    // and taking minutes. Updates stay per-line — each carries different
    // values — but only the ones that actually changed are sent.
    const pendingInserts: Array<{
      row: Record<string, unknown>;
      metadata: Record<string, unknown>;
      syncedAt: string;
      label: string;
    }> = [];

    summary.methodsTouched += 1;

    let order = 0;
    for (const write of planned.writes) {
      if (excluded.has(write.partNumber)) continue;
      const childItem = itemByReadableId.get(write.partNumber);
      if (!childItem) continue;

      // A reused Material is a Material line; a Tool cannot be a line.
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
        makeMethodId: method.id,
        documentId,
        elementId,
        partNumber: write.partNumber,
        index: write.index
      };

      // Reuse a line already carrying this component. Only the four facts
      // Onshape is authoritative for are written — quantity, BOM order, and
      // the pointer to the child's own method. `methodType` and
      // `unitOfMeasureCode` are derived from the Carbon item, not from CAD,
      // so they are set at create and left alone afterwards; everything else
      // on the row belongs to Carbon and is never touched.
      const reuse = reusableByItemId.get(childItem.id)?.shift();
      if (reuse) {
        // An unchanged line is left alone. Re-pushing an assembly nobody has
        // touched is the common case, and writing every line back would cost
        // a round-trip each and stamp `updatedBy`/`updatedAt` on rows that
        // did not change — which reads, in the audit trail, as an edit.
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
          .eq("id", reuse.mappingId);
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

      // Queued rather than written: see `pendingInserts`. `order` still
      // advances here so the BOM keeps the order the plan promised.
      pendingInserts.push({
        row: {
          itemId: childItem.id,
          quantity: write.quantity,
          makeMethodId: method.id,
          materialMakeMethodId: childMethod?.id ?? null,
          methodType:
            (childItem.defaultMethodType as "Make to Order" | null) ??
            (write.purchased ? "Pull from Inventory" : "Make to Order"),
          order,
          itemType,
          unitOfMeasureCode: childItem.unitOfMeasureCode ?? fallbackUnit,
          companyId,
          createdBy: userId
        },
        metadata: lineMetadata,
        syncedAt: lineSyncedAt,
        label: `${parentLabel} → ${write.partNumber}`
      });
      order += 1;
    }

    // The queued inserts, in two statements instead of two per line. Ids come
    // back in insertion order, which is what pairs each new line with its own
    // mapping row.
    if (pendingInserts.length > 0) {
      const inserted = await client
        .from("methodMaterial")
        // enum unions narrowed above
        .insert(pendingInserts.map((pending) => pending.row) as any)
        .select("id");
      if (inserted.error || !inserted.data) {
        summary.errors.push(
          `${parentLabel}: ${inserted.error?.message ?? "line insert failed"}`
        );
      } else if (inserted.data.length !== pendingInserts.length) {
        // Never observed, but pairing by index is only sound while the counts
        // match — a short result would link mapping rows to the wrong lines.
        summary.errors.push(
          `${parentLabel}: wrote ${inserted.data.length} of ${pendingInserts.length} lines; the rest are not linked to Onshape and a later push will duplicate them`
        );
        summary.linesWritten += inserted.data.length;
      } else {
        summary.linesWritten += inserted.data.length;
        // Without these rows the lines are indistinguishable from ones a
        // person added by hand: the next push will not replace them, and will
        // insert a second copy beside each. Report rather than leave lines
        // that silently compound on every push.
        const lineMappings = await client
          .from("externalIntegrationMapping")
          .insert(
            pendingInserts.map((pending, index) => ({
              entityType: "methodMaterial",
              entityId: inserted.data[index].id,
              integration: "onshape",
              metadata: pending.metadata as Json,
              lastSyncedAt: pending.syncedAt,
              companyId,
              createdBy: userId
            }))
          )
          .select("id");
        if (lineMappings.error || !lineMappings.data) {
          summary.errors.push(
            `${parentLabel}: ${pendingInserts.length} lines written but not linked to Onshape (${lineMappings.error?.message ?? "link failed"}); a later push will duplicate them`
          );
        } else {
          for (const mapping of lineMappings.data) {
            liveMappingIds.push(mapping.id);
          }
        }
      }
    }

    // Anything still queued is a component the Onshape BOM no longer has.
    const removed = [...reusableByItemId.values()].flat();
    if (removed.length > 0) {
      // Per batch, not per method: a method whose Onshape lines were all
      // removed at once can carry more ids than one request line holds.
      for (const batch of chunkFilterValues(removed.map((row) => row.lineId))) {
        const removedLines = await client
          .from("methodMaterial")
          .delete()
          .in("id", batch);
        if (removedLines.error) {
          summary.errors.push(
            `${parentLabel}: could not remove the lines Onshape no longer lists (${removedLines.error.message})`
          );
          // Their mapping rows must stay, or the leftover lines become
          // indistinguishable from manual ones and are preserved forever.
          const failed = new Set(batch);
          for (const row of removed) {
            if (failed.has(row.lineId)) liveMappingIds.push(row.mappingId);
          }
        }
      }
    }

    // Clear this method's Onshape mapping rows that no line answers for any
    // more: the ones just deleted, plus any whose line was removed in the ERP
    // between pushes.
    // Which rows are orphaned is decided here rather than by a `not in`
    // filter: that filter carries every line just written, in the URL, and a
    // method with a few hundred lines outgrows the request line — silently,
    // because the failure lands in `summary.errors` on a push that otherwise
    // reports success.
    const methodMappings = await serviceRole
      .from("externalIntegrationMapping")
      .select("id")
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "methodMaterial")
      .eq("metadata->>makeMethodId", method.id);
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

  // ---- Assembly item mapping + child part links --------------------------
  const pushedAt = datetime.timestamp();
  const assemblyExternalId = externalIdForAssembly(documentId, elementId);
  // Both deletes clear the way for one canonical row: by item (an older link
  // for this item, including one the legacy sync wrote with no externalId)
  // and by externalId (this element pointing at some other item). Two rows
  // would make the owned-field lock's `.maybeSingle()` error, silently
  // unlocking name and description on the item page.
  const clearedByItem = await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", "onshape")
    .eq("entityType", "item")
    .eq("entityId", rootItem.id);
  if (clearedByItem.error) {
    summary.errors.push(
      `${root.partNumber}: could not clear the previous Onshape link (${clearedByItem.error.message})`
    );
  }
  const clearedByElement = await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("companyId", companyId)
    .eq("integration", "onshape")
    .eq("entityType", "item")
    .eq("externalId", assemblyExternalId);
  if (clearedByElement.error) {
    summary.errors.push(
      `${root.partNumber}: could not clear this element's previous link (${clearedByElement.error.message})`
    );
  }
  const assemblyMapping = await client
    .from("externalIntegrationMapping")
    .insert({
      entityType: "item",
      entityId: rootItem.id,
      integration: "onshape",
      externalId: assemblyExternalId,
      metadata: {
        documentId,
        elementId,
        wv,
        wvId,
        kind: "assembly",
        partNumber: root.partNumber,
        name: root.name,
        pushedBy: userId,
        pushedAt,
        planId
      },
      lastSyncedAt: pushedAt,
      companyId,
      createdBy: userId
    });
  if (assemblyMapping.error) {
    summary.errors.push(
      `${root.partNumber}: pushed, but not linked to Onshape (${assemblyMapping.error.message}); the next push will not recognise it`
    );
  }

  // Link child parts to their source part studios when the BOM names them,
  // without clobbering a link an explicit part push already made.
  const childLinkError = await linkChildParts(client, serviceRole, {
    companyId,
    userId,
    nodes: allNodes,
    itemByReadableId
  });
  if (childLinkError) {
    summary.errors.push(childLinkError);
  }

  // One export per applied plan: a retried apply with the same plan and item
  // is the same event to Inngest.
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
      assetBaseName: root.partNumber
    },
    { id: `${planId}:${rootItem.id}:${elementId}` }
  );

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
  // Collect every candidate first, then decide with two bulk reads: an item
  // that already carries any Onshape mapping keeps it (an explicit part push
  // owns that link), and an externalId already in use is never claimed twice.
  const candidates: Array<{
    itemId: string;
    externalId: string;
    partNumber: string;
    source: NonNullable<OnshapeBomNode["itemSource"]>;
  }> = [];
  const seen = new Set<string>();
  for (const node of input.nodes) {
    const source = node.itemSource;
    if (!node.partNumber || !source?.documentId || !source.elementId) {
      continue;
    }
    const item = input.itemByReadableId.get(node.partNumber);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);

    // Part rows name a partId; sub-assembly rows name only their element, and
    // key the way that element's own push would, so one row serves both views.
    const externalId = source.partId
      ? externalIdForPart(source.documentId, source.elementId, source.partId)
      : externalIdForAssembly(source.documentId, source.elementId);
    candidates.push({
      itemId: item.id,
      externalId,
      partNumber: node.partNumber,
      source
    });
  }
  if (candidates.length === 0) return null;

  // `externalId` is `documentId:elementId:partId` — 53 to 58 characters, the
  // longest value the panel ever filters on, so this pair is the first thing
  // an assembly of any size breaks. Batched on encoded bytes, not on a count.
  const [byEntity, byExternal] = await Promise.all([
    selectInBatches(
      candidates.map((candidate) => candidate.itemId),
      (batch) =>
        serviceRole
          .from("externalIntegrationMapping")
          .select("entityId")
          .eq("companyId", input.companyId)
          .eq("integration", "onshape")
          .eq("entityType", "item")
          .in("entityId", batch)
    ),
    selectInBatches(
      candidates.map((candidate) => candidate.externalId),
      (batch) =>
        serviceRole
          .from("externalIntegrationMapping")
          .select("externalId")
          .eq("companyId", input.companyId)
          .eq("integration", "onshape")
          .eq("entityType", "item")
          .in("externalId", batch)
    )
  ]);
  // These two reads are the guards, not a lookup: a failed read degrading to
  // an empty set would mean "nothing is linked", and the insert below would
  // then claim links an explicit part push already owns. Refuse instead.
  if (byEntity.error || byExternal.error) {
    return `could not link child parts to their part studios: ${
      (byEntity.error ?? byExternal.error)?.message ?? "lookup failed"
    }`;
  }
  const linkedItemIds = new Set(
    (byEntity.data ?? []).map((row) => row.entityId)
  );
  const usedExternalIds = new Set(
    (byExternal.data ?? []).map((row) => row.externalId)
  );

  const linkedAt = datetime.timestamp();
  const rows = candidates
    .filter(
      (candidate) =>
        !linkedItemIds.has(candidate.itemId) &&
        !usedExternalIds.has(candidate.externalId)
    )
    .map((candidate) => ({
      entityType: "item" as const,
      entityId: candidate.itemId,
      integration: "onshape",
      externalId: candidate.externalId,
      metadata: {
        documentId: candidate.source.documentId,
        elementId: candidate.source.elementId,
        partId: candidate.source.partId ?? null,
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
  if (rows.length > 0) {
    const linked = await client.from("externalIntegrationMapping").insert(rows);
    if (linked.error) {
      return `child parts were not linked to their part studios (${linked.error.message}); pushing one of those studios will create a duplicate item`;
    }
  }
  return null;
}
