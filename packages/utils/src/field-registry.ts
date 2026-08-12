// Field resolver registry — single source of truth for the rule-builder UI and
// the evaluator's field paths. Split out of `rules.ts` to keep that file
// focused on evaluation/compilation. Depends on `rules` only for the core
// `Operator` / `TargetType` types (type-only — no runtime cycle).

import type { Database } from "@carbon/database";
import type { Operator, TargetType } from "./rules";

type Tables = Database["public"]["Tables"];

type IsNullable<T> = null extends T ? true : false;

type ExpectedNullable<
  T extends keyof Tables,
  C extends keyof Tables[T]["Row"]
> = IsNullable<Tables[T]["Row"][C]>;

export type FieldType =
  | "string"
  | "number"
  | "enum"
  | "id"
  /**
   * Special-cased id picker: the rule builder renders a hierarchical
   * (location → drill-down) storage-unit selector instead of a flat combobox.
   * Values stored as the chosen storage unit's UUID.
   */
  | "storageUnit";

export type ValueOptionsLoader =
  | "locations"
  | "storageTypes"
  | "storageUnits"
  | "itemTypes"
  | "replenishmentSystems"
  | "itemTrackingTypes"
  | "itemPostingGroups"
  | "customerTypes"
  | "customerStatuses"
  | "countries";

export type FieldContext =
  | "item"
  | "storage"
  | "workCenter"
  | "operation"
  | "transaction"
  | "customer";

export type FieldDef = {
  path: string;
  label: string;
  type: FieldType;
  operators: Operator[];
  context: FieldContext;
  /**
   * Which rule `targetType`(s) may reference this field.
   * - `"shared"`            → visible to every targetType (e.g. `transaction.*`)
   * - `TargetType`          → visible only to that one targetType
   * - `readonly TargetType[]` → visible to each targetType in the list
   */
  targetType: TargetType | "shared" | readonly TargetType[];
  valueOptionsLoader?: ValueOptionsLoader;
  /**
   * `true` (default) — column is nullable; `isSet`/`isNotSet` are valid.
   * `false`           — column is NOT NULL at the DB level; presence ops are
   *                     stripped from the available operator list.
   */
  nullable?: boolean;
  /**
   * Human-readable note on where this field's value originates. Surfaced in
   * the rule-builder UI under the field selector so authors understand what
   * they're testing against. Synthetic fields receive their `derivedFrom`
   * string here automatically.
   */
  description?: string;
};

const PRESENCE_OPS = new Set<Operator>(["isSet", "isNotSet"]);

const SCALAR_OPS: Operator[] = ["eq", "neq", "isSet", "isNotSet"];
const ENUM_OPS: Operator[] = ["eq", "neq", "in", "notIn", "isSet", "isNotSet"];
const ID_OPS: Operator[] = ["eq", "neq", "in", "notIn", "isSet", "isNotSet"];
const NUMBER_OPS: Operator[] = ["eq", "neq", "gt", "lt", "isSet", "isNotSet"];
const BOOL_OPS: Operator[] = ["eq", "neq"];

export const availableOperators = (def: FieldDef): Operator[] =>
  def.nullable === false
    ? def.operators.filter((op) => !PRESENCE_OPS.has(op))
    : def.operators;

export const isOperatorAllowed = (def: FieldDef, op: Operator): boolean =>
  availableOperators(def).includes(op);

const fields = {
  database: <
    T extends keyof Tables,
    C extends Extract<keyof Tables[T]["Row"], string>,
    N extends ExpectedNullable<T, C>
  >(args: {
    table: T;
    column: C;
    nullable: N;
    label: string;
    type: FieldType;
    operators: Operator[];
    context: FieldContext;
    targetType: FieldDef["targetType"];
    ctxKey?: string;
    valueOptionsLoader?: ValueOptionsLoader;
    description?: string;
  }): FieldDef => ({
    path: `${args.ctxKey ?? args.table}.${args.column}`,
    label: args.label,
    type: args.type,
    operators: args.operators,
    context: args.context,
    targetType: args.targetType,
    valueOptionsLoader: args.valueOptionsLoader,
    nullable: args.nullable,
    description: args.description
  }),

  synthetic: (args: {
    path: string;
    derivedFrom: string;
    nullable: boolean;
    label: string;
    type: FieldType;
    operators: Operator[];
    context: FieldContext;
    targetType: FieldDef["targetType"];
    valueOptionsLoader?: ValueOptionsLoader;
  }): FieldDef => ({
    path: args.path,
    label: args.label,
    type: args.type,
    operators: args.operators,
    context: args.context,
    targetType: args.targetType,
    valueOptionsLoader: args.valueOptionsLoader,
    nullable: args.nullable,
    description: args.derivedFrom
  })
};

