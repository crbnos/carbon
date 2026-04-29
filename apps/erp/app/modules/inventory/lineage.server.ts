import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  GraphData,
  TrackedEntity
} from "./types";

export type LineageDirection = "up" | "down" | "both";

export type LineagePayload = {
  entities: TrackedEntity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
  activities: Activity[];
};

const MAX_DEPTH = 5;
const MAX_ENTITIES = 200;

export async function fetchLineageSubgraph(
  client: SupabaseClient<Database>,
  rootEntityId: string,
  depth: number,
  direction: LineageDirection = "both"
): Promise<LineagePayload> {
  const safeDepth = Math.min(Math.max(1, depth), MAX_DEPTH);

  const rootEntity = await client
    .from("trackedEntity")
    .select("*")
    .eq("id", rootEntityId)
    .maybeSingle();

  const entities = new Map<string, TrackedEntity>();
  const activities = new Map<string, Activity>();
  const inputs = new Map<string, ActivityInput>();
  const outputs = new Map<string, ActivityOutput>();

  if (rootEntity.data)
    entities.set(rootEntity.data.id, rootEntity.data as TrackedEntity);

  const visited = new Set<string>([rootEntityId]);
  let frontier: string[] = [rootEntityId];

  for (let hop = 0; hop < safeDepth; hop++) {
    if (frontier.length === 0) break;
    if (entities.size >= MAX_ENTITIES) break;

    const descendantsResults: {
      id: string;
      trackedActivityId: string;
      quantity: number;
    }[][] = [];
    const ancestorsResults: {
      id: string;
      trackedActivityId: string;
      quantity: number;
    }[][] = [];

    const calls: Promise<void>[] = [];
    for (const id of frontier) {
      if (direction === "down" || direction === "both") {
        calls.push(
          (async () => {
            const res = await client.rpc(
              "get_direct_descendants_of_tracked_entity_strict",
              {
                p_tracked_entity_id: id
              }
            );
            descendantsResults.push((res.data ?? []) as any);
          })()
        );
      }
      if (direction === "up" || direction === "both") {
        calls.push(
          (async () => {
            const res = await client.rpc(
              "get_direct_ancestors_of_tracked_entity_strict",
              {
                p_tracked_entity_id: id
              }
            );
            ancestorsResults.push((res.data ?? []) as any);
          })()
        );
      }
    }

    await Promise.all(calls);

    const nextFrontier = new Set<string>();
    const newEntityIds = new Set<string>();
    const activityIds = new Set<string>();

    for (let i = 0; i < frontier.length; i++) {
      const sourceId = frontier[i];

      const desc = descendantsResults[i] ?? [];
      for (const row of desc) {
        if (!row?.id) continue;
        activityIds.add(row.trackedActivityId);
        const inputKey = `${row.trackedActivityId}:${sourceId}`;
        if (!inputs.has(inputKey)) {
          inputs.set(inputKey, {
            trackedActivityId: row.trackedActivityId,
            trackedEntityId: sourceId,
            quantity: row.quantity
          });
        }
        if (!visited.has(row.id)) {
          visited.add(row.id);
          newEntityIds.add(row.id);
          nextFrontier.add(row.id);
        }
        const outputKey = `${row.trackedActivityId}:${row.id}`;
        if (!outputs.has(outputKey)) {
          outputs.set(outputKey, {
            trackedActivityId: row.trackedActivityId,
            trackedEntityId: row.id,
            quantity: row.quantity
          });
        }
      }

      const anc = ancestorsResults[i] ?? [];
      for (const row of anc) {
        if (!row?.id) continue;
        activityIds.add(row.trackedActivityId);
        const outputKey = `${row.trackedActivityId}:${sourceId}`;
        if (!outputs.has(outputKey)) {
          outputs.set(outputKey, {
            trackedActivityId: row.trackedActivityId,
            trackedEntityId: sourceId,
            quantity: row.quantity
          });
        }
        if (!visited.has(row.id)) {
          visited.add(row.id);
          newEntityIds.add(row.id);
          nextFrontier.add(row.id);
        }
        const inputKey = `${row.trackedActivityId}:${row.id}`;
        if (!inputs.has(inputKey)) {
          inputs.set(inputKey, {
            trackedActivityId: row.trackedActivityId,
            trackedEntityId: row.id,
            quantity: row.quantity
          });
        }
      }
    }

    if (newEntityIds.size > 0) {
      const remainingCapacity = MAX_ENTITIES - entities.size;
      const idsToFetch = Array.from(newEntityIds).slice(0, remainingCapacity);
      const fetched = await client
        .from("trackedEntity")
        .select("*")
        .in("id", idsToFetch);
      for (const row of fetched.data ?? []) {
        entities.set(row.id, row as TrackedEntity);
      }
    }

    if (activityIds.size > 0) {
      const idsToFetch = Array.from(activityIds).filter(
        (id) => !activities.has(id)
      );
      if (idsToFetch.length > 0) {
        const fetched = await client
          .from("trackedActivity")
          .select("*")
          .in("id", idsToFetch);
        for (const row of fetched.data ?? []) {
          activities.set(row.id, row as unknown as Activity);
        }
      }
    }

    frontier = Array.from(nextFrontier);
  }

  return {
    entities: Array.from(entities.values()),
    inputs: Array.from(inputs.values()),
    outputs: Array.from(outputs.values()),
    activities: Array.from(activities.values())
  };
}

export function toGraphData(payload: LineagePayload): GraphData {
  const nodes = [
    ...payload.entities.map((entity) => ({
      id: entity.id,
      type: "entity" as const,
      data: entity,
      parentId: null
    })),
    ...payload.activities.map((activity) => ({
      id: activity.id,
      type: "activity" as const,
      data: activity,
      parentId: null
    }))
  ];

  const links = [
    ...payload.inputs.map((input) => ({
      source: input.trackedEntityId,
      target: input.trackedActivityId,
      type: "input" as const,
      quantity: input.quantity
    })),
    ...payload.outputs.map((output) => ({
      source: output.trackedActivityId,
      target: output.trackedEntityId,
      type: "output" as const,
      quantity: output.quantity
    }))
  ];

  return { nodes, links };
}
