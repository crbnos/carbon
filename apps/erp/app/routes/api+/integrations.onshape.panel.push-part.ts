import { requirePermissions } from "@carbon/auth/auth.server";
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
  mergeCustomFieldEdits,
  mergeCustomFieldValues,
  mergeEditsForCreates,
  missingListOptions,
  pickAdoptTarget,
  proposeItem
} from "@carbon/ee";
import {
  loadPartCustomFieldDefinitions,
  peekPanelPlan,
  takePanelPlan
} from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import { datetime, selectInBatches } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertPart } from "~/modules/items";

export const config = {
  runtime: "nodejs"
};

// Field values stay loose here on purpose: `mergeItemEdits` is the validator
// (enum whitelist, unit membership, the replenishment↔method interlock) and
// its verdict comes back as a 422 with per-row field errors, which a strict
// zod enum would turn into a bare 400. Unknown keys are stripped.
const itemEditSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  replenishmentSystem: z.string().optional(),
  defaultMethodType: z.string().optional(),
  itemTrackingType: z.string().optional(),
  unitOfMeasureCode: z.string().optional(),
  // Same reasoning: `mergeCustomFieldEdits` is the validator (owned-field
  // refusal, per-type coercion) and answers 422 per row, keyed by field id.
  customFields: z.record(z.string(), z.unknown()).optional()
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
  /** The Carbon item's readableId, so the panel can patch its list. */
  readableId?: string;
  message?: string;
};

