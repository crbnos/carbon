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
  /** The piece's own pre-fill, carried so the builder can seed it as a stored
   * value. `!== undefined`, never truthiness: `false` is the whole point for a
   * checkbox — dropped, an OFF toggle silently meant "vendor decides". */
  defaultValue?: unknown;
  /** The piece's own explanation of the field, for the builder's ⓘ tooltip. */
  description?: string;
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
  const label = vendorText(property.displayName ?? name);
  const required = property.required === true;
  const base = {
    required,
    label,
    ...(property.defaultValue === undefined
      ? {}
      : { defaultValue: property.defaultValue }),
    ...(property.description === undefined
      ? {}
      : { description: vendorText(property.description) })
  };

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

/** Vendor prose is spliced into a `msg` template literal by the generator, which
 * refuses a backtick or `${`. Slack writes "`1710304378.475129`" in a description. */
function vendorText(text: string): string {
  return text.replaceAll("`", "'").replaceAll("${", "$ {");
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
    case "record":
      return Object.fromEntries(
        Object.entries(value.fields).map(([name, field]) => [
          name,
          toPlain(field)
        ])
      );
  }
}

/** Resolved Carbon inputs -> the piece's `propsValue`. An absent optional input is
 * omitted rather than sent as null: pieces branch on `undefined`. */
export function toPropsValue(
  props: Record<string, PieceProperty>,
  inputs: Record<string, RuntimeValue>,
  /** Values pinned by the allowlist, applied only where the node supplied nothing.
   * Merged HERE rather than stored on the node, so changing a pin fixes every
   * existing workflow at once instead of leaving stale literals behind. */
  pinned: Record<string, unknown> = {}
): Record<string, unknown> {
  const propsValue: Record<string, unknown> = {};

  for (const name of Object.keys(props)) {
    // Display-only help text, never a value.
    if (props[name]?.type === "MARKDOWN") continue;
    const input = inputs[name];
    if (input === undefined) {
      // A node value always wins: an author who opened Advanced and set this
      // deliberately must not be overridden by our default.
      if (pinned[name] !== undefined) propsValue[name] = pinned[name];
      continue;
    }

    const plain = toPlain(input);
    if (plain === null || plain === undefined) {
      if (pinned[name] !== undefined) propsValue[name] = pinned[name];
      continue;
    }
    // An emptied multi-select is "nothing chosen", not "send an empty list": the
    // piece reads a required list unguarded. Falls back to the pin for the same
    // reason an absent input does — omitting it is what crashed the vendor.
    if (Array.isArray(plain) && plain.length === 0) {
      if (pinned[name] !== undefined) propsValue[name] = pinned[name];
      continue;
    }

    propsValue[name] = plain;
  }

  return propsValue;
}
