// Cross-app DB queries for Item Rules (sales-document surfaces). The ERP
// admin UI and the enforcement actions both import from here. Mirrors
// `../storage/service.ts`.
//
// ERP-only admin CRUD (list/upsert/delete) stays in the ERP module — it
// depends on ERP request-utils (GenericQueryFilters, sanitize) that don't
// belong in the EE package.

import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import {
  type ConditionAst,
  type ItemRuleFilter,
  type ItemRuleSurface,
  itemRuleAppliesToItem,
  type Severity,
  toItemRuleFilter
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemPostingGroupIdFromEmbed } from "../storage/context";

// Filter columns carried on every itemRule row (NOT NULL with defaults in the
// DB, unlike storageRule's nullable trio).
const ITEM_RULE_FILTER_COLUMNS =
  "filteredItemTypes, filteredItemGroupIds, filteredItemMatchAll";

const ITEM_RULE_EVAL_COLUMNS = `id, name, severity, message, conditionAst, surfaces, updatedAt, active, ${ITEM_RULE_FILTER_COLUMNS}`;

/**
 * Raw `itemRule` row shape the evaluator consumes. `conditionAst` arrives as
 * generic Json from PostgREST; rows are cast once at the query boundary.
 */
export type ItemRuleDbRow = {
  id: string;
  name: string;
  severity: Severity;
  message: string;
  conditionAst: ConditionAst;
  surfaces: ItemRuleSurface[];
  updatedAt: string | null;
  active: boolean;
  filteredItemTypes: string[];
  filteredItemGroupIds: string[];
  filteredItemMatchAll: boolean;
};

/**
 * Loads the rules applicable to a set of items:
 *   - `rules` — EVERY active item rule for the company. Each rule fires on a
 *     line when it has an explicit assignment for that line's item OR its
 *     `filteredItem*` filters match the item (`itemRuleAppliesToItem`; empty
 *     filters = every item). Filter matching happens in `server.ts` where the
 *     item rows exist.
 *   - `assignmentsByItemId` — explicit `itemRuleAssignment` rows for
 *     `itemIds`, as itemId → Set<ruleId>.
 *
 * Two round-trips. The rules fetch always runs, even when `itemIds` is empty,
 * so a request with no item still sees broadcasts.
 */
