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