// FIELD_REGISTRY holds ONLY fields the evaluator guarantees in ctx for every
// surface within a given targetType. Fields that may be null or are only
// populated for a subset of surfaces are intentionally excluded — rule
// authors should never write a predicate that silently no-ops on some surface.
//
// The `storageUnit.*` fields belong to item-target rules (they own the
// `place`/`pick` bin guards). The storageUnit ctx may be undefined when
// `line.storageUnitId` is null (inventoryAdjustment without a bin,
// warehouseTransfer with no destination yet); we mark such fields
// `nullable: true` so `availableOperators` exposes `isSet`/`isNotSet` and
// authors can guard explicitly.
//
// Dropped vs. earlier drafts (kept here as audit trail):
//   - shelf.locationId         → `shelf` is not a RuleContext root key
//   - transaction.locationId   → sometimes null per surface
//   - operation.itemId         → null at operationStart (no item bound yet)
//   - operation.workInstructionId → may be null on operations
//
// Re-added: `item.itemPostingGroupId` — the evaluator now embeds the 1:1
// `itemCost` row and flattens its `itemPostingGroupId` onto the item ctx, so
// the value is guaranteed for every item-target surface (all carry an itemId).
export const FIELD_REGISTRY: FieldDef[] = [
  // ── Item context (item target) ────────────────────────────────────────────
  // Every item-target surface carries a `line.itemId`, so the evaluator loads
  // item ctx and these fields resolve. Item DB columns are NOT NULL so no
  // nullable change.
  fields.database({
    table: "item",
    column: "type",
    nullable: false,
    label: "Item type",
    type: "enum",
    operators: ENUM_OPS,
    context: "item",
    targetType: "item",
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
    targetType: "item",
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
    targetType: "item",
    valueOptionsLoader: "itemTrackingTypes"
  }),
  // Posting group lives on the 1:1 `itemCost` row, not `item`. The evaluator
  // embeds it (see server.ts item SELECT) and flattens it onto the item ctx.
  // Nullable because an item may have no posting group assigned.
  fields.synthetic({
    path: "item.itemPostingGroupId",
    derivedFrom: "The item's posting group (from its itemCost row).",
    nullable: true,
    label: "Item group",
    type: "id",
    operators: ID_OPS,
    context: "item",
    targetType: "item",
    valueOptionsLoader: "itemPostingGroups"
  }),

  // ── StorageUnit context (item target) ─────────────────────────────────────
  // Loaded by the evaluator when `line.storageUnitId` is set. `nullable: true`
  // on every entry so item rules can guard with `isSet`/`isNotSet`.
  fields.synthetic({
    path: "storageUnit.id",
    derivedFrom: "The bin chosen on this transaction line.",
    nullable: true,
    label: "Storage unit",
    // `"storageUnit"` triggers the hierarchical drill-down picker in the
    // rule-builder UI (Location → drilldown) — no flat options list. The
    // loader is used only by the evaluator's `{condition[n].name}` resolver
    // to map the stored bin UUID back to its display name in messages.
    type: "storageUnit",
    // Drill picker selects a single bin — `in`/`notIn` would require a
    // multi-select UI that doesn't exist. Restrict to scalar ops.
    operators: SCALAR_OPS,
    context: "storage",
    targetType: "item",
    valueOptionsLoader: "storageUnits"
  }),
  fields.synthetic({
    path: "storageUnit.storageTypeId",
    derivedFrom: "The bin's primary storage type (e.g. cold, hazmat, dry).",
    nullable: true,
    label: "Storage type",
    type: "id",
    operators: ID_OPS,
    context: "storage",
    targetType: "item",
    valueOptionsLoader: "storageTypes"
  }),
  // Useful for `appliesToAll` rules that want to scope by physical location —
  // e.g. "block pick from any unit in the quarantine warehouse". Declared as
  // synthetic (not database) so `nullable: true` overrides the DB NOT NULL —
  // ctx itself can be undefined for item-target rules when `line.storageUnitId`
  // is null.
  fields.synthetic({
    path: "storageUnit.locationId",
    derivedFrom:
      "Physical location (warehouse or site) holding the chosen bin.",
    nullable: true,
    label: "Storage unit location",
    type: "id",
    operators: ID_OPS,
    context: "storage",
    targetType: "item",
    valueOptionsLoader: "locations"
  }),

  // ── WorkCenter target ─────────────────────────────────────────────────────
  // workCenter is the target — always loaded by the evaluator.
  fields.database({
    table: "workCenter",
    column: "locationId",
    nullable: true,
    label: "Work center location",
    type: "id",
    operators: ID_OPS,
    context: "workCenter",
    targetType: "workCenter",
    valueOptionsLoader: "locations"
  }),
  fields.database({
    table: "workCenter",
    column: "active",
    nullable: false,
    label: "Work center active",
    type: "enum",
    operators: BOOL_OPS,
    context: "workCenter",
    targetType: "workCenter"
  }),

  // ── Transaction (shared across all targets) ───────────────────────────────
  // transaction.quantity is set by every trigger handler. No other transaction
  // field is guaranteed across all surfaces.
  fields.synthetic({
    path: "transaction.quantity",
    derivedFrom:
      "Quantity moved or applied by this transaction. Meaning shifts per surface — see per-surface notes below.",
    nullable: false,
    label: "Transaction quantity",
    type: "number",
    operators: NUMBER_OPS,
    context: "transaction",
    targetType: "shared"
  })
];

