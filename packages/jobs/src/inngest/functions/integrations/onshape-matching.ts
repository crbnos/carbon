// Pure helpers that form the Onshape→Carbon matching contract: how a released
// Onshape revision resolves to a Carbon item. Kept free of heavy imports
// (no inngest/auth/env at module load) so they stay unit-testable — see
// onshape-matching.test.ts.

// Carbon's readableIdWithRevision == readableId when revision is empty/'0', else
// readableId + '.' + revision. Onshape's partNumber/revision map 1:1 to those.
export function releaseKey(
  partNumber: string,
  revision: string | null | undefined
): string {
  return revision && revision !== "0"
    ? `${partNumber}.${revision}`
    : partNumber;
}

// A released drawing is its OWN element (DRW-xxxx) sharing the number of the
// model it documents (PRT-xxxx / ASM-xxxx). Strip the leading letter prefix to
// get the shared suffix (e.g. "DRW-002033" -> "-002033"), used to find the model
// item a drawing PDF should attach to (works for both parts and assemblies).
// The suffix MUST start with a non-alphanumeric separator: it is used as the
// tail of a LIKE pattern, and the separator is what anchors it so "-002033"
// can't match "PRT-1002033". A part number with no letter prefix or no
// separator (e.g. "002033") has no safe anchor — return "" so callers skip it.
export function sharedNumberSuffix(partNumber: string): string {
  const suffix = partNumber.replace(/^[A-Za-z]+/, "");
  if (suffix === partNumber || /^[A-Za-z0-9]/.test(suffix)) {
    return "";
  }
  return suffix;
}

// Escape LIKE/ILIKE wildcards so user-controlled values (part numbers, ids)
// match literally — an unescaped "_" would match any single character.
export function escapeLikePattern(value: string): string {
  return value.replace(
    /[\\%_]/g,
    (specialCharacter) => `\\${specialCharacter}`
  );
}

// --- Matching from the ITEM side (the per-item re-pull) ----------------------
// The two triggers above start from a release and look for its item. The
// per-item re-pull starts from the item and looks for its release, so the same
// contract is applied in reverse. Both decisions live here (rather than beside
// the job) to stay loadable without the Inngest client — see the header.

export interface OnshapeItemRevisionTarget {
  readableId: string;
  revision: string | null;
  /** Carbon's generated readableId+revision key; recomputed when absent. */
  readableIdWithRevision?: string | null;
}

// An item's release key is its readableIdWithRevision, which is exactly
// releaseKey(readableId, revision) — so a release matches when its own key is
// equal.
export function itemReleaseKey(item: OnshapeItemRevisionTarget): string {
  return (
    item.readableIdWithRevision ?? releaseKey(item.readableId, item.revision)
  );
}

// A released revision as the revisions API reports it. Structural (not the
// OnshapeRevision interface) so this module keeps its zero runtime imports.
export interface ReleasedRevisionCandidate {
  partNumber: string;
  revision: string;
  elementType: number;
  isObsolete?: boolean;
}

// Which released revision (if any) belongs to this item. Three filters, all of
// them load-bearing:
//   - element type: 0 = Part Studio, 1 = Assembly carry a model; a drawing
//     released under the same number (2) is not one;
//   - isObsolete: an obsoleted revision is no longer released, so re-pulling it
//     would attach superseded geometry;
//   - release key: the revision LETTER has to be the item's revision. An item at
//     rev A never silently receives rev B's geometry — in Carbon that is a
//     different item.
// No match is a legitimate outcome (nothing released for this exact revision),
// never a retry: the answer would not change on a second call.
export function selectRevisionForItem<
  TRevision extends ReleasedRevisionCandidate
>(revisions: TRevision[], item: OnshapeItemRevisionTarget): TRevision | null {
  const wantedReleaseKey = itemReleaseKey(item);
  return (
    revisions.find(
      (revision) =>
        !revision.isObsolete &&
        (revision.elementType === 0 || revision.elementType === 1) &&
        releaseKey(revision.partNumber, revision.revision) === wantedReleaseKey
    ) ?? null
  );
}

// The persisted locator a drawing re-pull runs from. Drawings release under
// their OWN part numbers, so the revisions API can never find one from the
// item's part number — a re-pull re-exports the element a previous sync
// recorded, or does nothing.
export interface OnshapeDrawingIdentifiers {
  documentId: string;
  versionId: string;
  elementId: string;
  partNumber: string | null;
  revision: string | null;
  releaseState: string | null;
}

export interface OnshapeDrawingStateRow {
  documentId: string | null;
  versionId: string | null;
  elementId: string | null;
  partNumber: string | null;
  revision: string | null;
  releaseState: string | null;
}

// The drawing arm's gate: all three identifiers or nothing. A partial locator
// cannot address an Onshape element, and a state row written by a sync that
// skipped before resolving one carries none of them.
export function drawingIdentifiersFromState(
  row: OnshapeDrawingStateRow | null | undefined
): OnshapeDrawingIdentifiers | null {
  if (!row?.documentId || !row.versionId || !row.elementId) {
    return null;
  }
  return {
    documentId: row.documentId,
    versionId: row.versionId,
    elementId: row.elementId,
    partNumber: row.partNumber,
    revision: row.revision,
    releaseState: row.releaseState
  };
}
