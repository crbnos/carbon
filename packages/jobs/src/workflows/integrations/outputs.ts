// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPath } from "@carbon/ee/integrations/secrets";
import { t, type ValueType } from "@carbon/ee/workflows";
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

/** One declared output: its Carbon type, and the declared field it is read by. */
export interface OutputDescription {
  type: ValueType;
  field: PieceOutputField;
}

/**
 * The step's declared outputs, keyed as the author will see them, each with the
 * field that says where it lives in the real response.
 */
export function describeOutputs(
  schema: PieceOutputSchema
): Record<string, OutputDescription> {
  const outputs: Record<string, OutputDescription> = {};
  for (const field of schema.fields) {
    const type = typeOf(field, false);
    if (type !== undefined) outputs[field.key] = { type, field };
  }
  return outputs;
}

/**
 * A declared field's value, read from its own path (`value`, else `key`) inside
 * its container and rebuilt keyed as the type names it — at every depth, so a
 * remapped field inside `children` or `listItems` lands where its type says.
 *
 * A field the type dropped (a `dynamicKey`, a list inside a list) is still read
 * here, but it never reaches a step: `fromJson` walks only the declared fields.
 */
export function readField(
  field: PieceOutputField,
  container: unknown
): unknown {
  const raw = getPath(container, field.value ?? field.key);
  const { listItems, children } = field;
  if (listItems !== undefined) {
    return Array.isArray(raw)
      ? raw.map((item) => readFields(listItems, item))
      : raw;
  }
  if (children !== undefined) return readFields(children, raw);
  return raw;
}

function readFields(
  fields: readonly PieceOutputField[],
  container: unknown
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [field.key, readField(field, container)])
  );
}
