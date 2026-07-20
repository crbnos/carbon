import type { AssemblyGraph, AssemblyGraphNode, Vec3 } from "./types";

/** Distinct component (identical geometry) across the assembly, with its instances. */
export type ComponentGroup = {
  /** geometryHash, or `name:${name}` for leaves without one */
  key: string;
  name: string;
  count: number;
  color: [number, number, number, number] | null;
  /** nodeIds of every instance of this component */
  nodeIds: string[];
  /** Per-instance volume (mm³) from the representative leaf */
  volume: number | null;
  /** Representative instance world bounds, mm */
  bbox: { min: Vec3; max: Vec3 };
};

export type AssemblyGraphIndex = {
  graph: AssemblyGraph;
  /** Every node (assemblies and leaves) by nodeId */
  nodesById: Map<string, AssemblyGraphNode>;
  /** Leaf instances in depth-first order */
  leaves: AssemblyGraphNode[];
  /** All leaves grouped by identical geometry */
  groups: ComponentGroup[];
  /** Leaf nodeId → its group */
  groupByNodeId: Map<string, ComponentGroup>;
};

function groupKey(node: AssemblyGraphNode): string {
  return node.geometryHash ?? `name:${node.name}`;
}

/** One O(n) walk of graph.json building the lookups the editor panes need. */
export function indexAssemblyGraph(graph: AssemblyGraph): AssemblyGraphIndex {
  const nodesById = new Map<string, AssemblyGraphNode>();
  const leaves: AssemblyGraphNode[] = [];
  const groups: ComponentGroup[] = [];
  const groupsByKey = new Map<string, ComponentGroup>();
  const groupByNodeId = new Map<string, ComponentGroup>();

  const visit = (node: AssemblyGraphNode) => {
    nodesById.set(node.nodeId, node);
    if (node.isAssembly || node.children.length > 0) {
      for (const child of node.children) visit(child);
      return;
    }

    leaves.push(node);
    const key = groupKey(node);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        key,
        name: node.name,
        count: 0,
        color: node.color,
        nodeIds: [],
        volume: node.volume,
        bbox: node.bbox
      };
      groupsByKey.set(key, group);
      groups.push(group);
    }
    group.count += 1;
    group.nodeIds.push(node.nodeId);
    groupByNodeId.set(node.nodeId, group);
  };

  visit(graph.root);

  return { graph, nodesById, leaves, groups, groupByNodeId };
}

/**
 * Groups the given component nodeIds by identical geometry. Unknown/stale nodeIds
 * (e.g. after a model re-upload) are skipped.
 */
export function groupComponentNodeIds(
  componentNodeIds: string[],
  index: AssemblyGraphIndex
): ComponentGroup[] {
  const result: ComponentGroup[] = [];
  const byKey = new Map<string, ComponentGroup>();

  for (const nodeId of componentNodeIds) {
    const source = index.groupByNodeId.get(nodeId);
    if (!source) continue;
    let group = byKey.get(source.key);
    if (!group) {
      group = { ...source, count: 0, nodeIds: [] };
      byKey.set(source.key, group);
      result.push(group);
    }
    group.count += 1;
    group.nodeIds.push(nodeId);
  }

  return result;
}
