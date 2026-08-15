// Cross-app DB queries for Sales Rules (sales-document surfaces). The ERP
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
  ruleAppliesToItem,
  type SalesRuleFilter,
  type SalesRuleSurface,
  type Severity,
  toSalesRuleFilter
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemPostingGroupIdFromEmbed } from "../storage/context";

// Filter columns carried on every salesRule row (NOT NULL with defaults in the
// DB, unlike storageRule's nullable trio).
const SALES_RULE_FILTER_COLUMNS =
  "filteredItemTypes, filteredItemGroupIds, filteredItemMatchAll";

const SALES_RULE_EVAL_COLUMNS = `id, name, severity, message, conditionAst, surfaces, updatedAt, active, ${SALES_RULE_FILTER_COLUMNS}`;

/**
 * Raw `salesRule` row shape the evaluator consumes. `conditionAst` arrives as
 * generic Json from PostgREST; rows are cast once at the query boundary.
 */
export type SalesRuleDbRow = {
  id: string;
  name: string;
  severity: Severity;
  message: string;
  conditionAst: ConditionAst;
  surfaces: SalesRuleSurface[];
  updatedAt: string | null;
  active: boolean;
  filteredItemTypes: string[];
  filteredItemGroupIds: string[];
  filteredItemMatchAll: boolean;
};

/**
 * Loads the rules applicable to a set of items:
 *   - `rules` — EVERY active sales rule for the company. Each rule fires on a
 *     line when it has an explicit assignment for that line's item OR its
 *     `filteredItem*` filters match the item (`ruleAppliesToItem`; empty
 *     filters = every item). Filter matching happens in `server.ts` where the
 *     item rows exist.
 *   - `assignmentsByItemId` — explicit `salesRuleAssignment` rows for
 *     `itemIds`, as itemId → Set<ruleId>.
 *
 * Two round-trips. The rules fetch always runs, even when `itemIds` is empty,
 * so a request with no item still sees broadcasts.
 */
