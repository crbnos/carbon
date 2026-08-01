import type { WorkflowIssue, WorkflowNodeType } from "@carbon/workflows";
import { getNodeHandles } from "@carbon/workflows";
import type { Connection, EdgeChange, NodeChange } from "@xyflow/react";
import { addEdge, applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { nanoid } from "nanoid";
import { createStore } from "zustand";
import type { BuilderEdge, BuilderNode } from "../../types";
import {
  asWorkflowNode,
  createNode,
  fromReactFlow,
  nextNodePosition,
  toBuilderNode,
  wouldCreateCycle
} from "./graph";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type BuilderState = {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string | null;
  issues: WorkflowIssue[];
  saveState: SaveState;
  isReadOnly: boolean;
  baseline: string;
  onNodesChange: (changes: NodeChange<BuilderNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<BuilderEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (
    type: WorkflowNodeType,
    position?: { x: number; y: number }
  ) => void;
  setSelected: (id: string | null) => void;
  setIssues: (issues: WorkflowIssue[]) => void;
  setSaveState: (state: SaveState) => void;
  rebaseline: () => void;
  /** Merge a patch into one node's `data`. The only way node configuration changes. */
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  /** Set or clear a node's customer-given name. Empty string clears it. */
  renameNode: (id: string, title: string) => void;
  /** Expand or collapse a node. Persists on the node itself, not in data. */
  setNodeExpanded: (id: string, expanded: boolean) => void;
  /** Delete a node and its edges. Refuses the trigger. */
  removeNode: (id: string) => void;
};

export const snapshot = (nodes: BuilderNode[], edges: BuilderEdge[]) =>
  JSON.stringify(fromReactFlow(nodes, edges));

export function createBuilderStore(initial: {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  isReadOnly: boolean;
}) {
  return createStore<BuilderState>((set, get) => ({
    nodes: initial.nodes,
    edges: initial.edges,
    selectedNodeId: null,
    issues: [],
    saveState: "idle",
    isReadOnly: initial.isReadOnly,
    baseline: snapshot(initial.nodes, initial.edges),

    onNodesChange: (changes) => {
      const { isReadOnly, nodes } = get();
      if (isReadOnly) return;

      // Every definition needs exactly one trigger, so its removal is dropped.
      const triggerId = nodes.find((node) => node.type === "trigger")?.id;
      const allowed = changes.filter(
        (change) => !(change.type === "remove" && change.id === triggerId)
      );
      if (!allowed.length) return;

      set({ nodes: applyNodeChanges(allowed, nodes) });
    },

    onEdgesChange: (changes) => {
      const { isReadOnly, edges } = get();
      if (isReadOnly) return;
      set({ edges: applyEdgeChanges(changes, edges) });
    },

    onConnect: (connection) => {
      const { isReadOnly, edges } = get();
      if (isReadOnly) return;
      if (!connection.source || !connection.target) return;
      if (wouldCreateCycle(edges, connection.source, connection.target)) return;

      const duplicate = edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.sourceHandle === connection.sourceHandle &&
          edge.target === connection.target
      );
      if (duplicate) return;

      set({
        edges: addEdge(
          {
            ...connection,
            id: nanoid(),
            targetHandle: "in",
            type: "workflow"
          },
          edges
        )
      });
    },

    // With an explicit position (a palette drag-drop) the node lands there,
    // unconnected. Without one (a palette click) it lands below the selection and
    // is wired from that node's first unused handle.
    addNode: (type, position) => {
      const { isReadOnly, nodes, edges, selectedNodeId } = get();
      if (isReadOnly) return;

      const from = position
        ? undefined
        : nodes.find((node) => node.id === selectedNodeId);
      const node = createNode(type, position ?? nextNodePosition(nodes, from));

      const freeHandle = from
        ? getNodeHandles(
            asWorkflowNode(from.id, from.type as WorkflowNodeType, from.data)
          ).find(
            (handle) =>
              !edges.some(
                (edge) =>
                  edge.source === from.id && edge.sourceHandle === handle
              )
          )
        : undefined;

      set({
        nodes: [...nodes, toBuilderNode(node)],
        edges:
          from && freeHandle
            ? [
                ...edges,
                {
                  id: nanoid(),
                  source: from.id,
                  sourceHandle: freeHandle,
                  target: node.id,
                  targetHandle: "in",
                  type: "workflow"
                }
              ]
            : edges,
        selectedNodeId: node.id
      });
    },

    setSelected: (id) => set({ selectedNodeId: id }),
    setIssues: (issues) => set({ issues }),
    setSaveState: (saveState) => set({ saveState }),
    rebaseline: () => {
      const { nodes, edges } = get();
      set({ baseline: snapshot(nodes, edges) });
    },

    updateNodeData: (id, patch) =>
      set(({ nodes }) => ({
        nodes: nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
        )
      })),

    renameNode: (id, title) =>
      set(({ nodes }) => ({
        nodes: nodes.map((n) =>
          n.id === id ? { ...n, title: title === "" ? undefined : title } : n
        )
      })),

    setNodeExpanded: (id, expanded) =>
      set(({ nodes }) => ({
        nodes: nodes.map((n) => (n.id === id ? { ...n, expanded } : n))
      })),

    removeNode: (id) => {
      const { nodes, edges, selectedNodeId } = get();
      const node = nodes.find((n) => n.id === id);
      if (!node || node.type === "trigger") return;
      set({
        nodes: nodes.filter((n) => n.id !== id),
        edges: edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: selectedNodeId === id ? null : selectedNodeId
      });
    }
  }));
}
