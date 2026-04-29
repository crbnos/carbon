import type { Edge, Node } from "@xyflow/react";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";
import { NODE_SIZE } from "./constants";

export type EntityNodeData = {
  kind: "entity";
  entity: TrackedEntity;
  dimmed: boolean;
};

export type ActivityNodeData = {
  kind: "activity";
  activity: Activity;
  dimmed: boolean;
};

export type LineageNode = Node<EntityNodeData | ActivityNodeData>;

export type LineageEdgeData = {
  kind: "input" | "output";
  quantity: number;
  dimmed: boolean;
  weight?: number;
  isReject?: boolean;
  isBackEdge?: boolean;
  points?: { x: number; y: number }[];
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

export function payloadToFlow(
  payload: LineagePayload,
  positions: Map<string, { x: number; y: number }> = new Map()
): { nodes: LineageNode[]; edges: LineageEdge[] } {
  const seenNodeIds = new Set<string>();

  const entityNodes: LineageNode[] = payload.entities
    .filter((e) => {
      if (!e?.id || seenNodeIds.has(e.id)) return false;
      seenNodeIds.add(e.id);
      return true;
    })
    .map((entity) => ({
      id: entity.id,
      type: "entity",
      position: positions.get(entity.id) ?? { x: 0, y: 0 },
      width: NODE_SIZE,
      height: NODE_SIZE,
      measured: { width: NODE_SIZE, height: NODE_SIZE },
      data: { kind: "entity", entity, dimmed: false }
    }));

  const activityNodes: LineageNode[] = payload.activities
    .filter((a) => {
      if (!a?.id || seenNodeIds.has(a.id)) return false;
      seenNodeIds.add(a.id);
      return true;
    })
    .map((activity) => ({
      id: activity.id,
      type: "activity",
      position: positions.get(activity.id) ?? { x: 0, y: 0 },
      width: NODE_SIZE,
      height: NODE_SIZE,
      measured: { width: NODE_SIZE, height: NODE_SIZE },
      data: { kind: "activity", activity, dimmed: false }
    }));

  const seenEdgeIds = new Set<string>();
  const edges: LineageEdge[] = [];

  for (const input of payload.inputs) {
    const id = `in:${input.trackedActivityId}:${input.trackedEntityId}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);
    edges.push({
      id,
      type: "quantity",
      source: input.trackedEntityId,
      target: input.trackedActivityId,
      data: { kind: "input", quantity: input.quantity, dimmed: false }
    });
  }

  for (const output of payload.outputs) {
    const id = `out:${output.trackedActivityId}:${output.trackedEntityId}`;
    if (seenEdgeIds.has(id)) continue;
    seenEdgeIds.add(id);
    edges.push({
      id,
      type: "quantity",
      source: output.trackedActivityId,
      target: output.trackedEntityId,
      data: { kind: "output", quantity: output.quantity, dimmed: false }
    });
  }

  return { nodes: [...entityNodes, ...activityNodes], edges };
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
      return `/x/inventory/receipts/${id}`;
    case "Shipment":
      return `/x/inventory/shipments/${id}`;
    case "Purchase Order":
      return `/x/purchase-order/${id}`;
    case "Sales Order":
      return `/x/sales/orders/${id}`;
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
        isReject: rejectIds.has(e.target)
      }
    };
  });
}
