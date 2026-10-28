// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

const MAX_LIST_ITEMS = 5;
const MAX_STRING_LENGTH = 256;
const MAX_OBJECT_KEYS = 20;
const MAX_DEPTH = 5;

/** Shrinks a stored payload to a readable summary once it is past the full-detail
 * window. Markers follow util.inspect's convention — a silently-shortened value
 * reads as a complete one, which is the failure mode this exists to avoid. */
export function compactForLog(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "… nested value removed";

  if (typeof value === "string") {
    if (value.length <= MAX_STRING_LENGTH) return value;
    const dropped = value.length - MAX_STRING_LENGTH;
    return `${value.slice(0, MAX_STRING_LENGTH)}… ${dropped} more characters`;
  }

  if (Array.isArray(value)) {
    const kept = value
      .slice(0, MAX_LIST_ITEMS)
      .map((item) => compactForLog(item, depth + 1));
    if (value.length <= MAX_LIST_ITEMS) return kept;
    return [...kept, `… ${value.length - MAX_LIST_ITEMS} more items`];
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // An entity RuntimeValue is a type plus an id — already minimal. Its optional
    // inline `row` is the only heavy part, and it is not worth keeping.
    if (record.kind === "entity") {
      return { kind: record.kind, of: record.of, id: record.id };
    }
    // An object shrinks by its FIELDS. Its `of` is the declared type, not data —
    // left to the generic branch it would be compacted as a nested payload and
    // roughly double what the log keeps, while burying the values a reader wants.
    if (
      record.kind === "record" &&
      record.fields !== null &&
      typeof record.fields === "object"
    ) {
      return {
        kind: "record",
        fields: compactKeys(record.fields as Record<string, unknown>, depth)
      };
    }
    // Named rows shrink like a list: cap the entries, recurse into each value.
    if (record.kind === "pairs" && Array.isArray(record.entries)) {
      const rows = record.entries as Record<string, unknown>[];
      const kept = rows.slice(0, MAX_LIST_ITEMS).map((row) => ({
        name: row?.name,
        value: compactForLog(row?.value, depth + 1)
      }));
      return {
        kind: "pairs",
        entries:
          rows.length <= MAX_LIST_ITEMS
            ? kept
            : [
                ...kept,
                {
                  name: "…",
                  value: `… ${rows.length - MAX_LIST_ITEMS} more items`
                }
              ]
      };
    }
    return compactKeys(record, depth);
  }

  return value;
}

/** An object's first MAX_OBJECT_KEYS keys, each compacted, plus a marker for the
 * rest. Shared by a plain object and a record value's fields. */
function compactKeys(
  source: Record<string, unknown>,
  depth: number
): Record<string, unknown> {
  const entries = Object.entries(source);
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of entries.slice(0, MAX_OBJECT_KEYS)) {
    kept[key] = compactForLog(entry, depth + 1);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    kept["…"] = `${entries.length - MAX_OBJECT_KEYS} more keys`;
  }
  return kept;
}
