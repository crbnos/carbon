import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { nonConformancePriority } from "../quality/quality.models";
import type {
  ChangeOrderChangeType,
  ChangeOrderError,
  changeOrderStatus,
  changeOrderType
} from "./changeOrder.models";
import { isAllowedChangeOrderTransition } from "./changeOrder.models";
import {
  copyItem,
  copyItemPostingGroup,
  copyMakeMethod,
  createRevision,
  getItem,
  getNextRevision,
  upsertMakeMethodVersion
} from "./items.service";

// =============================================================================
// Change Orders — header CRUD, stage transitions, list, and CO Types config.
// =============================================================================

// -----------------------------------------------------------------------------
// Reads
// -----------------------------------------------------------------------------
export async function getChangeOrder(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  return client
    .from("changeOrder")
    .select("*")
    .eq("id", changeOrderId)
    .eq("companyId", companyId)
    .single();
}

export async function getChangeOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrder")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `changeOrderId.ilike.%${args.search}%,name.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "changeOrderId", ascending: false }
    ]);
  }

  return query;
}

// -----------------------------------------------------------------------------
// Header CRUD
// -----------------------------------------------------------------------------
export async function insertChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    changeOrderId?: string;
    name: string;
    type?: (typeof changeOrderType)[number];
    priority?: (typeof nonConformancePriority)[number];
    changeOrderTypeId?: string;
    nonConformanceId?: string;
    openDate: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; changeOrderId: string } | null;
  error: ChangeOrderError | null;
}> {
  let changeOrderId: string;
  if (input.changeOrderId) {
    changeOrderId = input.changeOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "changeOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error: seq.error ?? {
          message: "Failed to generate changeOrder sequence"
        }
      };
    }
    changeOrderId = seq.data;
  }

  const result = await client
    .from("changeOrder")
    .insert({
      changeOrderId,
      name: input.name,
      type: input.type ?? "Engineering",
      priority: input.priority ?? null,
      changeOrderTypeId: input.changeOrderTypeId ?? null,
      nonConformanceId: input.nonConformanceId ?? null,
      openDate: input.openDate,
      reasonForChange: input.reasonForChange ?? {},
      description: input.description ?? {},
      dueDate: input.dueDate ?? null,
      assignee: input.assignee ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id, changeOrderId")
    .single();

  if (result.error || !result.data) {
    return { data: null, error: result.error };
  }

  // No default actions are seeded on create — the CO starts with zero required
  // actions selected; the user picks them afterward from the rail's Required
  // Actions multiselect (reconciled by setChangeOrderActionTasks).

  return {
    data: { id: result.data.id, changeOrderId: result.data.changeOrderId },
    error: null
  };
}

export async function updateChangeOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    changeOrderId?: string;
    name?: string;
    type?: (typeof changeOrderType)[number];
    priority?: (typeof nonConformancePriority)[number] | null;
    changeOrderTypeId?: string | null;
    nonConformanceId?: string | null;
    openDate?: string;
    reasonForChange?: Json;
    description?: Json;
    dueDate?: string | null;
    assignee?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeOrderError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("changeOrder")
    .update(sanitize(rest))
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

export async function deleteChangeOrder(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
) {
  // Discard each affected item's CO-owned Draft first (the Draft make method for
  // a Version, or the revealed inactive item for a Revision/New Part). These are
  // NOT FK children of the change order, so the cascade below won't remove them —
  // only the changeOrderAffectedItem rows cascade. Without this, deleting a CO
  // orphans its drafts (mirrors removeChangeOrderAffectedItem's cleanup).
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("draftMakeMethodId, newItemId")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId);
  if (!affected.error && affected.data) {
    for (const item of affected.data) {
      await discardChangeOrderDraft(client, item, companyId);
    }
  }

  // Remaining children (affected items, action tasks) cascade via ON DELETE CASCADE.
  return client
    .from("changeOrder")
    .delete()
    .eq("id", changeOrderId)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Stage transition — the single guarded writer (G8), a compare-and-swap (G2).
// Forward-only (isAllowedChangeOrderTransition).
// -----------------------------------------------------------------------------
export async function updateChangeOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    companyId: string;
    fromStatus: (typeof changeOrderStatus)[number];
    toStatus: (typeof changeOrderStatus)[number];
    assignee?: string | null;
    updatedBy: string;
  }
): Promise<{
  data: { id: string; status: (typeof changeOrderStatus)[number] } | null;
  error: { message: string } | null;
}> {
  const { id, companyId, fromStatus, toStatus, ...rest } = update;

  if (!isAllowedChangeOrderTransition(fromStatus, toStatus)) {
    return {
      data: null,
      error: {
        message: `Cannot change status from ${fromStatus} to ${toStatus}`
      }
    };
  }

  // Build the update explicitly rather than sanitize({...rest}): sanitize coerces
  // every `undefined` field to null, which would wipe an existing assignee on a
  // transition where the caller passes it as undefined. Only set an optional
  // field when the caller provided a value.
  const payload: {
    status: (typeof changeOrderStatus)[number];
    updatedBy: string;
    assignee?: string | null;
  } = { status: toStatus, updatedBy: rest.updatedBy };
  if (rest.assignee !== undefined) payload.assignee = rest.assignee;

  const result = await client
    .from("changeOrder")
    .update(payload)
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("status", fromStatus)
    .select("id, status")
    .maybeSingle();

  if (result.error) return { data: null, error: result.error };
  if (!result.data) {
    return {
      data: null,
      error: {
        message:
          "The change order was updated by someone else. Refresh and try again."
      }
    };
  }
  return { data: result.data, error: null };
}

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export async function getChangeOrderTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("changeOrderType")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getChangeOrderTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("changeOrderType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function getChangeOrderType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderType").select("*").eq("id", id).single();
}

