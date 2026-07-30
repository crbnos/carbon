/**
 * Component-name similarity for BOM auto-matching ("Match BOM" — pairing a CAD
 * geometry group with a BOM item by name, see `autoMatchAssemblyComponents`).
 *
 * Unit GROUPING no longer lives here: the geometry planner auto-detects detail
 * swarms (a populated PCB's hundreds of tiny components on a board) from pure
 * geometry — see `detect_swarm_units` in `crates/planner` — and user-authored
 * "plan as one component" overrides ride `assemblyUnit` rows straight to the
 * planner's `options.units`.
 */

/** Lowercase alphanumeric+dot tokens (drops punctuation/whitespace). */
export function tokenizeName(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9.]+/)
      .filter((token) => token.length > 0)
  );
}

/** Jaccard overlap of two names' token sets, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const tokensA = tokenizeName(a);
  const tokensB = tokenizeName(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  return shared / (tokensA.size + tokensB.size - shared);
}