export async function getActiveItemRulesForItems(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[]
): Promise<{
  rules: ItemRuleDbRow[];
  assignmentsByItemId: Map<string, Set<string>>;
  error: unknown;
}> {
  const assignmentsByItemId = new Map<string, Set<string>>();

  const [rulesRes, assignmentsRes] = await Promise.all([
    client
      .from("itemRule")
      .select(ITEM_RULE_EVAL_COLUMNS)
      .eq("companyId", companyId)
      .eq("active", true),
    itemIds.length > 0
      ? client
          .from("itemRuleAssignment")
          .select("itemId, ruleId")
          .in("itemId", itemIds)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (rulesRes.error)
    return { rules: [], assignmentsByItemId, error: rulesRes.error };
  if (assignmentsRes.error)
    return { rules: [], assignmentsByItemId, error: assignmentsRes.error };

  for (const row of assignmentsRes.data ?? []) {
    const itemId = row.itemId as string;
    const ruleId = row.ruleId as string;
    const bucket = assignmentsByItemId.get(itemId);
    if (bucket) bucket.add(ruleId);
    else assignmentsByItemId.set(itemId, new Set([ruleId]));
  }

  return {
    rules: (rulesRes.data ?? []) as unknown as ItemRuleDbRow[],
    assignmentsByItemId,
    error: null
  };
}

/**
 * Loader-style row returned from `getItemRuleAssignmentsForItem`. Direct
 * assignments leave `inheritedFromId` / `inheritedFromName` null; broadcast
 * rules use the `__all__` sentinel so the UI can render an "All items" /
 * "Matches item filters" badge and suppress unassign. Mirrors
 * `RuleAssignmentRow` in `../storage/service.ts`.
 */
export type ItemRuleAssignmentRow = {
  /** Owner of the assignment row (the item id, or the `__all__` sentinel). */
  ownerId: string;
  ruleId: string;
  createdAt: string | null;
  itemRule: {
    id: string;
    name: string;
    severity: Severity;
    message: string;
    active: boolean;
    surfaces: ItemRuleSurface[];
  };
  /** null when the assignment is direct on `args.itemId`. */
  inheritedFromId: string | null;
  inheritedFromName: string | null;
};

/**
 * Merged explicit + broadcast rule list for one item — powers the per-item
 * Rules drawer section. Broadcasts are gated by the rule's item filters the
 * same way the evaluator gates them, so the drawer shows exactly the set that
 * will fire.
 */
export async function getItemRuleAssignmentsForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<{ data: ItemRuleAssignmentRow[]; error: unknown }> {
  // Annotated `string` so PostgREST yields generically-typed rows — the typed
  // select parser blows its instantiation depth on the composite-FK embed
  // (`itemRule:ruleId` resolves over ("ruleId","companyId")). Rows are cast
  // explicitly below, mirroring the storage-rules service.
  const assignmentCols: string =
    "itemId, ruleId, createdAt, itemRule:ruleId(id, name, severity, message, active, surfaces)";
  const [res, broadcastsRes, itemCtxRes] = await Promise.all([
    client
      .from("itemRuleAssignment")
      .select(assignmentCols)
      .eq("itemId", args.itemId)
      .eq("companyId", args.companyId),
    client
      .from("itemRule")
      .select(
        `id, name, severity, message, active, surfaces, createdAt, ${ITEM_RULE_FILTER_COLUMNS}`
      )
      .eq("companyId", args.companyId),
    // Item type/group for this item so we can gate broadcasts the same way
    // the evaluator does.
    client
      .from("item")
      .select("type, itemCost(itemPostingGroupId)")
      .eq("id", args.itemId)
      .eq("companyId", args.companyId)
      .maybeSingle()
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

  // Item assignments are always direct (no inheritance), so every explicit
  // row's owner is the item itself.
  const byRuleId = new Map<string, ItemRuleAssignmentRow>();
  for (const r of res.data ?? []) {
    const row = r as unknown as {
      [k: string]: unknown;
      itemRule:
        | ItemRuleAssignmentRow["itemRule"]
        | ItemRuleAssignmentRow["itemRule"][]
        | null;
    };
    const node = Array.isArray(row.itemRule) ? row.itemRule[0] : row.itemRule;
    if (!node) continue;

    const candidate: ItemRuleAssignmentRow = {
      ownerId: row.itemId as string,
      ruleId: row.ruleId as string,
      createdAt: (row.createdAt as string | null) ?? null,
      itemRule: node,
      inheritedFromId: null,
      inheritedFromName: null
    };

    if (!byRuleId.has(candidate.ruleId)) {
      byRuleId.set(candidate.ruleId, candidate);
    }
  }

  // Append broadcasts as synthetic rows. Sentinel `__all__` ownerId
  // distinguishes them from real assignment rows; UI keys off
  // `inheritedFromId === "__all__"` to render the badge and suppress unassign.
  for (const b of (broadcastsRes.data ?? []) as unknown as Array<{
    id: string;
    name: string;
    severity: Severity;
    message: string;
    active: boolean;
    surfaces: ItemRuleSurface[];
    createdAt: string | null;
    filteredItemTypes: string[];
    filteredItemGroupIds: string[];
    filteredItemMatchAll: boolean;
  }>) {
    if (b.active === false) continue;
    if (byRuleId.has(b.id)) continue;

    // Only surface rules whose filter matches this item. Label by reach so
    // the drawer reads "All items" vs a filtered match.
    const filter: ItemRuleFilter = toItemRuleFilter(b);
    if (itemCtx && !itemRuleAppliesToItem(itemCtx, filter)) continue;
    const filterless =
      (filter.filteredItemTypes?.length ?? 0) === 0 &&
      (filter.filteredItemGroupIds?.length ?? 0) === 0;

    byRuleId.set(b.id, {
      ownerId: "__all__",
      ruleId: b.id,
      createdAt: b.createdAt,
      itemRule: {
        id: b.id,
        name: b.name,
        severity: b.severity,
        message: b.message,
        active: b.active,
        surfaces: b.surfaces
      },
      inheritedFromId: "__all__",
      inheritedFromName: filterless ? "All items" : "Matches item filters"
    });
  }

  return { data: Array.from(byRuleId.values()), error: null };
}

export async function getItemRulesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    severity: Severity;
    active: boolean;
    surfaces: ItemRuleSurface[];
  }>(client, "itemRule", "id, name, severity, active, surfaces", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function assignItemRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string; createdBy: string }
) {
  // Preflight: rule must exist in this company. Without this, callers could
  // insert a foreign rule id; the evaluator filters defensively but the
  // orphan row still inflates assignment counts.
  const ruleRes = await client
    .from("itemRule")
    .select("id")
    .eq("id", args.ruleId)
    .eq("companyId", args.companyId)
    .single();
  if (ruleRes.error || !ruleRes.data) {
    return {
      data: null,
      error: ruleRes.error ?? new Error("Rule not found")
    };
  }

  return client
    .from("itemRuleAssignment")
    .insert({
      itemId: args.itemId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("itemId, ruleId")
    .single();
}

export async function unassignItemRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string }
) {
  return client
    .from("itemRuleAssignment")
    .delete()
    .eq("itemId", args.itemId)
    .eq("ruleId", args.ruleId)
    .eq("companyId", args.companyId);
}
