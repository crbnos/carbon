// Server-side item-rules service. Single entry point for trigger surfaces
// (receipt / shipment / stock-transfer / inventory adjustment), plan gate,
// and the per-item Rules-tab loader.
//
// All functions here are server-only. Never import from a client module.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import {
  type CompiledRule,
  type Condition,
  type ConditionAst,
  compileWithCache,
  evaluateRules,
  getFieldDef,
  Plan,
  type RuleContext,
  type Severity,
  type TransactionSurface,
  type ValueOptionsLoader,
  type Violation
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { getStorageTypesList } from "~/modules/inventory";
import { getLocationsList } from "~/modules/resources";
import { companyHasPlan } from "~/utils/planGate.server";
import {
  getActiveRulesForItems,
  getItemPostingGroupsList,
  getItemRulesList,
  getRuleAssignmentsForItem
} from "./items.service";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Plan gate
// ---------------------------------------------------------------------------

/**
 * Item rules require a paid plan (Business). Self-hosted (non-Cloud) and
 * bypass-listed companies always pass — `companyHasPlan` handles both.
 */
export const isItemRulesEnabledForCompany = (
  client: Client,
  companyId: string
): Promise<boolean> => companyHasPlan(client, companyId, [Plan.Business]);

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
 * Collapse violations by `ruleId + message`. Same rule firing on N lines or
 * across N surfaces (e.g. shipment + warehouseTransfer when posting an
 * outbound transfer) yields N copies — operator only needs to see one.
 * `evaluateLinesForSurface` dedups its own output; use this when a caller
 * accumulates results from multiple `evaluateLinesForSurface` invocations.
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
// Per-item Rules tab data (loader helper)
// ---------------------------------------------------------------------------

type AssignedRuleNode = {
  id: string;
  name: string;
  severity: Severity;
  message: string;
  active: boolean;
  surfaces: TransactionSurface[];
};

export async function getItemRulesDataForItem(
  client: Client,
  itemId: string,
  companyId: string
) {
  const [assignmentsRes, libraryRes] = await Promise.all([
    getRuleAssignmentsForItem(client, itemId, companyId),
    getItemRulesList(client, companyId)
  ]);

  const assignments: { ruleId: string; rule: AssignedRuleNode }[] = [];
  for (const row of assignmentsRes.data ?? []) {
    // Supabase returns joined relation as object or single-element array
    // depending on FK shape. Normalise once.
    const joined = (
      row as { itemRule: AssignedRuleNode | AssignedRuleNode[] | null }
    ).itemRule;
    const rule = Array.isArray(joined) ? joined[0] : joined;
    if (!rule) continue;
    assignments.push({ ruleId: row.ruleId as string, rule });
  }

  return { assignments, library: libraryRes.data ?? [] };
}

export async function loadRulesTabData({
  request,
  itemId
}: {
  request: LoaderFunctionArgs["request"];
  itemId: string;
}) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  return getItemRulesDataForItem(client, itemId, companyId);
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

/**
 * Batch-load + compile rules for many items in one round-trip. The compiled
 * cache (`compileWithCache`) deduplicates across requests so identical rules
 * compile once per process.
 */
