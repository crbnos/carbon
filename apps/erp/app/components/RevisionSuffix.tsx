/**
 * Two-tone revision suffix for display. For plain strings (clipboard,
 * filenames, titles, emails) use the `@carbon/documents/utils` helpers instead.
 */
export function RevisionSuffix({ revisionId }: { revisionId?: number | null }) {
  if ((revisionId ?? 0) <= 0) return null;
  return <span className="text-muted-foreground">-{revisionId}</span>;
}

export default RevisionSuffix;
