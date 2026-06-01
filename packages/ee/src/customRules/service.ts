// Cross-app DB queries for Custom Rules. Both ERP (admin UI, item/storage
// surfaces) and MES (workCenter surfaces) import from here.
//
// ERP-only admin CRUD (list/upsert/delete) stays in the ERP module — it
// depends on ERP request-utils (GenericQueryFilters, sanitize) that don't
// belong in the EE package.

import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import {
  type CustomRuleRow,
  type ItemRuleFilter,
  itemRuleAppliesToItem,
  type Severity,
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
):
  | "customRuleItemAssignment"
  | "customRuleStorageUnitAssignment"
  | "customRuleWorkCenterAssignment" => {
  switch (targetType) {
    case "item":
      return "customRuleItemAssignment";
    case "storageUnit":
      return "customRuleStorageUnitAssignment";
    case "workCenter":
      return "customRuleWorkCenterAssignment";
  }
};

const targetIdColumnFor = (
  targetType: TargetType
): "itemId" | "storageUnitId" | "workCenterId" => {
  switch (targetType) {
    case "item":
      return "itemId";
    case "storageUnit":
      return "storageUnitId";
    case "workCenter":
      return "workCenterId";
  }
};

type RuleRowSelect = Pick<
  CustomRuleRow,
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
 *   - storageUnit / workCenter targets: rules with `appliesToAll = TRUE` only.
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
  data: Map<string, CustomRuleRow[]>;
  broadcasts: CustomRuleRow[];
  broadcastFilters: Map<string, ItemRuleFilter>;
  error: unknown;
}> {
  const out = new Map<string, CustomRuleRow[]>();
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
    .from("customRule")
    .select(broadcastCols)
    .eq("companyId", args.companyId)
    .eq("targetType", args.targetType)
    .eq("active", true);

  const [explicit, broadcast] = await Promise.all([
    args.targetIds.length > 0
      ? (client as SupabaseClient<Database>)
          .from(table)
          .select(`${idCol}, customRule:ruleId(${ruleCols})`)
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
      customRule: RuleRowSelect | RuleRowSelect[] | null;
    };
    const targetId = row[idCol] as string;
    const node = Array.isArray(row.customRule)
      ? row.customRule[0]
      : row.customRule;
    if (!node || node.active === false) continue;
    if (node.targetType !== args.targetType) continue;
    const bucket = out.get(targetId);
    if (bucket) bucket.push(node as CustomRuleRow);
    else out.set(targetId, [node as CustomRuleRow]);
  }

  // `as unknown as` is required: a dynamic select string degrades PostgREST's
  // row type to `GenericStringError`, which doesn't overlap our explicit shape.
  const broadcasts = (broadcast.data ?? []) as unknown as (CustomRuleRow &
    ItemFilterColumns)[];

  if (isItem) {
    for (const row of broadcasts) {
      broadcastFilters.set(row.id, toItemRuleFilter(row));
    }
  }

  return { data: out, broadcasts, broadcastFilters, error: null };
}

/**
 * Loader-style row returned from `getRuleAssignmentsForTarget`. Adds
 * `inheritedFromId` / `inheritedFromName` so the UI can label rules that
 * came from an ancestor unit (storageUnit hierarchy only) and disable
 * unassign on those rows.
 */
