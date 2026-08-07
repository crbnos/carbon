import type { Edge, Node } from "@xyflow/react";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";
import type { ClusterResult, EntityCluster } from "./cluster";
import { clusterEntities, DEFAULT_CLUSTER_THRESHOLD, edgeKey } from "./cluster";
import { NODE_SIZE } from "./constants";
import { isMovementActivity } from "./metadata";

export type EntityNodeData = {
  kind: "entity";
  entity: TrackedEntity;
  dimmed: boolean;
  /**
   * Lot-state fields. The graph renders each entity as a CHAIN of states —
   * quantity at each point in time — so a split reads as a real branch
   * (parent-before → Split → child + parent-after) instead of a pass-through.
   * Absent (undefined) when the entity's history couldn't be replayed and it
   * collapsed to a single current-quantity node.
   */
  stateQuantity?: number;
  stateIndex?: number;
  stateCount?: number;
  /** Last state of the chain — this is where the lot's stock sits today. */
  isCurrentState?: boolean;
};

export type ActivityNodeData = {
  kind: "activity";
  activity: Activity;
  dimmed: boolean;
  /** Amount moved, for Pick / Transfer. Their edges carry the bins instead, so
   * the quantity lives on the node. */
  movementQuantity?: number;
};

export type EntityGroupNodeData = {
  kind: "entityGroup";
  cluster: EntityCluster;
  dimmed: boolean;
};

export type LineageNode = Node<
  EntityNodeData | ActivityNodeData | EntityGroupNodeData
>;

export type LineageEdgeData = {
  kind: "input" | "output" | "movement";
  quantity: number;
  /** Rendered instead of the quantity. Movement edges use it for the from/to
   * bin — for a move, where matters more than how much. */
  labelText?: string;
  dimmed: boolean;
  weight?: number;
  isReject?: boolean;
  isBackEdge?: boolean;
  /**
   * Where along this edge's own curve the label sits, 0..1 (0.5 = midpoint).
   * Layout slides it off the midpoint when parallel edges would stack their
   * pills. Stored as a PARAMETER, not a point, so the label keeps following
   * the curve when a node is dragged.
   */
  labelT?: number;
};

export type LineageEdge = Edge<LineageEdgeData>;

