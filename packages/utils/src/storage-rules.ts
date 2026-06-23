// Storage Rules evaluator. AST → JIT-compiled closure with LRU cache.
// Used server-side on transactions (receipt, shipment, stock transfer,
// inventory adjustment, place, pick, operation start/finish, material
// issue/receive) to enforce per-entity validation/guideline rules.
//
// Each rule binds to a single `TargetType` (`item` or `workCenter`). The field
// registry lives in `./field-registry`.

import {
  type FieldContext,
  type FieldDef,
  getFieldDef,
  getFieldsForTargetType
} from "./field-registry";

export type Operator =
  | "eq"
  | "neq"
  | "in"
  | "notIn"
  | "isSet"
  | "isNotSet"
  | "gt"
  | "lt";

export type Severity = "error" | "warn";

/**
 * Which entity a rule applies to. Drives the field registry slice the
 * builder shows the author, and the assignment table the loader joins.
 * Mirrors the Postgres ENUM `storageRuleTargetType`.
 */
export const TARGET_TYPES = ["item", "workCenter"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/**
 * Transaction surfaces a rule may opt into. Mirrors the Postgres ENUM
 * `transactionSurface`. After `bun run db:types` regenerates the database
 * types, tighten this to:
 *
 *   import type { Database } from "@carbon/database";
 *   ...as const satisfies readonly Database["public"]["Enums"]["transactionSurface"][];
 *
 * The runtime array stays the source of truth for the validator's `z.enum`.
 */
export const TRANSACTION_SURFACES = [
  "receipt",
  "shipment",
  "stockTransfer",
  "warehouseTransfer",
  "inventoryAdjustment",
  "place",
  "pick",
  "operationStart",
  "operationFinish",
  "materialIssue",
  "materialReceive"
] as const;
export type TransactionSurface = (typeof TRANSACTION_SURFACES)[number];

/**
 * Which surfaces are valid for each target type. The form validator narrows
 * a rule's `surfaces` array against this map; the evaluator skips surfaces
 * a rule didn't subscribe to.
 *
 * Item rules own every inventory/storage surface — including `place`/`pick`
 * (bin-level guards that used to live on the now-removed `storageUnit` target).
 * They reference bin context via the `storageUnit.*` fields in the registry.
 */
export const SURFACES_BY_TARGET_TYPE: Record<
  TargetType,
  readonly TransactionSurface[]
> = {
  item: [
    "receipt",
    "shipment",
    "stockTransfer",
    "warehouseTransfer",
    "inventoryAdjustment",
    "place",
    "pick"
  ],
  workCenter: [
    "operationStart",
    "operationFinish",
    "materialIssue",
    "materialReceive"
  ]
};

export type Condition = {
  field: string;
  op: Operator;
  value?: unknown;
};

export type MatchKind = "all" | "any" | "none";

export type ConditionAst = {
  /**
   * - `all`  — every condition must be true (AND)
   * - `any`  — at least one condition must be true (OR)
   * - `none` — no condition may be true (NOR / negate)
   */
  kind: MatchKind;
  conditions: Condition[];
};

export type Violation = {
  ruleId: string;
  severity: Severity;
  message: string;
};

export type RuleContext = {
  item?: Record<string, unknown> & { customFields?: Record<string, unknown> };
  shelf?: Record<string, unknown>;
  storageUnit?: Record<string, unknown>;
  workCenter?: Record<string, unknown>;
  operation?: Record<string, unknown>;
  transaction?: Record<string, unknown>;
};

export type StorageRuleRow = {
  id: string;
  targetType: TargetType;
  severity: Severity;
  message: string;
  conditionAst: ConditionAst;
  /**
   * Surfaces this rule applies to. Empty arrays are not allowed at the DB
   * level (CHECK constraint); treat missing/empty client-side as "all
   * surfaces for this targetType" for forward-compat with rules created
   * before the migration.
   */
  surfaces?: TransactionSurface[];
  updatedAt?: string | null;
  active?: boolean;
};

export type CompiledRule = {
  id: string;
  targetType: TargetType;
  severity: Severity;
  rawMessage: string;
  surfaces: TransactionSurface[];
  conditions: Condition[];
  requiredFieldChecks: {
    field: string;
    resolve: (ctx: RuleContext) => unknown;
  }[];
  predicate: (ctx: RuleContext) => boolean;
};

// ---------------------------------------------------------------------------
// Field path resolver
// ---------------------------------------------------------------------------

type Resolver = (ctx: RuleContext) => unknown;

const ROOT_KEYS = new Set([
  "item",
  "shelf",
  "storageUnit",
  "workCenter",
  "operation",
  "transaction"
]);

export const buildResolver = (path: string): Resolver => {
  const segments = path.split(".");
  if (segments.length < 2 || !ROOT_KEYS.has(segments[0]!)) {
    return () => undefined;
  }
  return (ctx: RuleContext) => {
    let cur: unknown = (ctx as Record<string, unknown>)[segments[0]!];
    for (let i = 1; i < segments.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[segments[i]!];
    }
    return cur;
  };
};

// ---------------------------------------------------------------------------
// Operator implementations (pure)
// ---------------------------------------------------------------------------

const isNullish = (v: unknown): boolean => v === null || v === undefined;

const eqAnyArrayLeft = (l: unknown[], r: unknown): boolean => {
  for (let i = 0; i < l.length; i++) if (l[i] === r) return true;
  return false;
};
const inAnyArrayLeft = (l: unknown[], r: unknown[]): boolean => {
  for (let i = 0; i < l.length; i++) if (r.includes(l[i])) return true;
  return false;
};

const operatorFns: Record<
  Operator,
  (left: unknown, right: unknown) => boolean
> = {
  eq: (l, r) => (Array.isArray(l) ? eqAnyArrayLeft(l, r) : l === r),
  neq: (l, r) => (Array.isArray(l) ? !eqAnyArrayLeft(l, r) : l !== r),
  in: (l, r) =>
    Array.isArray(r) &&
    (Array.isArray(l) ? inAnyArrayLeft(l, r) : r.includes(l)),
  notIn: (l, r) =>
    Array.isArray(r) &&
    (Array.isArray(l) ? !inAnyArrayLeft(l, r) : !r.includes(l)),
  isSet: (l) => (Array.isArray(l) ? l.length > 0 : !isNullish(l) && l !== ""),
  isNotSet: (l) =>
    Array.isArray(l) ? l.length === 0 : isNullish(l) || l === "",
  gt: (l, r) => typeof l === "number" && typeof r === "number" && l > r,
  lt: (l, r) => typeof l === "number" && typeof r === "number" && l < r
};

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

const compileCondition = (cond: Condition): ((ctx: RuleContext) => boolean) => {
  const resolve = buildResolver(cond.field);
  const op = operatorFns[cond.op];
  if (!op) return () => false;
  const value = cond.value;
  return (ctx) => op(resolve(ctx), value);
};

const compilePredicate = (
  ast: ConditionAst
): ((ctx: RuleContext) => boolean) => {
  if (!ast || !Array.isArray(ast.conditions)) return () => false;
  const kind = ast.kind;
  if (kind !== "all" && kind !== "any" && kind !== "none") return () => false;
  if (ast.conditions.length === 0) {
    return kind === "all" || kind === "none" ? () => true : () => false;
  }
  const fns = ast.conditions.map(compileCondition);
  if (kind === "all") {
    return (ctx) => {
      for (let i = 0; i < fns.length; i++) {
        if (!fns[i]!(ctx)) return false;
      }
      return true;
    };
  }
  if (kind === "any") {
    return (ctx) => {
      for (let i = 0; i < fns.length; i++) {
        if (fns[i]!(ctx)) return true;
      }
      return false;
    };
  }
  return (ctx) => {
    for (let i = 0; i < fns.length; i++) {
      if (fns[i]!(ctx)) return false;
    }
    return true;
  };
};

const defaultSurfacesFor = (
  targetType: TargetType
): readonly TransactionSurface[] => SURFACES_BY_TARGET_TYPE[targetType];

export const compileRule = (row: StorageRuleRow): CompiledRule => ({
  id: row.id,
  targetType: row.targetType,
  severity: row.severity,
  rawMessage: row.message,
  surfaces:
    row.surfaces && row.surfaces.length > 0
      ? row.surfaces
      : [...defaultSurfacesFor(row.targetType)],
  conditions:
    row.conditionAst && Array.isArray(row.conditionAst.conditions)
      ? row.conditionAst.conditions
      : [],
  requiredFieldChecks: (row.conditionAst &&
  Array.isArray(row.conditionAst.conditions)
    ? row.conditionAst.conditions
    : []
  )
    .filter((c) => c.op !== "isSet" && c.op !== "isNotSet")
    .map((c) => ({ field: c.field, resolve: buildResolver(c.field) })),
  predicate: compilePredicate(row.conditionAst)
});

// ---------------------------------------------------------------------------
// LRU cache (process-scoped, FIFO eviction at cap)
// ---------------------------------------------------------------------------

const CACHE_CAP = 256;
const cache = new Map<string, CompiledRule>();

const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
};

