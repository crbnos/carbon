import type { OptionsSource, RuntimeValue, ValueType } from "@carbon/workflows";
import { CONNECTION_INPUT, PROPERTY_PROVIDER } from "./options";
import type { PieceOption, PieceProperty } from "./types";

/** Translates a piece's form-fields-as-data into Carbon's input vocabulary, and
 * resolved Carbon values back into the plain object a piece's `run()` expects. */

export class UnmappablePropertyError extends Error {
  constructor(piece: string, action: string, property: string, type: string) {
    super(
      `Property "${property}" on ${piece}.${action} is a ${type}, which Carbon cannot represent.`
    );
    this.name = "UnmappablePropertyError";
  }
}

const STRING: ValueType = { kind: "primitive", of: "string" };
const NUMBER: ValueType = { kind: "primitive", of: "number" };
const BOOLEAN: ValueType = { kind: "primitive", of: "boolean" };
const DATE: ValueType = { kind: "primitive", of: "date" };
const STRING_LIST: ValueType = {
  kind: "list",
  of: { kind: "primitive", of: "string" }
};

export interface MappedProperty {
  type: ValueType;
  required: boolean;
  label: string;
  choices?: readonly string[];
  /** Values come from the vendor while editing; the builder fetches them. */
  options?: OptionsSource;
}

function staticChoices(property: PieceProperty): readonly string[] | undefined {
  const options = property.options;
  if (typeof options !== "object" || options === null) return undefined;
  const list = (options as { options?: readonly PieceOption[] }).options;
  if (!Array.isArray(list)) return undefined;
  return list.map((option) => String(option.value));
}

/** A dropdown only the vendor can fill, so it is fetched against a chosen connection. */
function fetched(piece: string, action: string, name: string): OptionsSource {
  return {
    provider: PROPERTY_PROVIDER,
    params: { piece, action, prop: name },
    dependsOn: [CONNECTION_INPUT]
  };
}

export function toValueType(
  piece: string,
  action: string,
  name: string,
  property: PieceProperty
): MappedProperty {
  const label = property.displayName ?? name;
  const required = property.required === true;
  const base = { required, label };

  switch (property.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return { ...base, type: STRING };
    case "NUMBER":
      return { ...base, type: NUMBER };
    case "CHECKBOX":
      return { ...base, type: BOOLEAN };
    case "DATE_TIME":
      return { ...base, type: DATE };
    case "ARRAY":
      return { ...base, type: STRING_LIST };
    case "STATIC_DROPDOWN":
      return { ...base, type: STRING, choices: staticChoices(property) ?? [] };
    case "STATIC_MULTI_SELECT_DROPDOWN":
      return {
        ...base,
        type: STRING_LIST,
        choices: staticChoices(property) ?? []
      };
    case "DROPDOWN":
      return { ...base, type: STRING, options: fetched(piece, action, name) };
    case "MULTI_SELECT_DROPDOWN":
      return {
        ...base,
        type: STRING_LIST,
        options: fetched(piece, action, name)
      };
    default:
      // OBJECT / JSON / FILE / DYNAMIC / MARKDOWN and anything new. Fails the
      // generator loudly: a half-described action must never be emitted.
      throw new UnmappablePropertyError(piece, action, name, property.type);
  }
}

function toPlain(value: RuntimeValue): unknown {
  switch (value.kind) {
    case "primitive":
      return value.value;
    case "entity":
      return value.id;
    case "list":
      return value.items.map(toPlain);
    case "pairs":
      return Object.fromEntries(
        value.entries.map((entry) => [entry.name, toPlain(entry.value)])
      );
  }
}

/** Resolved Carbon inputs -> the piece's `propsValue`. An absent optional input is
 * omitted rather than sent as null: pieces branch on `undefined`. */
export function toPropsValue(
  props: Record<string, PieceProperty>,
  inputs: Record<string, RuntimeValue>
): Record<string, unknown> {
  const propsValue: Record<string, unknown> = {};

  for (const name of Object.keys(props)) {
    const input = inputs[name];
    if (input === undefined) continue;

    const plain = toPlain(input);
    if (plain === null || plain === undefined) continue;
    if (Array.isArray(plain) && plain.length === 0) continue;

    propsValue[name] = plain;
  }

  return propsValue;
}