export type StepRecord = {
  id: string;
  jobOperationStepId: string;
  index: number;
  type: string;
  name: string;
  value: string | null;
  numericValue: number | null;
  booleanValue: boolean | null;
  userValue: string | null;
  unitOfMeasureCode: string | null;
  minValue: number | null;
  maxValue: number | null;
  operationId: string;
  operationDescription: string | null;
  itemId: string | null;
  itemReadableId: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type IssueContainmentStatus = "Contained" | "Uncontained";

export type IssueContainment = {
  id: string;
  readableId: string | null;
  containmentStatus: IssueContainmentStatus;
  status: string;
  priority: string | null;
  trackedEntityId: string;
};

export type LineagePayload = {
  entities: TrackedEntity[];
  activities: Activity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
  stepRecords?: StepRecord[];
  containments?: IssueContainment[];
};

// Delimiter between an entity id and its state index in node ids. Entity ids
// are nanoids (A-Za-z0-9_-), so "::s" can never occur inside one.
const STATE_DELIMITER = "::s";

/** Node id → the tracked entity id it represents (state nodes included). */
export function stateEntityId(nodeId: string): string {
  const i = nodeId.indexOf(STATE_DELIMITER);
  return i === -1 ? nodeId : nodeId.slice(0, i);
}

function stateNodeId(entityId: string, stateIndex: number): string {
  // State 0 keeps the bare entity id so URLs, root highlighting, and search
  // selection keep working without translation.
  return stateIndex === 0
    ? entityId
    : `${entityId}${STATE_DELIMITER}${stateIndex}`;
}

type LotEvent = {
  activityId: string;
  type: string | null;
  movement: boolean;
  createdAt: string;
  inQty: number | null;
  outQty: number | null;
  /** Bin names, enriched server-side onto movement activities. */
  fromBin: string | null;
  toBin: string | null;
};

type LotEventWiring = {
  activityId: string;
  movement: boolean;
  fromBin: string | null;
  toBin: string | null;
  /** State feeding the activity (input side); null for creation events. */
  beforeState: number | null;
  beforeQty: number | null;
  /** State the activity produces for THIS entity; null for terminal events. */
  afterState: number | null;
  afterQty: number | null;
};

type LotTimeline = {
  stateQuantities: number[];
  wiring: LotEventWiring[];
};

const QTY_EPSILON = 1e-6;

/**
 * Replay an entity's visible events backward from its current quantity to
 * recover the quantity at every point in time, then wire each event to
 * before/after states. Returns null when the history can't be reconciled
 * (legacy or partially-recorded data) — the caller collapses that entity to a
 * single current-quantity node instead of guessing.
 *
 * Rules per event shape:
 * - input+output (legacy split self-loop): before = input qty, after = output qty
 * - output only, first event: creation — after = output qty, no before state
 * - output only, later (e.g. merge gain): after = before + output qty
 * - input only, movement: after = before (relocation, quantity carried)
 * - input only, Split/Merge draw: after = before − input qty
 * - input only, otherwise (consume/ship): terminal — the state ends here
 */
function buildLotTimeline(
  entity: TrackedEntity,
  events: LotEvent[]
): LotTimeline | null {
  const current = Number(entity.quantity);
  if (!Number.isFinite(current)) return null;

  const before: (number | null)[] = new Array(events.length).fill(null);
  const after: (number | null)[] = new Array(events.length).fill(null);

  let cur = current;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.inQty !== null && ev.outQty !== null) {
      if (Math.abs(cur - ev.outQty) > QTY_EPSILON) return null;
      after[i] = ev.outQty;
      before[i] = ev.inQty;
      cur = ev.inQty;
    } else if (ev.outQty !== null) {
      if (i === 0) {
        // Creation: the produced quantity must be what flowed forward.
        if (Math.abs(cur - ev.outQty) > QTY_EPSILON) return null;
        after[i] = ev.outQty;
        before[i] = null;
      } else {
        after[i] = cur;
        before[i] = cur - ev.outQty;
        cur = before[i]!;
      }
    } else if (ev.inQty !== null) {
      if (ev.movement) {
        after[i] = cur;
        before[i] = cur;
      } else if (ev.type === "Split" || ev.type === "Merge") {
        after[i] = cur;
        before[i] = cur + ev.inQty;
        cur = before[i]!;
      } else {
        // Terminal consumption/shipment. Must be the last event — anything
        // after a full consume means the history doesn't replay.
        if (i !== events.length - 1) return null;
        after[i] = null;
        before[i] = ev.inQty;
        cur = ev.inQty;
      }
    } else {
      return null;
    }
    if (
      before[i] !== null &&
      (before[i]! < -QTY_EPSILON || !Number.isFinite(before[i]!))
    ) {
      return null;
    }
  }

  const stateQuantities: number[] = [];
  const wiring: LotEventWiring[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    let beforeState: number | null = null;
    if (before[i] !== null) {
      if (stateQuantities.length === 0) {
        stateQuantities.push(before[i]!);
      } else if (
        Math.abs(stateQuantities[stateQuantities.length - 1] - before[i]!) >
        QTY_EPSILON
      ) {
        return null;
      }
      beforeState = stateQuantities.length - 1;
    }
    let afterState: number | null = null;
    if (after[i] !== null) {
      stateQuantities.push(after[i]!);
      afterState = stateQuantities.length - 1;
    }
    wiring.push({
      activityId: ev.activityId,
      movement: ev.movement,
      fromBin: ev.fromBin,
      toBin: ev.toBin,
      beforeState,
      beforeQty: before[i],
      afterState,
      afterQty: after[i]
    });
  }
  if (stateQuantities.length === 0) return null;
  return { stateQuantities, wiring };
}

