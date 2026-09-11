export type RampKeysetCursor = {
  updatedAt: string;
  id: string | null;
};

type CursorRow = {
  id: string;
  updatedAt: string;
};

/**
 * Store a two-column keyset in the existing string metadata slot, allowing the
 * atomic single-key metadata patch to persist both values together.
 */
export function encodeRampKeysetCursor(
  cursor: Omit<RampKeysetCursor, "id"> & { id: string }
): string {
  return JSON.stringify([cursor.updatedAt, cursor.id]);
}

/**
 * Old installations hold a bare timestamp. Treat that as an inclusive
 * timestamp cursor (`id: null`) so rows tied at the old high-water mark replay
 * once and are then replaced by the stable composite representation.
 */
export function decodeRampKeysetCursor(
  stored: string | null | undefined
): RampKeysetCursor | null {
  if (!stored) return null;
  if (stored.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "string" &&
        typeof parsed[1] === "string" &&
        parsed[0] &&
        parsed[1]
      ) {
        return { updatedAt: parsed[0], id: parsed[1] };
      }
    } catch {
      // Fall through: malformed composite values fail closed as legacy text.
    }
  }
  return { updatedAt: stored, id: null };
}

export function rampKeysetFilter(
  cursor: RampKeysetCursor
): { operator: "gte"; value: string } | { operator: "or"; value: string } {
  if (!cursor.id) return { operator: "gte", value: cursor.updatedAt };
  return {
    operator: "or",
    value: `updatedAt.gt.${cursor.updatedAt},and(updatedAt.eq.${cursor.updatedAt},id.gt.${cursor.id})`
  };
}

/** Advance only across the contiguous successful prefix of the fetched page. */
export function nextRampKeysetCursor(
  rows: readonly CursorRow[],
  failedIds: ReadonlySet<string>
): { updatedAt: string; id: string } | null {
  let lastSuccessful: CursorRow | null = null;
  for (const row of rows) {
    if (failedIds.has(row.id)) break;
    lastSuccessful = row;
  }
  return lastSuccessful;
}
