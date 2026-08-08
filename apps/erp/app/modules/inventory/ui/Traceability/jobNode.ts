import type { LineagePayload } from "~/modules/inventory/lineage.server";
import type { TrackedEntity } from "~/modules/inventory/types";

/**
 * Where a job's not-yet-produced entities hang.
 *
 * A job's real activities are its PRODUCTION EVENTS — `startProductionEvent`
 * writes one per operation per unit, typed "<operation> (<event type>)". The
 * job itself has no `trackedActivity` row.
 *
 * Entities the item event-handlers seed at job creation have no producing
 * activity yet and would float unconnected. Rather than stand up a separate
 * "Job" node beside the production activity — two nodes for one origin — those
 * seeds attach to the job's own production activity, which is what the job
 * node was standing in for.
 *
 * TRADE-OFF: an un-produced seed hanging off a production activity asserts a
 * production event that has not happened. It reads as "this is where this unit
 * enters production", which is why the anchor is the EARLIEST activity rather
 * than an arbitrary one. A job with no activities at all has nothing to attach
 * to, so there the synthetic node is still the only option.
 *
 * Pure and server-free so it can be unit tested; the graph route imports it.
 */

export const JOB_NODE_PREFIX = "job:";

export function jobNodeId(jobId: string): string {
  return `${JOB_NODE_PREFIX}${jobId}`;
}

export function getEntityJobId(
  entity: TrackedEntity | undefined
): string | null {
  const attrs = entity?.attributes;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const job = (attrs as Record<string, unknown>).Job;
  return typeof job === "string" && job.length > 0 ? job : null;
}

/**
 * The job's own production activity to hang un-produced seeds from: the
 * earliest one, i.e. where a unit enters production. Sorted by `createdAt`
 * with an id tie-break so the choice is stable across runs.
 */
function productionAnchorId(
  payload: LineagePayload,
  jobId: string
): string | null {
  const own = payload.activities
    .filter((a) => {
      if (a.id === jobNodeId(jobId)) return false;
      const attrs = a.attributes as Record<string, unknown> | null | undefined;
      return attrs?.Job === jobId;
    })
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id)
    );
  return own[0]?.id ?? null;
}

export function withJobNode(
  payload: LineagePayload,
  jobId: string,
  jobReadableId: string
): LineagePayload {
  const id = jobNodeId(jobId);

  // Anything a real activity already produced is spoken for.
  const producedEntityIds = new Set(
    payload.outputs.map((o) => o.trackedEntityId)
  );

  const orphanSeeds = payload.entities.filter((entity) => {
    if (getEntityJobId(entity) !== jobId) return false;
    if (producedEntityIds.has(entity.id)) return false;
    return entity.status === "Reserved" || entity.sourceDocument === "Item";
  });

  // Nothing left to anchor — the job's real activities tell the whole story.
  if (orphanSeeds.length === 0) return payload;

  const anchorId = productionAnchorId(payload, jobId);
  const existingActivityIds = new Set(payload.activities.map((a) => a.id));

  // Prefer the job's real production activity; only synthesise a node when the
  // job has none at all (created, nothing started).
  const target = anchorId ?? id;
  const needsSyntheticNode = target === id && !existingActivityIds.has(id);

  return {
    ...payload,
    activities: needsSyntheticNode
      ? [
          {
            id,
            type: "Job",
            sourceDocument: "Job",
            sourceDocumentId: jobId,
            sourceDocumentReadableId: jobReadableId,
            attributes: { Job: jobId }
          },
          ...payload.activities
        ]
      : payload.activities,
    outputs: [
      ...payload.outputs,
      ...orphanSeeds.map((entity) => ({
        trackedActivityId: target,
        trackedEntityId: entity.id,
        quantity: entity.quantity
      }))
    ]
  };
}
