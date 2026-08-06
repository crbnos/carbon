import type { LineagePayload } from "~/modules/inventory/lineage.server";
import type { TrackedEntity } from "~/modules/inventory/types";

/**
 * The job's own node in the lineage graph.
 *
 * A job's real activities are its PRODUCTION EVENTS — `startProductionEvent`
 * writes one per operation per unit, typed "<operation> (<event type>)". Those
 * are the steps. The job itself has no `trackedActivity` row, so this
 * synthesises one.
 *
 * It exists for a single reason: entities the item event-handlers seed at job
 * creation have no producing activity yet, and would otherwise float
 * unconnected. Once a real activity accounts for an entity, the job node must
 * NOT also claim it — two parents for one entity reads as two separate
 * origins when there is only one. So the node only ever covers what nothing
 * else does, and disappears entirely once production covers everything.
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

export function withJobNode(
  payload: LineagePayload,
  jobId: string,
  jobReadableId: string
): LineagePayload {
  const id = jobNodeId(jobId);
  const existingActivityIds = new Set(payload.activities.map((a) => a.id));

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

  return {
    ...payload,
    activities: existingActivityIds.has(id)
      ? payload.activities
      : [
          {
            id,
            type: "Job",
            sourceDocument: "Job",
            sourceDocumentId: jobId,
            sourceDocumentReadableId: jobReadableId,
            attributes: { Job: jobId }
          },
          ...payload.activities
        ],
    outputs: [
      ...payload.outputs,
      ...orphanSeeds.map((entity) => ({
        trackedActivityId: id,
        trackedEntityId: entity.id,
        quantity: entity.quantity
      }))
    ]
  };
}
