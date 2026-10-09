// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The work center import's Processes column: comma-separated process names,
// resolved the way the work center form offers them (the company's active
// processes), matched case- and whitespace-insensitively.

export type ProcessIdsByName = Map<string, string[]>;

export function processIdsByName(
  processes: Array<{ id: string; name: string }>
): ProcessIdsByName {
  const byName: ProcessIdsByName = new Map();
  for (const process of processes) {
    const key = process.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), process.id]);
  }
  return byName;
}

/**
 * The process ids a Processes cell names, without repeats. A blank cell is
 * null: the row leaves the work center's processes as they are. A name that
 * matches no active process, or matches several, makes the row an error.
 */
export function resolveProcessNames(
  cell: string | undefined,
  byName: ProcessIdsByName
): { processIds: string[] } | { error: string } | null {
  const names = (cell ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return null;

  const processIds: string[] = [];
  for (const name of names) {
    const ids = byName.get(name.toLowerCase()) ?? [];
    if (ids.length === 0) {
      return {
        error: `Process "${name}" was not found among active processes`
      };
    }
    if (ids.length > 1) {
      return { error: `Process "${name}" matches more than one process` };
    }
    if (!processIds.includes(ids[0]!)) processIds.push(ids[0]!);
  }
  return { processIds };
}
