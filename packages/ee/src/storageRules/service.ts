// Cross-app DB queries for Storage Rules. Both ERP (admin UI, item/storage
// surfaces) and MES (workCenter surfaces) import from here.
//
// ERP-only admin CRUD (list/upsert/delete) stays in the ERP module — it
// depends on ERP request-utils (GenericQueryFilters, sanitize) that don't
// belong in the EE package.

import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import {
  type ItemRuleFilter,
  itemRuleAppliesToItem,
  type Severity,
  type StorageRuleRow,
  type TargetType,
  type TransactionSurface,
  toItemRuleFilter
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemPostingGroupIdFromEmbed } from "./context";

// Nullable filter columns appended to broadcast selects for item-target rules.
const ITEM_RULE_FILTER_COLUMNS =
  "filteredItemTypes, filteredItemGroupIds, filteredItemMatchAll";

// Filter columns carried on broadcast item rules. PostgREST's typed-select
// parser can't narrow our dynamically-built select string, so broadcast queries
// type their rows explicitly via this shape rather than the generated Row type.
type ItemFilterColumns = {
  filteredItemTypes?: string[] | null;
  filteredItemGroupIds?: string[] | null;
  filteredItemMatchAll?: boolean | null;
};

const assignmentTableFor = (
  targetType: TargetType
): "storageRuleItemAssignment" | "storageRuleWorkCenterAssignment" => {
  switch (targetType) {
    case "item":
      return "storageRuleItemAssignment";
    case "workCenter":
      return "storageRuleWorkCenterAssignment";
  }
};

const targetIdColumnFor = (
  targetType: TargetType
): "itemId" | "workCenterId" => {
  switch (targetType) {
    case "item":
      return "itemId";
    case "workCenter":
      return "workCenterId";
  }
};

type RuleRowSelect = Pick<
  StorageRuleRow,
  | "id"
  | "targetType"
  | "severity"
  | "message"
  | "conditionAst"
  | "surfaces"
  | "updatedAt"
  | "active"
>;

/**
 * Loads active rules applicable to a set of targets of one targetType.
 *
 * `data` keys are targetIds (explicit-assignment rules only).
 * `broadcasts` carries rules that fire beyond explicit assignments — caller
 * merges them into every line:
 *   - item targets: EVERY active item rule broadcasts, then the caller gates it
 *     per line via the rule's `filteredItem*` filters (see `broadcastFilters`);
 *     empty filters = every item.
 *   - workCenter targets: rules with `appliesToAll = TRUE` only.
 *
 * `broadcastFilters` maps ruleId → item type/group filter (item targets only).
 *
 * Two round-trips: explicit-assignments + broadcast. Broadcast fetch always
 * runs, even when `targetIds` is empty, so a request with no explicit target
 * still sees broadcasts.
 */
export async function getActiveRulesForTargets(
  client: SupabaseClient<Database>,
  args: {
    targetType: TargetType;
    targetIds: string[];
    companyId: string;
  }
): Promise<{
  data: Map<string, StorageRuleRow[]>;
  broadcasts: StorageRuleRow[];
  broadcastFilters: Map<string, ItemRuleFilter>;
  error: unknown;
}> {
  const out = new Map<string, StorageRuleRow[]>();
  const broadcastFilters = new Map<string, ItemRuleFilter>();

  const ruleCols =
    "id, targetType, severity, message, conditionAst, surfaces, updatedAt, active";
  const isItem = args.targetType === "item";
  // Item broadcasts carry their filters so the caller can gate per item.
  // Annotated `string` so PostgREST yields generically-typed rows (the dynamic
  // select string can't be statically parsed); rows are cast explicitly below.
  const broadcastCols: string = isItem
    ? `${ruleCols}, ${ITEM_RULE_FILTER_COLUMNS}`
    : ruleCols;

  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  const broadcastBase = client
    .from("storageRule")
    .select(broadcastCols)
    .eq("companyId", args.companyId)
    .eq("targetType", args.targetType)
    .eq("active", true);

  const [explicit, broadcast] = await Promise.all([
    args.targetIds.length > 0
      ? (client as SupabaseClient<Database>)
          .from(table)
          .select(`${idCol}, storageRule:ruleId(${ruleCols})`)
          .in(idCol, args.targetIds)
          .eq("companyId", args.companyId)
      : Promise.resolve({ data: [], error: null }),
    // Item rules all broadcast (filtered per item); non-item only when appliesToAll.
    isItem ? broadcastBase : broadcastBase.eq("appliesToAll", true)
  ]);

  if (explicit.error)
    return {
      data: out,
      broadcasts: [],
      broadcastFilters,
      error: explicit.error
    };
  if (broadcast.error)
    return {
      data: out,
      broadcasts: [],
      broadcastFilters,
      error: broadcast.error
    };

  for (const r of explicit.data ?? []) {
    const row = r as unknown as {
      [k: string]: unknown;
      storageRule: RuleRowSelect | RuleRowSelect[] | null;
    };
    const targetId = row[idCol] as string;
    const node = Array.isArray(row.storageRule)
      ? row.storageRule[0]
      : row.storageRule;
    if (!node || node.active === false) continue;
    if (node.targetType !== args.targetType) continue;
    const bucket = out.get(targetId);
    if (bucket) bucket.push(node as StorageRuleRow);
    else out.set(targetId, [node as StorageRuleRow]);
  }

  // `as unknown as` is required: a dynamic select string degrades PostgREST's
  // row type to `GenericStringError`, which doesn't overlap our explicit shape.
  const broadcasts = (broadcast.data ?? []) as unknown as (StorageRuleRow &
    ItemFilterColumns)[];

  if (isItem) {
    for (const row of broadcasts) {
      broadcastFilters.set(row.id, toItemRuleFilter(row));
    }
  }

  return { data: out, broadcasts, broadcastFilters, error: null };
}

