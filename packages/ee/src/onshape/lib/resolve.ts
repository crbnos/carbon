// Re-resolving a picker selection against Onshape before Carbon acts on it.
//
// The v2 create and link flows both receive an Onshape selection as form data,
// which means the client controls it. Trusting `partNumber` / `revision` from a
// POST would let anyone mint a Carbon item under any part number and stamp it
// with an Onshape mapping it never earned — the exact class of problem the
// hidden mapping exists to eliminate.
//
// So the identity is re-fetched from Onshape and every field the client sent is
// checked against it. Onshape is authoritative in fact, not merely by
// convention, and the values Carbon persists come from the API response rather
// than from the request body.

import type { OnshapeClient, OnshapeRevision } from "./client";

export type ResolveRevisionRequest = {
  onshapeCompanyId: string;
  partNumber: string;
  /** Numeric: 0 Part Studio, 1 Assembly, 2 Drawing. */
  elementType: number;
  revision: string;
  documentId: string;
  versionId: string;
  elementId: string;
  partId?: string | null;
};

export type ResolveRevisionResult =
  | { ok: true; revision: OnshapeRevision }
  | { ok: false; reason: ResolveRevisionFailure; message: string };

export type ResolveRevisionFailure =
  | "drawing-element"
  | "revision-not-found"
  | "obsolete"
  | "lookup-failed";

// A released drawing is its own DRW-xxxx element sharing the number of the
// model it documents. Its PDF attaches to the MODEL item; a DRW- item is never
// created. Refuse it here as well as in the picker, so a hand-posted form
// cannot reach the item-creation path with one.
const ELEMENT_TYPE_DRAWING = 2;

function sameId(a: string | null | undefined, b: string | null | undefined) {
  // Onshape omits partId for assemblies and may send null or "" for it; treat
  // all three as "no part", so a subassembly never fails verification over a
  // representational difference.
  return (a ?? "") === (b ?? "");
}

/**
 * Verify a client-supplied Onshape selection against Onshape itself.
 *
 * Returns the API's own revision record on success — callers should persist
 * THAT, never the request body.
 */
export async function resolveOnshapeRevision(
  client: OnshapeClient,
  request: ResolveRevisionRequest
): Promise<ResolveRevisionResult> {
  if (request.elementType === ELEMENT_TYPE_DRAWING) {
    return {
      ok: false,
      reason: "drawing-element",
      message:
        "Drawings are attached to the part they document rather than imported as their own item."
    };
  }

  let revisions: OnshapeRevision[];
  try {
    const response = await client.getRevisions(
      request.onshapeCompanyId,
      request.partNumber,
      request.elementType
    );
    revisions = response.items ?? [];
  } catch (error) {
    // Rethrow rate limits untouched — callers convert them into a retry, and
    // flattening one into "not found" would look like a missing part.
    if (error instanceof Error && "status" in error && error.status === 429) {
      throw error;
    }
    return {
      ok: false,
      reason: "lookup-failed",
      message:
        error instanceof Error
          ? error.message
          : "Could not read this revision from Onshape"
    };
  }

  // Every component must agree. Matching on revision alone would accept a
  // selection whose document/element had been swapped for another part's.
  const match = revisions.find(
    (candidate) =>
      candidate.revision === request.revision &&
      candidate.documentId === request.documentId &&
      candidate.versionId === request.versionId &&
      candidate.elementId === request.elementId &&
      sameId(candidate.partId, request.partId)
  );

  if (!match) {
    return {
      ok: false,
      reason: "revision-not-found",
      message:
        "That revision no longer matches anything in Onshape. It may have been superseded — reopen the picker and choose again."
    };
  }

  if (match.isObsolete) {
    return {
      ok: false,
      reason: "obsolete",
      message: "That revision is marked obsolete in Onshape."
    };
  }

  return { ok: true, revision: match };
}
