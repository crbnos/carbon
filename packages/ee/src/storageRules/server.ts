// Server-side storage-rules evaluator. Cross-app entry point — ERP
// (item surfaces) and MES (workCenter surfaces) both call
// `evaluateLinesForSurface`.
//
// All functions here are server-only. Never import from a client module.

import type { Database } from "@carbon/database";
import {
  type CompiledRule,
  type Condition,
  type ConditionAst,
  compileWithCache,
  evaluateRules,
  getFieldDef,
  type ItemRuleFilter,
  itemRuleAppliesToItem,
  type Severity,
  type TargetType,
  type TransactionSurface,
  type ValueOptionsLoader,
  type Violation
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyHasPlan } from "../plan.server";
import {
  buildLineContext,
  type ItemCtxRow,
  itemPostingGroupIdFromEmbed,
  type RuleLineInput,
  type StorageUnitCtxRow,
  type WorkCenterCtxRow
} from "./context";
import {
  getActiveRulesForTargets,
  getRuleAssignmentsForTarget,
  getStorageRulesList
} from "./service";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Plan gate
// ---------------------------------------------------------------------------

export const isStorageRulesEnabledForCompany = (
  client: Client,
  companyId: string
): Promise<boolean> =>
  companyHasPlan(client, companyId, { feature: "STORAGE_RULES" });

// ---------------------------------------------------------------------------
// Block decision
// ---------------------------------------------------------------------------

/** Any error blocks unconditionally. Warns block until acknowledged. */
export const isBlocked = (
  violations: Violation[],
  acknowledged: boolean
): boolean => {
  for (let i = 0; i < violations.length; i++) {
    if (violations[i]!.severity === "error") return true;
  }
  return violations.length > 0 && !acknowledged;
};

/**
 * Collapse violations by `ruleId + message`. Call when accumulating results
 * from multiple `evaluateLinesForSurface` invocations (e.g. item pass +
 * storageUnit pass on the same receipt).
 */
