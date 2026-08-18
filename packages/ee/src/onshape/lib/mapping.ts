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

// NOTE: these two are `type` aliases, not interfaces, on purpose. Both are
// written straight into a jsonb column, and the generated `Json` type requires
// an index signature — a type alias gets one implicitly, an interface does not,
// so making these interfaces breaks .insert() overload resolution.

/**
 * Metadata stored on the `onshapeElement` row.
 *
 * This is where the VOLATILE Onshape state lives, and keeping it here is what
 * lets `item.revision` stay clean. An unreleased sync has no Onshape revision
 * to record, so it targets Carbon's initial revision ('0') and marks itself
 * here instead of inventing a revision string that would leak into documents,
 * POs, accounting sync and CSV exports.
 */
export type OnshapeElementMappingMetadata = {
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
};

/** Metadata stored on the `onshapeRevision` row. */
export type OnshapeRevisionMappingMetadata = {
  /** The revision LETTER (e.g. "A"), as opposed to the revisionId key. */
  revision?: string;
  releaseId?: string;
  releaseName?: string;
  documentId?: string;
  versionId?: string;
  elementId?: string;
  importedAt?: string;
};

// ---------------------------------------------------------------------------
// Data access
//
// Type-only imports below, so this module still loads without pulling in a
// database client — the pure helpers above stay unit-testable.
//
// RLS on externalIntegrationMapping has SELECT and INSERT policies ONLY: no
// UPDATE, no DELETE (20260204001831). A PostgREST UPDATE from a user-scoped
// client matches zero rows and returns { data: [], error: null } — no error, no
// signal. So every WRITE here demands a service-role client, and the parameter
// is named `serviceRole` to make a wrong client obvious at the call site.
// ---------------------------------------------------------------------------

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ElementMappingRow {
  itemId: string;
  ref: OnshapeElementRef;
  metadata: OnshapeElementMappingMetadata;
  lastSyncedAt: string | null;
}

/**
 * Every Carbon item mapped to a given CAD thing.
 *
 * Returns MANY by design: `onshapeElement` rows carry
 * allowDuplicateExternalId = true because one Onshape part legitimately maps to
 * every Carbon revision of that part. Use `readItemIdForRevision` when you need
 * the single item for one specific released revision.
 */
export async function readItemIdsForElement(
  client: SupabaseClient<Database>,
  args: { companyId: string; ref: OnshapeElementRef }
): Promise<string[]> {
  const externalId = buildElementExternalId(args.ref);

  const result = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("integration", ONSHAPE_ELEMENT_INTEGRATION)
    .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
    .eq("externalId", externalId)
    .eq("companyId", args.companyId);

  // An unchecked error here would read as "no mapping exists" and send the
  // caller down the create-a-new-item path, which is how v1 built parallel
  // item trees. Fail loudly instead.
  if (result.error) {
    throw new Error(
      `Failed to read Onshape element mapping: ${result.error.message}`
    );
  }

  return (result.data ?? []).map((row) => row.entityId);
}

/** The Carbon item for one specific released Onshape revision, if linked. */
export async function readItemIdForRevision(
  client: SupabaseClient<Database>,
  args: { companyId: string; revisionId: string }
): Promise<string | null> {
  const result = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("integration", ONSHAPE_REVISION_INTEGRATION)
    .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
    .eq("externalId", args.revisionId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (result.error) {
    throw new Error(
      `Failed to read Onshape revision mapping: ${result.error.message}`
    );
  }

  return result.data?.entityId ?? null;
}

/**
 * The element mappings for a set of Carbon items, keyed by item id.
 *
 * One query for the whole set — the BOM import resolves an entire tree at once,
 * and a per-item lookup there is the N+1 the repo bans outright.
 */
export async function readElementMappingsForItems(
  client: SupabaseClient<Database>,
  args: { companyId: string; itemIds: string[] }
): Promise<Map<string, ElementMappingRow>> {
  const mappings = new Map<string, ElementMappingRow>();
  if (args.itemIds.length === 0) return mappings;

  // PostgREST builds .in() into the URL, so an unbounded list eventually
  // exceeds the request line and fails as a malformed request rather than as
  // "too many ids". Chunk it.
  const CHUNK = 200;
  for (let index = 0; index < args.itemIds.length; index += CHUNK) {
    const chunk = args.itemIds.slice(index, index + CHUNK);

    const result = await client
      .from("externalIntegrationMapping")
      .select("entityId, externalId, metadata, lastSyncedAt")
      .eq("integration", ONSHAPE_ELEMENT_INTEGRATION)
      .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
      .eq("companyId", args.companyId)
      .in("entityId", chunk);

    if (result.error) {
      throw new Error(
        `Failed to read Onshape element mappings: ${result.error.message}`
      );
    }

    for (const row of result.data ?? []) {
      const ref = parseElementExternalId(row.externalId);
      if (!ref) continue; // malformed id: skip rather than half-match
      mappings.set(row.entityId, {
        itemId: row.entityId,
        ref,
        metadata: (row.metadata ?? {}) as OnshapeElementMappingMetadata,
        lastSyncedAt: row.lastSyncedAt
      });
    }
  }

  return mappings;
}

/**
 * Link a Carbon item to a CAD thing, replacing any existing link for that item.
 *
 * `UNIQUE (entityType, entityId, integration, companyId)` is ALWAYS enforced —
 * one row per item per integration — so re-linking is delete-then-insert rather
 * than an upsert. Both statements need the service role (no UPDATE/DELETE RLS
 * policy exists), and they are not atomic: a crash between them leaves the item
 * unlinked, which the next link or import re-establishes. That is deliberately
 * the safe direction to fail — an absent mapping is recoverable, a mapping
 * pointing at the WRONG element is not.
 */
export async function writeElementMapping(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    itemId: string;
    ref: OnshapeElementRef;
    metadata: OnshapeElementMappingMetadata;
    createdBy: string;
  }
): Promise<void> {
  const externalId = buildElementExternalId(args.ref);

  const removed = await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", ONSHAPE_ELEMENT_INTEGRATION)
    .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
    .eq("entityId", args.itemId)
    .eq("companyId", args.companyId);

  if (removed.error) {
    throw new Error(
      `Failed to clear Onshape element mapping: ${removed.error.message}`
    );
  }

  const inserted = await serviceRole.from("externalIntegrationMapping").insert({
    entityType: ONSHAPE_MAPPING_ENTITY_TYPE,
    entityId: args.itemId,
    integration: ONSHAPE_ELEMENT_INTEGRATION,
    externalId,
    // One CAD part maps to every Carbon revision of that part, so the
    // partial unique index on externalId must NOT apply here.
    allowDuplicateExternalId: true,
    metadata: args.metadata,
    lastSyncedAt: new Date().toISOString(),
    createdBy: args.createdBy,
    companyId: args.companyId
  });

  if (inserted.error) {
    throw new Error(
      `Failed to write Onshape element mapping: ${inserted.error.message}`
    );
  }
}

