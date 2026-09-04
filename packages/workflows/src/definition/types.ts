import type { Operator } from "@carbon/utils";
import { z } from "zod";

export const primitiveKindSchema = z.enum([
  "boolean",
  "string",
  "number",
  "date",
  "null"
]);
export type PrimitiveKind = z.infer<typeof primitiveKindSchema>;

/**
 * A bag of named fields — Carbon's object type.
 *
 * Deliberately NOT an `entity`: an entity has a table, an id, a permission module
 * and a loader that fetches its row. A record has none of those. It is data a step
 * already holds (a vendor's JSON), so its fields travel with the value and reading
 * one never touches the database.
 *
 * Structural rather than named: the type carries its own fields, so nothing is
 * registered anywhere and a saved workflow can never reference a shape that
 * vanished. Records are legal only as node OUTPUTS and inside the data node — never
 * as a catalog input, a stored literal, a template part or a condition operand.
 */
export interface RecordType {
  kind: "record";
  fields: Record<string, ValueType>;
}

/** A single-item type: a primitive, an entity reference, or an object. */
export type ScalarType =
  | { kind: "primitive"; of: PrimitiveKind }
  | { kind: "entity"; of: string }
  | RecordType;

/** A list's `of` accepts only scalars, so `list<list<T>>` is unrepresentable. */
export type ValueType = ScalarType | { kind: "list"; of: ScalarType };

// The schemas are annotated and built with `z.lazy` because `RecordType` is
// recursive, and a lazy member cannot sit inside `z.discriminatedUnion` — hence
// `z.union` here. The explicit `z.ZodType<…>` annotations keep TypeScript from
// inferring through the recursion, which is what would otherwise risk TS2589 in
// `apps/erp` (see packages/workflows/AGENTS.md).
export const recordTypeSchema: z.ZodType<RecordType> = z.lazy(() =>
  z.object({
    kind: z.literal("record"),
    fields: z.record(z.string(), valueTypeSchema)
  })
);

export const scalarTypeSchema: z.ZodType<ScalarType> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("primitive"), of: primitiveKindSchema }),
    z.object({ kind: z.literal("entity"), of: z.string() }),
    recordTypeSchema
  ])
);

export const valueTypeSchema: z.ZodType<ValueType> = z.lazy(() =>
  z.union([
    scalarTypeSchema,
    z.object({ kind: z.literal("list"), of: scalarTypeSchema })
  ])
);

/** The canonical `ValueType` constructors; prefer these over inline literals. */
export const t = {
  string: { kind: "primitive", of: "string" },
  number: { kind: "primitive", of: "number" },
  boolean: { kind: "primitive", of: "boolean" },
  date: { kind: "primitive", of: "date" },
  entity: (of: string): ValueType => ({ kind: "entity", of }),
  list: (of: ScalarType): ValueType => ({ kind: "list", of }),
  record: (fields: Record<string, ValueType>): ValueType => ({
    kind: "record",
    fields
  })
} as const satisfies Record<
  string,
  ValueType | ((...args: never[]) => ValueType)
>;

/**
 * Compile-time exhaustiveness for a dispatch over a value's `kind`.
 *
 * The kind chains in this package are `if`/`else` rather than `switch`, so a new
 * `ValueType` or `RuntimeValue` member falls through them silently — passing both
 * typecheck and tests while doing nothing. Ending a dispatch here turns that into
 * a type error at the site that forgot the member.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled kind: ${JSON.stringify(value)}`);
}

export function typesEqual(a: ValueType, b: ValueType): boolean {
  // Recursive rather than comparing `of.of`: a record has no `of`, so the old
  // shorthand read `undefined === undefined` and called two different record
  // lists equal.
  if (a.kind === "list" && b.kind === "list") return typesEqual(a.of, b.of);
  if (a.kind === "primitive" && b.kind === "primitive") return a.of === b.of;
  if (a.kind === "entity" && b.kind === "entity") return a.of === b.of;
  if (a.kind === "record" && b.kind === "record") {
    const names = Object.keys(a.fields);
    if (names.length !== Object.keys(b.fields).length) return false;
    return names.every((name) => {
      const left = a.fields[name];
      const right = b.fields[name];
      return (
        left !== undefined && right !== undefined && typesEqual(left, right)
      );
    });
  }
  return false;
}

/**
 * Whether a value of type `from` may be supplied where `to` is expected.
 *
 * Batching is the one relaxation: a batched action runs once per item, so a list
 * may fill an input that takes a single value of the list's element type.
 */
