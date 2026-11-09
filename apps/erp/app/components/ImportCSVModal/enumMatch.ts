// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure matching helpers for the CSV import enum-mapping step. Extracted so the
// auto-match logic is unit-testable without a DOM. An option may carry
// `aliases` — additional identifiers (e.g. a supplier's readableId) that resolve
// to the same value as the visible label. The option's value is a match key
// too, after every label and alias: a lookup keyed by a code (a unit of
// measure's code, a country's alpha-2) then matches a CSV that holds the code.

import type { ListItem } from "~/types";

export type MatchableOption = {
  label: string;
  value: string;
  aliases?: string[];
  // The value is an internal id rather than a code, so it is not a match key.
  internalValue?: boolean;
};

const normalize = (value: string): string => value.toLowerCase().trim();

// Build a normalized lookup of every match key -> option value: first each
// option's label and aliases, then each option's value, so a name always wins
// over a code that collides with it. Earlier options win on collision so
// results are deterministic.
export function buildOptionLookup(
  options: MatchableOption[]
): Map<string, string> {
  const lookup = new Map<string, string>();
  const add = (key: string, value: string) => {
    const normalized = normalize(key);
    if (normalized === "") return;
    if (!lookup.has(normalized)) lookup.set(normalized, value);
  };
  for (const option of options) {
    for (const key of [option.label, ...(option.aliases ?? [])]) {
      add(key, option.value);
    }
  }
  for (const option of options) {
    if (!option.internalValue) add(option.value, option.value);
  }
  return lookup;
}

// Resolve a CSV cell value to an option value, or undefined when no key matches.
export function matchCsvValue(
  lookup: Map<string, string>,
  csvValue: string
): string | undefined {
  return lookup.get(normalize(csvValue));
}

// Derive a MatchableOption from a fetched list item. Employees (items with an
// email) match by email ONLY — their names are not unique, so name must not be
// a match key, and their id is internal. For suppliers and other no-email
// lookups, the label is the readableId when the company displays readable IDs
// (else the name), and the other identifier(s) become aliases so auto-match
// resolves by either.
export function toMatchableOption(
  item: ListItem,
  showReadableId: boolean
): MatchableOption {
  if (item.email) {
    return { label: item.email, value: item.id, internalValue: true };
  }
  const label = showReadableId && item.readableId ? item.readableId : item.name;
  const aliases = [item.readableId, item.name].filter(
    (alias): alias is string => !!alias && alias !== label
  );
  return { label, value: item.id, aliases };
}