export const dedupeViolations = (violations: Violation[]): Violation[] => {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i]!;
    const key = `${v.ruleId}\x00${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Per-target Rules tab data (loader helper)
// ---------------------------------------------------------------------------

type AssignedRuleNode = {
  id: string;
  name: string;
  targetType: TargetType;
  severity: Severity;
  message: string;
  active: boolean;
  surfaces: TransactionSurface[];
  appliesToAll: boolean;
};

export async function getStorageRulesDataForTarget(
  client: Client,
  args: { targetType: TargetType; targetId: string; companyId: string }
) {
  const [assignmentsRes, libraryRes] = await Promise.all([
    getRuleAssignmentsForTarget(client, args),
    getStorageRulesList(client, args.companyId, args.targetType)
  ]);

  // Forward inheritance metadata so the drawer can tag inherited rows.
  const assignments: {
    ruleId: string;
    rule: AssignedRuleNode;
    inheritedFromId: string | null;
    inheritedFromName: string | null;
  }[] = [];
  for (const row of assignmentsRes.data ?? []) {
    const joined = row.storageRule as
      | AssignedRuleNode
      | AssignedRuleNode[]
      | null;
    const rule = Array.isArray(joined) ? joined[0] : joined;
    if (!rule) continue;
    assignments.push({
      ruleId: row.ruleId,
      rule,
      inheritedFromId: row.inheritedFromId,
      inheritedFromName: row.inheritedFromName
    });
  }

  return { assignments, library: libraryRes.data ?? [] };
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

async function loadCompiledRulesForTargets(
  client: Client,
  args: { targetType: TargetType; targetIds: string[]; companyId: string }
): Promise<{
  byTarget: Map<string, CompiledRule[]>;
  broadcasts: CompiledRule[];
  broadcastFilters: Map<string, ItemRuleFilter>;
}> {
  const byTarget = new Map<string, CompiledRule[]>();

  const { data, broadcasts, broadcastFilters } = await getActiveRulesForTargets(
    client,
    args
  );
  for (const [targetId, rows] of data) {
    const compiled = new Array<CompiledRule>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      compiled[i] = compileWithCache({
        ...row,
        conditionAst: row.conditionAst as ConditionAst
      });
    }
    byTarget.set(targetId, compiled);
  }

  const compiledBroadcasts = new Array<CompiledRule>(broadcasts.length);
  for (let i = 0; i < broadcasts.length; i++) {
    const row = broadcasts[i]!;
    compiledBroadcasts[i] = compileWithCache({
      ...row,
      conditionAst: row.conditionAst as ConditionAst
    });
  }

  return { byTarget, broadcasts: compiledBroadcasts, broadcastFilters };
}

// ---------------------------------------------------------------------------
// Loader-label resolver — UUID condition values → human labels
// ---------------------------------------------------------------------------

type LoaderFn = (
  client: Client,
  companyId: string
) => Promise<{ id: string; name: string }[]>;

// Inline-table loaders. Each pulls (id, name) for one entity type scoped by
// company. No ERP-app-utils dependency — keeps this file portable across apps.
const LOADERS: Record<ValueOptionsLoader, LoaderFn | null> = {
  locations: async (c, id) => {
    const { data } = await c
      .from("location")
      .select("id, name")
      .eq("companyId", id);
    return (data ?? []) as { id: string; name: string }[];
  },
  storageTypes: async (c, id) => {
    const { data } = await c
      .from("storageType")
      .select("id, name")
      .eq("companyId", id);
    return (data ?? []) as { id: string; name: string }[];
  },
  itemPostingGroups: async (c, id) => {
    const { data } = await c
      .from("itemPostingGroup")
      .select("id, name")
      .eq("companyId", id);
    return (data ?? []) as { id: string; name: string }[];
  },
  // Static enums — value is already the label.
  itemTypes: null,
  replenishmentSystems: null,
  itemTrackingTypes: null
};

const EMPTY_RESOLVER = (): undefined => undefined;

async function buildConditionValueResolver(
  client: Client,
  companyId: string,
  conditions: Iterable<Condition>
): Promise<(cond: Condition) => string | undefined> {
  const byLoader = new Map<ValueOptionsLoader, Set<string>>();
  for (const cond of conditions) {
    const def = getFieldDef(cond.field);
    if (!def?.valueOptionsLoader || def.type !== "id") continue;
    if (LOADERS[def.valueOptionsLoader] === null) continue;
    if (cond.value == null) continue;

    let bucket = byLoader.get(def.valueOptionsLoader);
    if (!bucket) {
      bucket = new Set<string>();
      byLoader.set(def.valueOptionsLoader, bucket);
    }
    if (Array.isArray(cond.value)) {
      for (const v of cond.value) bucket.add(String(v));
    } else {
      bucket.add(String(cond.value));
    }
  }

  if (byLoader.size === 0) return EMPTY_RESOLVER;

  const labels = new Map<ValueOptionsLoader, Map<string, string>>();
  await Promise.all(
    Array.from(byLoader.keys()).map(async (loader) => {
      const fn = LOADERS[loader]!;
      const rows = await fn(client, companyId);
      const map = new Map<string, string>();
      for (const r of rows) map.set(r.id, r.name);
      labels.set(loader, map);
    })
  );

  return (cond: Condition): string | undefined => {
    if (cond.value == null) return undefined;
    const def = getFieldDef(cond.field);
    const map = def?.valueOptionsLoader
      ? labels.get(def.valueOptionsLoader)
      : undefined;

    if (Array.isArray(cond.value)) {
      if (cond.value.length === 0) return "—";
      const out: string[] = [];
      for (const v of cond.value) {
        const s = String(v);
        out.push(map?.get(s) ?? s);
      }
      return out.join(", ");
    }
    const s = String(cond.value);
    return map?.get(s) ?? s;
  };
}

// ---------------------------------------------------------------------------
// Per-line evaluator — single entry point trigger handlers call
// ---------------------------------------------------------------------------

export type EvaluateLinesForSurfaceArgs = {
  client: Client;
  companyId: string;
  userId: string;
  /**
   * Which targetType the call is evaluating (`item` for ERP inventory
   * surfaces, `workCenter` for MES). A caller running more than one surface
   * (e.g. a receipt's `receipt` + `place` passes) concatenates and
   * `dedupeViolations`-es the results.
   */
  targetType: TargetType;
  surface: TransactionSurface;
  lines: RuleLineInput[];
};

export type EvaluateLinesForSurfaceResult = {
  violations: Violation[];
  ruleNames: Record<string, string>;
};

const EMPTY_RESULT: EvaluateLinesForSurfaceResult = {
  violations: [],
  ruleNames: {}
};

const lineTargetIdFor = (
  line: RuleLineInput,
  targetType: TargetType
): string | null => {
  switch (targetType) {
    case "item":
      return line.itemId ?? null;
    case "workCenter":
      return line.workCenterId ?? null;
  }
};

export async function evaluateLinesForSurface({
  client,
  companyId,
  userId,
  targetType,
  surface,
  lines
}: EvaluateLinesForSurfaceArgs): Promise<EvaluateLinesForSurfaceResult> {
  if (lines.length === 0) return EMPTY_RESULT;
  if (!(await isStorageRulesEnabledForCompany(client, companyId)))
    return EMPTY_RESULT;

  const targetIds = new Set<string>();
  const itemIds = new Set<string>();
  const storageUnitIds = new Set<string>();
  const workCenterIds = new Set<string>();
  for (const line of lines) {
    const tid = lineTargetIdFor(line, targetType);
    if (tid) targetIds.add(tid);
    if (line.itemId) itemIds.add(line.itemId);
    if (line.storageUnitId) storageUnitIds.add(line.storageUnitId);
    if (line.workCenterId) workCenterIds.add(line.workCenterId);
    if (line.operation?.itemId) itemIds.add(line.operation.itemId);
  }
  // No early-return on empty targetIds — broadcasts (all active item rules, or
  // appliesToAll rules for non-item targets) must still fire against every line.
  // Explicit-assignment lookup short-circuits inside `getActiveRulesForTargets`
  // when targetIds is empty.

  // Walk the storage-unit tree for every line that carries a bin id so storage
  // types cascade: a child bin implicitly carries every `storageTypeIds`
  // declared on itself OR any ancestor. The evaluator unions them when
  // populating `ctx.storageUnit.storageTypeId` below (item rules referencing
  // `storageUnit.storageTypeId` on place/pick depend on this). One round-trip;
  // selects `storageTypeIds` so the union doesn't need a second fetch.
  const ancestorsByBin = new Map<string, string[]>();
  const storageTypesByBin = new Map<string, string[]>();
  if (storageUnitIds.size > 0) {
    const ids = Array.from(storageUnitIds);
    const ancestorsRes = await (client as Client)
      .from("storageUnits_recursive")
      .select("id, ancestorPath, storageTypeIds")
      .in("id", ids)
      .eq("companyId", companyId);

    const ancestorIds = new Set<string>();
    for (const row of (ancestorsRes.data ?? []) as Array<{
      id: string;
      ancestorPath: string[] | null;
      storageTypeIds: string[] | null;
    }>) {
      const chain =
        row.ancestorPath && row.ancestorPath.length > 0
          ? row.ancestorPath
          : [row.id];
      ancestorsByBin.set(row.id, chain);
      if (row.storageTypeIds) storageTypesByBin.set(row.id, row.storageTypeIds);
      for (const a of chain) ancestorIds.add(a);
    }
    for (const id of ids) {
      if (!ancestorsByBin.has(id)) ancestorsByBin.set(id, [id]);
    }

    // Second fetch: storageTypeIds for ancestor bins not in the line-bin set
    // (the first query only returned rows for the bins we asked about, not
    // their ancestors). Skip if every ancestor was already in the line set.
    const missing = Array.from(ancestorIds).filter(
      (id) => !storageTypesByBin.has(id) && !ids.includes(id)
    );
    if (missing.length > 0) {
      const ancestorRowsRes = await (client as Client)
        .from("storageUnits_recursive")
        .select("id, storageTypeIds")
        .in("id", missing)
        .eq("companyId", companyId);
      for (const row of (ancestorRowsRes.data ?? []) as Array<{
        id: string;
        storageTypeIds: string[] | null;
      }>) {
        if (row.storageTypeIds)
          storageTypesByBin.set(row.id, row.storageTypeIds);
      }
    }
  }

  const [itemsRes, storageUnitsRes, workCentersRes, compiled] =
    await Promise.all([
      itemIds.size > 0
        ? client
            .from("item")
            // `itemPostingGroupId` lives on the 1:1 `itemCost` row — embed it
            // so the `item.itemPostingGroupId` rule field resolves.
            .select(
              "id, type, replenishmentSystem, itemTrackingType, name, readableId, itemCost(itemPostingGroupId)"
            )
            .in("id", Array.from(itemIds))
        : Promise.resolve({ data: [], error: null }),
      storageUnitIds.size > 0
        ? client
            .from("storageUnit")
            .select("id, storageTypeIds, warehouseId, name, locationId")
            .in("id", Array.from(storageUnitIds))
        : Promise.resolve({ data: [], error: null }),
      workCenterIds.size > 0
        ? client
            .from("workCenter")
            .select("id, locationId, active, name")
            .in("id", Array.from(workCenterIds))
        : Promise.resolve({ data: [], error: null }),
      loadCompiledRulesForTargets(client, {
        targetType,
        targetIds: Array.from(targetIds),
        companyId
      })
    ]);

  const compiledByTarget = compiled.byTarget;
  const broadcastCompiled = compiled.broadcasts;
  const broadcastFilters = compiled.broadcastFilters;

  // If neither explicit assignments nor broadcasts exist, nothing can fire.
  if (compiledByTarget.size === 0 && broadcastCompiled.length === 0)
    return EMPTY_RESULT;

  const itemsById = new Map<string, ItemCtxRow>();
  for (const it of itemsRes.data ?? []) {
    const row = it as unknown as Record<string, unknown>;
    const readable = row.readableId as string | undefined;
    // Flatten the 1:1 `itemCost` embed's posting group onto the item ctx; drop
    // the nested object.
    const { itemCost, ...rest } = row;
    itemsById.set(row.id as string, {
      ...rest,
      id: readable ?? (row.id as string),
      itemPostingGroupId: itemPostingGroupIdFromEmbed(itemCost) ?? undefined
    });
  }

  const unitsById = new Map<string, StorageUnitCtxRow>();
  for (const u of storageUnitsRes.data ?? []) {
    const row = u as Record<string, unknown>;
    const binId = row.id as string;
    // Union storage types across the ancestor chain so a child bin inherits
    // every type declared on itself + every parent. Predicates like
    // `storageUnit.storageTypeId eq frozen` then match when ANY ancestor
    // (incl. self) carries "frozen".
    const chain = ancestorsByBin.get(binId) ?? [binId];
    const unionedTypes = new Set<string>();
    for (const ancestorId of chain) {
      const ownTypes =
        ancestorId === binId
          ? (row.storageTypeIds as string[] | null | undefined)
          : storageTypesByBin.get(ancestorId);
      if (ownTypes) for (const t of ownTypes) unionedTypes.add(t);
    }
    unitsById.set(binId, {
      ...row,
      storageTypeId:
        unionedTypes.size > 0 ? Array.from(unionedTypes) : undefined
    });
  }

  const wcById = new Map<string, WorkCenterCtxRow>();
  for (const w of workCentersRes.data ?? []) {
    const row = w as Record<string, unknown>;
    wcById.set(row.id as string, { ...row });
  }

  const resolveConditionValue = await buildConditionValueResolver(
    client,
    companyId,
    iterateConditions(compiledByTarget, broadcastCompiled)
  );

  const violations: Violation[] = [];
  for (const line of lines) {
    const targetId = lineTargetIdFor(line, targetType);

    // Per-line compiled rule set: explicit assignments (target-keyed) +
    // broadcasts. Lines without a targetId of this targetType still match
    // broadcasts.
    const seen = new Set<string>();
    const compiledForLine: CompiledRule[] = [];

    if (targetId) {
      const rules = compiledByTarget.get(targetId);
      if (rules) {
        for (const r of rules) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          compiledForLine.push(r);
        }
      }
    }

    // Item broadcasts are gated per item by the rule's type/group filters
    // (empty filters = every item). A line with no itemId can't match an item
    // rule. Non-item broadcasts (appliesToAll) fire on every line.
    const itemForLine =
      targetType === "item" && line.itemId
        ? itemsById.get(line.itemId)
        : undefined;
    for (const r of broadcastCompiled) {
      if (seen.has(r.id)) continue;
      if (targetType === "item") {
        if (!itemForLine) continue;
        const filter: ItemRuleFilter = broadcastFilters.get(r.id) ?? {};
        if (!itemRuleAppliesToItem(itemForLine, filter)) continue;
      }
      seen.add(r.id);
      compiledForLine.push(r);
    }

    if (compiledForLine.length === 0) continue;

    // Fallback id-only ctx objects when the DB lookup misses the row (RLS,
    // missing record, late insert) are handled inside `buildLineContext` so the
    // `{item.id}` / `{storageUnit.id}` / `{workCenter.id}` tokens still resolve.
    const ctx = buildLineContext({
      line,
      surface,
      userId,
      item: line.itemId ? itemsById.get(line.itemId) : undefined,
      storageUnit: line.storageUnitId
        ? unitsById.get(line.storageUnitId)
        : undefined,
      workCenter: line.workCenterId ? wcById.get(line.workCenterId) : undefined
    });

    const ruleViolations = evaluateRules(compiledForLine, ctx, surface, {
      resolveConditionValue
    });
    for (let i = 0; i < ruleViolations.length; i++) {
      violations.push(ruleViolations[i]!);
    }
  }

  const deduped = dedupeViolations(violations);
  if (deduped.length === 0) {
    return { violations: deduped, ruleNames: {} };
  }

  const violatedIds = new Set<string>();
  for (let i = 0; i < deduped.length; i++) violatedIds.add(deduped[i]!.ruleId);

  const { data: namedRules } = await client
    .from("storageRule")
    .select("id, name")
    .in("id", Array.from(violatedIds))
    .eq("companyId", companyId);

  const ruleNames: Record<string, string> = {};
  for (const r of namedRules ?? []) {
    ruleNames[r.id as string] = r.name as string;
  }

  return { violations: deduped, ruleNames };
}

function* iterateConditions(
  compiledByTarget: Map<string, CompiledRule[]>,
  broadcasts: CompiledRule[]
): Generator<Condition> {
  for (const rules of compiledByTarget.values()) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      const conds = rule.conditions;
      for (let j = 0; j < conds.length; j++) yield conds[j]!;
    }
  }
  for (let i = 0; i < broadcasts.length; i++) {
    const conds = broadcasts[i]!.conditions;
    for (let j = 0; j < conds.length; j++) yield conds[j]!;
  }
}
