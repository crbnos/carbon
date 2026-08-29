import type {
  BatchPlan,
  WorkflowIssue,
  WorkflowNodeType
} from "@carbon/workflows";
import {
  getNodeHandles,
  slugifyNodeName,
  uniqueNodeName
} from "@carbon/workflows";
import type { Connection, EdgeChange, NodeChange } from "@xyflow/react";
import { addEdge, applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { nanoid } from "nanoid";
import { createStore } from "zustand";
import type { BuilderEdge, BuilderNode } from "../../types";
import type { RunStepView } from "../Runs/WorkflowRunSteps";
import {
  asWorkflowNode,
  canConnect,
  createNode,
  fromReactFlow,
  nextNodePosition,
  toBuilderNode
} from "./graph";
import { layoutPositions } from "./layout";

export type SaveState = "idle" | "saving" | "saved" | "error";

export type TestRunResult = {
  status: "Succeeded" | "Failed";
  steps: RunStepView[];
  /** More steps were written than the reader returned — say so rather than cap silently. */
  truncated: boolean;
  /** Why it failed — a refused request, or a run that failed before any step ran. */
  error: string | null;
  /** What has to be fixed before it can run at all. Listed in the run panel, not the
   * publish one — the author asked to run, not to publish. */
  issues: WorkflowIssue[];
};

export type BuilderState = {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  selectedNodeId: string | null;
  /** What the last publish attempt found. Only replaced by another attempt. */
  issues: WorkflowIssue[];
  /** Broken variables, recomputed as the graph is edited. Kept apart from `issues`
   * so a publish attempt and a live edit never overwrite each other's findings. */
  liveIssues: WorkflowIssue[];
  /** Which action steps repeat and over what, by node id — derived from the wiring
   * alongside `liveIssues`, and absent for a step that runs once. */
  batchPlans: Record<string, BatchPlan>;
  saveState: SaveState;
  /** This version is the promoted one. Behaviour edits are refused; positions are not. */
  isVersionLocked: boolean;
  /** The viewer holds workflows_update. */
  canEdit: boolean;
  /** Config, nodes, edges and expand state — everything that changes what it does. */
  canChangeDefinition: boolean;
  /** Layout only. Follows permission, NOT the lock: tidying a live version is allowed. */
  canMoveNodes: boolean;
  /** The viewer owns this workflow, so they may fire a test run. */
  isOwner: boolean;
  /** The trigger node whose test-run dialog is open, or null. */
  testRunFor: string | null;
  testRunStatus: "idle" | "running";
  testRunResult: TestRunResult | null;
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
  setLiveIssues: (issues: WorkflowIssue[]) => void;
  setBatchPlans: (plans: Record<string, BatchPlan>) => void;
  setSaveState: (state: SaveState) => void;
  openTestRun: (nodeId: string) => void;
  closeTestRun: () => void;
  setTestRunStatus: (status: "idle" | "running") => void;
  setTestRunResult: (result: TestRunResult | null) => void;
  /** Mark `saved` (the snapshot that was actually persisted) as the new baseline. */
  rebaseline: (saved: string) => void;
  /** Merge a patch into one node's `data`. The only way node configuration changes. */
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  /** Rename a node. Slugifies the value and picks the nearest unique name if taken. */
  renameNode: (id: string, name: string) => void;
  /** Expand or collapse a node. Persists on the node itself, not in data. */
  setNodeExpanded: (id: string, expanded: boolean) => void;
  /** Expand or collapse every node at once. */
  setAllNodesExpanded: (expanded: boolean) => void;
  /** Re-flow the columns for the cards' current sizes. */
  arrangeNodes: () => void;
  /** Move nodes in bulk — how auto-arrange applies a computed layout. */
  setNodePositions: (
    positions: Record<string, { x: number; y: number }>
  ) => void;
  /** Delete a node and its edges. Refuses if it's the last trigger node. */
  removeNode: (id: string) => void;
};

/**
 * Runs `arrange` once the cards have been re-measured. A card's real height only
 * lands a frame or two after it expands, and arranging before then packs the
 * columns against a guessed height — which is where the extra gaps came from.
 */
function afterMeasure(arrange: () => void) {
  if (typeof requestAnimationFrame !== "function") return arrange();
  requestAnimationFrame(() => requestAnimationFrame(arrange));
}

export const snapshot = (nodes: BuilderNode[], edges: BuilderEdge[]) =>
  JSON.stringify(fromReactFlow(nodes, edges));

export function createBuilderStore(initial: {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  isVersionLocked: boolean;
  canEdit: boolean;
  isOwner: boolean;
}) {
  const canChangeDefinition = initial.canEdit && !initial.isVersionLocked;
  const canMoveNodes = initial.canEdit;

  return createStore<BuilderState>((set, get) => ({
    nodes: initial.nodes,
    edges: initial.edges,
    selectedNodeId: null,
    issues: [],
    liveIssues: [],
    batchPlans: {},
    saveState: "idle",
    isVersionLocked: initial.isVersionLocked,
    canEdit: initial.canEdit,
    canChangeDefinition,
    canMoveNodes,
    isOwner: initial.isOwner,
    testRunFor: null,
    testRunStatus: "idle",
    testRunResult: null,
    baseline: snapshot(initial.nodes, initial.edges),

    onNodesChange: (changes) => {
      const { canChangeDefinition, canMoveNodes, nodes } = get();

      // Position, size and selection carry no behaviour, so they follow permission
      // rather than the version lock — a live workflow can still be tidied and read.
      const isLayout = (c: NodeChange<BuilderNode>) =>
        c.type === "position" || c.type === "dimensions" || c.type === "select";

      let incoming = changes;
      if (!canChangeDefinition) {
        if (!canMoveNodes) return;
        incoming = changes.filter(isLayout);
        if (!incoming.length) return;
      }

      // Protect the last trigger — deletion is allowed only when another remains.
      const isRemove = (
        c: NodeChange<BuilderNode>
      ): c is { type: "remove"; id: string } => c.type === "remove";
      const triggerIds = new Set(
        nodes.filter((n) => n.type === "trigger").map((n) => n.id)
      );
      const triggerRemoveCount = incoming
        .filter(isRemove)
        .filter((c) => triggerIds.has(c.id)).length;
      const allowed =
        triggerRemoveCount >= triggerIds.size
          ? incoming.filter((c) => !(isRemove(c) && triggerIds.has(c.id)))
          : incoming;
      if (!allowed.length) return;

      set({ nodes: applyNodeChanges(allowed, nodes) });
    },

    onEdgesChange: (changes) => {
      const { canChangeDefinition, edges } = get();
      if (!canChangeDefinition) return;
      set({ edges: applyEdgeChanges(changes, edges) });
    },

    onConnect: (connection) => {
      const { canChangeDefinition, nodes, edges } = get();
      if (!canChangeDefinition) return;
      if (!canConnect(nodes, edges, connection)) return;

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
      const { canChangeDefinition, nodes, edges, selectedNodeId } = get();
      if (!canChangeDefinition) return;

      const takenNames = new Set(nodes.map((n) => n.name));
      const from = position
        ? undefined
        : nodes.find((node) => node.id === selectedNodeId);
      const node = createNode(
        type,
        position ?? nextNodePosition(nodes, from),
        takenNames
      );

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
    setLiveIssues: (liveIssues) => {
      // Identity matters: every card subscribes to this list, so a fresh empty array
      // on every keystroke would re-render the whole canvas for nothing.
      const current = get().liveIssues;
      if (current.length === 0 && liveIssues.length === 0) return;
      set({ liveIssues });
    },
    setBatchPlans: (plans) => {
      // Same identity rule as `liveIssues`: most graphs have no repeating step, and a
      // fresh empty object every 250 ms would re-render every card that reads one.
      const current = get().batchPlans;
      if (
        Object.keys(current).length === 0 &&
        Object.keys(plans).length === 0
      ) {
        return;
      }
      set({ batchPlans: plans });
    },
    setSaveState: (saveState) => set({ saveState }),
    openTestRun: (nodeId) => set({ testRunFor: nodeId }),
    // Deliberately keeps `testRunResult` — dismissing the dialog must not throw
    // away a result the author is still reading.
    closeTestRun: () => set({ testRunFor: null }),
    setTestRunStatus: (testRunStatus) => set({ testRunStatus }),
    setTestRunResult: (testRunResult) => set({ testRunResult }),
    // Takes the submitted snapshot, never `get()` — edits made while the save was
    // in flight must stay dirty or the next autosave skips them.
    rebaseline: (saved) => set({ baseline: saved }),

    // The single gate every node config form funnels through. Without it a live
    // version's trigger could be switched to Schedule and — autosave being off — the
    // edit silently evaporated on reload, with no toast and no explanation.
    updateNodeData: (id, patch) => {
      if (!get().canChangeDefinition) return;
      set(({ nodes }) => ({
        nodes: nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
        )
      }));
    },

    renameNode: (id, name) => {
      if (!get().canChangeDefinition) return;
      set(({ nodes }) => {
        const slug = slugifyNodeName(name);
        if (slug === "") return {};
        const taken = new Set(
          nodes.filter((n) => n.id !== id).map((n) => n.name)
        );
        const unique = uniqueNodeName(slug, taken);
        return {
          nodes: nodes.map((n) => (n.id === id ? { ...n, name: unique } : n))
        };
      });
    },

    // `expanded` rides along in the persisted definition, so collapsing a card is a
    // behaviour edit as far as the save route is concerned.
    setNodeExpanded: (id, expanded) => {
      if (!get().canChangeDefinition) return;
      set(({ nodes }) => ({
        nodes: nodes.map((n) => (n.id === id ? { ...n, expanded } : n))
      }));
      afterMeasure(get().arrangeNodes);
    },

    setAllNodesExpanded: (expanded) => {
      if (!get().canChangeDefinition) return;
      set(({ nodes }) => ({
        nodes: nodes.map((n) => ({ ...n, expanded }))
      }));
      afterMeasure(get().arrangeNodes);
    },

    arrangeNodes: () => {
      const { nodes, edges, canMoveNodes, setNodePositions } = get();
      if (!canMoveNodes) return;
      setNodePositions(layoutPositions(nodes, edges));
    },

    setNodePositions: (positions) => {
      const { canMoveNodes, nodes } = get();
      if (!canMoveNodes) return;
      set({
        nodes: nodes.map((n) =>
          positions[n.id] ? { ...n, position: positions[n.id] } : n
        )
      });
    },

    removeNode: (id) => {
      const { canChangeDefinition, nodes, edges, selectedNodeId } = get();
      if (!canChangeDefinition) return;
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      if (
        node.type === "trigger" &&
        nodes.filter((n) => n.type === "trigger").length <= 1
      )
        return;
      set({
        nodes: nodes.filter((n) => n.id !== id),
        edges: edges.filter((e) => e.source !== id && e.target !== id),
        selectedNodeId: selectedNodeId === id ? null : selectedNodeId
      });
    }
  }));
}
