import { t, type ValueType } from "@carbon/workflows";
import type { PieceOutputField, PieceOutputSchema } from "./types";

/** Translates a piece's declared output into Carbon's value vocabulary, and records
 * where in the real response each declared field is read from.
 *
 * The mirror of `properties.ts`, which does the same for the input side. Both refuse
 * rather than degrade — a half-described action must never reach a customer's canvas.
 */

export class UnmappableOutputError extends Error {
  constructor(piece: string, action: string) {
    super(
      `${piece}.${action} declares no outputSchema, so Carbon cannot describe what it returns.`
    );
    this.name = "UnmappableOutputError";
  }
}

/** `format` is a DISPLAY hint upstream, not a type — so this is our reading of it,
 * and every mapped value still degrades to null at run time when it disagrees. */
function primitiveFor(format: string | undefined): ValueType {
  switch (format) {
    case "datetime":
      return t.date;
    case "number":
      return t.number;
    case "boolean":
      return t.boolean;
    // url / email / image / filesize are all text with a rendering hint attached.
    default:
      return t.string;
  }
}

/** Where a field's value sits, relative to its container. */
function pathOf(field: PieceOutputField): string[] {
  return (field.value ?? field.key).split(".");
}

/**
 * A field's Carbon type, or `undefined` when it has none we can offer.
 *
 * `nested` is what stops a list of lists: `list.of` accepts only a scalar, so an
 * array INSIDE an array has no representation. Rather than throwing — which would
 * refuse a whole action over one field — the inner array is dropped, and the raw
 * `result` output remains the way to reach it.
 */
function typeOf(
  field: PieceOutputField,
  nested: boolean
): ValueType | undefined {
  // The vendor is saying the keys here vary per account and cannot be enumerated.
  // Inventing names for them would be exactly the lie this mapper exists to avoid.
  if (field.dynamicKey === true) return undefined;

  if (field.listItems !== undefined) {
    if (nested) return undefined;
    const fields = shapeOf(field.listItems, true);
    return fields === undefined
      ? undefined
      : t.list({ kind: "record", fields });
  }

  if (field.children !== undefined) {
    const fields = shapeOf(field.children, nested);
    return fields === undefined ? undefined : t.record(fields);
  }

  return primitiveFor(field.format);
}

/** The field map for one container, or `undefined` when nothing in it is mappable. */
function shapeOf(
  fields: readonly PieceOutputField[],
  nested: boolean
): Record<string, ValueType> | undefined {
  const shape: Record<string, ValueType> = {};
  for (const field of fields) {
    const type = typeOf(field, nested);
    if (type !== undefined) shape[field.key] = type;
  }
  return Object.keys(shape).length === 0 ? undefined : shape;
}

/** The step's declared outputs, keyed as the author will see them. */
export function toOutputTypes(
  schema: PieceOutputSchema
): Record<string, ValueType> {
  return shapeOf(schema.fields, false) ?? {};
}

/** One emitted output and where to read it from the response. */
export interface OutputPath {
  /** Path from the response root to this output's container. */
  path: string[];
  /** For a list output, how to read each element's fields off one item. */
  items?: Record<string, string[]>;
}

/**
 * Where each output declared by `toOutputTypes` lives in the real response.
 *
 * Kept beside the type mapping rather than derived separately, so the two can never
 * disagree about which fields exist — a projection reading a field the type does not
 * declare would land untyped data in a step's output.
 */
export function toOutputPaths(
  schema: PieceOutputSchema
): Record<string, OutputPath> {
  const paths: Record<string, OutputPath> = {};

  for (const field of schema.fields) {
    if (typeOf(field, false) === undefined) continue;

    if (field.listItems !== undefined) {
      const items: Record<string, string[]> = {};
      for (const item of field.listItems) {
        if (typeOf(item, true) === undefined) continue;
        items[item.key] = pathOf(item);
      }
      paths[field.key] = { path: pathOf(field), items };
      continue;
    }

    paths[field.key] = { path: pathOf(field) };
  }

  return paths;
}

/** Reads a dotted path off a plain response object; anything missing is `undefined`. */
export function readPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
