// Single source of truth for the supersession swap — should a component be
// replaced by its successor — shared by the MRP engine (planning / demand) and
// the get-method edge function (job creation) so the two can never disagree.
//
// All dates are ISO "YYYY-MM-DD" strings. Lexicographic comparison is exact for
// that format and equivalent to a calendar-date compare, so no date library is
// needed (and the two callers stay byte-for-byte consistent).

export type SupersessionRow = {
  itemId: string;
  supersessionMode: string;
  successorItemId: string | null;
  successorEffectivityDate: string | null;
  conversionFactor: number | string | null;
};

export type Redirect = { to: string; factor: number };

// Only these phase-out modes redirect demand to the successor. Stock Only keeps
// its successor as a reference (reserve-governed, no redirect); No Stock has no
// successor. Must match the mode gating in mrp/index.ts.
const REDIRECTING_MODES = new Set(["Consume First", "Prefer New"]);

// Build `oldItemId -> { successor, cumulative factor }` for every item whose
// supersession is *effective* as of `asOfDate`, collapsing multi-hop chains
// (A->B->C becomes A->C with the product of the conversion factors), cycle-safe.
//
// The caller decides what `asOfDate` means for its context:
//   - MRP demand redirect : today (is the part being phased out right now)
//   - job creation        : the job's build date (start date)
//
// This mirrors the redirectByItem construction + chain collapse in mrp/index.ts.
export function buildSupersessionRedirectMap(
  supersessions: SupersessionRow[],
  asOfDate: string
): Map<string, Redirect> {
  const byItem = new Map<string, SupersessionRow>();
  for (const s of supersessions) {
    byItem.set(s.itemId, s);
  }

  const redirect = new Map<string, Redirect>();
  for (const [oldItemId, sup] of byItem) {
    if (!sup.successorItemId) continue;
    if (!REDIRECTING_MODES.has(sup.supersessionMode)) continue;
    const effective =
      !sup.successorEffectivityDate || sup.successorEffectivityDate <= asOfDate;
    if (!effective) continue;
    redirect.set(oldItemId, {
      to: sup.successorItemId,
      factor: Number(sup.conversionFactor ?? 1) || 1,
    });
  }

  // Collapse multi-hop chains, multiplying factors along the way, cycle-safe.
  for (const oldId of [...redirect.keys()]) {
    const start = redirect.get(oldId)!;
    let to = start.to;
    let factor = start.factor;
    const seen = new Set<string>([oldId]);
    while (redirect.has(to) && !seen.has(to)) {
      seen.add(to);
      const next = redirect.get(to)!;
      factor *= next.factor;
      to = next.to;
    }
    redirect.set(oldId, { to, factor });
  }

  return redirect;
}