export function payloadToFlow(
  payload: LineagePayload,
  positions: Map<string, { x: number; y: number }> = new Map(),
  opts: { clusterThreshold?: number; rootIds?: string[] } = {}
): { nodes: LineageNode[]; edges: LineageEdge[] } & ClusterResult {
  const activityById = new Map(payload.activities.map((a) => [a.id, a]));

  // Gather each entity's events from the junction rows.
  const eventsByEntity = new Map<string, Map<string, LotEvent>>();
  const eventFor = (entityId: string, activityId: string): LotEvent => {
    let events = eventsByEntity.get(entityId);
    if (events === undefined) {
      events = new Map();
      eventsByEntity.set(entityId, events);
    }
    let ev = events.get(activityId);
    if (ev === undefined) {
      const activity = activityById.get(activityId);
      const attrs = activity?.attributes as Record<string, unknown> | undefined;
      ev = {
        activityId,
        type: activity?.type ?? null,
        movement: isMovementActivity(activity?.type),
        createdAt: (activity?.createdAt as string | undefined) ?? "",
        inQty: null,
        outQty: null,
        fromBin:
          (attrs?.["From Storage Unit Name"] as string | undefined) ?? null,
        toBin: (attrs?.["To Storage Unit Name"] as string | undefined) ?? null
      };
      events.set(activityId, ev);
    }
    return ev;
  };
  for (const input of payload.inputs) {
    eventFor(input.trackedEntityId, input.trackedActivityId).inQty = Number(
      input.quantity
    );
  }
  for (const output of payload.outputs) {
    eventFor(output.trackedEntityId, output.trackedActivityId).outQty = Number(
      output.quantity
    );
  }

  // Replay every entity; entities whose history doesn't reconcile collapse to
  // a single current-quantity node with the raw recorded edges (legacy data).
  const timelines = new Map<string, LotTimeline>();
  const seenEntityIds = new Set<string>();
  for (const entity of payload.entities) {
    if (!entity?.id || seenEntityIds.has(entity.id)) continue;
    seenEntityIds.add(entity.id);
    const events = Array.from(
      eventsByEntity.get(entity.id)?.values() ?? []
    ).sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        // Same-transaction activities share a timestamp; the event that
        // creates the entity (output-only) precedes the ones that draw on it.
        Number(a.outQty === null) - Number(b.outQty === null) ||
        a.activityId.localeCompare(b.activityId)
    );
    if (events.length === 0) continue;
    const timeline = buildLotTimeline(entity, events);
    if (timeline) timelines.set(entity.id, timeline);
  }

  const stateCountByEntity = new Map<string, number>();
  for (const entity of payload.entities) {
    if (!entity?.id || stateCountByEntity.has(entity.id)) continue;
    stateCountByEntity.set(
      entity.id,
      timelines.get(entity.id)?.stateQuantities.length ?? 1
    );
  }

  // Serial fans: collapse identical-story qty-1 siblings into one group node.
  // Only single-state entities are eligible — a multi-state entity renders as
  // a chain, which can't fold into a single circle.
  const singleStateIds = new Set<string>();
  for (const [id, count] of stateCountByEntity) {
    if (count === 1) singleStateIds.add(id);
  }
  const { clusters, memberToCluster } = clusterEntities(payload, {
    threshold: opts.clusterThreshold ?? DEFAULT_CLUSTER_THRESHOLD,
    excludeIds: new Set(opts.rootIds ?? []),
    eligibleIds: singleStateIds
  });

  const nodes: LineageNode[] = [];
  const seenNodeIds = new Set<string>();

  for (const cluster of clusters) {
    seenNodeIds.add(cluster.id);
    nodes.push({
      id: cluster.id,
      type: "entityGroup",
      position: positions.get(cluster.id) ?? { x: 0, y: 0 },
      width: NODE_SIZE,
      height: NODE_SIZE,
      measured: { width: NODE_SIZE, height: NODE_SIZE },
      data: { kind: "entityGroup", cluster, dimmed: false }
    });
  }

  for (const entity of payload.entities) {
    if (!entity?.id || seenNodeIds.has(entity.id)) continue;
    if (memberToCluster[entity.id]) continue;
    seenNodeIds.add(entity.id);
    const timeline = timelines.get(entity.id);
    const stateQuantities = timeline?.stateQuantities ?? [
      Number(entity.quantity)
    ];
    for (let k = 0; k < stateQuantities.length; k++) {
      const id = stateNodeId(entity.id, k);
      nodes.push({
        id,
        type: "entity",
        position: positions.get(id) ?? { x: 0, y: 0 },
        width: NODE_SIZE,
        height: NODE_SIZE,
        measured: { width: NODE_SIZE, height: NODE_SIZE },
        data: {
          kind: "entity",
          entity,
          dimmed: false,
          stateQuantity: stateQuantities[k],
          stateIndex: k,
          stateCount: stateQuantities.length,
          isCurrentState: k === stateQuantities.length - 1
        }
      });
    }
  }

  const movementQtyByActivity = new Map<string, number>();
  for (const timeline of timelines.values()) {
    for (const w of timeline.wiring) {
      if (!w.movement) continue;
      const qty = w.beforeQty ?? w.afterQty;
      if (qty !== null) movementQtyByActivity.set(w.activityId, qty);
    }
  }

  for (const activity of payload.activities) {
    if (!activity?.id || seenNodeIds.has(activity.id)) continue;
    seenNodeIds.add(activity.id);
    nodes.push({
      id: activity.id,
      type: "activity",
      position: positions.get(activity.id) ?? { x: 0, y: 0 },
      width: NODE_SIZE,
      height: NODE_SIZE,
      measured: { width: NODE_SIZE, height: NODE_SIZE },
      data: {
        kind: "activity",
        activity,
        dimmed: false,
        movementQuantity: movementQtyByActivity.get(activity.id)
      }
    });
  }

  const seenEdgeIds = new Set<string>();
  const edges: LineageEdge[] = [];
  const pushEdge = (
    id: string,
    source: string,
    target: string,
    kind: LineageEdgeData["kind"],
    quantity: number,
    labelText?: string
  ) => {
    if (seenEdgeIds.has(id)) return;
    seenEdgeIds.add(id);
    edges.push({
      id,
      type: "quantity",
      source,
      target,
      data: { kind, quantity, labelText, dimmed: false }
    });
  };

  // Timeline-driven edges: each entity wires its own input/creation/
  // continuation edges, labeled with the quantity at that moment.
  for (const [entityId, timeline] of timelines) {
    if (memberToCluster[entityId]) continue;
    for (const w of timeline.wiring) {
      if (w.beforeState !== null && w.beforeQty !== null) {
        pushEdge(
          `in:${w.activityId}:${entityId}@${w.beforeState}`,
          stateNodeId(entityId, w.beforeState),
          w.activityId,
          w.movement ? "movement" : "input",
          w.beforeQty,
          w.movement ? (w.fromBin ?? undefined) : undefined
        );
      }
      if (w.afterState !== null && w.afterQty !== null) {
        pushEdge(
          `out:${w.activityId}:${entityId}@${w.afterState}`,
          w.activityId,
          stateNodeId(entityId, w.afterState),
          w.movement ? "movement" : "output",
          w.afterQty,
          w.movement ? (w.toBin ?? undefined) : undefined
        );
      }
    }
  }

  // Raw edges for collapsed entities (no timeline) — today's rendering.
  const activityTypeById = new Map(
    payload.activities.map((a) => [a.id, a.type])
  );
  for (const input of payload.inputs) {
    if (timelines.has(input.trackedEntityId)) continue;
    if (memberToCluster[input.trackedEntityId]) continue;
    const kind = isMovementActivity(
      activityTypeById.get(input.trackedActivityId)
    )
      ? "movement"
      : "input";
    pushEdge(
      `in:${input.trackedActivityId}:${input.trackedEntityId}`,
      input.trackedEntityId,
      input.trackedActivityId,
      kind,
      input.quantity
    );
  }
  for (const output of payload.outputs) {
    if (timelines.has(output.trackedEntityId)) continue;
    if (memberToCluster[output.trackedEntityId]) continue;
    pushEdge(
      `out:${output.trackedActivityId}:${output.trackedEntityId}`,
      output.trackedActivityId,
      output.trackedEntityId,
      "output",
      output.quantity
    );
  }

  // One edge per signature entry, standing in for every member edge it
  // replaced — quantity is their sum.
  for (const cluster of clusters) {
    for (const entry of cluster.signature) {
      const quantity =
        cluster.quantitiesByEdge[edgeKey(entry.activityId, entry.side)] ?? 0;
      if (entry.side === "input") {
        pushEdge(
          `in:${entry.activityId}:${cluster.id}`,
          cluster.id,
          entry.activityId,
          isMovementActivity(activityTypeById.get(entry.activityId))
            ? "movement"
            : "input",
          quantity
        );
      } else {
        pushEdge(
          `out:${entry.activityId}:${cluster.id}`,
          entry.activityId,
          cluster.id,
          "output",
          quantity
        );
      }
    }
  }

  return { nodes, edges, clusters, memberToCluster };
}

