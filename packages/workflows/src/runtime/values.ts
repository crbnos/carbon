import { MAX_LIST_ITEMS } from "../definition/schema";
import type {
  Literal,
  PrimitiveKind,
  ScalarType,
  ValueType
} from "../definition/types";
import type { RuntimeValue } from "./types";

export function primitiveValue(
  of: PrimitiveKind,
  value: string | number | boolean | null
): RuntimeValue {
  return { kind: "primitive", of, value };
}

/** Reading a property of this yields this again, never an error. */
export function nullValue(): RuntimeValue {
  return { kind: "primitive", of: "null", value: null };
}

export function entityValue(
  of: string,
  id: string,
  row?: Record<string, unknown>
): RuntimeValue {
  return row === undefined
    ? { kind: "entity", of, id }
    : { kind: "entity", of, id, row };
}

/** The one place MAX_LIST_ITEMS is applied. */
export function capItems(items: RuntimeValue[]): {
  items: RuntimeValue[];
  dropped: number;
} {
  return {
    items: items.slice(0, MAX_LIST_ITEMS),
    dropped: Math.max(0, items.length - MAX_LIST_ITEMS)
  };
}

export function listValue(
  of: ScalarType,
  items: RuntimeValue[]
): { value: RuntimeValue; dropped: number } {
  const capped = capItems(items);
  return {
    value: { kind: "list", of, items: capped.items },
    dropped: capped.dropped
  };
}

export function pairsValue(
  entries: { name: string; value: RuntimeValue }[]
): RuntimeValue {
  return { kind: "pairs", entries };
}

export function isNull(value: RuntimeValue): boolean {
  return value.kind === "primitive" && value.value === null;
}

/** Coerces a raw database column value against its catalog type; anything unusable is null. */
export function fromColumn(type: ValueType, raw: unknown): RuntimeValue {
  if (type.kind === "list") {
    if (!Array.isArray(raw)) return { kind: "list", of: type.of, items: [] };
    return listValue(
      type.of,
      raw.map((entry) => fromColumn(type.of, entry))
    ).value;
  }

  if (raw === null || raw === undefined) return nullValue();

  if (type.kind === "entity") {
    return raw === "" ? nullValue() : entityValue(type.of, String(raw));
  }

  switch (type.of) {
    case "date": {
      const parsed = new Date(raw as string);
      return Number.isNaN(parsed.getTime())
        ? nullValue()
        : primitiveValue("date", parsed.toISOString());
    }
    case "number": {
      const parsed = Number(raw);
      return Number.isFinite(parsed)
        ? primitiveValue("number", parsed)
        : nullValue();
    }
    case "boolean":
      return primitiveValue("boolean", Boolean(raw));
    case "string":
      return primitiveValue("string", String(raw));
    case "null":
      return nullValue();
  }
}

export function fromLiteral(literal: Literal): RuntimeValue {
  return fromColumn(literal.type, literal.value);
}
