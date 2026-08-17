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

// Carbon treats '0', '' and NULL as "no revision" (see the generated
// readableIdWithRevision column), so all three are the initial revision.
export function isInitialRevision(
  revision: string | null | undefined
): boolean {
  return (
    revision === null ||
    revision === undefined ||
    revision === "" ||
    revision === "0"
  );
}

export interface ItemRevisionRow {
  revision: string | null;
  active: boolean | null;
  createdAt?: string | null;
}

/**
 * Which existing revision of a readableId a released Onshape revision applies to.
 *
 * Two different row sets on purpose:
 *
 * - "already-imported" is tested against EVERY sibling, active or not. An
 *   inactive sibling is a draft revision owned by an open change notice, and it
 *   still occupies item_unique (readableId, revision, companyId, type) — so
 *   ignoring it would turn a re-release into a 23505 that rolls the affected row
 *   back and leaves an empty change notice behind a marker claiming success.
 *   Matched on the RAW revision column, never readableIdWithRevision, because
 *   that column collapses '0' and '' and a numeric Onshape scheme would then be
 *   unable to distinguish revision "0" from the initial revision.
 *
 * - The SOURCE must be ACTIVE. Carbon's affected-item picker filters inactive
 *   items out entirely, so a human cannot raise a change notice on top of a
 *   draft revision; the importer must not either. Carbon deliberately allows
 *   same-part parallel notices, each raised against the live item.
 *
 * Ordering mirrors the sibling selection Phase 1 established for the BOM route:
 * named revisions before the initial one, then newest first.
 */
export function selectReleaseTarget<T extends ItemRevisionRow>(
  rows: T[],
  revision: string
):
  | { kind: "not-found" }
  | { kind: "already-imported" }
  | { kind: "revision"; item: T } {
  if (rows.length === 0) return { kind: "not-found" };
  if (rows.some((row) => row.revision === revision)) {
    return { kind: "already-imported" };
  }

  const active = rows.filter((row) => row.active === true);
  if (active.length === 0) return { kind: "not-found" };

  const sorted = [...active].sort((a, b) => {
    const aInitial = isInitialRevision(a.revision);
    const bInitial = isInitialRevision(b.revision);
    if (aInitial !== bInitial) return aInitial ? 1 : -1;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const item = sorted[0];
  return item ? { kind: "revision", item } : { kind: "not-found" };
}

// Escape LIKE/ILIKE wildcards so user-controlled values (part numbers, ids)
// match literally — an unescaped "_" would match any single character.
export function escapeLikePattern(value: string): string {
  return value.replace(
    /[\\%_]/g,
    (specialCharacter) => `\\${specialCharacter}`
  );
}
