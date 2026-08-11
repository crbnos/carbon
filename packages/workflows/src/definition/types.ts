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

/** A single-item type: a primitive, or a reference to a record type. */
export const scalarTypeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("primitive"), of: primitiveKindSchema }),
  z.object({ kind: z.literal("entity"), of: z.string() })
]);
export type ScalarType = z.infer<typeof scalarTypeSchema>;

/** A list's `of` accepts only scalars, so `list<list<T>>` is unrepresentable. */
export const valueTypeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("primitive"), of: primitiveKindSchema }),
  z.object({ kind: z.literal("entity"), of: z.string() }),
  z.object({ kind: z.literal("list"), of: scalarTypeSchema })
]);
export type ValueType = z.infer<typeof valueTypeSchema>;

/** The canonical `ValueType` constructors; prefer these over inline literals. */
export const t = {
  string: { kind: "primitive", of: "string" },
  number: { kind: "primitive", of: "number" },
  boolean: { kind: "primitive", of: "boolean" },
  date: { kind: "primitive", of: "date" },
  entity: (of: string): ValueType => ({ kind: "entity", of }),
  list: (of: ScalarType): ValueType => ({ kind: "list", of })
} as const satisfies Record<
  string,
  ValueType | ((...args: never[]) => ValueType)
>;

export function typesEqual(a: ValueType, b: ValueType): boolean {
  if (a.kind === "list" && b.kind === "list") {
    return a.of.kind === b.of.kind && a.of.of === b.of.of;
  }
  if (a.kind === "primitive" && b.kind === "primitive") return a.of === b.of;
  if (a.kind === "entity" && b.kind === "entity") return a.of === b.of;
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
 * Whether a value of this type has a reading inside a sentence. A record does not —
 * it would flatten to whichever column happened to look name-ish, or to its raw id.
 * The property the user meant is one hop further in.
 */
export function rendersAsText(type: ValueType): boolean {
  if (type.kind === "entity") return false;
  return type.kind !== "list" || type.of.kind !== "entity";
}

/** Customer-facing rendering of a type, for issue messages. */
export function describeType(type: ValueType): string {
  if (type.kind === "list") return `a list of ${type.of.of}`;
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
  if (type.kind === "list") return OPERATORS_BY_TYPE.list;
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
  path: z.array(z.string()).default([])
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
