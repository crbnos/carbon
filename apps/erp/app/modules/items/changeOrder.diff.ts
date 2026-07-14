import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChangeOrderItemDiff,
  ChangeOrderMergeChoice,
  ChangeOrderReleaseConflict,
  ChangeOrderReleaseConflictEntry,
  MethodDiffEntry,
  MethodDiffStatus,
  OperationChildrenDiff,
  OperationDiffEntry
} from "./changeOrder.models";
import { getChangeOrderAffectedItems } from "./changeOrder.service";

// Re-export the operation diff types (now owned by changeOrder.models to avoid a
// circular import) so existing `from "./changeOrder.diff"` callers keep working.
export type { OperationChildrenDiff, OperationDiffEntry };

// =============================================================================
// Change Orders — the reusable method-diff engine (Q5 git-style end-state).
//
// `diffMethod` is a PURE function (no DB access, unit-testable): it compares two
// method snapshots (a `base` = the current live method, a `target` = the CO's
// staged desired end-state) and classifies every material / operation as
// added / removed / modified / unchanged, plus a column-by-column attribute diff.
// The same shape is reused for the pre-release "tips" (staged-vs-live) and the
// post-release oldRev↔newRev redline (Task 17).
//
// `getChangeOrderDiff` is the DB-facing wrapper: for each affected item it reads
// the current source method live + the staged rows, runs `diffMethod`, and also
// returns the manual supersession declarations. Reads are flat selects + JS
// stitch (no composite-FK PostgREST embeds — the erp TS2589 budget; see lessons).
// =============================================================================

// A plain record — DB rows are passed straight through; the engine is generic
// over the shape and only reads the compared field subset + the identity keys.
type Row = Record<string, unknown>;

// Materials are matched by identity: a staged/target row's `sourceMaterialId`
// links it to a base row's `id`. Operations use `sourceOperationId`. Operation
// CHILDREN (steps / parameters / tools) use `sourceId` (the staged child's
// pointer at the live child it was copied from; NULL ⇒ added child line).
const MATERIAL_SOURCE_KEY = "sourceMaterialId";
const OPERATION_SOURCE_KEY = "sourceOperationId";
const CHILD_SOURCE_KEY = "sourceId";

// Never compared — audit / linkage / tenancy columns. The compared set for every
// staged entity is derived as (staged row keys − this set), so adding a mirrored
// business column to a staged table automatically includes it in the diff; only
// genuine noise columns need listing here.
const IGNORED_FIELDS = new Set<string>([
  "id",
  "companyId",
  "changeOrderId",
  "affectedItemId",
  "sourceMaterialId",
  "sourceOperationId",
  "sourceId",
  "stagedOperationId",
  // v2: base and draft rows live on different real methods/operations, so these
  // linkage columns always differ and must never count as a business change.
  "makeMethodId",
  "operationId",
  // The customFields JSON bag differs as a copy artifact (null vs {}), surfacing
  // a meaningless "— → Set" on unrelated edits — never diff it as a whole column.
  "customFields",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
]);

// Loose equality tolerant of the numeric-string ↔ number skew that Supabase
// returns for NUMERIC columns (a live `quantity` may be `"1"` while a staged one
// is `1`). null and undefined are the same "empty" value. JSON/array columns
// (workInstruction, step description, listValues/fileTypes) are separate object
// instances on the live vs staged side, so they're compared structurally — a
// reference check would report every non-null one as changed.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// The business columns to compare for a matched (base, target) pair: every key
// the CO actually STAGED (the target row), minus the audit/linkage/tenancy set.
// Deriving from the staged row — not a hand-maintained per-entity list, and not
// the union with the live row — is what keeps the diff in lockstep with the
// mirrored schema: staging copies exactly the changeable columns, live rows carry
// extra columns (makeMethodId, …) that must NOT be compared against `undefined`.
function comparedFields(target: Row): string[] {
  return Object.keys(target).filter((k) => !IGNORED_FIELDS.has(k));
}

