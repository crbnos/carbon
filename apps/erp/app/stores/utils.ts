/**
 * Insert `row` into a name-sorted list store, or return the list unchanged if a
 * row with the same id already exists. Used by create-on-the-fly flows (which
 * append synchronously) and the realtime INSERT handlers (which may deliver the
 * same row later) so the two paths never double-add.
 */
export function upsertIntoListStore<T extends { id: string; name: string }>(
  rows: T[],
  row: T
): T[] {
  return rows.some((r) => r.id === row.id)
    ? rows
    : [...rows, row].sort((a, b) => a.name.localeCompare(b.name));
}