export async function getActiveSalesRulesForItems(
  client: SupabaseClient<Database>,
  companyId: string,
  itemIds: string[]
): Promise<{
  rules: SalesRuleDbRow[];
  assignmentsByItemId: Map<string, Set<string>>;
  error: unknown;
}> {
  const assignmentsByItemId = new Map<string, Set<string>>();

  const [rulesRes, assignmentsRes] = await Promise.all([
    client
      .from("enforcementRule")
      .select(SALES_RULE_EVAL_COLUMNS)
      .eq("companyId", companyId)
      .eq("family", "sales")
      .eq("active", true),
    itemIds.length > 0
      ? client
          .from("enforcementRuleItemAssignment")
          .select("itemId, ruleId")
          .in("itemId", itemIds)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (rulesRes.error)
    return { rules: [], assignmentsByItemId, error: rulesRes.error };
  if (assignmentsRes.error)
    return { rules: [], assignmentsByItemId, error: assignmentsRes.error };

  // The pin table is shared with the storage family; a storage rule pinned to
  // the same item must not enter the sales evaluation set. The fetched rules
  // are already family-filtered, so they are the authority on what counts.
  const salesRuleIds = new Set(
    ((rulesRes.data ?? []) as unknown as SalesRuleDbRow[]).map((r) => r.id)
  );

  for (const row of assignmentsRes.data ?? []) {
    const itemId = row.itemId as string;
    const ruleId = row.ruleId as string;
    if (!salesRuleIds.has(ruleId)) continue;
    const bucket = assignmentsByItemId.get(itemId);
    if (bucket) bucket.add(ruleId);
    else assignmentsByItemId.set(itemId, new Set([ruleId]));
  }

  return {
    rules: (rulesRes.data ?? []) as unknown as SalesRuleDbRow[],
    assignmentsByItemId,
    error: null
  };
}

/**
 * Loader-style row returned from `getSalesRuleAssignmentsForItem`. Direct
 * assignments leave `inheritedFromId` / `inheritedFromName` null; broadcast
 * rules use the `__all__` sentinel so the UI can render an "All items" /
 * "Matches item filters" badge and suppress unassign. Mirrors
 * `RuleAssignmentRow` in `../storage/service.ts`.
 */
export type SalesRuleAssignmentRow = {
  /** Owner of the assignment row (the item id, or the `__all__` sentinel). */
  ownerId: string;
  ruleId: string;
  createdAt: string | null;
  salesRule: {
    id: string;
    name: string;
    severity: Severity;
    message: string;
    active: boolean;
    surfaces: SalesRuleSurface[];
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
export async function getSalesRuleAssignmentsForItem(
  client: SupabaseClient<Database>,
  args: { itemId: string; companyId: string }
): Promise<{ data: SalesRuleAssignmentRow[]; error: unknown }> {
  // No embed: the pin table is shared with the storage family, so the pinned
  // rules are resolved in a second, family-filtered pass below.
  const assignmentCols: string = "itemId, ruleId, createdAt";
  const [res, broadcastsRes, itemCtxRes] = await Promise.all([
    client
      .from("enforcementRuleItemAssignment")
      .select(assignmentCols)
      .eq("itemId", args.itemId)
      .eq("companyId", args.companyId),
    client
      .from("enforcementRule")
      .select(
        `id, name, severity, message, active, surfaces, createdAt, ${SALES_RULE_FILTER_COLUMNS}`
      )
      .eq("companyId", args.companyId)
      .eq("family", "sales"),
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
  // row's owner is the item itself. Pinned rules are resolved against the
  // family-filtered fetch above — a pin pointing at a storage rule (same shared
  // table) simply finds no match and is skipped.
  const salesRuleById = new Map(
    (
      (broadcastsRes.data ??
        []) as unknown as SalesRuleAssignmentRow["salesRule"][]
    ).map((r) => [r.id, r])
  );

  const byRuleId = new Map<string, SalesRuleAssignmentRow>();
  for (const r of res.data ?? []) {
    const row = r as unknown as {
      [k: string]: unknown;
      ruleId: string;
    };
    const node = salesRuleById.get(row.ruleId);
    if (!node) continue;

    const candidate: SalesRuleAssignmentRow = {
      ownerId: row.itemId as string,
      ruleId: row.ruleId,
      createdAt: (row.createdAt as string | null) ?? null,
      salesRule: node,
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
    surfaces: SalesRuleSurface[];
    createdAt: string | null;
    filteredItemTypes: string[];
    filteredItemGroupIds: string[];
    filteredItemMatchAll: boolean;
  }>) {
    if (b.active === false) continue;
    if (byRuleId.has(b.id)) continue;

    // Only surface rules whose filter matches this item. Label by reach so
    // the drawer reads "All items" vs a filtered match.
    const filter: SalesRuleFilter = toSalesRuleFilter(b);
    if (itemCtx && !ruleAppliesToItem(itemCtx, filter)) continue;
    const filterless =
      (filter.filteredItemTypes?.length ?? 0) === 0 &&
      (filter.filteredItemGroupIds?.length ?? 0) === 0;

    byRuleId.set(b.id, {
      ownerId: "__all__",
      ruleId: b.id,
      createdAt: b.createdAt,
      salesRule: {
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

export async function getSalesRulesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    severity: Severity;
    active: boolean;
    surfaces: SalesRuleSurface[];
  }>(
    client,
    "enforcementRule",
    "id, name, severity, active, surfaces",
    (query) =>
      query.eq("companyId", companyId).eq("family", "sales").order("name")
  );
}

export async function assignSalesRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string; createdBy: string }
) {
  // Preflight: rule must exist in this company. Without this, callers could
  // insert a foreign rule id; the evaluator filters defensively but the
  // orphan row still inflates assignment counts.
  const ruleRes = await client
    .from("enforcementRule")
    .select("id")
    .eq("id", args.ruleId)
    .eq("companyId", args.companyId)
    .eq("family", "sales")
    .single();
  if (ruleRes.error || !ruleRes.data) {
    return {
      data: null,
      error: ruleRes.error ?? new Error("Rule not found")
    };
  }

  return client
    .from("enforcementRuleItemAssignment")
    .insert({
      itemId: args.itemId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("itemId, ruleId")
    .single();
}

export async function unassignSalesRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string }
) {
  return client
    .from("enforcementRuleItemAssignment")
    .delete()
    .eq("itemId", args.itemId)
    .eq("ruleId", args.ruleId)
    .eq("companyId", args.companyId);
}
