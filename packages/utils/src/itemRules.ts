// Item Rules evaluator. AST → JIT-compiled closure with LRU cache.
// Used server-side on transactions (receipt, shipment, stock transfer,
// inventory adjustment) to enforce per-item validation/guideline rules.

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
  "inventoryAdjustment"
] as const;
export type TransactionSurface = (typeof TRANSACTION_SURFACES)[number];

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
  transaction?: Record<string, unknown>;
};

export type ItemRuleRow = {
  id: string;
  severity: Severity;
  message: string;
  conditionAst: ConditionAst;
  /**
   * Surfaces this rule applies to. Empty arrays are not allowed at the DB
   * level (CHECK constraint); treat missing/empty client-side as "all
   * surfaces" for forward-compat with rules created before the migration.
   */
  surfaces?: TransactionSurface[];
  updatedAt?: string | null;
  active?: boolean;
};

export type CompiledRule = {
  id: string;
  severity: Severity;
  rawMessage: string;
  surfaces: TransactionSurface[];
  /**
   * Raw condition list — kept on the compiled rule so message templates can
   * reference `{condition[N].field|operator|value}` at eval time without
   * round-tripping back to the AST row.
   */
  conditions: Condition[];
  /**
   * Pre-bound resolvers for every condition whose op is NOT a presence-aware
   * operator (`isSet`/`isNotSet`). Evaluator runs these BEFORE the predicate;
   * any null / undefined / empty-string field hit short-circuits the rule
   * to a "field is required" violation. Lets authors declare contracts at
   * the condition level — referencing a field implies it must be set.
   */
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

const ROOT_KEYS = new Set(["item", "shelf", "storageUnit", "transaction"]);

const buildResolver = (path: string): Resolver => {
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

// Array-left helpers: treat the field's resolved array as "any of these
// elements". Lets storage-unit fields with multiple types (e.g.
// `storageUnit.storageTypeId` flattened from `storageTypeIds[]`) participate
// in `eq` / `in` semantics naturally.
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
  // Bind everything at compile time. Closure shape is monomorphic per Operator
  // (single property access pattern, single equality check), keeping V8 happy.
  return (ctx) => op(resolve(ctx), value);
};

const compilePredicate = (
  ast: ConditionAst
): ((ctx: RuleContext) => boolean) => {
  if (!ast || !Array.isArray(ast.conditions)) return () => false;
  const kind = ast.kind;
  if (kind !== "all" && kind !== "any" && kind !== "none") return () => false;
  // Vacuous-truth handling: empty `all` = true, empty `any`/`none` = false/true.
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
  // none — no condition may be true
  return (ctx) => {
    for (let i = 0; i < fns.length; i++) {
      if (fns[i]!(ctx)) return false;
    }
    return true;
  };
};

export const compileRule = (row: ItemRuleRow): CompiledRule => ({
  id: row.id,
  severity: row.severity,
  rawMessage: row.message,
  // Empty / missing → treat as "all surfaces" (backward-compat for rules
  // created before the surfaces column existed).
  surfaces:
    row.surfaces && row.surfaces.length > 0
      ? row.surfaces
      : [...TRANSACTION_SURFACES],
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

// FNV-1a 32-bit. Cheap, deterministic, no deps. Used to cache-bust on
// content changes even if `updatedAt` is missing/stale (e.g. callers that
// forget to refresh the column on edit).
const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
};

const cacheKey = (row: ItemRuleRow): string => {
  // Hash the bits that drive compilation output. If any change, the cached
  // CompiledRule (with its baked-in rawMessage + predicate) is stale.
  const contentHash = fnv1a(
    `${row.message}|${JSON.stringify(row.conditionAst)}|${(row.surfaces ?? []).join(",")}`
  );
  return `${row.id}:${row.updatedAt ?? ""}:${contentHash}`;
};

export const compileWithCache = (row: ItemRuleRow): CompiledRule => {
  const key = cacheKey(row);
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency: delete + re-insert so the most-recently-used floats to the end.
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

export const __resetItemRulesCache = (): void => {
  cache.clear();
};

export const __itemRulesCacheSize = (): number => cache.size;

// ---------------------------------------------------------------------------
// Message interpolation
// ---------------------------------------------------------------------------

/**
 * Token grammar:
 *   {ctx.dotted.path}                  — resolved against `RuleContext`
 *   {condition[N].field|operator|value} — resolved against the rule's AST
 *
 * Missing/null tokens render as an em-dash so the message stays readable
 * when the rule fires precisely because the field is empty.
 */
const TOKEN_RE =
  /\{(condition\[\d+\]\.(?:field|operator|value)|[a-zA-Z_][\w.]*)\}/g;

const CONDITION_TOKEN_RE = /^condition\[(\d+)\]\.(field|operator|value)$/;

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
  /** AST conditions for `{condition[N].…}` tokens. Pass `rule.conditions`. */
  conditions?: Condition[];
  /**
   * Optional resolver that turns a condition's stored `value` into a
   * human-friendly string (e.g. UUID → display label for `id`-typed
   * loaders). Returning `undefined` falls back to a default formatter that
   * stringifies scalars and joins arrays with `", "`.
   */
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
      const prop = condMatch[2] as "field" | "operator" | "value";
      const cond = conditions?.[idx];
      if (!cond) return "—";
      switch (prop) {
        case "field":
          // Read the registry at call time — declarations are hoisted by
          // the module's eval order, so `getFieldDef` exists by the time
          // any rule actually fires.
          return getFieldDef(cond.field)?.label ?? cond.field;
        case "operator":
          return OPERATOR_LABELS[cond.op] ?? cond.op;
        case "value":
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
  /**
   * Resolver for `{condition[N].value}` tokens — typically an async-prefilled
   * lookup map of `id` → label for loader-backed condition values.
   */
  resolveConditionValue?: (
    cond: Condition,
    index: number
  ) => string | undefined;
};

/**
 * Walk a rule's required-field checks. Returns a label of the FIRST field
 * that resolved to null / undefined / empty string, or `null` if every
 * required field is populated. Indexed loop, monomorphic resolver call
 * site — predicate-style hot path that V8 keeps in IC.
 */
const findFirstMissingRequiredField = (
  rule: CompiledRule,
  ctx: RuleContext
): string | null => {
  const checks = rule.requiredFieldChecks;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i]!;
    const value = c.resolve(ctx);
    // Empty array counts as missing — synthetic fields like
    // `storageUnit.storageTypeId` resolve to `string[]` from `storageTypeIds[]`.
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
  rule: CompiledRule,
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
    // Surface gate — skip rules that don't opt into this surface before
    // touching the predicate. Cheap: 1–4 element array, O(1) in practice.
    if (!rule.surfaces.includes(surface)) continue;

    // Required-field pre-check — referencing a field in a condition implies
    // that field is part of the rule's contract. Null → hard violation,
    // skip predicate.
    const missing = findFirstMissingRequiredField(rule, ctx);
    if (missing !== null) {
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: buildRequiredFieldMessage(rule, missing)
      });
      continue;
    }

    if (rule.predicate(ctx)) continue; // condition satisfied — no violation
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
// Field resolver registry — single source of truth for builder UI + evaluator
// ---------------------------------------------------------------------------

// Pull DB row shapes from the generated Supabase types so the registry stays
// in sync with the schema. Type-only import — no runtime dependency.
import type { Database } from "@carbon/database";

type Tables = Database["public"]["Tables"];

/**
 * Compile-time check: returns `true` if the column type accepts `null`,
 * else `false`. Used to verify each `dbField` declares the correct nullability.
 */
type IsNullable<T> = null extends T ? true : false;

type ExpectedNullable<
  T extends keyof Tables,
  C extends keyof Tables[T]["Row"]
> = IsNullable<Tables[T]["Row"][C]>;

export type FieldType = "string" | "number" | "enum" | "id";

export type ValueOptionsLoader =
  | "locations"
  | "storageTypes"
  | "itemTypes"
  | "replenishmentSystems"
  | "itemTrackingTypes"
  | "itemPostingGroups";

export type FieldDef = {
  path: string;
  label: string;
  type: FieldType;
  operators: Operator[];
  context: "item" | "storage" | "transaction";
  valueOptionsLoader?: ValueOptionsLoader;
  /**
   * `true` (default) — column is nullable; `isSet`/`isNotSet` are valid.
   * `false`           — column is NOT NULL at the DB level; presence ops are
   *                     stripped from the available operator list.
   */
  nullable?: boolean;
};

const PRESENCE_OPS = new Set<Operator>(["isSet", "isNotSet"]);

const SCALAR_OPS: Operator[] = ["eq", "neq", "isSet", "isNotSet"];
const ENUM_OPS: Operator[] = ["eq", "neq", "in", "notIn", "isSet", "isNotSet"];
const ID_OPS: Operator[] = ["eq", "neq", "in", "notIn", "isSet", "isNotSet"];
const NUMBER_OPS: Operator[] = ["eq", "neq", "gt", "lt", "isSet", "isNotSet"];

/**
 * Returns the operator subset valid for a field given its DB nullability.
 * Strips `isSet`/`isNotSet` when the field is non-nullable — those ops are
 * meaningless on a NOT NULL column and would always evaluate to a constant.
 */
export const availableOperators = (def: FieldDef): Operator[] =>
  def.nullable === false
    ? def.operators.filter((op) => !PRESENCE_OPS.has(op))
    : def.operators;

export const isOperatorAllowed = (def: FieldDef, op: Operator): boolean =>
  availableOperators(def).includes(op);

/**
 * Field declaration helpers. Two flavors:
 *
 * - `fields.database({ table, column, nullable, ... })` — maps 1:1 to a real
 *   DB column. Nullability is **enforced at compile time** against
 *   `Database["public"]["Tables"][T]["Row"][C]`. Schema drift = TS error.
 *   Path is derived as `${ctxKey ?? table}.${column}`.
 *
 * - `fields.synthetic({ path, derivedFrom, nullable, ... })` — no direct DB
 *   column (e.g. `transaction.*` is built per-trigger; `item.itemPostingGroupId`
 *   is denormalised from a join). Nullability is asserted by hand; document
 *   the runtime source in `derivedFrom`.
 */
const fields = {
  database: <
    T extends keyof Tables,
    C extends Extract<keyof Tables[T]["Row"], string>,
    N extends ExpectedNullable<T, C>
  >(args: {
    table: T;
    column: C;
    nullable: N; // ← must equal ExpectedNullable<T, C> or TS errors
    label: string;
    type: FieldType;
    operators: Operator[];
    context: FieldDef["context"];
    ctxKey?: string;
    valueOptionsLoader?: ValueOptionsLoader;
  }): FieldDef => ({
    path: `${args.ctxKey ?? args.table}.${args.column}`,
    label: args.label,
    type: args.type,
    operators: args.operators,
    context: args.context,
    valueOptionsLoader: args.valueOptionsLoader,
    nullable: args.nullable
  }),

  synthetic: (args: {
    path: string;
    derivedFrom: string;
    nullable: boolean;
    label: string;
    type: FieldType;
    operators: Operator[];
    context: FieldDef["context"];
    valueOptionsLoader?: ValueOptionsLoader;
  }): FieldDef => ({
    path: args.path,
    label: args.label,
    type: args.type,
    operators: args.operators,
    context: args.context,
    valueOptionsLoader: args.valueOptionsLoader,
    nullable: args.nullable
  })
};

export const FIELD_REGISTRY: FieldDef[] = [
  // ── Item ──────────────────────────────────────────────────────────────────
  fields.database({
    table: "item",
    column: "type",
    nullable: false,
    label: "Item type",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    valueOptionsLoader: "itemTypes"
  }),
  fields.database({
    table: "item",
    column: "replenishmentSystem",
    nullable: false,
    label: "Replenishment system",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    valueOptionsLoader: "replenishmentSystems"
  }),
  fields.database({
    table: "item",
    column: "itemTrackingType",
    nullable: false,
    label: "Item tracking type",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    valueOptionsLoader: "itemTrackingTypes"
  }),
  fields.synthetic({
    path: "item.itemPostingGroupId",
    derivedFrom: "itemCost.itemPostingGroupId (denormalised into ctx.item)",
    nullable: true,
    label: "Item posting group",
    type: "id",
    operators: ID_OPS,
    context: "item",
    valueOptionsLoader: "itemPostingGroups"
  }),

  // ── Storage ───────────────────────────────────────────────────────────────
  fields.synthetic({
    path: "shelf.locationId",
    derivedFrom: "storageUnit.locationId via shelfId join (no `shelf` table)",
    nullable: false,
    label: "Shelf location",
    type: "id",
    operators: ID_OPS,
    context: "storage",
    valueOptionsLoader: "locations"
  }),
  fields.synthetic({
    path: "storageUnit.storageTypeId",
    derivedFrom: "first element of storageUnit.storageTypeIds[]",
    nullable: true,
    label: "Storage type",
    type: "id",
    operators: ID_OPS,
    context: "storage",
    valueOptionsLoader: "storageTypes"
  }),
  // ── Transaction ───────────────────────────────────────────────────────────
  // `transaction` is a synthetic ctx assembled per-trigger (receipt/shipment/
  // stock-transfer/job op). No corresponding table — all paths synthetic.
  fields.synthetic({
    path: "transaction.locationId",
    derivedFrom: "trigger handler — varies by surface",
    nullable: true,
    label: "Transaction location",
    type: "id",
    operators: ID_OPS,
    context: "transaction",
    valueOptionsLoader: "locations"
  }),
  fields.synthetic({
    path: "transaction.quantity",
    derivedFrom: "line.quantity from receipt/shipment/transfer consumption",
    nullable: false,
    label: "Transaction quantity",
    type: "number",
    operators: NUMBER_OPS,
    context: "transaction"
  })
];

export const getFieldDef = (path: string): FieldDef | undefined => {
  // Custom fields are dynamic — accept any item.customFields.* path.
  if (path.startsWith("item.customFields.")) {
    return {
      path,
      label: path.slice("item.customFields.".length),
      type: "string",
      operators: SCALAR_OPS,
      context: "item"
    };
  }
  return FIELD_REGISTRY.find((f) => f.path === path);
};