const cacheKey = (row: StorageRuleRow): string => {
  // Hash bits that drive compilation output, including targetType so two
  // rules with identical AST but different targets cannot collide.
  const contentHash = fnv1a(
    `${row.targetType}|${row.message}|${JSON.stringify(row.conditionAst)}|${(row.surfaces ?? []).join(",")}`
  );
  return `${row.id}:${row.updatedAt ?? ""}:${contentHash}`;
};

export const compileWithCache = (row: StorageRuleRow): CompiledRule => {
  const key = cacheKey(row);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const compiled = compileRule(row);
  cache.set(key, compiled);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return compiled;
};

export const __resetStorageRulesCache = (): void => {
  cache.clear();
};

export const __storageRulesCacheSize = (): number => cache.size;

// ---------------------------------------------------------------------------
// Message interpolation
// ---------------------------------------------------------------------------

const TOKEN_RE =
  /\{(condition\[\d+\]\.(?:field|operator|value|name)|[a-zA-Z_][\w.]*)\}/g;

const CONDITION_TOKEN_RE = /^condition\[(\d+)\]\.(field|operator|value|name)$/;

const OPERATOR_LABELS: Record<Operator, string> = {
  eq: "equals",
  neq: "not equals",
  in: "is one of",
  notIn: "is none of",
  isSet: "is set",
  isNotSet: "is not set",
  gt: "greater than",
  lt: "less than"
};

