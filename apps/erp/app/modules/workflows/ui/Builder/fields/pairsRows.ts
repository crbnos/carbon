import type { PairEntry, PairValue, ValueOrRef } from "@carbon/workflows";

/** A new row starts with an empty name and an empty value — never absent, because
 * a row's value is not optional. Blank rows are dropped before the request goes out. */
export const EMPTY_ROW_VALUE: PairValue = {
  kind: "literal",
  type: { kind: "primitive", of: "string" },
  value: ""
};

export function entriesOf(value: ValueOrRef | undefined): PairEntry[] {
  return value?.kind === "pairs" ? value.entries : [];
}

export function addRow(entries: PairEntry[]): PairEntry[] {
  return [...entries, { name: "", value: EMPTY_ROW_VALUE }];
}

export function removeRow(entries: PairEntry[], index: number): PairEntry[] {
  return entries.filter((_, i) => i !== index);
}

export function setRowName(
  entries: PairEntry[],
  index: number,
  name: string
): PairEntry[] {
  return entries.map((entry, i) => (i === index ? { ...entry, name } : entry));
}

/** The editor can only produce the four simple forms, so a `pairs` coming back here
 * would mean a bug elsewhere; treat it as cleared rather than nest the unnestable. */
export function setRowValue(
  entries: PairEntry[],
  index: number,
  value: ValueOrRef | undefined
): PairEntry[] {
  const next: PairValue =
    value === undefined || value.kind === "pairs" ? EMPTY_ROW_VALUE : value;
  return entries.map((entry, i) =>
    i === index ? { ...entry, value: next } : entry
  );
}

/** An empty set is stored as absent, so a field the user emptied looks untouched. */
export function toValue(entries: PairEntry[]): ValueOrRef | undefined {
  return entries.length === 0 ? undefined : { kind: "pairs", entries };
}
