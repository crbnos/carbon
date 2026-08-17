/**
 * Appends a document's revision suffix to its readable id: `PO000123-1`.
 * Revision 0 is the original and stays bare, and a missing id yields "" rather
 * than a stray "-1".
 *
 * This is the one place the suffix format is defined — the per-document helpers
 * (`getPurchaseOrderDisplayId`, `getQuoteDisplayId`) delegate here, as does any
 * caller holding a readable id and revision generically (e.g. the document
 * template editor's preview-record picker, which reads both from a view row).
 */
export function withRevisionSuffix(
  readableId?: string | null,
  revisionId?: number | null
) {
  if (!readableId) return "";
  return (revisionId ?? 0) > 0 ? `${readableId}-${revisionId}` : readableId;
}
