// Pure matching helpers for the CSV import enum-mapping step. Extracted so the
// auto-match logic is unit-testable without a DOM. An option may carry
// `aliases` — additional identifiers (e.g. a supplier's readableId) that resolve
// to the same value as the visible label.

import type { ListItem } from "~/types";

export type MatchableOption = {
  label: string;
  value: string;
  aliases?: string[];
};

const normalize = (value: string): string => value.toLowerCase().trim();

// Build a normalized lookup of every match key (label + aliases) -> option
// value. Earlier options win on collision so results are deterministic.
export function buildOptionLookup(
  options: MatchableOption[]
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const option of options) {
    for (const key of [option.label, ...(option.aliases ?? [])]) {
      const normalized = normalize(key);
      if (normalized === "") continue;
      if (!lookup.has(normalized)) lookup.set(normalized, option.value);
    }
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
// a match key. For suppliers and other no-email lookups, the label is the
// readableId when the company displays readable IDs (else the name), and the
// other identifier(s) become aliases so auto-match resolves by either.
export function toMatchableOption(
  item: ListItem,
  showReadableId: boolean
): MatchableOption {
  if (item.email) {
    return { label: item.email, value: item.id };
  }
  const label = showReadableId && item.readableId ? item.readableId : item.name;
  const aliases = [item.readableId, item.name].filter(
    (alias): alias is string => !!alias && alias !== label
  );
  return { label, value: item.id, aliases };
}
