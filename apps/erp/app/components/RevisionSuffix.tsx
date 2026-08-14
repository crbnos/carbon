/**
 * The `-1` that marks a revised document (quote or purchase order), rendered
 * muted so the base number stays the thing the eye lands on. Renders nothing
 * for revision 0 — the original is displayed bare.
 *
 * For plain strings (clipboard, filenames, modal titles, emails) use
 * `getQuoteDisplayId` / `getPurchaseOrderDisplayId` from `@carbon/documents/utils`
 * instead; this component exists only for the two-tone display.
 */
export function RevisionSuffix({ revisionId }: { revisionId?: number | null }) {
  if ((revisionId ?? 0) <= 0) return null;
  return <span className="text-muted-foreground">-{revisionId}</span>;
}

export default RevisionSuffix;