export function canAssign(
  from: ValueType,
  to: ValueType,
  { batching = false }: { batching?: boolean } = {}
): boolean {
  if (typesEqual(from, to)) return true;
  if (!batching) return false;
  return to.kind !== "list" && from.kind === "list" && typesEqual(from.of, to);
}

/**
 * The type the right-hand side of a clause must have. `contains` on a list tests
 * membership, so it wants one element, not another list.
 */
export function expectedClauseRightType(
  left: ValueType,
  operator: Operator
): ValueType {
  return left.kind === "list" && operator === "contains" ? left.of : left;
}

/**
 * Whether a value of this type has a reading inside a sentence. A record does: it prints as
 * the name its entity declares in `display` (`SO000123`), which is exactly what someone
 * means by "…for SO000123" — and in a notification body it becomes the link to that record.
 * A LIST of records does not: a run of ids in a sentence has no good reading, and the
 * property the author meant is one hop further in. This is what lets `renderPart` assume an
 * entity part is never a list.
 */
export function rendersAsText(type: ValueType): boolean {
  // An object has no reading in a sentence — the field the author meant is one hop
  // further in — so it is kept out of every template the same way a list of records is.
  if (type.kind === "record") return false;
  if (type.kind !== "list") return true;
  return type.of.kind !== "entity" && type.of.kind !== "record";
}

/** Customer-facing rendering of a type, for issue messages. */
export function describeType(type: ValueType): string {
  if (type.kind === "record") return "an object";
  if (type.kind === "list") {
    return type.of.kind === "record"
      ? "a list of objects"
      : `a list of ${type.of.of}`;
  }
  if (type.of === "null") return "nothing";
  return `a ${type.of}`;
}

/** Which operators each type may be tested with. Names come from `@carbon/utils`. */
export const OPERATORS_BY_TYPE = {
  boolean: ["eq", "neq"],
  string: ["eq", "neq", "contains", "startsWith", "endsWith"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte"],
  null: ["eq", "neq"],
  entity: ["eq", "neq"],
  list: ["contains"]
} as const satisfies Record<string, readonly Operator[]>;

/** Every operator a workflow clause may use, flattened for the schema. */
export const WORKFLOW_OPERATORS = [
  ...new Set(Object.values(OPERATORS_BY_TYPE).flat())
] as [Operator, ...Operator[]];

export const operatorSchema = z.enum(WORKFLOW_OPERATORS);

export function operatorsForType(type: ValueType): readonly Operator[] {
  if (type.kind === "primitive") return OPERATORS_BY_TYPE[type.of];
  // Objects are not comparable: `equals` has no reading for one, so `contains` on a
  // list of them would silently never match. Reach into a field and compare that.
  if (type.kind === "record") return [];
  if (type.kind === "list") {
    return type.of.kind === "record" ? [] : OPERATORS_BY_TYPE.list;
  }
  return OPERATORS_BY_TYPE.entity;
}

/** A structured reference to an upstream node's output, plus a property path. */
export const variableRefSchema = z.object({
  kind: z.literal("ref"),
  nodeId: z.string(),
  output: z.string(),
  path: z.array(z.string()).default([])
});
export type VariableRef = z.infer<typeof variableRefSchema>;

/** The item a looping node is currently on: a filter's list, or a batched action's. */
export const itemRefSchema = z.object({
  kind: z.literal("item"),
  path: z.array(z.string()).default([]),
  /** The operation card this ref lives in (data-node chains). Absent = the
   * first card, which for every pre-chain ref is the only card. */
  card: z.string().optional()
});
export type ItemRef = z.infer<typeof itemRefSchema>;

export const literalSchema = z.object({
  kind: z.literal("literal"),
  type: valueTypeSchema,
  value: z.unknown()
});
export type Literal = z.infer<typeof literalSchema>;

export const templatePartSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  variableRefSchema,
  itemRefSchema
]);
export type TemplatePart = z.infer<typeof templatePartSchema>;

