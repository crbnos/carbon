import { groupBy } from "@carbon/utils";
import type {
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";

/**
 * Serial items at quantity N create N quantity-1 tracked entities by design
 * (the serial pre-split at job creation). A 50-serial job therefore fans out
 * into 50 identical nodes hanging off one activity, which drowns the graph.
 *
 * This pass collapses siblings that tell the exact same story into a single
 * group node. "Same story" is an identical edge signature — the exact set of
 * `(activityId, side)` pairs the entity participates in — plus the same item
 * and status. Anything with a distinct history keeps its own node.
 *
 * Display-only: nothing here touches the payload, the schema, or the server.
 *
 * This module is deliberately free of runtime dependencies beyond
 * `@carbon/utils` — it runs inside the lineage Web Worker.
 */

/** Reserved node-id prefix. Contains no `::s`, so `stateEntityId` leaves it alone. */
export const CLUSTER_ID_PREFIX = "cluster:";

export const DEFAULT_CLUSTER_THRESHOLD = 3;

export type ClusterSide = "input" | "output";

export type ClusterMember = {
  id: string;
  readableId: string | null;
  quantity: number;
};

export type ClusterSignatureEntry = {
  activityId: string;
  side: ClusterSide;
};

export type EntityCluster = {
  id: string;
  status: TrackedEntity["status"];
  itemReadableId: string | null;
  /** Item headline shown on the node and in the sidebar. */
  headline: string;
  /** Ordered by readableId. Carries its own snapshots so consumers never
   *  have to re-resolve members out of a payload. */
  members: ClusterMember[];
  readableIdRange: [string, string] | null;
  signature: ClusterSignatureEntry[];
  /** `${activityId}:${side}` → summed member quantity on that edge. */
  quantitiesByEdge: Record<string, number>;
};

export type ClusterResult = {
  clusters: EntityCluster[];
  /** Member entity id → cluster id. A plain Record: this crosses the
   *  Comlink structured-clone boundary out of the worker. */
  memberToCluster: Record<string, string>;
};

export function edgeKey(activityId: string, side: ClusterSide): string {
  return `${activityId}:${side}`;
}

export function isClusterId(id: string): boolean {
  return id.startsWith(CLUSTER_ID_PREFIX);
}

type ClusterInputPayload = {
  entities: TrackedEntity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
};

type ClusterOptions = {
  threshold?: number;
  /** Never cluster these — the traced root must stay individually visible. */
  excludeIds?: Set<string>;
  /** Only these are candidates. The caller restricts this to entities that
   *  resolve to a single timeline state; a multi-state entity renders as a
   *  chain of nodes that can't collapse into one. */
  eligibleIds: Set<string>;
};

/**
 * `${activityId}:${side}` pairs an entity participates in, sorted so two
 * entities on the same edges produce the same string regardless of row order.
 */
function signatureOf(
  entityId: string,
  inputsByEntity: Record<string, ActivityInput[]>,
  outputsByEntity: Record<string, ActivityOutput[]>
): ClusterSignatureEntry[] {
  const entries: ClusterSignatureEntry[] = [];
  for (const row of inputsByEntity[entityId] ?? []) {
    entries.push({ activityId: row.trackedActivityId, side: "input" });
  }
  for (const row of outputsByEntity[entityId] ?? []) {
    entries.push({ activityId: row.trackedActivityId, side: "output" });
  }
  entries.sort(
    (a, b) =>
      a.activityId.localeCompare(b.activityId) || a.side.localeCompare(b.side)
  );
  return entries;
}

export function clusterEntities(
  payload: ClusterInputPayload,
  opts: ClusterOptions
): ClusterResult {
  const threshold = opts.threshold ?? DEFAULT_CLUSTER_THRESHOLD;
  const excludeIds = opts.excludeIds ?? new Set<string>();
  const { eligibleIds } = opts;

  const inputsByEntity = groupBy(payload.inputs, (i) => i.trackedEntityId);
  const outputsByEntity = groupBy(payload.outputs, (o) => o.trackedEntityId);

  type Candidate = {
    entity: TrackedEntity;
    signature: ClusterSignatureEntry[];
    groupKey: string;
  };

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const entity of payload.entities) {
    if (!entity?.id || seen.has(entity.id)) continue;
    seen.add(entity.id);
    if (excludeIds.has(entity.id)) continue;
    if (!eligibleIds.has(entity.id)) continue;
    if (Number(entity.quantity) !== 1) continue;

    const signature = signatureOf(entity.id, inputsByEntity, outputsByEntity);
    // An entity with no edges is an isolated node — nothing to collapse.
    if (signature.length === 0) continue;

    // Key on the real `itemId`, not just the denormalised
    // `sourceDocumentReadableId` display string — the documented rule is "same
    // item", and identity should not ride on a value a trigger keeps in sync.
    // Both are included so entities missing one still discriminate on the other.
    //
    // JSON rather than a delimiter join: these are data values, so any
    // separator we picked could in principle appear inside one and collapse
    // two different groups into one.
    const groupKey = JSON.stringify([
      entity.status,
      entity.itemId ?? "",
      entity.sourceDocumentReadableId ?? "",
      signature.map((s) => edgeKey(s.activityId, s.side))
    ]);

    candidates.push({ entity, signature, groupKey });
  }

  const clusters: EntityCluster[] = [];
  const memberToCluster: Record<string, string> = {};

  const grouped = groupBy(candidates, (c) => c.groupKey);
  // Deterministic cluster order — `groupBy` returns an object, whose key order
  // is insertion order for these string keys, but sorting makes it explicit.
  for (const groupKey of Object.keys(grouped).sort()) {
    const group = grouped[groupKey];
    if (group.length < threshold) continue;

    const sorted = [...group].sort((a, b) =>
      (a.entity.readableId ?? a.entity.id).localeCompare(
        b.entity.readableId ?? b.entity.id
      )
    );
    const first = sorted[0].entity;
    const signature = sorted[0].signature;

    const quantitiesByEdge: Record<string, number> = {};
    for (const { entity } of sorted) {
      for (const row of inputsByEntity[entity.id] ?? []) {
        const key = edgeKey(row.trackedActivityId, "input");
        quantitiesByEdge[key] = (quantitiesByEdge[key] ?? 0) + row.quantity;
      }
      for (const row of outputsByEntity[entity.id] ?? []) {
        const key = edgeKey(row.trackedActivityId, "output");
        quantitiesByEdge[key] = (quantitiesByEdge[key] ?? 0) + row.quantity;
      }
    }

    const id = `${CLUSTER_ID_PREFIX}${clusterHash(groupKey)}`;
    const readableIds = sorted
      .map((c) => c.entity.readableId)
      .filter((r): r is string => !!r);

    clusters.push({
      id,
      status: first.status,
      itemReadableId: first.sourceDocumentReadableId ?? null,
      headline:
        first.sourceDocumentReadableId ?? first.itemId ?? first.id.slice(0, 8),
      members: sorted.map(({ entity }) => ({
        id: entity.id,
        readableId: entity.readableId,
        quantity: Number(entity.quantity)
      })),
      readableIdRange:
        readableIds.length > 0
          ? [readableIds[0], readableIds[readableIds.length - 1]]
          : null,
      signature,
      quantitiesByEdge
    });

    for (const { entity } of sorted) memberToCluster[entity.id] = id;
  }

  return { clusters, memberToCluster };
}

/**
 * Stable short hash of the group key. Only needs to be collision-free within
 * one graph, and the key itself is already unique per cluster — this exists so
 * node ids stay short and don't leak an entity id list into the DOM.
 */
function clusterHash(key: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}
