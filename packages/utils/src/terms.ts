export type TermsVersionRow = {
  id: string;
  content: unknown; // tiptap JSONContent, untyped at this layer
  partyIds: string[] | null; // the counterparty ids this version is limited to
  countryCodes: string[] | null; // empty/null = not country-scoped
  effectiveFrom: string | null; // DATE string YYYY-MM-DD
  effectiveTo: string | null;
};

// Specificity tiers: named counterparty > country > global. A row scoped to
// somewhere/someone else is never eligible, even as a fallback.
const NOT_ELIGIBLE = -1;

function specificity(
  row: TermsVersionRow,
  partyId: string | null,
  countryCode: string | null
): number {
  if (row.partyIds && row.partyIds.length > 0) {
    return partyId && row.partyIds.includes(partyId) ? 2 : NOT_ELIGIBLE;
  }
  if (row.countryCodes && row.countryCodes.length > 0) {
    return countryCode &&
      row.countryCodes.some(
        (code) => code.toUpperCase() === countryCode.toUpperCase()
      )
      ? 1
      : NOT_ELIGIBLE;
  }
  return 0;
}

function pick<T extends TermsVersionRow>(
  rows: T[],
  partyId: string | null,
  countryCode: string | null
): T | null {
  let best: T | null = null;
  let bestSpecificity = NOT_ELIGIBLE;
  for (const row of rows) {
    const s = specificity(row, partyId, countryCode);
    if (s === NOT_ELIGIBLE) continue;
    if (
      best === null ||
      s > bestSpecificity ||
      (s === bestSpecificity &&
        ((row.effectiveFrom ?? "") > (best.effectiveFrom ?? "") ||
          ((row.effectiveFrom ?? "") === (best.effectiveFrom ?? "") &&
            row.id > best.id)))
    ) {
      best = row;
      bestSpecificity = s;
    }
  }
  return best;
}

/**
 * Resolve the terms version in effect for a counterparty on a date. Callers pass
 * the rows already filtered to the document type being printed.
 * Dates are compared as plain YYYY-MM-DD strings — never JS Date.
 *
 * Pass A: rows effective on `date` (null bounds are open-ended).
 * Pass B (quiet fallback): no row in effect — ignore `effectiveTo`, so an
 *         expired version with no successor keeps printing.
 * Pass C (quiet fallback): still nothing — ignore both bounds, so future-only
 *         versions still resolve. Printing is never blocked by a dating gap.
 */
export function resolveEffectiveTermsVersion<T extends TermsVersionRow>(
  rows: T[],
  scope: { partyId?: string | null; countryCode?: string | null },
  date: string
): T | null {
  const partyId = scope.partyId ?? null;
  const code = scope.countryCode ?? null;

  const inWindow = rows.filter(
    (r) =>
      (r.effectiveFrom === null || r.effectiveFrom <= date) &&
      (r.effectiveTo === null || r.effectiveTo >= date)
  );
  const passA = pick(inWindow, partyId, code);
  if (passA) return passA;

  const started = rows.filter(
    (r) => r.effectiveFrom === null || r.effectiveFrom <= date
  );
  const passB = pick(started, partyId, code);
  if (passB) return passB;

  return pick(rows, partyId, code);
}
