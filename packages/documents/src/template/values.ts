// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ValueEdits } from "./schema";

/** One table row's values as the record holds them. */
export interface CollectedRow {
  /** `<prefix>:<record id>`, the key of the row's changes in `ValueEdits`. */
  key: string;
  prefix: string;
  values: Record<string, string>;
}

/** Every value a render printed from the record, in print order. */
export interface CollectedValues {
  document: Record<string, string>;
  rows: CollectedRow[];
}

/** Hears each set of values as a render builds them, before any change applies. */
export interface ValueCollector {
  document: (values: Record<string, string>) => void;
  row: (row: CollectedRow) => void;
}

/** Applies one document's changed values, and reports the record's to a collector. */
export interface DocumentValues {
  document: <V extends Record<string, string>>(vars: V) => V;
  row: <V extends Record<string, string>>(
    prefix: string,
    id: string | number | null | undefined,
    vars: V
  ) => V;
}

export function documentValues(
  edits?: ValueEdits,
  collector?: ValueCollector
): DocumentValues {
  return {
    document: (vars) => {
      collector?.document(vars);
      return { ...vars, ...edits?.document };
    },
    row: (prefix, id, vars) => {
      // A row with no id has nothing to tell it from another such row.
      if (id === null || id === undefined) return vars;
      const key = `${prefix}:${id}`;
      collector?.row({ key, prefix, values: vars });
      return { ...vars, ...edits?.rows?.[key] };
    }
  };
}

/** A collector and what it heard. A page repeated per method keeps the first of each. */
export function collectValues(): {
  collector: ValueCollector;
  collected: CollectedValues;
} {
  const collected: CollectedValues = { document: {}, rows: [] };
  const seen = new Set<string>();
  return {
    collected,
    collector: {
      document: (values) => {
        collected.document = { ...values, ...collected.document };
      },
      row: (row) => {
        if (seen.has(row.key)) return;
        seen.add(row.key);
        collected.rows.push(row);
      }
    }
  };
}

export function isEmptyValueEdits(edits: ValueEdits | undefined): boolean {
  return (
    Object.keys(edits?.document ?? {}).length === 0 &&
    Object.keys(edits?.rows ?? {}).length === 0
  );
}

/**
 * The changes after one value is typed. `rowKey` is null for a document value.
 * A value typed back to the record's leaves no entry, and no changes at all is
 * `undefined`, so an untouched document stores nothing.
 */
export function setValueEdit(
  edits: ValueEdits | undefined,
  target: { rowKey: string | null; token: string; recordValue: string },
  text: string
): ValueEdits | undefined {
  const { rowKey, token, recordValue } = target;
  const changed = (current: Record<string, string> | undefined) => {
    const next = { ...current };
    if (text === recordValue) delete next[token];
    else next[token] = text;
    return next;
  };

  const document = rowKey ? { ...edits?.document } : changed(edits?.document);
  const rows = { ...edits?.rows };
  if (rowKey) {
    const row = changed(rows[rowKey]);
    if (Object.keys(row).length > 0) rows[rowKey] = row;
    else delete rows[rowKey];
  }

  const next: ValueEdits = {
    ...(Object.keys(document).length > 0 ? { document } : {}),
    ...(Object.keys(rows).length > 0 ? { rows } : {})
  };
  return isEmptyValueEdits(next) ? undefined : next;
}

/**
 * Stored row keys name record ids (`line:<id>`, `charge:<lineId>:<qty>:<id>`).
 * When a record is copied under new ids, `newId` gives each piece's new id. A key
 * whose first id has no new id is dropped: its row no longer exists here.
 */
export function rewriteValueEditRowKeys(
  edits: ValueEdits,
  newId: (id: string) => string | undefined
): ValueEdits {
  const rows = Object.entries(edits.rows ?? {}).flatMap(([key, values]) => {
    const [prefix = "", first = "", ...rest] = key.split(":");
    const id = newId(first);
    if (!id) return [];
    const parts = rest.map((part) => newId(part) ?? part);
    return [[[prefix, id, ...parts].join(":"), values] as const];
  });
  return { ...edits, rows: Object.fromEntries(rows) };
}