export function mergePayloads(
  base: LineagePayload,
  incoming: LineagePayload
): LineagePayload {
  const entityIds = new Set(base.entities.map((e) => e.id));
  const activityIds = new Set(base.activities.map((a) => a.id));
  const inputKeys = new Set(
    base.inputs.map((i) => `${i.trackedActivityId}:${i.trackedEntityId}`)
  );
  const outputKeys = new Set(
    base.outputs.map((o) => `${o.trackedActivityId}:${o.trackedEntityId}`)
  );
  const baseSteps = base.stepRecords ?? [];
  const baseContainments = base.containments ?? [];
  const incomingSteps = incoming.stepRecords ?? [];
  const incomingContainments = incoming.containments ?? [];
  const stepIds = new Set(baseSteps.map((s) => s.id));
  const containmentKeys = new Set(
    baseContainments.map((c) => `${c.id}:${c.trackedEntityId}`)
  );

  return {
    entities: [
      ...base.entities,
      ...incoming.entities.filter((e) => !entityIds.has(e.id))
    ],
    activities: [
      ...base.activities,
      ...incoming.activities.filter((a) => !activityIds.has(a.id))
    ],
    inputs: [
      ...base.inputs,
      ...incoming.inputs.filter(
        (i) => !inputKeys.has(`${i.trackedActivityId}:${i.trackedEntityId}`)
      )
    ],
    outputs: [
      ...base.outputs,
      ...incoming.outputs.filter(
        (o) => !outputKeys.has(`${o.trackedActivityId}:${o.trackedEntityId}`)
      )
    ],
    stepRecords:
      incomingSteps.length === 0 && baseSteps.length === 0
        ? undefined
        : [...baseSteps, ...incomingSteps.filter((s) => !stepIds.has(s.id))],
    containments:
      incomingContainments.length === 0 && baseContainments.length === 0
        ? undefined
        : [
            ...baseContainments,
            ...incomingContainments.filter(
              (c) => !containmentKeys.has(`${c.id}:${c.trackedEntityId}`)
            )
          ]
  };
}