/** Text with variables in it. Only ever valid where a string is expected. */
export const templateSchema = z.object({
  kind: z.literal("template"),
  parts: z.array(templatePartSchema).default([])
});
export type Template = z.infer<typeof templateSchema>;

/** A row's value: the four simple forms. Deliberately not `valueOrRefSchema` — a set of
 * name/value rows nested inside another one has no meaning, so it is unrepresentable
 * rather than merely invalid, and no recursive schema is needed. */
export const pairValueSchema = z.discriminatedUnion("kind", [
  literalSchema,
  variableRefSchema,
  itemRefSchema,
  templateSchema
]);
export type PairValue = z.infer<typeof pairValueSchema>;

export const pairEntrySchema = z.object({
  name: z.string(),
  value: pairValueSchema
});
export type PairEntry = z.infer<typeof pairEntrySchema>;

/** Named rows — request headers today. Only valid where a catalog input sets `pairs`. */
export const pairsSchema = z.object({
  kind: z.literal("pairs"),
  entries: z.array(pairEntrySchema).default([])
});
export type Pairs = z.infer<typeof pairsSchema>;

function scalarValueMatches(type: ScalarType, value: unknown): boolean {
  // A record is never a literal — it only ever arrives as a step's output — so no
  // stored value may claim to be one.
  if (type.kind === "record") return false;
  if (type.kind === "entity") return typeof value === "string";
  switch (type.of) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value));
    case "null":
      return value === null;
  }
}

/** Every other check compares declared types only, so the tag must be verified here. */
export function literalValueMatchesType(
  type: ValueType,
  value: unknown
): boolean {
  if (type.kind === "list") {
    return (
      Array.isArray(value) &&
      value.every((item) => scalarValueMatches(type.of, item))
    );
  }
  return scalarValueMatches(type, value);
}

// The literal refinement lives here because zod's `discriminatedUnion` only
// accepts plain objects, so `literalSchema` itself cannot be refined.
export const valueOrRefSchema = z
  .discriminatedUnion("kind", [
    literalSchema,
    variableRefSchema,
    itemRefSchema,
    templateSchema,
    pairsSchema
  ])
  .superRefine((value, ctx) => {
    if (value.kind !== "literal") return;
    if (!literalValueMatchesType(value.type, value.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `This value is not ${describeType(value.type)}.`
      });
    }
  });
export type ValueOrRef = z.infer<typeof valueOrRefSchema>;

/**
 * One comparison. Shared by condition, lookup and filter nodes.
 * `right` is optional so a half-filled draft still saves; publish rejects it.
 */
export const clauseSchema = z.object({
  left: valueOrRefSchema,
  operator: operatorSchema,
  right: valueOrRefSchema.optional()
});
export type Clause = z.infer<typeof clauseSchema>;

/**
 * A lookup names a property of the record it is searching, not a value on both sides.
 * `field`/`value` may be blank mid-edit for the same reason as `clauseSchema.right`.
 */
export const lookupMatchSchema = z.object({
  field: z.string(),
  operator: operatorSchema,
  value: valueOrRefSchema.optional()
});
export type LookupMatch = z.infer<typeof lookupMatchSchema>;

export const combinatorSchema = z.enum(["and", "or"]);
export type Combinator = z.infer<typeof combinatorSchema>;

/** Wall time plus an IANA zone name, never a UTC instant — schedules must survive clock changes. */
export const scheduleSchema = z.object({
  freq: z.enum(["Daily", "Weekly", "Monthly"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  day: z.union([z.number().int().min(1).max(31), z.literal("last")]).optional(),
  tz: z.string()
});
export type Schedule = z.infer<typeof scheduleSchema>;