export type InterpolateMessageOptions = {
  conditions?: Condition[];
  resolveConditionValue?: (
    cond: Condition,
    index: number
  ) => string | undefined;
};

const formatConditionValue = (value: unknown): string => {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((v) => String(v)).join(", ");
  }
  return String(value);
};

export const interpolateMessage = (
  template: string,
  ctx: RuleContext,
  options: InterpolateMessageOptions = {}
): string => {
  const { conditions, resolveConditionValue } = options;
  return template.replace(TOKEN_RE, (_match, raw: string) => {
    const condMatch = CONDITION_TOKEN_RE.exec(raw);
    if (condMatch) {
      const idx = Number(condMatch[1]);
      const prop = condMatch[2] as "field" | "operator" | "value" | "name";
      const cond = conditions?.[idx];
      if (!cond) return "—";
      switch (prop) {
        case "field":
          return getFieldDef(cond.field)?.label ?? cond.field;
        case "operator":
          return OPERATOR_LABELS[cond.op] ?? cond.op;
        case "value":
          // Raw stored id / input value, no label resolution. Use `.name`
          // for the human-readable label.
          if (cond.op === "isSet" || cond.op === "isNotSet") return "—";
          return formatConditionValue(cond.value);
        case "name":
          // Human-readable label for the value (e.g. id → name via the
          // field's value-options loader). Falls back to the raw value when
          // no resolver is supplied or the id has no matching label.
          if (cond.op === "isSet" || cond.op === "isNotSet") return "—";
          if (resolveConditionValue) {
            const resolved = resolveConditionValue(cond, idx);
            if (resolved !== undefined) return resolved;
          }
          return formatConditionValue(cond.value);
      }
    }

    const value = buildResolver(raw)(ctx);
    if (value == null || value === "") return "—";
    return String(value);
  });
};

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export type EvaluateRulesOptions = {
  resolveConditionValue?: (
    cond: Condition,
    index: number
  ) => string | undefined;
};

const findFirstMissingRequiredField = (
  rule: CompiledRule,
  ctx: RuleContext
): string | null => {
  const checks = rule.requiredFieldChecks;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i]!;
    const value = c.resolve(ctx);
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      return c.field;
    }
  }
  return null;
};

const buildRequiredFieldMessage = (
  _rule: CompiledRule,
  fieldPath: string
): string => {
  const label = getFieldDef(fieldPath)?.label ?? fieldPath;
  return `${label} is required`;
};

