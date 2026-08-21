// Which revision letter an `onshape.revision.created` delivery is about.
//
// THE WEBHOOK DOES NOT CARRY THE LETTER. This is the whole reason this file
// exists, and it is worth stating flatly because the opposite was assumed for
// most of v2's life. A real delivery, captured live 2026-08-21 from a 9-element
// release of RD-410:
//
//   { companyId, documentId, elementId, elementType: 1, groupKey, messageId,
//     partNumber: "RD-410", releaseId, revisionId: "6a885b9b…", userId,
//     versionId }
//
// No `revision`. No `releaseName`. Both are declared optional on the envelope
// and both are simply absent, so `payload.revision ?? ""` was empty on every
// genuine release and the job skipped all nine events with
// `revision-missing-from-event`. The synthetic events used in testing DID carry
// a revision, which is exactly why the assumption survived so long — the smoke
// payload was written from the schema rather than from a real delivery.
//
// `revisionId` IS carried, and it identifies the released revision on its own:
//
//   GET /api/v10/revisions/{revisionId}
//   → { partNumber: "RD-410", revision: "D", elementType: 1, releaseId: … }
//
// So the letter is one lookup away. Resolution order is event first, API
// second: a caller that already knows the letter (the backfill, a replayed
// event, a test) must not pay for a call, and Onshape adding the field later
// should silently become the fast path rather than a behaviour change.

export interface OnshapeReleasedRevisionSource {
  /** The letter, when the caller or a future Onshape payload supplies one. */
  revision?: string | null;
  /** The id the webhook always carries. */
  revisionId?: string | null;
}

/**
 * Resolve the released revision LETTER for a delivery.
 *
 * Returns `""` when it cannot be determined — the caller decides what that
 * means. It is never guessed at: an empty letter resolves a revision family to
 * its revision-'0' member, which would stamp released geometry onto the item
 * that predates every release.
 *
 * `readRevision` is injected rather than taking an `OnshapeClient` so the rule
 * is unit-testable without booting one, and so the caller keeps ownership of
 * rate-limit retries.
 */
export async function resolveReleasedRevision(
  source: OnshapeReleasedRevisionSource,
  readRevision: (
    revisionId: string
  ) => Promise<{ revision?: string | null } | null | undefined>
): Promise<string> {
  const fromEvent = source.revision?.trim();
  if (fromEvent) return fromEvent;

  const revisionId = source.revisionId?.trim();
  if (!revisionId) return "";

  const revision = await readRevision(revisionId);
  return revision?.revision?.trim() ?? "";
}
