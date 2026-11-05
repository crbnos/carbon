// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The generic row diff engine. Change notices (items) and project baselines and
// change requests (projects) both compare two lists of plain rows with it. It is
// pure: the caller loads the rows, the engine only classifies them.

// A plain record — DB rows are passed straight through; the engine is generic
// over the shape and only reads the compared field subset + the identity keys.
type Row = Record<string, unknown>;

export type DiffStatus = "added" | "removed" | "modified" | "unchanged";

export type DiffEntry<T> = {
  status: DiffStatus;
  before: T | null;
  after: T | null;
  // Field-level changes for a "modified" entry: { field: { before, after } }.
  changedFields?: Record<string, { before: unknown; after: unknown }>;
};

export type ChangedFields = Record<string, { before: unknown; after: unknown }>;

// Never compared — audit and tenancy columns that every table carries. A caller
// adds its own linkage columns through `ignoredFields`.
export const BASE_IGNORED_FIELDS: ReadonlySet<string> = new Set<string>([
  "id",
  "companyId",
  // The customFields JSON bag differs as a copy artifact (null vs {}), surfacing
  // a meaningless "— → Set" on unrelated edits — never diff it as a whole column.
  "customFields",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
]);

// Loose equality tolerant of the numeric-string ↔ number skew that Supabase
// returns for NUMERIC columns (a live `quantity` may be `"1"` while a staged one
// is `1`). null and undefined are the same "empty" value. JSON/array columns
// (workInstruction, step description, listValues/fileTypes) are separate object
// instances on the live vs staged side, so they're compared structurally — a
// reference check would report every non-null one as changed.
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

// The columns to compare for a matched (base, target) pair: every key of the
// TARGET row minus the ignored set. Deriving from the target row keeps the diff
// in lockstep with whatever the caller chose to carry; the base row may hold
// extra columns that must NOT be compared against `undefined`.
export function comparedFields(target: Row, ignored: ReadonlySet<string>) {
  return Object.keys(target).filter((k) => !ignored.has(k));
}

// Build the field-level change map for a matched (base, target) pair. Returns
// undefined when nothing changed.
export function diffFields(
  base: Row,
  target: Row,
  ignored: ReadonlySet<string>
): ChangedFields | undefined {
  const changed: ChangedFields = {};
  for (const field of comparedFields(target, ignored)) {
    if (!valuesEqual(base[field], target[field])) {
      changed[field] = {
        before: base[field] ?? null,
        after: target[field] ?? null
      };
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined;
}

export type DiffRowsOptions = {
  // The target column that holds the matching base row's `id`. A target row
  // with a null/absent value is an added row.
  key: string;
  // Extra columns never compared, on top of `BASE_IGNORED_FIELDS`.
  ignoredFields?: Iterable<string>;
};

// Match target rows to base rows by `target[key] === base.id`, then classify.
//   - base row with no target pointing at it            ⇒ removed
//   - target row with a null/absent key                  ⇒ added
//   - target whose key references a base row              ⇒ modified | unchanged
export function diffRows<T extends Row = Row>(
  base: T[],
  target: T[],
  { key, ignoredFields }: DiffRowsOptions
): DiffEntry<T>[] {
  const ignored = new Set<string>(BASE_IGNORED_FIELDS);
  for (const field of ignoredFields ?? []) ignored.add(field);

  const entries: DiffEntry<T>[] = [];

  // Index base rows by their id for O(1) lookup, and track which get matched.
  const baseById = new Map<string, T>();
  for (const row of base) {
    const id = row.id;
    if (typeof id === "string") baseById.set(id, row);
  }
  const matchedBaseIds = new Set<string>();

  for (const targetRow of target) {
    const sourceId = targetRow[key];
    const baseRow =
      typeof sourceId === "string" ? baseById.get(sourceId) : undefined;

    if (!baseRow) {
      // No base counterpart — a newly-added row.
      entries.push({ status: "added", before: null, after: targetRow });
      continue;
    }

    matchedBaseIds.add(baseRow.id as string);
    const changedFields = diffFields(baseRow, targetRow, ignored);
    const status: DiffStatus = changedFields ? "modified" : "unchanged";
    entries.push({
      status,
      before: baseRow,
      after: targetRow,
      ...(changedFields ? { changedFields } : {})
    });
  }

  // Any base row nothing pointed at was dropped from the target.
  for (const baseRow of base) {
    const id = baseRow.id;
    if (typeof id === "string" && !matchedBaseIds.has(id)) {
      entries.push({ status: "removed", before: baseRow, after: null });
    }
  }

  return entries;
}