// ITEM_RULE_FIELD_REGISTRY holds fields ONLY item rules (sales-document
// surfaces) may reference. Kept SEPARATE from FIELD_REGISTRY so the storage
// rule builder/validator never sees customer fields — the storage evaluator
// never builds a `customer` ctx.
export const ITEM_RULE_FIELD_REGISTRY: FieldDef[] = [
  fields.database({
    table: "customer",
    column: "customerTypeId",
    nullable: true,
    label: "Customer type",
    type: "id",
    operators: ID_OPS,
    context: "customer",
    targetType: "item",
    ctxKey: "customer",
    valueOptionsLoader: "customerTypes"
  }),
  fields.database({
    table: "customer",
    column: "customerStatusId",
    nullable: true,
    label: "Customer status",
    type: "id",
    operators: ID_OPS,
    context: "customer",
    targetType: "item",
    ctxKey: "customer",
    valueOptionsLoader: "customerStatuses"
  }),
  fields.synthetic({
    path: "customer.location.countryCode",
    derivedFrom:
      "Ship-to country (alpha-2) resolved from the document's customer location address.",
    nullable: true,
    label: "Customer country",
    type: "id",
    operators: ID_OPS,
    context: "customer",
    valueOptionsLoader: "countries",
    targetType: "item"
  })
];

/**
 * Subset of the registry visible to a rule of a given `targetType`. Includes
 * all fields explicitly declared for that target plus the `shared` set, plus
 * any field whose `targetType` is an array containing the requested target.
 * Builder UI filters its field dropdown through this helper.
 */
export const getFieldsForTargetType = (targetType: TargetType): FieldDef[] =>
  FIELD_REGISTRY.filter((f) => {
    if (f.targetType === "shared") return true;
    if (Array.isArray(f.targetType)) return f.targetType.includes(targetType);
    return f.targetType === targetType;
  });

/**
 * Full field set an ITEM RULE may reference: the item + shared slice of the
 * storage registry (no storage/workCenter/operation contexts — the item-rule
 * evaluator never builds those) plus the customer-context fields above.
 * Narrow further by surfaces via `getFieldsForItemRuleSurfaces`.
 */
export const getFieldsForItemRules = (): FieldDef[] => [
  ...FIELD_REGISTRY.filter(
    (f) => f.context === "item" || f.targetType === "shared"
  ),
  ...ITEM_RULE_FIELD_REGISTRY
];

export const getFieldDef = (path: string): FieldDef | undefined => {
  // Custom fields are dynamic — accept any item.customFields.* path.
  if (path.startsWith("item.customFields.")) {
    return {
      path,
      label: path.slice("item.customFields.".length),
      type: "string",
      operators: SCALAR_OPS,
      context: "item",
      targetType: "item",
      description: "Custom field on the item record."
    };
  }
  // Same synthesis for customer custom fields (item-rule surfaces only).
  if (path.startsWith("customer.customFields.")) {
    return {
      path,
      label: path.slice("customer.customFields.".length),
      type: "string",
      operators: SCALAR_OPS,
      context: "customer",
      targetType: "item",
      description: "Custom field on the customer record."
    };
  }
  return (
    FIELD_REGISTRY.find((f) => f.path === path) ??
    ITEM_RULE_FIELD_REGISTRY.find((f) => f.path === path)
  );
};
