// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The pure half of the live lists: how a list is brought up to date from the
// change log (`table_changes_since`) or a broadcast. No React, no network.

/** Where to start reading the change log next time. Opaque to the client. */
export type Cursor = { xid: string; epoch: string; at: string };

/** What `table_changes_since` answers. */
export type LoggedChanges = Cursor & {
  /** The log cannot answer for the cursor it was given: fetch everything. */
  reset: boolean;
  /** Changed row ids per table. `null`: too many to list, read the table again. */
  changes: Record<string, string[] | null>;
};

// Past this many changed rows, one full fetch is cheaper than the re-reads.
const MAX_ROWS_TO_REREAD = 500;

/**
 * The cursor to send for several lists: the oldest, so its answer covers them
 * all (a list with a newer cursor is told about a few rows it already has).
 * `null` when no list has one.
 */
export function oldestCursor(cursors: (Cursor | null)[]): Cursor | null {
  let oldest: Cursor | null = null;
  for (const cursor of cursors) {
    if (!cursor) continue;
    if (!oldest || BigInt(cursor.xid) < BigInt(oldest.xid)) oldest = cursor;
  }
  return oldest;
}

/**
 * How to bring one list up to date: `"all"` (fetch it in full) or the changed
 * ids to re-read, per table.
 *
 * `covered` says the answer was computed from a cursor this list can trust:
 * it has rows, and its own cursor is from the same server epoch as the one
 * that was sent. Without that the log's answer says nothing about this list.
 */
export function planSync(
  log: LoggedChanges,
  tables: string[],
  covered: boolean
): "all" | [table: string, ids: string[]][] {
  if (log.reset || !covered) return "all";
  const plan: [string, string[]][] = [];
  let total = 0;
  for (const table of tables) {
    if (!(table in log.changes)) continue;
    const ids = log.changes[table];
    if (!ids) return "all";
    total += ids.length;
    plan.push([table, ids]);
  }
  return total > MAX_ROWS_TO_REREAD ? "all" : plan;
}

/** The list without these rows. */
export function removeRows<Row extends { id: string }>(
  rows: Row[],
  ids: string[]
): Row[] {
  const gone = new Set(ids);
  return rows.filter((row) => !gone.has(row.id));
}

/** The list with these rows added, or replaced where it already has them. */
export function upsertRows<Row extends { id: string }>(
  rows: Row[],
  fetched: Row[],
  sort: (a: Row, b: Row) => number
): Row[] {
  if (fetched.length === 0) return rows;
  return [
    ...removeRows(
      rows,
      fetched.map((row) => row.id)
    ),
    ...fetched
  ].sort(sort);
}

/** The key a list is stored under on the device. */
export const storedListKey = (
  companyId: string,
  userId: string,
  name: string
) => `${name}:${companyId}:${userId}`;

/**
 * How long a stored list may stay on a device without being rewritten: it is
 * company data, so a copy nobody has refreshed for a day goes. An open page
 * rewrites its own lists every hour (`LiveLists`), so a list in use does not
 * expire under its reader.
 */
export const STORED_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Where a stored list's write time is kept: beside it, so reading it is cheap. */
export const storedAtKey = (key: string) => `${key}:at`;

/** True for a stored list's own key, not the write time beside it. */
const isListKey = (key: string) => key.split(":").length === 3;

/**
 * The stored lists that are too old to keep, given each one's write time. A
 * list with no write time (stored before lists expired) counts as too old.
 */
export function expiredStoredKeys(
  storedAt: [key: string, at: unknown][],
  now: number
): string[] {
  return storedAt
    .filter(
      ([, at]) => typeof at !== "number" || now - at > STORED_LIST_MAX_AGE_MS
    )
    .map(([key]) => key);
}

/**
 * The stored lists this user may no longer hold: another user's, or a
 * company's the user does not belong to (removed from it since the copy was
 * taken). Keys that are not a live list are left alone; the store is shared.
 */
export function staleStoredKeys(
  keys: string[],
  {
    names,
    userId,
    companyIds
  }: { names: string[]; userId: string; companyIds: string[] }
): string[] {
  return keys.filter((key) => {
    const [name, companyId, owner] = key.split(":");
    if (!names.includes(name ?? "")) return false;
    return owner !== userId || !companyIds.includes(companyId ?? "");
  });
}

/** Of these keys, the stored lists named `names` (not their write times). */
export function storedListKeys(keys: string[], names: string[]): string[] {
  return keys.filter(
    (key) => isListKey(key) && names.includes(key.split(":")[0] ?? "")
  );
}