export function lineagePathEdges(
  rootId: string,
  edges: LineageEdge[]
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  const outgoing = new Map<string, LineageEdge[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
  }

  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>([rootId]);

  const stack = [rootId];
  const visited = new Set<string>([rootId]);
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of outgoing.get(cur) ?? []) {
      edgeIds.add(e.id);
      nodeIds.add(e.target);
      if (!visited.has(e.target)) {
        visited.add(e.target);
        stack.push(e.target);
      }
    }
  }

  return { edgeIds, nodeIds };
}

export function lineagePathEdgesMulti(
  rootIds: string[],
  edges: LineageEdge[],
  excludedIds: Set<string> = new Set()
): { edgeIds: Set<string>; nodeIds: Set<string> } {
  const filteredEdges = excludedIds.size
    ? edges.filter(
        (e) => !excludedIds.has(e.source) && !excludedIds.has(e.target)
      )
    : edges;
  const edgeIds = new Set<string>();
  const nodeIds = new Set<string>();
  const rootSet = new Set(rootIds.filter((id) => !excludedIds.has(id)));
  for (const id of rootSet) {
    const r = lineagePathEdges(id, filteredEdges);
    for (const e of r.edgeIds) edgeIds.add(e);
    for (const n of r.nodeIds) nodeIds.add(n);
  }
  for (const e of filteredEdges) {
    if (rootSet.has(e.source) && rootSet.has(e.target)) {
      edgeIds.add(e.id);
      nodeIds.add(e.source);
      nodeIds.add(e.target);
    }
  }
  return { edgeIds, nodeIds };
}