export type RuleAssignmentRow = {
  /** Owner of the assignment row (this target id, or an ancestor unit id). */
  ownerId: string;
  ruleId: string;
  createdAt: string | null;
  customRule: {
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

  // Storage units inherit assignments from every ancestor in the tree.
  // Item / workCenter targets are flat — keep the simple direct query.
  const lookupIds = await resolveLookupIds(client, args);

  // Broadcast rules govern targets beyond explicit assignments. Surface them
  // alongside explicit + inherited rows so the drawer shows the full set the
  // evaluator will fire (was previously hidden — drawer showed "0 assignments"
  // while broadcasts still triggered).
  //   - item: EVERY active item rule broadcasts, gated per item by its
  //     type/group filters (empty = all items) — mirrors the evaluator.
  //   - storageUnit / workCenter: rules with `appliesToAll = TRUE`.
  const isItem = args.targetType === "item";
  const baseBroadcastCols =
    "id, name, targetType, severity, message, active, surfaces, appliesToAll, createdAt";
  // `string` so PostgREST yields generic rows; cast explicitly at the loop.
  const broadcastCols: string = isItem
    ? `${baseBroadcastCols}, ${ITEM_RULE_FILTER_COLUMNS}`
    : baseBroadcastCols;
  const broadcastBase = client
    .from("customRule")
    .select(broadcastCols)
    .eq("companyId", args.companyId)
    .eq("targetType", args.targetType);

  const [res, broadcastsRes, itemCtxRes] = await Promise.all([
    (client as SupabaseClient<Database>)
      .from(table)
      .select(
        `${idCol}, ruleId, createdAt, customRule:ruleId(id, name, targetType, severity, message, active, surfaces, appliesToAll)`
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

  // Resolve ancestor names in one extra query so the UI doesn't need to
  // re-fetch. Only the storageUnit case can yield non-self owner ids.
  const inheritedOwnerIds = new Set<string>();
  for (const r of res.data ?? []) {
    const ownerId = (r as unknown as Record<string, unknown>)[idCol] as string;
    if (ownerId && ownerId !== args.targetId) inheritedOwnerIds.add(ownerId);
  }

  const ancestorNameById = new Map<string, string>();
  if (args.targetType === "storageUnit" && inheritedOwnerIds.size > 0) {
    const namesRes = await client
      .from("storageUnit")
      .select("id, name")
      .in("id", Array.from(inheritedOwnerIds))
      .eq("companyId", args.companyId);
    for (const row of (namesRes.data ?? []) as Array<{
      id: string;
      name: string;
    }>) {
      ancestorNameById.set(row.id, row.name);
    }
  }

  // Dedupe: if the same rule is assigned to both self and an ancestor,
  // keep the direct row (so unassign UI operates on what the user owns).
  const byRuleId = new Map<string, RuleAssignmentRow>();
  for (const r of res.data ?? []) {
    const row = r as unknown as {
      [k: string]: unknown;
      customRule:
        | RuleAssignmentRow["customRule"]
        | RuleAssignmentRow["customRule"][]
        | null;
    };
    const ownerId = row[idCol] as string;
    const node = Array.isArray(row.customRule)
      ? row.customRule[0]
      : row.customRule;
    if (!node) continue;

    const isDirect = ownerId === args.targetId;
    const inheritedFromId = isDirect ? null : ownerId;
    const inheritedFromName = inheritedFromId
      ? (ancestorNameById.get(inheritedFromId) ?? null)
      : null;

    const candidate: RuleAssignmentRow = {
      ownerId,
      ruleId: row.ruleId as string,
      createdAt: (row.createdAt as string | null) ?? null,
      customRule: node,
      inheritedFromId,
      inheritedFromName
    };

    const existing = byRuleId.get(candidate.ruleId);
    // Prefer direct over inherited when both exist for the same rule.
    if (!existing || (existing.inheritedFromId && !candidate.inheritedFromId)) {
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
      customRule: {
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

/**
 * Returns the set of unit ids to query assignments under. For storageUnit
 * targets this is the unit + every ancestor (so child drawer sees inherited
 * rules). For other targets it's just the target id.
 */
async function resolveLookupIds(
  client: SupabaseClient<Database>,
  args: { targetType: TargetType; targetId: string; companyId: string }
): Promise<string[]> {
  if (args.targetType !== "storageUnit") return [args.targetId];

  const { data } = await (client as SupabaseClient<Database>)
    .from("storageUnits_recursive")
    .select("ancestorPath")
    .eq("id", args.targetId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  const row = data as { ancestorPath: string[] | null } | null;
  const chain =
    row?.ancestorPath && row.ancestorPath.length > 0
      ? row.ancestorPath
      : [args.targetId];
  return chain;
}

export async function getCustomRulesList(
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
    "customRule",
    "id, name, targetType, severity, active, appliesToAll, surfaces",
    (query) => {
      let q = query.eq("companyId", companyId).order("name");
      if (targetType) q = q.eq("targetType", targetType);
      return q;
    }
  );
}

export async function assignCustomRule(
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
  // id into customRuleItemAssignment; the evaluator filters defensively but
  // the orphan row still inflates getRuleAssignmentCounts.
  const ruleRes = await client
    .from("customRule")
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

export async function unassignCustomRule(
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
