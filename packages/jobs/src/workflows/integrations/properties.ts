// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ActionInputLike,
  OptionsSource,
  RuntimeValue,
  ValueType
} from "@carbon/ee/workflows";
import { toPlainValue } from "../actions/values";
import { allowlistEntry } from "./allowlist";
import { CONNECTION_INPUT, PROPERTY_PROVIDER } from "./options";
import type { PieceProperty } from "./types";
import { staticOptions, visibilityOf } from "./visibility";

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

function staticChoices(property: PieceProperty): readonly string[] | undefined {
  return staticOptions(property)?.map((option) => String(option.value));
}

/** A dropdown only the vendor can fill, so it is fetched against a chosen connection. */
function fetched(piece: string, action: string, name: string): OptionsSource {
  return {
    provider: PROPERTY_PROVIDER,
    params: { piece, action, prop: name },
    dependsOn: [CONNECTION_INPUT]
  };
}

/** One piece property as a declared step input. */
export function toValueType(
  piece: string,
  action: string,
  name: string,
  property: PieceProperty
): ActionInputLike {
  const base = {
    required: property.required === true,
    label: vendorText(property.displayName ?? name),
    // The piece's own pre-fill, carried so the builder can seed it as a stored
    // value. `!== undefined`, never truthiness: `false` is the whole point for a
    // checkbox — dropped, an OFF toggle silently meant "vendor decides".
    ...(property.defaultValue === undefined
      ? {}
      : {
          defaultValue: property.defaultValue as ActionInputLike["defaultValue"]
        }),
    // The piece's own explanation of the field, for the builder's ⓘ tooltip.
    ...(property.description === undefined
      ? {}
      : { description: vendorText(property.description) })
  };

  switch (property.type) {
    case "SHORT_TEXT":
      return { ...base, type: STRING };
    // A vendor's LongText is a message body or a description: rendered as the
    // multiline editor Carbon's own prose inputs use, or Slack's "Message" and a
    // calendar description arrive as one-line boxes.
    case "LONG_TEXT":
      return { ...base, type: STRING, template: true };
    case "NUMBER":
      return { ...base, type: NUMBER };
    case "CHECKBOX":
      return { ...base, type: BOOLEAN };
    // The vendor said DATE_TIME, not DATE. Dropping the time here is what left
    // Google Calendar's "Start date time of the event" with a date-only picker,
    // and made the value an underspecified instant the piece then read in the
    // WORKER's timezone.
    case "DATE_TIME":
      return { ...base, type: DATE, precision: "datetime" };
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

/** Vendor prose is spliced verbatim into a `msg` template literal by the
 * generator, which refuses a backtick, `${` or a lone backslash
 * (`assertLabelIsSafe`). Slack writes "`1710304378.475129`" in a description. A
 * backslash is doubled, so the template reads it back as the one the vendor wrote. */
export function vendorText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "'")
    .replaceAll("${", "$ {");
}

/**
 * Resolved Carbon inputs -> the piece's `propsValue`, for one action. One pass over
 * the piece's props, so a prop the action no longer declares is never sent.
 *
 * - An omitted prop (allowlist `omit`, or display-only) takes its pin and nothing
 *   else: the catalog never offered it, so a node value for it is stale or
 *   hand-posted.
 * - Otherwise a node value wins — an author who opened Advanced and set it
 *   deliberately must not be overridden by our default — and the pin fills in
 *   only where the node supplied nothing.
 *
 * A pin is a hidden prop's value (`visibilityOf`), or a shown prop's allowlist
 * `value`. Merged HERE rather than stored on the node, so changing a pin fixes
 * every saved workflow at once; a piece applies neither a pin nor its own
 * `defaultValue` for itself. An absent optional input is omitted rather than sent
 * as null: pieces branch on `undefined`.
 */
export function toPropsValue(
  piece: string,
  action: string,
  props: Record<string, PieceProperty>,
  inputs: Record<string, RuntimeValue>
): Record<string, unknown> {
  const overrides = allowlistEntry(piece)?.props?.[action] ?? {};
  const propsValue: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(props)) {
    const visibility = visibilityOf(property, overrides[name]);
    const pin = visibility.show ? overrides[name]?.value : visibility.value;

    const omitted = !visibility.show && visibility.omit === true;
    const input = omitted ? undefined : inputs[name];
    const plain = input === undefined ? undefined : toPlainValue(input);
    // An emptied multi-select is "nothing chosen", not "send an empty list": the
    // piece reads a required list unguarded, so it falls back to the pin exactly
    // as an absent input does — omitting it is what crashed the vendor.
    if (
      plain === null ||
      plain === undefined ||
      (Array.isArray(plain) && plain.length === 0)
    ) {
      if (pin !== undefined) propsValue[name] = pin;
      continue;
    }

    propsValue[name] = plain;
  }

  return propsValue;
}