// Build the field-level change map for a matched (base, target) pair. Returns
// undefined when nothing changed.
function diffFields(
  base: Row,
  target: Row
): Record<string, { before: unknown; after: unknown }> | undefined {
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of comparedFields(target)) {
    if (!valuesEqual(base[field], target[field])) {
      changed[field] = {
        before: base[field] ?? null,
        after: target[field] ?? null
      };
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

// Match target rows to base rows by the given source-pointer key, then classify.
//   - base row with no target pointing at it            ⇒ removed
//   - target row with a null/absent source pointer      ⇒ added
//   - target whose source pointer references a base row  ⇒ modified | unchanged
function diffRows(
  base: Row[],
  target: Row[],
  sourceKey: string
): MethodDiffEntry<Row>[] {
  const entries: MethodDiffEntry<Row>[] = [];

  // Index base rows by their id for O(1) lookup, and track which get matched.
  const baseById = new Map<string, Row>();
  for (const row of base) {
    const id = row.id;
    if (typeof id === "string") baseById.set(id, row);
  }
  const matchedBaseIds = new Set<string>();

  for (const targetRow of target) {
    const sourceId = targetRow[sourceKey];
    const baseRow =
      typeof sourceId === "string" ? baseById.get(sourceId) : undefined;

    if (!baseRow) {
      // No live counterpart — a newly-added line.
      entries.push({ status: "added", before: null, after: targetRow });
      continue;
    }

    matchedBaseIds.add(baseRow.id as string);
    const changedFields = diffFields(baseRow, targetRow);
    const status: MethodDiffStatus = changedFields ? "modified" : "unchanged";
    entries.push({
      status,
      before: baseRow,
      after: targetRow,
      ...(changedFields ? { changedFields } : {})
    });
  }

  // Any base row nothing pointed at was dropped from the staged end-state.
  for (const baseRow of base) {
    const id = baseRow.id;
    if (typeof id === "string" && !matchedBaseIds.has(id)) {
      entries.push({ status: "removed", before: baseRow, after: null });
    }
  }

  return entries;
}

// -----------------------------------------------------------------------------
// Operation children (steps / parameters / tools)
// -----------------------------------------------------------------------------

// The three staged child buckets for a single operation, keyed by the staged
// operation's id. Both the live (base) children and the staged (target) children
// share this shape.
export type OperationChildren = {
  steps: Row[];
  parameters: Row[];
  tools: Row[];
};

// OperationChildrenDiff and OperationDiffEntry now live in changeOrder.models
// (imported + re-exported above) so ChangeOrderItemDiff can reference them
// without a circular import. Their shape is unchanged (Row = Record<string,
// unknown>, the same as MethodDiffEntry's generic here).

// Base/target children keyed by operation id. For target (staged) operations the
// key is the staged operation's own id; for base (live) operations it's the live
// operation's id. Matching a staged operation to its base children goes through
// the operation's `sourceOperationId`.
export type ChildrenByOperationId = Record<string, OperationChildren>;

function emptyChildren(): OperationChildren {
  return { steps: [], parameters: [], tools: [] };
}

// Diff one operation's children. `base`/`target` are the live/staged child
// buckets; each bucket is matched by `sourceId` over its own compare-field set.
function diffOperationChildren(
  base: OperationChildren,
  target: OperationChildren
): OperationChildrenDiff {
  return {
    steps: diffRows(base.steps, target.steps, CHILD_SOURCE_KEY),
    parameters: diffRows(base.parameters, target.parameters, CHILD_SOURCE_KEY),
    tools: diffRows(base.tools, target.tools, CHILD_SOURCE_KEY)
  };
}

// Diff operations AND, when child buckets are supplied, attach a per-operation
// child diff. Matches operations exactly like diffRows (by `sourceOperationId`);
// for each entry it pairs the base children (via the matched base operation id)
// with the target children (via the staged operation id) and runs
// `diffOperationChildren`. When no child maps are supplied it degrades to the
// plain operation diff (identical to `diffRows`), so existing callers/tests are
// unaffected.
function diffOperations(
  base: Row[],
  target: Row[],
  baseChildren?: ChildrenByOperationId,
  targetChildren?: ChildrenByOperationId
): OperationDiffEntry[] {
  const entries = diffRows(
    base,
    target,
    OPERATION_SOURCE_KEY
  ) as OperationDiffEntry[];

  if (!baseChildren && !targetChildren) return entries;

  for (const entry of entries) {
    const baseId = (entry.before as { id?: string } | null)?.id;
    const targetId = (entry.after as { id?: string } | null)?.id;
    const baseKids = (baseId && baseChildren?.[baseId]) || emptyChildren();
    const targetKids =
      (targetId && targetChildren?.[targetId]) || emptyChildren();
    entry.children = diffOperationChildren(baseKids, targetKids);
  }

  return entries;
}

// Column-by-column diff of two attribute objects. Every key present in either
// object (minus the ignored audit/linkage set) is compared; each changed column
// becomes one MethodDiffEntry whose `changedFields` holds the single field. When
// nothing changed a single "unchanged" entry is returned so callers can render
// "no attribute changes" uniformly.
function diffAttributes(
  base: Row | null,
  target: Row | null
): MethodDiffEntry<Row>[] {
  const b = base ?? {};
  const t = target ?? {};
  // Compare only the columns the CO staged (target), minus audit/linkage — the
  // live source select carries extra columns (e.g. modelUploadId) the staged row
  // doesn't mirror, and comparing those against `undefined` would be spurious.
  const keys = target ? comparedFields(target) : [];

  const entries: MethodDiffEntry<Row>[] = [];
  for (const key of keys) {
    if (valuesEqual(b[key], t[key])) continue;
    entries.push({
      status: "modified",
      before: base,
      after: target,
      changedFields: {
        [key]: { before: b[key] ?? null, after: t[key] ?? null }
      }
    });
  }

  if (entries.length === 0) {
    return [{ status: "unchanged", before: base, after: target }];
  }
  return entries;
}

// -----------------------------------------------------------------------------
// The pure diff engine
// -----------------------------------------------------------------------------

export type DiffMethodInput = {
  baseMaterials: Row[];
  targetMaterials: Row[];
  baseOperations: Row[];
  targetOperations: Row[];
  baseAttributes?: Row | null;
  targetAttributes?: Row | null;
  // Optional per-operation children (steps/parameters/tools), keyed by operation
  // id (live op id for base, staged op id for target). When omitted, operation
  // entries carry no `children` and the result is identical to the pre-Task-16
  // shape.
  baseOperationChildren?: ChildrenByOperationId;
  targetOperationChildren?: ChildrenByOperationId;
};

export type DiffMethodResult = {
  materials: MethodDiffEntry<Row>[];
  // Operations may carry an optional child-level diff (see OperationDiffEntry).
  // OperationDiffEntry is a superset of MethodDiffEntry<Row>, so consumers typed
  // against MethodDiffEntry<Row>[] keep working.
  operations: OperationDiffEntry[];
  attributes: MethodDiffEntry<Row>[];
};

// PURE. Compares two method snapshots. No DB access — the caller supplies plain
// rows (live method rows as `base`, CO-staged rows as `target`), and optionally
// the per-operation child buckets to also diff steps/parameters/tools.
export function diffMethod(input: DiffMethodInput): DiffMethodResult {
  return {
    materials: diffRows(
      input.baseMaterials,
      input.targetMaterials,
      MATERIAL_SOURCE_KEY
    ),
    operations: diffOperations(
      input.baseOperations,
      input.targetOperations,
      input.baseOperationChildren,
      input.targetOperationChildren
    ),
    attributes: diffAttributes(
      input.baseAttributes ?? null,
      input.targetAttributes ?? null
    )
  };
}

// -----------------------------------------------------------------------------
// DB-facing wrapper
// -----------------------------------------------------------------------------

export type ChangeOrderDiff = {
  items: ChangeOrderItemDiff[];
};

// Editable item attribute columns compared for the attribute diff. `mpn` lives on
// item; the item group (itemPostingGroupId) lives on itemCost and is merged in
// separately by readItemAttributes. `active` is intentionally excluded — a CO
// draft is created inactive until release, so it always differs (not a real edit).
const ITEM_ATTRIBUTE_COLUMNS =
  "name, description, unitOfMeasureCode, itemTrackingType, defaultMethodType, replenishmentSystem, sourcingType, requiresInspection, thumbnailPath, mpn";

// Read one make method's materials + operations + per-operation children (real
// method tables — the v2 substrate). Empty for a null makeMethodId (e.g. a Buy
// item with no method, or before a draft exists).
async function readMethodRows(
  client: SupabaseClient<Database>,
  makeMethodId: string | null,
  companyId: string
): Promise<{
  materials: Row[];
  operations: Row[];
  children: ChildrenByOperationId;
  error: { message: string } | null;
}> {
  const empty = { materials: [], operations: [], children: {}, error: null };
  if (!makeMethodId) return empty;

  const [materials, operations] = await Promise.all([
    client
      .from("methodMaterial")
      .select("*")
      .eq("makeMethodId", makeMethodId)
      .eq("companyId", companyId)
      .order("order", { ascending: true }),
    client
      .from("methodOperation")
      .select("*")
      .eq("makeMethodId", makeMethodId)
      .eq("companyId", companyId)
      .order("order", { ascending: true })
  ]);
  if (materials.error) return { ...empty, error: materials.error };
  if (operations.error) return { ...empty, error: operations.error };

  const ops = (operations.data ?? []) as Row[];
  const children: ChildrenByOperationId = {};
  const opIds = ops
    .map((o) => o.id)
    .filter((id): id is string => typeof id === "string");

  if (opIds.length > 0) {
    const [steps, parameters, tools] = await Promise.all([
      client
        .from("methodOperationStep")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId),
      client
        .from("methodOperationParameter")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId),
      client
        .from("methodOperationTool")
        .select("*")
        .in("operationId", opIds)
        .eq("companyId", companyId)
    ]);
    if (steps.error) return { ...empty, error: steps.error };
    if (parameters.error) return { ...empty, error: parameters.error };
    if (tools.error) return { ...empty, error: tools.error };

    for (const id of opIds)
      children[id] = { steps: [], parameters: [], tools: [] };
    for (const r of (steps.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.steps.push(r);
    }
    for (const r of (parameters.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.parameters.push(r);
    }
    for (const r of (tools.data ?? []) as Row[]) {
      const op = r.operationId;
      if (typeof op === "string") children[op]?.tools.push(r);
    }
  }

  return {
    materials: (materials.data ?? []) as Row[],
    operations: ops,
    children,
    error: null
  };
}

// The v2 draft method is created by copying the base method, so it initially
// mirrors the base 1:1 with NO back-pointer ids. We reconstruct the source
// pointers the pure engine expects by matching each target row to a base row on
// a natural key (materials → component itemId, operations → order, children →
// name/key/toolId), first-unmatched-wins. An unmatched target row is an add; an
// unmatched base row is a remove.
function correlate(
  base: Row[],
  target: Row[],
  keyField: string,
  sourceKey: string
): void {
  const usedBaseIds = new Set<string>();
  for (const t of target) {
    const key = t[keyField];
    const match = base.find(
      (b) =>
        b[keyField] === key &&
        typeof b.id === "string" &&
        !usedBaseIds.has(b.id)
    );
    if (match && typeof match.id === "string") {
      usedBaseIds.add(match.id);
      t[sourceKey] = match.id;
    } else {
      t[sourceKey] = null;
    }
  }
}

async function readItemAttributes(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<Row | null> {
  const [item, cost] = await Promise.all([
    client
      .from("item")
      .select(ITEM_ATTRIBUTE_COLUMNS)
      .eq("id", itemId)
      .eq("companyId", companyId)
      .maybeSingle(),
    // The item group lives on itemCost, not item — merge it in so it diffs too.
    client
      .from("itemCost")
      .select("itemPostingGroupId")
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (!item.data) return null;
  return {
    ...(item.data as Row),
    itemPostingGroupId: cost.data?.itemPostingGroupId ?? null
  };
}

// Resolve item-group ids → their names for readable diff display.
async function readPostingGroupNames(
  client: SupabaseClient<Database>,
  ids: string[],
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)].filter((id) => id.length > 0);
  if (unique.length === 0) return map;
  const groups = await client
    .from("itemPostingGroup")
    .select("id, name")
    .in("id", unique)
    .eq("companyId", companyId);
  for (const g of groups.data ?? []) {
    if (g.id && g.name) map.set(g.id, g.name);
  }
  return map;
}

// Resolve component item UUIDs → human-readable ids (e.g. `P000123.A`). The diff
// viewer labels each BOM line by its component; a `methodMaterial` row carries only
// the item UUID, and the client `useItems` store can miss a just-minted/placeholder
// component. Resolving here (server-side, guaranteed present) makes the label
// store-independent. Flat select scoped by companyId.
async function readItemReadableIds(
  client: SupabaseClient<Database>,
  itemIds: string[],
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(itemIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return map;
  const items = await client
    .from("item")
    .select("id, readableIdWithRevision")
    .in("id", unique)
    .eq("companyId", companyId);
  for (const row of items.data ?? []) {
    if (row.id && row.readableIdWithRevision)
      map.set(row.id, row.readableIdWithRevision);
  }
  return map;
}

// Stamp the resolved readable id onto each material diff row (before + after) under
// `itemReadableId`, so the read-only viewer can label the line without a store
// lookup. Applied AFTER diffMethod so it never counts as a business-field change.
function stampMaterialReadableIds(
  materials: MethodDiffEntry<Row>[],
  readableIds: Map<string, string>
): void {
  for (const entry of materials) {
    for (const row of [entry.before, entry.after]) {
      const itemId = (row as { itemId?: string } | null)?.itemId;
      if (row && typeof itemId === "string") {
        const readable = readableIds.get(itemId);
        if (readable) (row as Row).itemReadableId = readable;
      }
    }
  }
}

// For every affected item: read the base (source Active) method as `base` and the
// CO-owned Draft method as `target` (both REAL method tables), correlate by
// natural keys, run the pure `diffMethod`, and collect. Also returns the manual
// supersession declarations. Flat selects scoped by companyId (no embeds).
export async function getChangeOrderDiff(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{ data: ChangeOrderDiff; error: { message: string } | null }> {
  const affected = await getChangeOrderAffectedItems(
    client,
    changeOrderId,
    companyId
  );
  if (affected.error) return { data: { items: [] }, error: affected.error };

  const items: ChangeOrderItemDiff[] = [];

  for (const affectedItem of affected.data) {
    const base = await readMethodRows(
      client,
      affectedItem.baseMakeMethodId,
      companyId
    );
    if (base.error) return { data: { items: [] }, error: base.error };
    const target = await readMethodRows(
      client,
      affectedItem.draftMakeMethodId,
      companyId
    );
    if (target.error) return { data: { items: [] }, error: target.error };

    // Reconstruct source pointers by natural key.
    correlate(base.materials, target.materials, "itemId", MATERIAL_SOURCE_KEY);
    correlate(
      base.operations,
      target.operations,
      "order",
      OPERATION_SOURCE_KEY
    );
    for (const top of target.operations) {
      const baseOpId = top[OPERATION_SOURCE_KEY];
      const topId = top.id;
      if (typeof baseOpId !== "string" || typeof topId !== "string") continue;
      const bKids = base.children[baseOpId];
      const tKids = target.children[topId];
      if (!bKids || !tKids) continue;
      correlate(bKids.steps, tKids.steps, "name", CHILD_SOURCE_KEY);
      correlate(bKids.parameters, tKids.parameters, "key", CHILD_SOURCE_KEY);
      correlate(bKids.tools, tKids.tools, "toolId", CHILD_SOURCE_KEY);
    }

    // Attribute diff: base = source item columns; target = the draft item's
    // columns. For a Version the draft is on the same item, so there is no
    // attribute change (Q2) and both sides read the same row.
    const draftItemId = affectedItem.newItemId ?? affectedItem.itemId;
    const baseAttributes = await readItemAttributes(
      client,
      affectedItem.itemId,
      companyId
    );
    const targetAttributes =
      draftItemId === affectedItem.itemId
        ? baseAttributes
        : await readItemAttributes(client, draftItemId, companyId);

    const diff = diffMethod({
      baseMaterials: base.materials,
      targetMaterials: target.materials,
      baseOperations: base.operations,
      targetOperations: target.operations,
      baseAttributes,
      targetAttributes,
      baseOperationChildren: base.children,
      targetOperationChildren: target.children
    });

    // Label BOM lines by their component's readable id (store-independent).
    const componentIds = [...base.materials, ...target.materials]
      .map((m) => m.itemId)
      .filter((id): id is string => typeof id === "string");
    const readableIds = await readItemReadableIds(
      client,
      componentIds,
      companyId
    );
    stampMaterialReadableIds(diff.materials, readableIds);

    // Resolve the item-group id → name so the attribute diff reads "Group A →
    // Group B" instead of opaque ids.
    const groupIds = diff.attributes.flatMap((a) => {
      const cf = a.changedFields?.itemPostingGroupId;
      return cf
        ? [cf.before, cf.after].filter(
            (v): v is string => typeof v === "string"
          )
        : [];
    });
    if (groupIds.length > 0) {
      const names = await readPostingGroupNames(client, groupIds, companyId);
      for (const a of diff.attributes) {
        const cf = a.changedFields?.itemPostingGroupId;
        if (!cf) continue;
        if (typeof cf.before === "string")
          cf.before = names.get(cf.before) ?? cf.before;
        if (typeof cf.after === "string")
          cf.after = names.get(cf.after) ?? cf.after;
      }
    }

    items.push({
      affectedItemId: affectedItem.id,
      itemId: affectedItem.itemId,
      materials: diff.materials,
      operations: diff.operations,
      attributes: diff.attributes
    });
  }

  return { data: { items }, error: null };
}

// -----------------------------------------------------------------------------
// Release-time 2-way merge (Q3). Unlike getChangeOrderDiff (draft vs the base
// the draft was copied from), this diffs the draft against the CURRENT live
// Active method — which may have moved if a same-part parallel CO released
// first. Only Version affected items can clobber (Revision/New Part make new
// items), so only they are considered. A conflict exists only when the live
// method actually moved (currentActive.id !== baseMakeMethodId).
// -----------------------------------------------------------------------------

// The item's current live Active method, excluding CO-owned drafts (changeOrderId
// set). This is "theirs" — the merge target the draft activates over.
export async function getCurrentActiveMakeMethodId(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const active = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Active")
    .is("changeOrderId", null)
    .maybeSingle();
  return active.data?.id ?? null;
}

function defaultChoiceFor(status: MethodDiffStatus): ChangeOrderMergeChoice {
  // Protect a live-only line (another CO's addition) by defaulting to keep it;
  // the CO's own adds/edits default to keeping the draft.
  return status === "removed" ? "theirs" : "mine";
}

function childChangeCount(entry: OperationDiffEntry): number {
  const c = entry.children;
  if (!c) return 0;
  const count = (rows: MethodDiffEntry<Row>[]) =>
    rows.filter((r) => r.status !== "unchanged").length;
  return count(c.steps) + count(c.parameters) + count(c.tools);
}

// Build the conflicting lines (draft="mine" vs live="theirs") for ONE affected
// item, given the current live method id. Shared by the loader (UI) and the
// server apply so both agree on the conflict set + default choices.
export async function buildReleaseConflictEntries(
  client: SupabaseClient<Database>,
  affected: {
    id: string;
    itemId: string;
    draftMakeMethodId: string | null;
  },
  liveMethodId: string,
  companyId: string
): Promise<{
  entries: ChangeOrderReleaseConflictEntry[];
  error: { message: string } | null;
}> {
  const live = await readMethodRows(client, liveMethodId, companyId);
  if (live.error) return { entries: [], error: live.error };
  const draft = await readMethodRows(
    client,
    affected.draftMakeMethodId,
    companyId
  );
  if (draft.error) return { entries: [], error: draft.error };

  // Reconstruct source pointers by natural key (base = live, target = draft).
  correlate(live.materials, draft.materials, "itemId", MATERIAL_SOURCE_KEY);
  correlate(live.operations, draft.operations, "order", OPERATION_SOURCE_KEY);
  for (const top of draft.operations) {
    const baseOpId = top[OPERATION_SOURCE_KEY];
    const topId = top.id;
    if (typeof baseOpId !== "string" || typeof topId !== "string") continue;
    const bKids = live.children[baseOpId];
    const tKids = draft.children[topId];
    if (!bKids || !tKids) continue;
    correlate(bKids.steps, tKids.steps, "name", CHILD_SOURCE_KEY);
    correlate(bKids.parameters, tKids.parameters, "key", CHILD_SOURCE_KEY);
    correlate(bKids.tools, tKids.tools, "toolId", CHILD_SOURCE_KEY);
  }

  const diff = diffMethod({
    baseMaterials: live.materials,
    targetMaterials: draft.materials,
    baseOperations: live.operations,
    targetOperations: draft.operations,
    baseOperationChildren: live.children,
    targetOperationChildren: draft.children
  });

  const entries: ChangeOrderReleaseConflictEntry[] = [];

  for (const m of diff.materials) {
    if (m.status === "unchanged") continue;
    const row = (m.after ?? m.before) as {
      id?: string;
      itemId?: string;
    } | null;
    const fieldCount = m.changedFields
      ? Object.keys(m.changedFields).length
      : 0;
    entries.push({
      kind: "material",
      status: m.status,
      draftId: (m.after as { id?: string } | null)?.id ?? null,
      liveId: (m.before as { id?: string } | null)?.id ?? null,
      itemId: row?.itemId ?? null,
      label: row?.itemId ?? "Material",
      detail: fieldCount > 0 ? `${fieldCount} field change(s)` : null,
      defaultChoice: defaultChoiceFor(m.status),
      mine: (m.after as Record<string, unknown> | null) ?? null,
      theirs: (m.before as Record<string, unknown> | null) ?? null,
      ...(m.changedFields ? { changedFields: m.changedFields } : {})
    });
  }

  for (const o of diff.operations) {
    const kids = childChangeCount(o);
    if (o.status === "unchanged" && kids === 0) continue;
    const row = (o.after ?? o.before) as {
      id?: string;
      description?: string;
      order?: number;
    } | null;
    const fieldCount = o.changedFields
      ? Object.keys(o.changedFields).length
      : 0;
    const detailParts: string[] = [];
    if (fieldCount > 0) detailParts.push(`${fieldCount} field change(s)`);
    if (kids > 0) detailParts.push(`${kids} step/tool change(s)`);
    const changedInBucket = (rows: MethodDiffEntry<Row>[]) =>
      rows.filter((r) => r.status !== "unchanged").length;
    const childChanges = o.children
      ? {
          steps: changedInBucket(o.children.steps),
          parameters: changedInBucket(o.children.parameters),
          tools: changedInBucket(o.children.tools)
        }
      : undefined;
    entries.push({
      kind: "operation",
      // A child-only change surfaces as a "modified" operation conflict.
      status: o.status === "unchanged" ? "modified" : o.status,
      draftId: (o.after as { id?: string } | null)?.id ?? null,
      liveId: (o.before as { id?: string } | null)?.id ?? null,
      itemId: null,
      label: row?.description || `Operation ${row?.order ?? ""}`.trim(),
      detail: detailParts.length > 0 ? detailParts.join(", ") : null,
      defaultChoice: defaultChoiceFor(
        o.status === "unchanged" ? "modified" : o.status
      ),
      mine: (o.after as Record<string, unknown> | null) ?? null,
      theirs: (o.before as Record<string, unknown> | null) ?? null,
      ...(o.changedFields ? { changedFields: o.changedFields } : {}),
      ...(childChanges && kids > 0 ? { childChanges } : {})
    });
  }

  return { entries, error: null };
}

// For each Version affected item whose live method has moved since the draft was
// created, return the conflicting lines for the release merge UI. Items with no
// moved base (the common case) produce no conflict and are omitted.
export async function getChangeOrderReleaseDiff(
  client: SupabaseClient<Database>,
  changeOrderId: string,
  companyId: string
): Promise<{
  data: ChangeOrderReleaseConflict[];
  error: { message: string } | null;
}> {
  const affected = await getChangeOrderAffectedItems(
    client,
    changeOrderId,
    companyId
  );
  if (affected.error) return { data: [], error: affected.error };

  const conflicts: ChangeOrderReleaseConflict[] = [];
  for (const item of affected.data) {
    if (item.changeType !== "Version" || !item.draftMakeMethodId) continue;
    const liveId = await getCurrentActiveMakeMethodId(
      client,
      item.itemId,
      companyId
    );
    // No live method, or the base hasn't moved → nothing to merge.
    if (!liveId || liveId === item.baseMakeMethodId) continue;
    const built = await buildReleaseConflictEntries(
      client,
      {
        id: item.id,
        itemId: item.itemId,
        draftMakeMethodId: item.draftMakeMethodId
      },
      liveId,
      companyId
    );
    if (built.error) return { data: [], error: built.error };
    if (built.entries.length > 0) {
      conflicts.push({
        affectedItemId: item.id,
        itemId: item.itemId,
        entries: built.entries
      });
    }
  }

  return { data: conflicts, error: null };
}
