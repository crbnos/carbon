/**
 * The one definition of the revision suffix: `PO000123-1`. Revision 0 stays
 * bare, and a missing id yields "" rather than a stray "-1".
 */
export function withRevisionSuffix(
  readableId?: string | null,
  revisionId?: number | null
) {
  if (!readableId) return "";
  return (revisionId ?? 0) > 0 ? `${readableId}-${revisionId}` : readableId;
}
