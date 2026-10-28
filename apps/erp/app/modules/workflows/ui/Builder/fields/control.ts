// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ValueOrRef, ValueType } from "@carbon/ee/workflows";
import {
  parseAbsolute,
  parseDate,
  toCalendarDateTime
} from "@internationalized/date";
import { hasRecordPicker } from "./recordPickerEntities";

/** Which control a value field renders. */
export type ControlKind = "inline" | "chip" | "pick" | "literal";

/** A list of plain text — email recipients, calendar attendees — that a person
 * can write down one entry at a time. Every other list (records, numbers, dates)
 * has no honest source but an earlier step. */
export function isWritableList(type: ValueType): boolean {
  return (
    type.kind === "list" &&
    type.of.kind === "primitive" &&
    type.of.of === "string"
  );
}

/** A value there is no way to write down: a list that is not plain text, or a
 * record with no searchable picker behind it. The only honest source for one is
 * an earlier step. */
function variableOnly(type: ValueType): boolean {
  if (type.kind === "list") return !isWritableList(type);
  return type.kind === "entity" && !hasRecordPicker(type.of);
}

/**
 * One ordered decision instead of a branch per case. Order is the whole point:
 * `choices` has to disqualify the free-text rule, or every enum column loses its
 * dropdown to the inline editor.
 *
 * `literal` covers everything `LiteralControl` still dispatches internally
 * (choices, number, boolean, date, searchable record) — this only decides which of
 * the four shells wraps the value.
 */
export function pickControl(
  type: ValueType,
  value: ValueOrRef | undefined,
  choices: readonly string[] | undefined
): ControlKind {
  const isFreeText =
    type.kind === "primitive" && type.of === "string" && !choices?.length;
  // Text wins over the chip: a lone variable in a text field renders as a token
  // inside the editor, so the user can still type around it.
  if (isFreeText) return "inline";
  if (value?.kind === "ref" || value?.kind === "item") return "chip";
  if (variableOnly(type)) return "pick";
  return "literal";
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stored dates are the `YYYY-MM-DD` the picker itself writes. Anything else is a
 * value from elsewhere, and an empty picker beats a crash. */
export function asCalendarDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return parseDate(value.slice(0, 10));
  } catch {
    return null;
  }
}

/** Stored datetimes are the full ISO instant the picker itself writes. A value
 * saved before datetime inputs existed is a bare `YYYY-MM-DD`, which
 * `parseAbsolute` rejects — read it as midnight on the company's calendar, the
 * moment it already effectively meant. Anything else leaves the picker empty
 * rather than crashing the node form. */
export function asCalendarDateTime(value: unknown, timeZone: string) {
  if (typeof value !== "string" || !value) return null;
  try {
    return toCalendarDateTime(parseAbsolute(value, timeZone));
  } catch {
    // Only a complete bare date: `2026-08-01junk` must not display as midnight
    // while the run still sends the rejected text.
    if (!BARE_DATE.test(value)) return null;
    const date = asCalendarDate(value);
    return date ? toCalendarDateTime(date) : null;
  }
}