export const evaluateRules = (
  rules: CompiledRule[],
  ctx: RuleContext,
  surface: TransactionSurface,
  opts?: EvaluateRulesOptions
): Violation[] => {
  const out: Violation[] = [];
  const resolveConditionValue = opts?.resolveConditionValue;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (!rule.surfaces.includes(surface)) continue;

    const missing = findFirstMissingRequiredField(rule, ctx);
    if (missing !== null) {
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: buildRequiredFieldMessage(rule, missing)
      });
      continue;
    }

    if (rule.predicate(ctx)) continue;
    out.push({
      ruleId: rule.id,
      severity: rule.severity,
      message: interpolateMessage(rule.rawMessage, ctx, {
        conditions: rule.conditions,
        resolveConditionValue
      })
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Item-target rule filtering — which items a broadcast item rule fires on
// ---------------------------------------------------------------------------
//
// Item rules no longer use the blunt `appliesToAll` broadcast. Instead they
// carry optional type/group filters; empty filters = every item. `server.ts`
// gates each item broadcast through this before adding the rule to a line.

export type ItemRuleFilter = {
  filteredItemTypes?: string[];
  filteredItemGroupIds?: string[];
  /** false → OR across the two dimensions (any); true → AND (all). */
  filteredItemMatchAll?: boolean;
};

/**
 * Minimal item shape the filter matcher reads. The index signature keeps it
 * structurally compatible with the looser item-context records the evaluator
 * and loaders build (no cast needed at call sites).
 */
export type ItemCtx = Record<string, unknown> & {
  type?: unknown;
  itemPostingGroupId?: unknown;
};

export const itemRuleAppliesToItem = (
  item: ItemCtx,
  f: ItemRuleFilter
): boolean => {
  const types = f.filteredItemTypes ?? [];
  const groups = f.filteredItemGroupIds ?? [];
  if (types.length === 0 && groups.length === 0) return true; // empty = all
  // `null` = dimension not constrained; it drops out of the combination so a
  // single set dimension behaves identically under OR and AND.
  const typeMatch = types.length ? types.includes(item.type as string) : null;
  const groupMatch = groups.length
    ? item.itemPostingGroupId != null &&
      groups.includes(item.itemPostingGroupId as string)
    : null;
  return f.filteredItemMatchAll
    ? (typeMatch ?? true) && (groupMatch ?? true)
    : (typeMatch ?? false) || (groupMatch ?? false);
};

/** Normalize a raw `storageRule` row's nullable filter columns into a filter. */
export const toItemRuleFilter = (row: {
  filteredItemTypes?: string[] | null;
  filteredItemGroupIds?: string[] | null;
  filteredItemMatchAll?: boolean | null;
}): ItemRuleFilter => ({
  filteredItemTypes: row.filteredItemTypes ?? [],
  filteredItemGroupIds: row.filteredItemGroupIds ?? [],
  filteredItemMatchAll: row.filteredItemMatchAll ?? false
});

// ---------------------------------------------------------------------------
// Per-surface context availability — single source of truth for "which field
// may a rule reference given the surfaces it subscribes to"
// ---------------------------------------------------------------------------
//
// Declares which root `FieldContext`s the evaluator STRUCTURALLY builds in
// `RuleContext` for each surface. "Structurally" = the evaluator constructs that
// root context for the surface at all; whether a given line's value is null is a
// separate, allowed concern handled by `isSet`/`isNotSet` (see `nullable`). This
// turns the prose in `STORAGE_UNIT_NOTES` / "Not populated" into enforced data so
// the builder/validator can never offer or accept a field that won't resolve.
//
// Note `"storage"` is the `FieldContext` value; it maps to the `storageUnit`
// RuleContext root key.
//
// Locked by the anti-drift test in `packages/ee/src/storage-rules/context.test.ts`,
// which asserts the ctx `evaluateLinesForSurface` builds for each surface
// populates exactly these contexts.
export const SURFACE_CONTEXT_AVAILABILITY: Record<
  TransactionSurface,
  readonly FieldContext[]
> = {
  receipt: ["item", "storage", "transaction"],
  shipment: ["item", "storage", "transaction"],
  stockTransfer: ["item", "storage", "transaction"],
  warehouseTransfer: ["item", "storage", "transaction"],
  inventoryAdjustment: ["item", "storage", "transaction"],
  place: ["item", "storage", "transaction"],
  pick: ["item", "storage", "transaction"],
  operationStart: ["workCenter", "operation", "transaction"],
  operationFinish: ["workCenter", "operation", "transaction"],
  materialIssue: ["workCenter", "operation", "transaction"],
  materialReceive: ["workCenter", "operation", "transaction"]
};

/**
 * A field resolves for a rule iff its context is structurally available on
 * EVERY surface the rule subscribes to. Empty surfaces → defer to targetType
 * only (caller hasn't picked surfaces yet).
 */
export const isFieldAvailableOnSurfaces = (
  def: FieldDef,
  surfaces: readonly TransactionSurface[]
): boolean =>
  surfaces.length === 0 ||
  surfaces.every((s) => SURFACE_CONTEXT_AVAILABILITY[s]?.includes(def.context));

/**
 * Registry subset a rule of the given `targetType` may reference when it
 * subscribes to `surfaces`. Narrows `getFieldsForTargetType` by per-surface
 * context availability. Builder field picker filters through this.
 */
export const getFieldsForTargetTypeAndSurfaces = (
  targetType: TargetType,
  surfaces: readonly TransactionSurface[]
): FieldDef[] =>
  getFieldsForTargetType(targetType).filter((f) =>
    isFieldAvailableOnSurfaces(f, surfaces)
  );

// ---------------------------------------------------------------------------
// Per-surface field semantics
// ---------------------------------------------------------------------------
//
// Some fields carry different meaning depending on which surface fires the
// rule. `transaction.quantity` is the prime example — it's the line qty on a
// receipt, the planned op qty on `operationStart`, the scan delta on
// `operationFinish`, etc. Surface this so rule authors don't write predicates
// that work on one surface and silently misfire on another.

const TRANSACTION_QUANTITY_NOTES: Record<TransactionSurface, string> = {
  receipt: "Quantity received on this receipt line.",
  shipment: "Quantity shipped on this shipment line.",
  stockTransfer: "Quantity moved on this stock-transfer line.",
  warehouseTransfer: "Quantity moved on this warehouse-transfer line.",
  inventoryAdjustment: "Signed delta applied by this adjustment.",
  place: "Quantity placed into the storage unit (= receipt line qty).",
  pick: "Quantity taken from the storage unit (= shipment line qty).",
  operationStart:
    "Planned operation quantity (full target, not a delta this scan).",
  operationFinish: "Quantity completed by this scan (a delta, not cumulative).",
  materialIssue: "Material quantity consumed by this issue.",
  materialReceive: "Material quantity returned to stock."
};

// StorageUnit fields shift meaning between source bin (pick / shipment) and
// destination bin (place / receipt / transfer). On operation surfaces they
// aren't populated at all.
const STORAGE_UNIT_NOTES: Record<TransactionSurface, string> = {
  receipt: "Destination bin (where receiving line lands).",
  shipment: "Source bin (where shipped line was picked from).",
  stockTransfer: "Destination bin (TO storage unit).",
  warehouseTransfer: "Destination bin (TO storage unit).",
  inventoryAdjustment: "Bin the adjustment applies to (may be unset).",
  place: "Destination bin (mirrors receipt).",
  pick: "Source bin (mirrors shipment).",
  operationStart: "Not populated.",
  operationFinish: "Not populated.",
  materialIssue: "Not populated.",
  materialReceive: "Not populated."
};

const SURFACE_FIELD_NOTES: Record<
  string,
  Partial<Record<TransactionSurface, string>>
> = {
  "transaction.quantity": TRANSACTION_QUANTITY_NOTES,
  "storageUnit.id": STORAGE_UNIT_NOTES,
  "storageUnit.locationId": STORAGE_UNIT_NOTES,
  "storageUnit.storageTypeId": STORAGE_UNIT_NOTES
};

/**
 * Per-surface note for a given field path. Returns `undefined` when the field
 * carries the same meaning across every surface it applies to (no clarification
 * needed). Returns a partial map keyed by surface otherwise.
 *
 * Builder UI renders these under the field selector when the user picks a
 * field whose semantics shift between surfaces.
 */
export const getFieldSurfaceNotes = (
  path: string
): Partial<Record<TransactionSurface, string>> | undefined =>
  SURFACE_FIELD_NOTES[path];