export function lineageReachableMulti(
  rootIds: string[],
  edges: LineageEdge[]
): Set<string> {
  const result = new Set<string>();
  for (const id of rootIds) {
    for (const r of lineageReachable(id, edges)) result.add(r);
  }
  return result;
}

export function lineageReachable(
  rootId: string,
  edges: LineageEdge[]
): Set<string> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  }
  const result = new Set<string>([rootId]);

  const downStack = [rootId];
  const downVisited = new Set<string>([rootId]);
  while (downStack.length) {
    const cur = downStack.pop()!;
    for (const next of outgoing.get(cur) ?? []) {
      if (!downVisited.has(next)) {
        downVisited.add(next);
        result.add(next);
        downStack.push(next);
      }
    }
  }

  const upStack = [rootId];
  const upVisited = new Set<string>([rootId]);
  while (upStack.length) {
    const cur = upStack.pop()!;
    for (const prev of incoming.get(cur) ?? []) {
      if (!upVisited.has(prev)) {
        upVisited.add(prev);
        result.add(prev);
        upStack.push(prev);
      }
    }
  }

  return result;
}

export function entityHeadline(
  e: Pick<TrackedEntity, "id" | "readableId" | "sourceDocumentReadableId">,
  sliceTo?: number
): string {
  return (
    e.sourceDocumentReadableId ??
    e.readableId ??
    (sliceTo ? e.id.slice(0, sliceTo) : e.id)
  );
}

export function activityHeadline(
  a: Pick<Activity, "id" | "type" | "sourceDocumentReadableId">,
  sliceTo?: number
): string {
  return (
    a.sourceDocumentReadableId ??
    a.type ??
    (sliceTo ? a.id.slice(0, sliceTo) : a.id)
  );
}

export function sourceLinkHref(
  doc: string | null | undefined,
  id: string | null | undefined
): string | null {
  if (!doc || !id) return null;
  switch (doc) {
    case "Job":
      return `/x/job/${id}`;
    case "Receipt":
      return `/x/receipt/${id}`;
    case "Shipment":
      return `/x/shipment/${id}`;
    case "Purchase Order":
      return `/x/purchase-order/${id}`;
    case "Sales Order":
      return `/x/sales-order/${id}`;
    case "Picking List":
      return `/x/picking-list/${id}`;
    case "Stock Transfer":
      return `/x/stock-transfer/${id}`;
    default:
      return null;
  }
}

export function annotateEdgeWeights(
  edges: LineageEdge[],
  rejectIds: Set<string>
): LineageEdge[] {
  const totalsBySource = new Map<string, number>();
  for (const e of edges) {
    const q = e.data?.quantity ?? 0;
    totalsBySource.set(e.source, (totalsBySource.get(e.source) ?? 0) + q);
  }

  return edges.map((e) => {
    const total = totalsBySource.get(e.source) ?? 0;
    const q = e.data?.quantity ?? 0;
    const weight = total > 0 ? q / total : 0.5;
    return {
      ...e,
      data: {
        ...(e.data as LineageEdgeData),
        weight,
        // rejectIds hold entity ids; edge targets may be state nodes.
        isReject: rejectIds.has(stateEntityId(e.target))
      }
    };
  });
}