/**
 * Apply a reviewed part plan: create or link the items the user kept, write
 * the mappings, and queue the slow asset export per part.
 *
 * Reads nothing from Onshape — every fact the write needs (part number,
 * revision, microversion, name, description) is in the plan `plan-part`
 * stored. The plan is taken once (GETDEL), so a double-click cannot write
 * twice and a failed apply means "review again".
 *
 * Between plan and apply Carbon can change under the plan, so items are
 * re-resolved by readableId right before writing: a "create" whose part number
 * now has a Part row adopts it instead — `upsertPart` reads the new id back
 * from the `parts` view by readableId, which is the wrong row once another
 * revision of the number exists — and an adopt/update whose target item is
 * gone becomes a create. The user's edits apply to creates only; adopt and
 * update refresh the Onshape-owned fields from the plan, never from edits,
 * so the owned-field lock on the item page stays true.
 *
 * Mapped custom fields ride the same rails: a create writes every mapped
 * value (default-mode edits included), an adopt/update merges only
 * owned-mode values into the part row's stored JSON, and List options a
 * written value is missing are appended (add-only) right before the writes.
 *
 * Each part is written on its own: a failure is reported in its result and
 * the next part still runs, as the single-request push did.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });

  // The body is validated before the plan is taken: a malformed request must
  // not burn a one-shot plan.
  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { planId } = parsed.data;
  const selected = [...new Set(parsed.data.selected)];
  // Enum-typed fields arrive as plain strings; `mergeItemEdits` rejects any
  // value outside the enum before it is applied.
  const edits = parsed.data.edits as Record<string, ItemEdit>;

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
  if (stored.plan.kind !== "part") {
    return data({ error: "This review is not a part push" }, { status: 400 });
  }
  const plan: PartPlan = stored.plan;
  const { documentId, wv, wvId, elementId, options } = plan;

  const rowByPartId = new Map(plan.rows.map((row) => [row.partId, row]));
  const selectedRows = selected
    .map((partId) => rowByPartId.get(partId))
    .filter((row): row is PartPlanRow => !!row);

  // ---- Merge edits, before any write --------------------------------------
  const merged = mergeEditsForCreates(
    selectedRows
      .filter((row) => row.action === "create" && row.partNumber)
      .map((row) => ({ key: row.partId, proposed: proposedFor(row, plan) })),
    edits,
    options
  );
  // Custom-field edits are validated the same way, per create row, while the
  // plan is still peeked: a bad value 422s and the review stays applyable.
  // Adopt/update rows take no custom-field edits — like item edits — and
  // only their owned-mode plan values are applied below.
  const customFieldValues = new Map<
    string,
    Record<string, string | number | boolean | null>
  >();
  const fieldErrors = merged.errors.map((entry) => ({ ...entry }));
  for (const row of selectedRows) {
    if (row.action !== "create" || !row.partNumber) continue;
    const mergedFields = mergeCustomFieldEdits(
      row.customFields ?? [],
      edits[row.partId]?.customFields
    );
    if (mergedFields.ok) {
      customFieldValues.set(row.partId, mergedFields.values);
      continue;
    }
    // One fieldErrors entry per row: item and custom-field errors share it.
    const existing = fieldErrors.find((entry) => entry.key === row.partId);
    if (existing) {
      existing.errors = [...existing.errors, ...mergedFields.errors];
    } else {
      fieldErrors.push({ key: row.partId, errors: mergedFields.errors });
    }
  }
  if (fieldErrors.length > 0) {
    return data(
      { error: "Some edits are not valid", fieldErrors },
      { status: 422 }
    );
  }

  // The definitions the list-option sync needs are read while the plan is
  // still peeked: nothing the take produces feeds them, so a failed read
  // must not burn a one-shot review. They are re-read here rather than taken
  // from the plan, so an option edited between review and apply is unioned,
  // never clobbered. Rows apply never writes carry no value, so a push with
  // no mapped field still pays nothing.
  const writesMappedFields = selectedRows.some(
    (row) =>
      row.action !== "unchanged" &&
      row.action !== "skip-no-part-number" &&
      (row.customFields ?? []).length > 0
  );
  let definitions: Awaited<ReturnType<typeof loadPartCustomFieldDefinitions>> =
    [];
  if (writesMappedFields) {
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

  // ---- Re-resolve Carbon, one query per table -----------------------------
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
        .select("id, readableId, revision, name, type")
        .eq("companyId", companyId)
        .in("readableId", batch)
        .order("revision")
    ),
    selectInBatches(targetItemIds, (batch) =>
      client
        .from("item")
        .select("id, readableId, revision, name, type")
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

  // What a row writes against, given what Carbon holds now: the plan's target
  // when it still exists, else any row at this part number, else nothing —
  // and then the row creates. `rowsByReadableId` grows as the loop writes, so
  // a later row at a number this apply just created sees it.
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

  // Plan-level problems that belong to no single part — currently only a
  // failed list-option append, which leaves parts carrying a value the field
  // does not list.
  const warnings: string[] = [];

  // ---- Custom fields: list options + current part values, before the loop -
  // Every value this apply could write, per field. An adopt/update writes
  // only its owned-mode values, so a default-mode value must not append an
  // option no row will use; a row with no target left creates and writes them
  // all. The loop can only gain targets from here, so this never under-counts.
  const writtenValuesByFieldId = new Map<
    string,
    Array<string | number | boolean | null>
  >();
  for (const row of selectedRows) {
    if (row.action === "unchanged" || row.action === "skip-no-part-number") {
      continue;
    }
    const values = resolveTarget(row)
      ? (ownedCustomFieldValues(row)?.values ?? {})
      : (customFieldValues.get(row.partId) ?? planCustomFieldValues(row));
    for (const [fieldId, value] of Object.entries(values)) {
      const list = writtenValuesByFieldId.get(fieldId) ?? [];
      list.push(value);
      writtenValuesByFieldId.set(fieldId, list);
    }
  }
  if (writtenValuesByFieldId.size > 0) {
    for (const definition of definitions) {
      const values = writtenValuesByFieldId.get(definition.id);
      if (!values) continue;
      const missing = missingListOptions(definition, values);
      if (missing.length === 0) continue;
      // Add-only: append after the existing options, order kept. The user
      // holds parts permissions, not settings, so the append needs the
      // service role. A failure is deliberately non-fatal — the plan is
      // already taken, the value is written regardless, and the next push
      // of the same value retries the append. It is NOT silent, though: the
      // value lands in a List field that does not contain it, and the ERP
      // renders that as an unknown option with nothing to explain it.
      const appended = await serviceRole
        .from("customField")
        .update({
          listOptions: [...(definition.listOptions ?? []), ...missing],
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", definition.id)
        .eq("companyId", companyId);
      if (appended.error) {
        warnings.push(
          `${definition.name}: could not add the option${
            missing.length > 1 ? "s" : ""
          } ${missing.join(", ")} to the field (${appended.error.message}); parts carry the value but the field does not list it`
        );
      }
    }
  }

  // Owned-mode fields merge into the target part rows' stored JSON. part.id
  // is the item's readableId (one part row per part number, shared across
  // revisions), so the candidates are every readableId a selected row can
  // resolve to. One bulk read; the map is kept current as the loop writes,
  // so a later row merging into a part this apply just created cannot
  // clobber what the create wrote.
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

    // Only an unmapped part needs a number; a linked part whose number was
    // cleared in Onshape is still updated (name, description, model).
    if (row.action === "skip-no-part-number") {
      results.push({
        partId,
        action: "skipped",
        message: "Set a part number in Onshape first"
      });
      continue;
    }

    if (row.action === "unchanged") {
      results.push({
        partId,
        action: "unchanged",
        itemId: row.itemId ?? undefined,
        readableId: row.item?.readableId
      });
      continue;
    }

    // What the row does now, given what Carbon holds at apply time.
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
      // A create writes every mapped value, defaults included — they were
      // editable in the review. The fallback covers an adopt/update whose
      // target vanished (no peek-phase merge ran for it): plan values as-is.
      const fieldValues =
        customFieldValues.get(row.partId) ?? planCustomFieldValues(row);
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
      // A later selected part with the same number adopts this item rather
      // than creating a second one.
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
      // Onshape owns name/description; refresh them on the linked item from
      // the plan's Onshape values, never from edits.
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
      // Owned-mode custom fields follow every push exactly like name and
      // description. The merge touches only the owned keys, so everything
      // Carbon owns — default-mode fields, unmapped custom fields — stays.
      // Rows with no valued owned field write nothing at all.
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
            // Plain data by construction (string/number/boolean values).
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

    // Upsert the mapping: one row per item, one per external part. The delete
    // by entityId OR externalId is what the uniqueness constraints rely on.
    const externalId = externalIdForPart(documentId, elementId, partId);
    const now = datetime.timestamp();
    // Both deletes must land before the insert. A second row for the same
    // item makes the owned-field lock's `.maybeSingle()` error, which
    // silently unlocks name and description on the item page — so a failure
    // here stops this part rather than inserting alongside.
    const clearedByItem = await serviceRole
      .from("externalIntegrationMapping")
      .delete()
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .eq("entityId", itemId);
    const clearedByExternal = clearedByItem.error
      ? null
      : await serviceRole
          .from("externalIntegrationMapping")
          .delete()
          .eq("companyId", companyId)
          .eq("integration", "onshape")
          .eq("entityType", "item")
          .eq("externalId", externalId);
    if (clearedByItem.error || clearedByExternal?.error) {
      results.push({
        partId,
        action: "error",
        message:
          "Item saved but its previous Onshape link could not be cleared; push again"
      });
      continue;
    }
    const inserted = await client.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: itemId,
      integration: "onshape",
      externalId,
      metadata: {
        documentId,
        elementId,
        partId,
        wv,
        wvId,
        // The plan-time microversion: the only "unchanged" signal a later
        // plan has, so it must be the one the user reviewed, not a newer one.
        microversionId: row.microversionId,
        partNumber: row.partNumber,
        name: row.name,
        revision: row.revision,
        pushedBy: userId,
        pushedAt: now,
        planId
      },
      lastSyncedAt: now,
      companyId,
      createdBy: userId
    });
    if (inserted.error) {
      results.push({
        partId,
        action: "error",
        message: "Item saved but the Onshape link failed; push again"
      });
      continue;
    }

    // One event id per plan × item × element: a retried apply of the same
    // plan cannot queue the export twice. If the event cannot be sent, the
    // mapping just written is removed again: it carries this microversion,
    // and leaving it would make the next plan read "unchanged" and never
    // queue the export at all.
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
          assetBaseName: row.partNumber ?? row.name
        },
        { id: `${planId}:${itemId}:${elementId}` }
      );
    } catch (error) {
      // Roll the mapping back so the next plan does not read "unchanged" and
      // skip the export forever. If the rollback itself fails, say so — the
      // advice to "push again" would otherwise be wrong, since the stale
      // mapping makes the next push a no-op.
      const rolledBack = await serviceRole
        .from("externalIntegrationMapping")
        .delete()
        .eq("companyId", companyId)
        .eq("integration", "onshape")
        .eq("entityType", "item")
        .eq("externalId", externalId);
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

  return data(warnings.length > 0 ? { results, warnings } : { results }, {
    headers: { "Cache-Control": "no-store" }
  });
}

/**
 * The item a create writes for a row: the plan's proposal when it has one,
 * else one built from the row (an adopt/update whose target vanished). The
 * row carries no Onshape description of its own, so that fallback takes the
 * description from the recorded owned-field change when there is one.
 */
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

/**
 * The Onshape-owned fields an adopt/update refreshes: always the Onshape name
 * and description the plan captured, whatever Carbon holds now — Onshape owns
 * them, and the plan's `changes` list is display only.
 */
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

/**
 * The owned-mode values an adopt/update writes, or null when the row has no
 * valued owned field — the part row is then left untouched.
 */
function ownedCustomFieldValues(row: PartPlanRow): {
  values: Record<string, string | number | boolean | null>;
  fieldIds: Set<string>;
} | null {
  const values: Record<string, string | number | boolean | null> = {};
  const fieldIds = new Set<string>();
  for (const field of row.customFields ?? []) {
    if (field.mode !== "owned") continue;
    // A null rides along: mergeCustomFieldValues deletes the key, so a
    // property emptied in Onshape empties in Carbon (owned means CAD wins).
    values[field.fieldId] = field.value;
    fieldIds.add(field.fieldId);
  }
  return fieldIds.size > 0 ? { values, fieldIds } : null;
}