/**
 * Record which Onshape release produced a Carbon item revision.
 *
 * Enforced 1:1 (`allowDuplicateExternalId: false`), so a second item claiming
 * the same revisionId raises 23505. That is the constraint doing its job —
 * report it rather than swallowing it, because the alternative is two Carbon
 * items silently claiming one Onshape release.
 */
export async function writeRevisionMapping(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    itemId: string;
    revisionId: string;
    metadata: OnshapeRevisionMappingMetadata;
    createdBy: string;
  }
): Promise<{ ok: true } | { ok: false; conflict: boolean; error: string }> {
  // Replace THIS item's own provenance row first. The always-enforced
  // UNIQUE (entityType, entityId, integration, companyId) means re-linking an
  // item to a NEWER release would otherwise 23505 against itself — which reads
  // as "another item claims this release" and is a different problem entirely.
  const removed = await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", ONSHAPE_REVISION_INTEGRATION)
    .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
    .eq("entityId", args.itemId)
    .eq("companyId", args.companyId);

  if (removed.error) {
    return {
      ok: false,
      conflict: false,
      error: `Failed to clear the previous Onshape revision link: ${removed.error.message}`
    };
  }

  const inserted = await serviceRole.from("externalIntegrationMapping").insert({
    entityType: ONSHAPE_MAPPING_ENTITY_TYPE,
    entityId: args.itemId,
    integration: ONSHAPE_REVISION_INTEGRATION,
    externalId: args.revisionId,
    allowDuplicateExternalId: false,
    metadata: args.metadata,
    lastSyncedAt: new Date().toISOString(),
    createdBy: args.createdBy,
    companyId: args.companyId
  });

  if (inserted.error) {
    return {
      ok: false,
      conflict: inserted.error.code === "23505",
      error: inserted.error.message
    };
  }

  return { ok: true };
}

/**
 * Resolve many CAD things to their Carbon items in one query.
 *
 * The BOM import resolves a whole tree at once; a per-row lookup there is the
 * N+1 the repo bans outright. Returns externalId -> itemIds, and an entry is
 * absent rather than empty when nothing is mapped.
 */
export async function readItemIdsForElements(
  client: SupabaseClient<Database>,
  args: { companyId: string; refs: OnshapeElementRef[] }
): Promise<Map<string, string[]>> {
  const byExternalId = new Map<string, string[]>();
  if (args.refs.length === 0) return byExternalId;

  const externalIds = Array.from(
    new Set(args.refs.map((ref) => buildElementExternalId(ref)))
  );

  const CHUNK = 200;
  for (let index = 0; index < externalIds.length; index += CHUNK) {
    const chunk = externalIds.slice(index, index + CHUNK);

    const result = await client
      .from("externalIntegrationMapping")
      .select("entityId, externalId")
      .eq("integration", ONSHAPE_ELEMENT_INTEGRATION)
      .eq("entityType", ONSHAPE_MAPPING_ENTITY_TYPE)
      .eq("companyId", args.companyId)
      .in("externalId", chunk);

    if (result.error) {
      throw new Error(
        `Failed to resolve Onshape element mappings: ${result.error.message}`
      );
    }

    for (const row of result.data ?? []) {
      if (!row.externalId) continue;
      const existing = byExternalId.get(row.externalId);
      if (existing) existing.push(row.entityId);
      else byExternalId.set(row.externalId, [row.entityId]);
    }
  }

  return byExternalId;
}
