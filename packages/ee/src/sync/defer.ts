/**
 * Waiting for another engine's mapping, without calling it.
 *
 * A spend push sometimes needs an identifier only another sync run can produce:
 * an item receipt needs its purchase order's remote id; a coded bill (slice 5)
 * needs the ACCOUNTING provider's vendor id. The obvious implementation — call
 * the other engine inline and push its entity first — is the one to avoid. It
 * would make the spend engine block on another provider's HTTP round-trip,
 * inherit its failure modes and rate limits, and merge two retry policies into
 * one operation whose failure nobody can attribute.
 *
 * So this NEVER pushes anything. It reads the mapping; if it is absent the
 * caller skips with a reason, and the document is retried when either
 *
 * - the dependency's own push lands and the document is touched again, or
 * - the outbound sweep re-reconciles it (≤30 min).
 *
 * That is deliberately a wait, not a stall: the dependency is already being
 * pushed by its own event-driven operation. Nothing here makes it happen; this
 * only avoids acting on a half-known identity.
 */

/** Stable prefix so a waiting document is greppable in Sync Activity. */
export const AWAITING_MAPPING_CODE = "AWAITING_MAPPING";

export type MappingDependency = {
  /** Whose mapping is required — may be a DIFFERENT integration than the push. */
  integrationId: string;
  entityType: string;
  carbonId: string;
};

export type MappingResolution =
  | { kind: "resolved"; remoteId: string }
  | { kind: "deferred"; reason: string; dependency: MappingDependency };

export function awaitingMappingReason(
  dependency: MappingDependency,
  waitingFor: string
): string {
  return `${AWAITING_MAPPING_CODE}: ${waitingFor} needs ${dependency.entityType} ${dependency.carbonId} to be synced to ${dependency.integrationId} first`;
}

export function isAwaitingMapping(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(AWAITING_MAPPING_CODE);
}

/**
 * The dependency's remote id, or a deferral.
 *
 * `mappingService` is narrowed to the one method used, so this stays testable
 * without constructing the service.
 */
export async function requireMappingOrDefer(args: {
  mappingService: {
    getExternalId: (
      entityType: string,
      entityId: string,
      integration: string
    ) => Promise<string | null>;
  };
  dependency: MappingDependency;
  /** What is waiting, named for the skip message (e.g. "item receipt IR-1"). */
  waitingFor: string;
}): Promise<MappingResolution> {
  const { dependency } = args;

  const remoteId = await args.mappingService.getExternalId(
    dependency.entityType,
    dependency.carbonId,
    dependency.integrationId
  );

  if (remoteId) return { kind: "resolved", remoteId };

  return {
    kind: "deferred",
    reason: awaitingMappingReason(dependency, args.waitingFor),
    dependency
  };
}