export async function upsertChangeOrderType(
  client: SupabaseClient<Database>,
  changeOrderType:
    | {
        name: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        name: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("createdBy" in changeOrderType) {
    return client
      .from("changeOrderType")
      .insert([changeOrderType])
      .select("id")
      .single();
  }
  return client
    .from("changeOrderType")
    .update(sanitize(changeOrderType))
    .eq("id", changeOrderType.id)
    .select("id")
    .single();
}

export async function deleteChangeOrderType(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("changeOrderType").delete().eq("id", id);
}

// =============================================================================
// Phase 2 — Products Affected
// =============================================================================

// Joins to `item` throughout Phase 2 are done as separate FLAT scalar selects +
// a JS stitch rather than PostgREST embeds: an embedded select instantiates
// PostgREST's deeply-recursive relation parser, and across the module that
// pushed TS's global instantiation budget over the edge (TS2589 in unrelated
// files). Flat selects barely instantiate.

// Climb the BOM (methodMaterial → makeMethod → item) from a set of start items up
// to the top-level products — items that are used by nothing. Returns each product
// with `sourceItemIds`: which of the start items (the targeted assemblies) rolled up
// into it (provenance, for the "affected by" display). Flat queries (no PostgREST
// embeds — TS2589 budget); a per-item origin set that only grows drives a fixpoint,
// so a corrupt/cyclic BOM can't loop forever and provenance fully propagates.
// `nodeBudget` is a pure infinite-loop backstop, not a depth limit.
export async function getTopLevelProductsForItems(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  data: Array<{ productId: string; sourceItemIds: string[] }>;
  error: { message: string } | null;
}> {
  const start = [...new Set(itemIds.filter(Boolean))];
  if (start.length === 0) return { data: [], error: null };

  // origins[item] = the start items (targeted assemblies) that reach it.
  const origins = new Map<string, Set<string>>();
  for (const s of start) origins.set(s, new Set([s]));
  // parentsCache[item] = its immediate parent items (one level up), fetched once.
  const parentsCache = new Map<string, Set<string>>();
  const roots = new Map<string, Set<string>>();

  const fetchParents = async (ids: string[]) => {
    const unknown = ids.filter((id) => !parentsCache.has(id));
    if (unknown.length === 0) return;
    for (const id of unknown) parentsCache.set(id, new Set());

    const materials = await client
      .from("methodMaterial")
      .select("itemId, makeMethodId")
      .in("itemId", unknown)
      .eq("companyId", companyId);
    if (materials.error) throw materials.error;

    const makeMethodIds = [
      ...new Set((materials.data ?? []).map((m) => m.makeMethodId))
    ];
    const parentByMethod = new Map<string, string>();
    if (makeMethodIds.length > 0) {
      const methods = await client
        .from("makeMethod")
        .select("id, itemId")
        .in("id", makeMethodIds)
        .eq("companyId", companyId);
      if (methods.error) throw methods.error;
      for (const mm of methods.data ?? []) parentByMethod.set(mm.id, mm.itemId);
    }
    for (const row of materials.data ?? []) {
      const parent = parentByMethod.get(row.makeMethodId);
      if (parent) parentsCache.get(row.itemId)?.add(parent);
    }
  };

  let queue = [...start];
  let nodeBudget = 20000;
  try {
    while (queue.length > 0 && nodeBudget > 0) {
      const batch = [...new Set(queue)];
      queue = [];
      nodeBudget -= batch.length;
      await fetchParents(batch);

      for (const id of batch) {
        const parents = parentsCache.get(id);
        const idOrigins = origins.get(id) ?? new Set<string>();

        if (!parents || parents.size === 0) {
          // used by nothing → a top-level product; record its origins
          if (!roots.has(id)) roots.set(id, new Set());
          const rootOrigins = roots.get(id)!;
          for (const o of idOrigins) rootOrigins.add(o);
          continue;
        }

        for (const parent of parents) {
          if (!origins.has(parent)) origins.set(parent, new Set());
          const target = origins.get(parent)!;
          const before = target.size;
          for (const o of idOrigins) target.add(o);
          // Re-enqueue when the parent's origin set grew (monotonic, finite → the
          // loop terminates even on cyclic data) so provenance fully propagates.
          if (target.size > before) queue.push(parent);
        }
      }
    }
  } catch (err) {
    return { data: [], error: { message: (err as Error).message } };
  }

  return {
    data: [...roots.entries()].map(([productId, srcs]) => ({
      productId,
      sourceItemIds: [...srcs]
    })),
    error: null
  };
}

// G3 — forward-reference to a not-yet-synced part. Mints a REAL item row
// (active=false, revisionStatus='Design') through the standard item shape so
// `changeOrderStagedMaterial.itemId` is always non-null and no placeholder branch
// is threaded downstream. Onshape sync reconciles by matching readableId+company
// (flip active, fill details). A cancelled CO can leave an inactive stub — it's
// filterable and tied to the CO, far cheaper than nullable-threading everywhere.
export async function mintPlaceholderPart(
  client: SupabaseClient<Database>,
  input: {
    readableId: string;
    name: string;
    companyId: string;
    createdBy: string;
    unitOfMeasureCode?: string;
  }
): Promise<{
  data: { id: string } | null;
  error: ChangeOrderError | null;
}> {
  const item = await client
    .from("item")
    .insert({
      readableId: input.readableId,
      revision: "0",
      name: input.name,
      type: "Part",
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: input.unitOfMeasureCode ?? "EA",
      active: false,
      revisionStatus: "Design",
      companyId: input.companyId,
      createdBy: input.createdBy
    })
    .select("id")
    .single();

  if (item.error || !item.data) return { data: null, error: item.error };

  const part = await client.from("part").insert({
    id: input.readableId,
    companyId: input.companyId,
    createdBy: input.createdBy
  });
  if (part.error) return { data: null, error: part.error };

  return { data: { id: item.data.id }, error: null };
}

// =============================================================================
// v2 — CO-owned Draft make-method orchestration (affected items).
//
// A CO's edits for one affected item live on a REAL Draft makeMethod owned by
// the CO (makeMethod.changeOrderId set) and hidden from version lists until
// release. Creating an affected item spins that draft per the change type:
//   Version  → new Draft method version on the SAME item (BoM/BoP edits).
//   Revision → new inactive revision item + its Draft method (attrs/docs).
//   New Part → new inactive part number (new readableId) + copied Draft method.
// All three keep the user client (the release path uses the same client for the
// same privileged method helpers — see applyChangeOrder / changeOrder.server).
// =============================================================================

// Mint the next readableId for a CO-derived New Part, following the SAME numbering
// scheme as the source part — so "GA-0029" yields "GA-0030", not a bare number.
// Server-side mirror of useNextItemId: split the source readableId into its
// non-numeric prefix + trailing number, ask the matching sequence RPC for the
// current MAX with that shape, then increment + zero-pad to the same width.
// Falls back to a plain numeric id when the source has no prefix.
async function getNextItemIdFromSource(
  client: SupabaseClient<Database>,
  companyId: string,
  itemType: Database["public"]["Enums"]["itemType"],
  sourceReadableId: string
): Promise<string> {
  const prefix = sourceReadableId.match(/^(.*?)\d+$/)?.[1] ?? "";

  const rpc = prefix
    ? await client.rpc("get_next_prefixed_sequence", {
        company_id: companyId,
        item_type: itemType,
        prefix
      })
    : await client.rpc("get_next_numeric_sequence", {
        company_id: companyId,
        item_type: itemType
      });

  const current = rpc.data;
  const sequence = current?.slice(prefix.length) ?? "";
  const currentSequence = parseInt(sequence, 10);
  if (!current || Number.isNaN(currentSequence)) {
    return `${prefix}${(1).toString().padStart(9, "0")}`;
  }
  // Preserve the source's digit width (mirrors useNextItemId's pad math).
  const tail = current.split(`${currentSequence}`)?.[1]?.length ?? 0;
  const width = Math.max(sequence.length - tail, 1);
  return `${prefix}${(currentSequence + 1).toString().padStart(width, "0")}`;
}

// Resolve the current Active make method id for an item (the base the draft is
// copied from + the merge base at release). Falls back to the highest version.
// Also returns `maxVersion` = the highest version number across ALL of the
// item's methods (Draft/Active/Archived) — a new draft must be numbered above
// this, not above the Active one, so parallel COs on the same item don't collide
// on the `(itemId, version)` unique constraint (a hidden CO draft already holds
// Active+1).
async function getActiveMakeMethodId(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<{ id: string; version: number; maxVersion: number } | null> {
  const methods = await client
    .from("makeMethod")
    .select("id, version, status")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false });
  const rows = methods.data ?? [];
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.status === "Active");
  const chosen = active ?? rows[0];
  // rows are ordered by version DESC, so rows[0] holds the highest version.
  const maxVersion = rows[0].version ?? chosen.version ?? 1;
  return { id: chosen.id, version: chosen.version ?? 1, maxVersion };
}