/**
 * Loader-style row returned from `getRuleAssignmentsForTarget`. Direct
 * assignments leave `inheritedFromId` / `inheritedFromName` null; broadcast
 * rules use the `__all__` sentinel so the UI can render an "Applies to all"
 * badge and suppress unassign.
 */
export type RuleAssignmentRow = {
  /** Owner of the assignment row (this target id, or an ancestor unit id). */
  ownerId: string;
  ruleId: string;
  createdAt: string | null;
  storageRule: {
    id: string;
    name: string;
    targetType: TargetType;
    severity: Severity;
    message: string;
    active: boolean;
    surfaces?: TransactionSurface[];
    appliesToAll?: boolean;
  };
  /** null when the assignment is direct on `args.targetId`. */
  inheritedFromId: string | null;
  inheritedFromName: string | null;
};

export async function getRuleAssignmentsForTarget(
  client: SupabaseClient<Database>,
  args: { targetType: TargetType; targetId: string; companyId: string }
): Promise<{ data: RuleAssignmentRow[]; error: unknown }> {
  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  // Item / workCenter targets are flat — a direct query on the target id.
  const lookupIds = [args.targetId];

  // Broadcast rules govern targets beyond explicit assignments. Surface them
  // alongside explicit + inherited rows so the drawer shows the full set the
  // evaluator will fire (was previously hidden — drawer showed "0 assignments"
  // while broadcasts still triggered).
  //   - item: EVERY active item rule broadcasts, gated per item by its
  //     type/group filters (empty = all items) — mirrors the evaluator.
  //   - workCenter: rules with `appliesToAll = TRUE`.
  const isItem = args.targetType === "item";
  const baseBroadcastCols =
    "id, name, targetType, severity, message, active, surfaces, appliesToAll, createdAt";
  // `string` so PostgREST yields generic rows; cast explicitly at the loop.
  const broadcastCols: string = isItem
    ? `${baseBroadcastCols}, ${ITEM_RULE_FILTER_COLUMNS}`
    : baseBroadcastCols;
  const broadcastBase = client
    .from("storageRule")
    .select(broadcastCols)
    .eq("companyId", args.companyId)
    .eq("targetType", args.targetType);

  const [res, broadcastsRes, itemCtxRes] = await Promise.all([
    (client as SupabaseClient<Database>)
      .from(table)
      .select(
        `${idCol}, ruleId, createdAt, storageRule:ruleId(id, name, targetType, severity, message, active, surfaces, appliesToAll)`
      )
      .in(idCol, lookupIds)
      .eq("companyId", args.companyId),
    isItem ? broadcastBase : broadcastBase.eq("appliesToAll", true),
    // Item type/group for this target so we can gate item broadcasts the same
    // way the evaluator does.
    isItem
      ? client
          .from("item")
          .select("type, itemCost(itemPostingGroupId)")
          .eq("id", args.targetId)
          .eq("companyId", args.companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (res.error) return { data: [], error: res.error };
  if (broadcastsRes.error) return { data: [], error: broadcastsRes.error };
  if (itemCtxRes.error) return { data: [], error: itemCtxRes.error };

  // Flatten itemPostingGroupId off the 1:1 itemCost embed for filter matching.
  const itemCtx = (() => {
    const row = itemCtxRes.data as {
      type?: unknown;
      itemCost?: unknown;
    } | null;
    if (!row) return null;
    return {
      type: row.type,
      itemPostingGroupId: itemPostingGroupIdFromEmbed(row.itemCost)
    };
  })();

  // Item / workCenter assignments are always direct (no inheritance), so every
  // row's owner is the target itself.
  const byRuleId = new Map<string, RuleAssignmentRow>();
  for (const r of res.data ?? []) {
    const row = r as unknown as {
      [k: string]: unknown;
      storageRule:
        | RuleAssignmentRow["storageRule"]
        | RuleAssignmentRow["storageRule"][]
        | null;
    };
    const ownerId = row[idCol] as string;
    const node = Array.isArray(row.storageRule)
      ? row.storageRule[0]
      : row.storageRule;
    if (!node) continue;

    const candidate: RuleAssignmentRow = {
      ownerId,
      ruleId: row.ruleId as string,
      createdAt: (row.createdAt as string | null) ?? null,
      storageRule: node,
      inheritedFromId: null,
      inheritedFromName: null
    };

    if (!byRuleId.has(candidate.ruleId)) {
      byRuleId.set(candidate.ruleId, candidate);
    }
  }

  // Append broadcasts as synthetic rows. Sentinel `__all__` ownerId distinguishes
  // them from real assignment rows; UI keys off `inheritedFromId === "__all__"`
  // or the rule's `appliesToAll` flag to render the "Applies to all" badge and
  // suppress unassign. Skip when already present as an explicit row (shouldn't
  // happen in practice — broadcast rules can't be assigned — but be defensive).
  // `as unknown as`: dynamic select → PostgREST `GenericStringError` row type.
  for (const b of (broadcastsRes.data ?? []) as unknown as Array<
    {
      id: string;
      name: string;
      targetType: TargetType;
      severity: Severity;
      message: string;
      active: boolean;
      surfaces: TransactionSurface[];
      appliesToAll: boolean;
      createdAt: string | null;
    } & ItemFilterColumns
  >) {
    if (b.active === false) continue;
    if (byRuleId.has(b.id)) continue;

    // Item rules: only surface those whose filter matches this item. Label by
    // reach so the drawer reads "All items" vs a filtered match.
    let label = "Applies to all";
    if (isItem) {
      const filter = toItemRuleFilter(b);
      if (itemCtx && !itemRuleAppliesToItem(itemCtx, filter)) continue;
      const filterless =
        (filter.filteredItemTypes?.length ?? 0) === 0 &&
        (filter.filteredItemGroupIds?.length ?? 0) === 0;
      label = filterless ? "All items" : "Matches item filters";
    }

    byRuleId.set(b.id, {
      ownerId: "__all__",
      ruleId: b.id,
      createdAt: b.createdAt,
      storageRule: {
        id: b.id,
        name: b.name,
        targetType: b.targetType,
        severity: b.severity,
        message: b.message,
        active: b.active,
        surfaces: b.surfaces,
        appliesToAll: b.appliesToAll
      },
      inheritedFromId: "__all__",
      inheritedFromName: label
    });
  }

  return { data: Array.from(byRuleId.values()), error: null };
}

export async function getStorageRulesList(
  client: SupabaseClient<Database>,
  companyId: string,
  targetType?: TargetType
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    targetType: TargetType;
    severity: Severity;
    active: boolean;
    appliesToAll: boolean;
    surfaces: TransactionSurface[];
  }>(
    client,
    "storageRule",
    "id, name, targetType, severity, active, appliesToAll, surfaces",
    (query) => {
      let q = query.eq("companyId", companyId).order("name");
      if (targetType) q = q.eq("targetType", targetType);
      return q;
    }
  );
}

export async function assignStorageRule(
  client: SupabaseClient<Database>,
  args: {
    targetType: TargetType;
    targetId: string;
    ruleId: string;
    companyId: string;
    userId: string;
  }
) {
  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  // Preflight: rule must exist in this company and its targetType must match
  // the assignment table. Without this, callers could insert a storageUnit-rule
  // id into storageRuleItemAssignment; the evaluator filters defensively but
  // the orphan row still inflates getRuleAssignmentCounts.
  const ruleRes = await client
    .from("storageRule")
    .select("id, targetType")
    .eq("id", args.ruleId)
    .eq("companyId", args.companyId)
    .single();
  if (ruleRes.error || !ruleRes.data) {
    return {
      data: null,
      error: ruleRes.error ?? new Error("Rule not found")
    };
  }
  if (ruleRes.data.targetType !== args.targetType) {
    return {
      data: null,
      error: new Error(
        `Rule targetType "${ruleRes.data.targetType}" does not match "${args.targetType}"`
      )
    };
  }

  return (client as SupabaseClient<Database>)
    .from(table)
    .insert({
      [idCol]: args.targetId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.userId
    } as never)
    .select(`${idCol}, ruleId`)
    .single();
}

export async function unassignStorageRule(
  client: SupabaseClient<Database>,
  args: { targetType: TargetType; targetId: string; ruleId: string }
) {
  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  return (client as SupabaseClient<Database>)
    .from(table)
    .delete()
    .eq(idCol, args.targetId)
    .eq("ruleId", args.ruleId);
}
