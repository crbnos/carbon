// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Optimistic inline edits, laid over the rows the Table gets.
 *
 * The Table keeps only the user's edits (by row id), never a copy of the rows.
 * An edit shows until the rows catch up with it: a load of the rows that
 * started after the edit, or a row whose value already equals the edit.
 */

let clock = 0;

/** A logical clock. An edit and a load each take a tick, so they can be ordered. */
export function tick(): number {
  clock += 1;
  return clock;
}

/** The values one row was edited to, by column id, and the tick of the edit. */
export type RowEdit = { values: Record<string, unknown>; at: number };

export type RowEdits = Record<string, RowEdit>;

// A column id with `_` that is not a key of the row is a nested path
// (`updateNestedProperty` in `Grid/utils.ts` uses the same rule).
function pathOf(row: object, columnId: string): string[] {
  return columnId.includes("_") && !(columnId in row)
    ? columnId.split("_")
    : [columnId];
}

function readPath(row: object, path: string[]): unknown {
  let value: unknown = row;
  for (const key of path) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function writePath(row: object, path: string[], value: unknown): object {
  const [key, ...rest] = path;
  const current = row as Record<string, unknown>;
  if (rest.length === 0) return { ...current, [key!]: value };
  const child = current[key!];
  return {
    ...current,
    [key!]: writePath(
      child && typeof child === "object" ? child : {},
      rest,
      value
    )
  };
}

/** The row with the edit's values. The row itself is never changed. */
export function applyRowEdit<T extends object>(
  row: T,
  values: Record<string, unknown>
): T {
  let next: object = row;
  for (const [columnId, value] of Object.entries(values)) {
    const path = pathOf(row, columnId);
    // A nested path skips `undefined`, as `updateNestedProperty` did.
    if (path.length > 1 && value === undefined) continue;
    next = writePath(next, path, value);
  }
  return next as T;
}

/** True when the row already holds every value of the edit. */
export function editMatchesRow(
  row: object,
  values: Record<string, unknown>
): boolean {
  return Object.entries(values).every(([columnId, value]) =>
    Object.is(readPath(row, pathOf(row, columnId)), value)
  );
}

// An edit is live while no load that started after it has finished, and the
// row (when it is loaded) does not already hold it.
function isLive(edit: RowEdit, row: object | undefined, syncedAt: number) {
  if (edit.at < syncedAt) return false;
  return !row || !editMatchesRow(row, edit.values);
}

/** The rows with each live edit laid over its row. Unchanged rows keep their identity. */
export function applyRowEdits<T extends object>(
  rows: T[],
  edits: RowEdits,
  getRowId: (row: T, index: number) => string,
  syncedAt: number
): T[] {
  if (Object.keys(edits).length === 0) return rows;
  let changed = false;
  const next = rows.map((row, index) => {
    const edit = edits[getRowId(row, index)];
    if (!edit || !isLive(edit, row, syncedAt)) return row;
    changed = true;
    return applyRowEdit(row, edit.values);
  });
  return changed ? next : rows;
}

/** The edits without the ones the rows caught up with. The same object when none goes. */
export function pruneRowEdits<T extends object>(
  edits: RowEdits,
  rows: T[],
  getRowId: (row: T, index: number) => string,
  syncedAt: number
): RowEdits {
  const ids = Object.keys(edits);
  if (ids.length === 0) return edits;
  const rowById = new Map<string, T>();
  rows.forEach((row, index) => {
    rowById.set(getRowId(row, index), row);
  });
  const kept: RowEdits = {};
  for (const id of ids) {
    if (isLive(edits[id]!, rowById.get(id), syncedAt)) kept[id] = edits[id]!;
  }
  return Object.keys(kept).length === ids.length ? edits : kept;
}