// Compact quantity for node badges/stubs, where horizontal space is tight.
/**
 * How edges are drawn. Flipping this is a ONE-LINE change: `QuantityEdge` picks
 * the matching xyflow path function and `edgeLabelPoint` picks the matching
 * geometry, so labels can never end up sampling a curve the renderer isn't
 * drawing (which strands them off the line).
 */
export const EDGE_STYLE: "bezier" | "smoothstep" = "bezier";

/** Must match the values QuantityEdge passes to `getSmoothStepPath`. */
export const EDGE_BORDER_RADIUS = 10;
/** The handles sit at the node CENTRE, so the run has to clear the circle
 *  (radius 22) before the path is allowed to turn. */
export const EDGE_OFFSET = 34;

type Pt = { x: number; y: number };

const isHorizontal = (position: string | undefined) =>
  position === "left" || position === "right";

const handleDir = (position: string | undefined): Pt => {
  switch (position) {
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
    case "top":
      return { x: 0, y: -1 };
    default:
      return { x: 0, y: 1 };
  }
};

/**
 * The corner points of the orthogonal path `getSmoothStepPath` draws.
 *
 * Mirrors xyflow's `getPoints` for the OPPOSITE-handle case, which is the only
 * one this graph produces — layout pins handles to Bottom→Top (TB) or
 * Right→Left (LR). Corner rounding is ignored: this is used to place labels,
 * and label candidates skip the bends anyway.
 *
 * Compared as string literals rather than importing the `Position` enum, so
 * this stays free of a runtime @xyflow/react dependency — it runs in the
 * lineage Web Worker.
 */
export function smoothStepPolyline(
  sourceX: number,
  sourceY: number,
  sourcePosition: string | undefined,
  targetX: number,
  targetY: number,
  targetPosition: string | undefined,
  offset: number = EDGE_OFFSET
): Pt[] {
  const sourceDir = handleDir(sourcePosition);
  const targetDir = handleDir(targetPosition);
  const s: Pt = { x: sourceX, y: sourceY };
  const t: Pt = { x: targetX, y: targetY };
  const sg: Pt = {
    x: s.x + sourceDir.x * offset,
    y: s.y + sourceDir.y * offset
  };
  const tg: Pt = {
    x: t.x + targetDir.x * offset,
    y: t.y + targetDir.y * offset
  };

  const horizontal = isHorizontal(sourcePosition);
  // getDirection: which way the run actually travels between the gapped points.
  const currDir = horizontal ? (sg.x < tg.x ? 1 : -1) : sg.y < tg.y ? 1 : -1;
  const sourceComponent = horizontal ? sourceDir.x : sourceDir.y;

  const centerX = (sg.x + tg.x) / 2;
  const centerY = (sg.y + tg.y) / 2;
  const verticalSplit: Pt[] = [
    { x: centerX, y: sg.y },
    { x: centerX, y: tg.y }
  ];
  const horizontalSplit: Pt[] = [
    { x: sg.x, y: centerY },
    { x: tg.x, y: centerY }
  ];

  const bends =
    sourceComponent === currDir
      ? horizontal
        ? verticalSplit
        : horizontalSplit
      : horizontal
        ? horizontalSplit
        : verticalSplit;

  const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
  const raw = [
    s,
    ...(same(sg, bends[0]) ? [] : [sg]),
    ...bends,
    ...(same(tg, bends[bends.length - 1]) ? [] : [tg]),
    t
  ];

  // Drop duplicate and colinear joints. xyflow renders those as a plain `L`
  // (no bend), so keeping them would make a dead-straight edge look like it
  // had corners — and label placement would refuse to sit anywhere near them.
  const simplified: Pt[] = [];
  for (const p of raw) {
    const last = simplified[simplified.length - 1];
    if (last && same(last, p)) continue;
    if (simplified.length >= 2) {
      const a = simplified[simplified.length - 2];
      const b = last!;
      const colinear =
        (a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y);
      if (colinear) simplified.pop();
    }
    simplified.push(p);
  }
  return simplified;
}

