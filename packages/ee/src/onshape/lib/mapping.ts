// The Onshape v2 identity contract: how a Carbon item is joined to an Onshape
// part or subassembly WITHOUT part-number string matching.
//
// v1 matched on `item.readableIdWithRevision === partNumber[.revision]`. That
// made a hand-typed string the join key, which is why a lowercase part number,
// a renamed BOM column, or two elements sharing a part number all fail — some
// of them silently. v2 stores the join in `externalIntegrationMapping` and
// never consults the part number again.
//
// Two levels, because the two systems slice identity differently: an Onshape
// element/part id identifies a thing ACROSS all its revisions, while a Carbon
// `item` row IS one revision.
//
//   onshapeElement  -> which CAD thing this Carbon item is. Repeats across the
//                      revisions of one part, so allowDuplicateExternalId=true.
//   onshapeRevision -> which Onshape release produced this Carbon item
//                      revision. Enforced 1:1 (allowDuplicateExternalId=false).
//
// Both live on the one `externalIntegrationMapping` table.
// `UNIQUE (entityType, entityId, integration, companyId)` is ALWAYS enforced,
// which is why these are two `integration` values rather than two columns on
// one row. The partial
// `UNIQUE (integration, externalId, entityType, companyId) WHERE allowDuplicateExternalId = false`
// is what makes the revision link a real constraint rather than a convention.
//
// Kept free of heavy imports (no auth/inngest/env at module load) so the pure
// half stays unit-testable — see mapping.test.ts.

/** `integration` value for the durable item -> CAD-thing link. */
export const ONSHAPE_ELEMENT_INTEGRATION = "onshapeElement";

/** `integration` value for the item-revision -> Onshape-release link. */
export const ONSHAPE_REVISION_INTEGRATION = "onshapeRevision";

/** `entityType` both mapping shapes use. */
export const ONSHAPE_MAPPING_ENTITY_TYPE = "item";

/**
 * What a BOM row / picker selection points at.
 *
 * A subassembly IS an element, so `(documentId, elementId)` addresses it.
 * A part is one solid body INSIDE a Part Studio, and `partId` is scoped to that
 * element rather than globally unique — so a part is always the triple. This
 * asymmetry is the reason an element-level link alone is not sufficient: a Part
 * Studio holding five parts is one element but five Carbon items (and an
 * element-level GLTF export returns all five bodies in one file).
 */
export interface OnshapeElementRef {
  documentId: string;
  elementId: string;
  /** Present for a part inside a Part Studio; absent for a subassembly. */
  partId?: string | null;
}

// Onshape document/element ids are 24-char hex and partIds are short
// alphanumerics, so a ":" separator is collision-free in practice. Components
// are still encoded rather than trusted: the id is a uniqueness constraint, and
// "in practice" is not a guarantee worth a silent cross-part collision.
// encodeURIComponent leaves alphanumerics untouched, so real ids stay readable.
const SEPARATOR = ":";

/**
 * The `externalId` for an `onshapeElement` mapping row.
 *
 * `{documentId}:{elementId}` for a subassembly,
 * `{documentId}:{elementId}:{partId}` for a part.
 *
 * Deliberately positional and open-ended: a configuration component can be
 * appended later without invalidating ids already written (parse tolerates
 * extra components).
 */
export function buildElementExternalId(ref: OnshapeElementRef): string {
  if (!ref.documentId || !ref.elementId) {
    throw new Error(
      "buildElementExternalId requires both documentId and elementId"
    );
  }

  const parts = [ref.documentId, ref.elementId];
  if (ref.partId) parts.push(ref.partId);

  return parts.map(encodeURIComponent).join(SEPARATOR);
}

/**
 * Inverse of `buildElementExternalId`. Returns null for anything that is not a
 * well-formed element id, so a malformed row is skipped rather than matched
 * against a half-parsed key.
 */
export function parseElementExternalId(
  externalId: string | null | undefined
): OnshapeElementRef | null {
  if (!externalId) return null;

  const parts = externalId.split(SEPARATOR);
  if (parts.length < 2) return null;

  let decoded: string[];
  try {
    decoded = parts.map(decodeURIComponent);
  } catch {
    // A stray "%" makes decodeURIComponent throw (URIError). Treat it as
    // malformed rather than letting it escape to the caller.
    return null;
  }

  const [documentId, elementId, partId] = decoded;
  if (!documentId || !elementId) return null;

  return { documentId, elementId, partId: partId || null };
}

/**
 * Are these the same CAD thing? Compares through the canonical id so that a
 * null partId and an absent partId can never be treated as different things.
 */
export function isSameElementRef(
  a: OnshapeElementRef,
  b: OnshapeElementRef
): boolean {
  return buildElementExternalId(a) === buildElementExternalId(b);
}

/**
 * Metadata stored on the `onshapeElement` row.
 *
 * This is where the VOLATILE Onshape state lives, and keeping it here is what
 * lets `item.revision` stay clean. An unreleased sync has no Onshape revision
 * to record, so it targets Carbon's initial revision ('0') and marks itself
 * here instead of inventing a revision string that would leak into documents,
 * POs, accounting sync and CSV exports.
 */
export interface OnshapeElementMappingMetadata {
  /** Numeric Onshape elementType: 0 Part Studio, 1 Assembly, 2 Drawing. */
  elementType?: number;
  /** The version this item was last synced FROM. */
  versionId?: string;
  versionName?: string;
  /** Onshape's part number at last sync — a label for display, never a key. */
  partNumber?: string;
  /** True when the last sync came from a version that was never released. */
  fromUnreleasedVersion?: boolean;
  lastSyncedAt?: string;
}

/** Metadata stored on the `onshapeRevision` row. */
export interface OnshapeRevisionMappingMetadata {
  /** The revision LETTER (e.g. "A"), as opposed to the revisionId key. */
  revision?: string;
  releaseId?: string;
  releaseName?: string;
  documentId?: string;
  versionId?: string;
  elementId?: string;
  importedAt?: string;
}