async function loadCompiledRulesForItems(
  client: Client,
  itemIds: string[],
  companyId: string
): Promise<Map<string, CompiledRule[]>> {
  const out = new Map<string, CompiledRule[]>();
  if (itemIds.length === 0) return out;

  const { data: byItem } = await getActiveRulesForItems(
    client,
    itemIds,
    companyId
  );
  for (const [itemId, rows] of byItem) {
    const compiled = new Array<CompiledRule>(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      compiled[i] = compileWithCache({
        ...row,
        conditionAst: row.conditionAst as ConditionAst
      });
    }
    out.set(itemId, compiled);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loader-label resolver — UUID condition values → human labels
// ---------------------------------------------------------------------------

type LoaderFn = (
  client: Client,
  companyId: string
) => Promise<{ id: string; name: string }[]>;

const LOADERS: Record<ValueOptionsLoader, LoaderFn | null> = {
  locations: async (c, id) => (await getLocationsList(c, id)).data ?? [],
  storageTypes: async (c, id) => (await getStorageTypesList(c, id)).data ?? [],
  itemPostingGroups: async (c, id) =>
    (await getItemPostingGroupsList(c, id)).data ?? [],
  // Static enums — value is already the label.
  itemTypes: null,
  replenishmentSystems: null,
  itemTrackingTypes: null
};

const EMPTY_RESOLVER = (): undefined => undefined;

/**
 * Build a synchronous `(cond) => label` resolver. Pre-fetches every distinct
 * loader referenced by an `id`-typed condition in one parallel batch, then
 * returns a closure that hits memory only.
 */
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
// Per-line evaluator — the single entry point trigger handlers call
// ---------------------------------------------------------------------------

export type RuleLineInput = {
  /** Diagnostic identifier — not used in eval. */
  lineId: string;
  /** Item the line operates on. `null` lines are skipped. */
  itemId: string | null;
  /** Storage unit being interacted with. `null` → `storageUnit.*` resolves to undefined. */
  storageUnitId: string | null;
  /** Quantity for `transaction.quantity` predicates. */
  quantity: number;
  /**
   * Location stamped on the transaction. When `null`, the helper derives one
   * from the storage unit (if any).
   */
  locationId?: string | null;
};

export type EvaluateLinesForSurfaceArgs = {
  /** Service-role client — `item` / `storageUnit` reads bypass RLS. */
  client: Client;
  companyId: string;
  userId: string;
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

type ItemCtxRow = Record<string, unknown> & {
  customFields?: Record<string, unknown>;
};
type StorageUnitCtxRow = Record<string, unknown> & {
  locationId?: string | null;
};

export async function evaluateLinesForSurface({
  client,
  companyId,
  userId,
  surface,
  lines
}: EvaluateLinesForSurfaceArgs): Promise<EvaluateLinesForSurfaceResult> {
  if (lines.length === 0) return EMPTY_RESULT;
  if (!(await isItemRulesEnabledForCompany(client, companyId)))
    return EMPTY_RESULT;

  // Single-pass extraction of unique itemIds + storageUnitIds. Avoids two
  // `pluckUnique` calls + intermediate arrays.
  const itemIds = new Set<string>();
  const storageUnitIds = new Set<string>();
  for (const line of lines) {
    if (line.itemId) itemIds.add(line.itemId);
    if (line.storageUnitId) storageUnitIds.add(line.storageUnitId);
  }
  if (itemIds.size === 0) return EMPTY_RESULT;

  const [itemsRes, storageUnitsRes, compiledByItem] = await Promise.all([
    client
      .from("item")
      .select(
        "id, type, replenishmentSystem, itemTrackingType, name, readableId"
      )
      .in("id", Array.from(itemIds)),
    storageUnitIds.size > 0
      ? client
          .from("storageUnit")
          .select("id, storageTypeIds, warehouseId, name, locationId")
          .in("id", Array.from(storageUnitIds))
      : Promise.resolve({ data: [], error: null }),
    loadCompiledRulesForItems(client, Array.from(itemIds), companyId)
  ]);

  // Item ctx exposes `readableId` as `id` so templates can render `{item.id}`
  // as "PART-001" (not the UUID). Predicates never reference UUID directly.
  const itemsById = new Map<string, ItemCtxRow>();
  for (const it of itemsRes.data ?? []) {
    const row = it as Record<string, unknown>;
    const readable = row.readableId as string | undefined;
    itemsById.set(row.id as string, {
      ...row,
      id: readable ?? (row.id as string)
    });
  }

  // Expose the full `storageTypeIds[]` under the synthetic `storageTypeId`
  // field (FIELD_REGISTRY entry is named singular for legacy reasons). Array
  // shape lets the operator helpers do "any of" matching against rule values
  // — a unit configured as both Hot + Cool should satisfy `in [Cool]`.
  const unitsById = new Map<string, StorageUnitCtxRow>();
  for (const u of storageUnitsRes.data ?? []) {
    const row = u as Record<string, unknown>;
    const ids = row.storageTypeIds as string[] | null | undefined;
    unitsById.set(row.id as string, {
      ...row,
      // Empty/null → undefined so `isNotSet` fires correctly, otherwise the
      // full array so the operator helpers handle "any of" semantics.
      storageTypeId: ids && ids.length > 0 ? ids : undefined
    });
  }

  // One eager DB pass for label maps. Build the condition list with a single
  // generator so we never allocate an intermediate flat array.
  const resolveConditionValue = await buildConditionValueResolver(
    client,
    companyId,
    iterateConditions(compiledByItem)
  );

  const violations: Violation[] = [];
  for (const line of lines) {
    if (!line.itemId) continue;
    const compiled = compiledByItem.get(line.itemId);
    if (!compiled || compiled.length === 0) continue;

    const storageUnit = line.storageUnitId
      ? unitsById.get(line.storageUnitId)
      : undefined;

    const ctx: RuleContext = {
      item: itemsById.get(line.itemId),
      storageUnit,
      transaction: {
        kind: surface,
        locationId: line.locationId ?? storageUnit?.locationId ?? null,
        quantity: line.quantity,
        userId
      }
    };

    const ruleViolations = evaluateRules(compiled, ctx, surface, {
      resolveConditionValue
    });
    for (let i = 0; i < ruleViolations.length; i++) {
      violations.push(ruleViolations[i]!);
    }
  }

  // Dedup. Same item + same rule across N lines yields N identical violations
  // (e.g. 3 shipment lines of "Frozen peas" all break "Hot only"). Operator
  // doesn't need to see the same message thrice — collapse by ruleId+message.
  const seen = new Set<string>();
  const deduped: Violation[] = [];
  for (let i = 0; i < violations.length; i++) {
    const v = violations[i]!;
    const key = `${v.ruleId}\x00${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }

  if (deduped.length === 0) {
    return { violations: deduped, ruleNames: {} };
  }

  // Resolve human-readable rule names for the violations modal.
  const violatedIds = new Set<string>();
  for (let i = 0; i < violations.length; i++)
    violatedIds.add(violations[i]!.ruleId);

  const { data: namedRules } = await client
    .from("itemRule")
    .select("id, name")
    .in("id", Array.from(violatedIds));

  const ruleNames: Record<string, string> = {};
  for (const r of namedRules ?? []) {
    ruleNames[r.id as string] = r.name as string;
  }

  return { violations, ruleNames };
}

/** Lazy-iterate every condition across every compiled rule. No allocations. */
function* iterateConditions(
  compiledByItem: Map<string, CompiledRule[]>
): Generator<Condition> {
  for (const rules of compiledByItem.values()) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      const conds = rule.conditions;
      for (let j = 0; j < conds.length; j++) yield conds[j]!;
    }
  }
}