/**
 * Walk a polyline to the point at `fraction` of its total length, and report
 * how far that point is from the nearest corner — a label sitting on a bend
 * would float off the rounded path the renderer actually draws.
 */
export function pointAlongPolyline(
  points: Pt[],
  fraction: number
): { x: number; y: number; distanceToBend: number } {
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
    segLengths.push(d);
    total += d;
  }
  if (total === 0) {
    return { x: points[0].x, y: points[0].y, distanceToBend: Infinity };
  }

  let travelled = fraction * total;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i];
    if (travelled <= len || i === segLengths.length - 1) {
      const r = len === 0 ? 0 : Math.min(travelled, len) / len;
      const a = points[i];
      const b = points[i + 1];
      // Only interior joints are bends; the endpoints are not.
      const startIsBend = i > 0;
      const endIsBend = i < segLengths.length - 1;
      const along = r * len;
      return {
        x: a.x + (b.x - a.x) * r,
        y: a.y + (b.y - a.y) * r,
        distanceToBend: Math.min(
          startIsBend ? along : Infinity,
          endIsBend ? len - along : Infinity
        )
      };
    }
    travelled -= len;
  }

  const last = points[points.length - 1];
  return { x: last.x, y: last.y, distanceToBend: Infinity };
}

/**
 * A point on the curve `getSimpleBezierPath` draws.
 *
 * Mirrors xyflow's `getControl`: a Left/Right handle puts the control at the
 * midpoint in x and the endpoint's own y; Top/Bottom is the transpose.
 */
function bezierControl(
  position: string | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): [number, number] {
  return isHorizontal(position) ? [0.5 * (x1 + x2), y1] : [x1, 0.5 * (y1 + y2)];
}

function cubicAt(
  t: number,
  p0: number,
  c1: number,
  c2: number,
  p3: number
): number {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3
  );
}

export function simpleBezierPointAt(
  t: number,
  sourceX: number,
  sourceY: number,
  sourcePosition: string | undefined,
  targetX: number,
  targetY: number,
  targetPosition: string | undefined
): { x: number; y: number } {
  const [c1x, c1y] = bezierControl(
    sourcePosition,
    sourceX,
    sourceY,
    targetX,
    targetY
  );
  const [c2x, c2y] = bezierControl(
    targetPosition,
    targetX,
    targetY,
    sourceX,
    sourceY
  );
  return {
    x: cubicAt(t, sourceX, c1x, c2x, targetX),
    y: cubicAt(t, sourceY, c1y, c2y, targetY)
  };
}

/**
 * Where a label sits on an edge. Layout picks the `fraction`; the edge
 * component evaluates it against LIVE endpoint coordinates, so a dragged node
 * takes its labels with it.
 *
 * Dispatches on EDGE_STYLE so the geometry always matches what is drawn.
 * A bezier has no corners, hence the infinite bend clearance.
 */
export function edgeLabelPoint(
  fraction: number,
  sourceX: number,
  sourceY: number,
  sourcePosition: string | undefined,
  targetX: number,
  targetY: number,
  targetPosition: string | undefined
): { x: number; y: number; distanceToBend: number } {
  if (EDGE_STYLE === "bezier") {
    const p = simpleBezierPointAt(
      fraction,
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition
    );
    return { ...p, distanceToBend: Infinity };
  }
  return pointAlongPolyline(
    smoothStepPolyline(
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition
    ),
    fraction
  );
}

export function formatQuantity(q: number): string {
  if (q >= 1000) return `${(q / 1000).toFixed(1)}k`;
  if (Number.isInteger(q)) return String(q);
  return q.toFixed(1);
}