// Fetch the (single) Draft make method for a freshly-created item — the trigger
// creates one and createRevision/copyItem populate it.
async function getDraftMakeMethodIdForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const draft = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return draft.data?.id ?? null;
}

type DraftMethodResult = {
  data: {
    draftMakeMethodId: string | null;
    baseMakeMethodId: string | null;
    newItemId: string | null;
  } | null;
  error: ChangeOrderError | null;
};

// Create the CO-owned Draft make method for an affected item per its change type.
export async function createChangeOrderDraftMethod(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    itemId: string;
    changeType: ChangeOrderChangeType;
    companyId: string;
    userId: string;
  }
): Promise<DraftMethodResult> {
  const { changeOrderId, itemId, changeType, companyId, userId } = input;

  const base = await getActiveMakeMethodId(client, itemId, companyId);

  if (changeType === "Version") {
    if (!base) {
      return {
        data: null,
        error: { message: "Item has no make method to version" }
      };
    }
    // New Draft version on the same item, then copy the BoM/BoP rows (the
    // canonical new-version flow: header insert + copyMakeMethod). Number it
    // above ALL existing versions (maxVersion + 1), not the Active one, so a
    // second CO on the same part doesn't collide on (itemId, version). Retry on
    // a concurrent unique-violation by recomputing the next free version.
    let draftId: string | null = null;
    let nextVersion = base.maxVersion + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await upsertMakeMethodVersion(client, {
        copyFromId: base.id,
        version: nextVersion,
        companyId,
        createdBy: userId
      });
      if (!res.error && res.data) {
        draftId = res.data.id;
        break;
      }
      // 23505 = unique_violation (makeMethod_unique_itemId_version); a parallel
      // CO grabbed this number first — recompute the next free version + retry.
      if (res.error?.code === "23505") {
        const latest = await getActiveMakeMethodId(client, itemId, companyId);
        nextVersion = (latest?.maxVersion ?? nextVersion) + 1;
        continue;
      }
      return {
        data: null,
        error: res.error ?? { message: "Failed to create draft version" }
      };
    }
    if (!draftId) {
      return {
        data: null,
        error: { message: "Failed to create draft version" }
      };
    }
    // @ts-expect-error TS2345 - getMethodValidator flags default via edge fn
    const copy = await copyMakeMethod(client, {
      sourceId: base.id,
      targetId: draftId,
      companyId,
      userId
    });
    if (copy.error) {
      return { data: null, error: { message: "Failed to copy make method" } };
    }
    const stamp = await client
      .from("makeMethod")
      .update({ changeOrderId })
      .eq("id", draftId)
      .eq("companyId", companyId);
    if (stamp.error) return { data: null, error: stamp.error };
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: base.id,
        newItemId: null
      },
      error: null
    };
  }

  if (changeType === "Revision") {
    const source = await getItem(client, itemId);
    if (source.error || !source.data) {
      return { data: null, error: { message: "Item not found" } };
    }
    // Next revision string across the item's readableId siblings.
    const siblings = await client
      .from("item")
      .select("revision")
      .eq("readableId", source.data.readableId)
      .eq("companyId", companyId)
      .eq("type", source.data.type)
      .order("revision", { ascending: false });
    const maxRevision = siblings.data?.[0]?.revision ?? "0";
    const nextRevision = getNextRevision(maxRevision);

    const revision = await createRevision(client, {
      item: source.data,
      revision: nextRevision,
      createdBy: userId,
      active: false
    });
    if (revision.error || !revision.data) {
      return { data: null, error: revision.error };
    }
    const newItemId = revision.data.id;
    const draftId = await getDraftMakeMethodIdForItem(
      client,
      newItemId,
      companyId
    );
    const stampItem = await client
      .from("item")
      .update({ changeOrderId })
      .eq("id", newItemId)
      .eq("companyId", companyId);
    if (stampItem.error) return { data: null, error: stampItem.error };
    if (draftId) {
      await client
        .from("makeMethod")
        .update({ changeOrderId })
        .eq("id", draftId)
        .eq("companyId", companyId);
    }
    return {
      data: {
        draftMakeMethodId: draftId,
        baseMakeMethodId: base?.id ?? null,
        newItemId
      },
      error: null
    };
  }

  // New Part — a new part number derived from + (at release) superseding the
  // affected part. ECO scope is Parts + Tools (Materials/Consumables/Services
  // excluded); reject other types rather than mint a malformed row.
  const source = await getItem(client, itemId);
  if (source.error || !source.data) {
    return { data: null, error: { message: "Item not found" } };
  }
  if (source.data.type !== "Part" && source.data.type !== "Tool") {
    return {
      data: null,
      error: {
        message: `New Part is only supported for Parts and Tools (got ${source.data.type})`
      }
    };
  }
  const newReadableId = await getNextItemIdFromSource(
    client,
    companyId,
    source.data.type,
    source.data.readableId
  );
  const newItem = await client
    .from("item")
    .insert({
      readableId: newReadableId,
      revision: "0",
      name: source.data.name,
      type: source.data.type,
      replenishmentSystem: source.data.replenishmentSystem,
      defaultMethodType: source.data.defaultMethodType,
      itemTrackingType: source.data.itemTrackingType,
      unitOfMeasureCode: source.data.unitOfMeasureCode,
      // Faithfully copy the source's attributes so the CO diff shows only the
      // user's edits, not gaps left by an incomplete copy.
      description: source.data.description,
      sourcingType: source.data.sourcingType,
      requiresInspection: source.data.requiresInspection,
      thumbnailPath: source.data.thumbnailPath,
      mpn: source.data.mpn,
      active: false,
      revisionStatus: "Design",
      changeOrderId,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (newItem.error || !newItem.data) {
    return { data: null, error: newItem.error };
  }
  const newItemId = newItem.data.id;
  const typeTable = source.data.type === "Part" ? "part" : "tool";
  const typeRow = await client
    .from(typeTable)
    .insert({ id: newReadableId, companyId, createdBy: userId });
  if (typeRow.error) return { data: null, error: typeRow.error };

  // Carry the source's item group (on itemCost) onto the new part.
  await copyItemPostingGroup(client, {
    sourceItemId: itemId,
    targetItemId: newItemId,
    companyId
  });

  // Copy the affected part's method into the new item's (trigger-created) draft.
  // @ts-expect-error TS2345 - getMethodValidator flags default via edge fn
  const copy = await copyItem(client, {
    sourceId: itemId,
    targetId: newItemId,
    companyId,
    userId
  });
  if (copy.error) {
    return { data: null, error: { message: "Failed to copy make method" } };
  }
  const draftId = await getDraftMakeMethodIdForItem(
    client,
    newItemId,
    companyId
  );
  if (draftId) {
    await client
      .from("makeMethod")
      .update({ changeOrderId })
      .eq("id", draftId)
      .eq("companyId", companyId);
  }
  return {
    data: {
      draftMakeMethodId: draftId,
      baseMakeMethodId: base?.id ?? null,
      newItemId
    },
    error: null
  };
}

// Discard an affected item's CO-owned Draft (used on change-type switch + when
// removing the affected item). Deletes the new item for Revision/New Part
// (cascades its method rows) or the Draft method for Version.
async function discardChangeOrderDraft(
  client: SupabaseClient<Database>,
  affected: {
    draftMakeMethodId: string | null;
    newItemId: string | null;
  },
  companyId: string
): Promise<void> {
  if (affected.newItemId) {
    await client
      .from("item")
      .delete()
      .eq("id", affected.newItemId)
      .eq("companyId", companyId);
    return;
  }
  if (affected.draftMakeMethodId) {
    await client
      .from("makeMethod")
      .delete()
      .eq("id", affected.draftMakeMethodId)
      .eq("companyId", companyId);
  }
}

// Add an affected item to a CO: insert the row, then spin its CO-owned Draft
// make method per the change type and write the draft refs back. Rolls the row
// back if draft creation fails (edge-fn calls can't share one txn — G2).
export async function addChangeOrderAffectedItem(
  client: SupabaseClient<Database>,
  input: {
    changeOrderId: string;
    itemId: string;
    changeType: ChangeOrderChangeType;
    companyId: string;
    userId: string;
  }
): Promise<{
  data: { id: string; draftMakeMethodId: string | null } | null;
  error: ChangeOrderError | null;
}> {
  const { changeOrderId, itemId, changeType, companyId, userId } = input;

  // A purchased (Buy) item has no BoM/BoP, so a Version change is a no-op —
  // default it to a Revision (part-data/docs), the meaningful change for Buy.
  let effectiveChangeType = changeType;
  if (changeType === "Version") {
    const item = await client
      .from("item")
      .select("replenishmentSystem")
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (item.data?.replenishmentSystem === "Buy") {
      effectiveChangeType = "Revision";
    }
  }

  const last = await client
    .from("changeOrderAffectedItem")
    .select("sortOrder")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last.data?.sortOrder ?? -1) + 1;

  const inserted = await client
    .from("changeOrderAffectedItem")
    .insert({
      changeOrderId,
      itemId,
      changeType: effectiveChangeType,
      sortOrder,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    return { data: null, error: inserted.error };
  }
  const affectedItemId = inserted.data.id;

  const draft = await createChangeOrderDraftMethod(client, {
    changeOrderId,
    itemId,
    changeType: effectiveChangeType,
    companyId,
    userId
  });
  if (draft.error || !draft.data) {
    await client
      .from("changeOrderAffectedItem")
      .delete()
      .eq("id", affectedItemId)
      .eq("companyId", companyId);
    return { data: null, error: draft.error };
  }

  await client
    .from("changeOrderAffectedItem")
    .update({
      draftMakeMethodId: draft.data.draftMakeMethodId,
      baseMakeMethodId: draft.data.baseMakeMethodId,
      newItemId: draft.data.newItemId,
      updatedBy: userId
    })
    .eq("id", affectedItemId)
    .eq("companyId", companyId);

  return {
    data: {
      id: affectedItemId,
      draftMakeMethodId: draft.data.draftMakeMethodId
    },
    error: null
  };
}

// Switch an affected item's change type: discard its current draft and rebuild
// for the new type (Q2 — the editable surface differs per type, so edits reset).
export async function updateChangeOrderAffectedItemChangeType(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    changeType: ChangeOrderChangeType;
    companyId: string;
    userId: string;
  }
): Promise<{ data: { id: string } | null; error: ChangeOrderError | null }> {
  const { id, changeType, companyId, userId } = input;

  const affected = await client
    .from("changeOrderAffectedItem")
    .select(
      "id, changeOrderId, itemId, changeType, draftMakeMethodId, newItemId"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (affected.error || !affected.data) {
    return { data: null, error: { message: "Affected item not found" } };
  }
  if (affected.data.changeType === changeType) {
    return { data: { id }, error: null };
  }

  // Create the replacement Draft BEFORE destroying the current one, so a failure
  // in creation or the ref swap leaves the affected row still pointing at a valid
  // (undeleted) draft instead of a dangling reference. The old draft is discarded
  // only after the swap succeeds (worst case on a late failure is an orphaned
  // draft, never a dangling ref). Capture the old refs first.
  const previousDraft = {
    draftMakeMethodId: affected.data.draftMakeMethodId,
    newItemId: affected.data.newItemId
  };

  const draft = await createChangeOrderDraftMethod(client, {
    changeOrderId: affected.data.changeOrderId,
    itemId: affected.data.itemId,
    changeType,
    companyId,
    userId
  });
  if (draft.error || !draft.data) {
    return { data: null, error: draft.error };
  }

  const updated = await client
    .from("changeOrderAffectedItem")
    .update({
      changeType,
      draftMakeMethodId: draft.data.draftMakeMethodId,
      baseMakeMethodId: draft.data.baseMakeMethodId,
      newItemId: draft.data.newItemId,
      updatedBy: userId
    })
    .eq("id", id)
    .eq("companyId", companyId);
  if (updated.error) return { data: null, error: updated.error };

  // Swap succeeded — now safe to discard the superseded draft.
  await discardChangeOrderDraft(client, previousDraft, companyId);
  return { data: { id }, error: null };
}

// Update the per-item revision cutover config (mode + dates). The existence of
// the oldRev→newRev supersession is automatic at release; this only tunes it.
export async function updateChangeOrderAffectedItemCutover(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    supersessionMode: Database["public"]["Enums"]["supersessionMode"];
    discontinuationDate?: string;
    successorEffectivityDate?: string;
    userId: string;
  }
) {
  const { id, userId, ...rest } = input;
  return client
    .from("changeOrderAffectedItem")
    .update({
      ...sanitize(rest),
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

// =============================================================================
// Affected-item + supersession reads/writes (label-stitched). Flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget).
// =============================================================================

// The minimal item label rendered next to each affected item / supersession.
export type ChangeOrderStagingItemLabel = {
  id: string;
  readableId: string;
  readableIdWithRevision: string | null;
  name: string;
  type: Database["public"]["Enums"]["itemType"];
  active: boolean;
  revisionStatus: Database["public"]["Enums"]["itemRevisionStatus"];
  replenishmentSystem: Database["public"]["Enums"]["itemReplenishmentSystem"];
};

type ChangeOrderAffectedItemRow =
  Database["public"]["Tables"]["changeOrderAffectedItem"]["Row"];

export type ChangeOrderAffectedItemWithLabel = ChangeOrderAffectedItemRow & {
  item: ChangeOrderStagingItemLabel | null;
};

const ITEM_LABEL_COLUMNS =
  "id, readableId, readableIdWithRevision, name, type, active, revisionStatus, replenishmentSystem";

// Fetch minimal item labels for a set of ids, indexed by item id.
async function stitchItemLabels(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<{
  labels: Map<string, ChangeOrderStagingItemLabel>;
  error: { message: string } | null;
}> {
  const uniqueIds = [...new Set(itemIds)];
  const labels = new Map<string, ChangeOrderStagingItemLabel>();
  if (uniqueIds.length === 0) return { labels, error: null };

  const items = await client
    .from("item")
    .select(ITEM_LABEL_COLUMNS)
    .in("id", uniqueIds)
    .eq("companyId", companyId);

  if (items.error) return { labels, error: items.error };
  for (const it of items.data ?? [])
    labels.set(it.id, it as ChangeOrderStagingItemLabel);

  return { labels, error: null };
}

// The affected items of a CO, each stitched to a minimal item label.
export async function getChangeOrderAffectedItems(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderAffectedItemWithLabel[];
  error: { message: string } | null;
}> {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("*")
    .eq("changeOrderId", changeOrderId)
    .eq("companyId", companyId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });

  if (affected.error) return { data: [], error: affected.error };
  const rows = affected.data ?? [];
  if (rows.length === 0) return { data: [], error: null };

  const { labels, error } = await stitchItemLabels(
    client,
    rows.map((r) => r.itemId),
    companyId
  );
  if (error) return { data: [], error };

  return {
    data: rows.map((r) => ({ ...r, item: labels.get(r.itemId) ?? null })),
    error: null
  };
}

// Remove an affected item + discard its CO-owned Draft (delete the new item for
// Revision/New Part, or the Draft method for Version) so no orphan draft leaks.
export async function removeChangeOrderAffectedItem(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  const affected = await client
    .from("changeOrderAffectedItem")
    .select("draftMakeMethodId, newItemId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!affected.error && affected.data) {
    await discardChangeOrderDraft(client, affected.data, companyId);
  }
  return client
    .from("changeOrderAffectedItem")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}
