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
  .discriminatedUnion("kind", [literalSchema, variableRefSchema, itemRefSchema])
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

/** One comparison. Shared by condition, lookup and filter nodes. */
export const clauseSchema = z.object({
  left: valueOrRefSchema,
  operator: operatorSchema,
  right: valueOrRefSchema
});
export type Clause = z.infer<typeof clauseSchema>;

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
