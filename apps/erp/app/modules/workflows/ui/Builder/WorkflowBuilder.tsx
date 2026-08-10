import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@carbon/react";
import type { WorkflowNodeType } from "@carbon/workflows";
import type { IsValidConnection } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow
} from "@xyflow/react";
import type { KeyboardEvent } from "react";
import { useCallback } from "react";
import type { BuilderEdge, BuilderNode } from "../../types";
import type { WorkflowCanvasState } from "../../workflows.models";
import { BuilderControls } from "./BuilderControls";
import { NODE_DRAG_TYPE } from "./constants";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { edgeTypes } from "./edges/WorkflowEdge";
import { canConnect } from "./graph";
import { NodePalette } from "./NodePalette";
import { nodeTypes } from "./nodes";
import { TestRunPanel } from "./TestRun/TestRunPanel";
import { FIT_VIEW_OPTIONS, useCanvasState } from "./useCanvasState";

const proOptions = { hideAttribution: true };

// Overlays portal to document.body, so their keys are theirs — never the canvas's.
const OVERLAY_SELECTOR =
  "[data-radix-popper-content-wrapper],[role=menu],[role=listbox],[role=dialog]";

type Props = {
  workflowId: string;
  canvasState: WorkflowCanvasState | null;
  /** Viewport is remembered for anyone who may edit, live version or not. */
  canPersistCanvasState: boolean;
};

export function WorkflowBuilder({
  workflowId,
  canvasState,
  canPersistCanvasState
}: Props) {
  const store = useBuilderStoreApi();
  const { screenToFlowPosition } = useReactFlow();
  const { panOnScroll, togglePanOnScroll, onMoveEnd, initialViewport } =
    useCanvasState({
      workflowId,
      initial: canvasState,
      canPersist: canPersistCanvasState
    });

  const nodes = useBuilderStore((state) => state.nodes);
  const edges = useBuilderStore((state) => state.edges);
  const isReadOnly = useBuilderStore((state) => state.isReadOnly);
  const showResults = useBuilderStore(
    (state) => state.testRunStatus === "running" || state.testRunResult !== null
  );
  const onNodesChange = useBuilderStore((state) => state.onNodesChange);
  const onEdgesChange = useBuilderStore((state) => state.onEdgesChange);
  const onConnect = useBuilderStore((state) => state.onConnect);
  const setSelected = useBuilderStore((state) => state.setSelected);
  const addNode = useBuilderStore((state) => state.addNode);

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const { nodes, edges } = store.getState();
      return canConnect(nodes, edges, {
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target
      });
    },
    [store]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (isReadOnly) return;

      const type = event.dataTransfer.getData(NODE_DRAG_TYPE);
      if (!type) return;

      addNode(
        type as WorkflowNodeType,
        screenToFlowPosition({ x: event.clientX, y: event.clientY })
      );
    },
    [addNode, isReadOnly, screenToFlowPosition]
  );

  // A field with focus owns its keys; the canvas must not steal Delete/arrows.
  const onKeyDownCapture = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest(OVERLAY_SELECTOR)) {
      event.stopPropagation();
      return;
    }
    if (target.closest("input,textarea,select,[contenteditable=true]")) {
      event.stopPropagation();
    }
  }, []);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId="workflow-builder"
      className="flex-1 overflow-hidden"
    >
      {!isReadOnly && (
        <ResizablePanel
          id="palette"
          order={1}
          defaultSize={14}
          minSize={10}
          maxSize={22}
        >
          <NodePalette />
        </ResizablePanel>
      )}
      {!isReadOnly && <ResizableHandle withHandle />}
      <ResizablePanel id="canvas" order={2} defaultSize={62} minSize={30}>
        <div
          className="relative h-full"
          onKeyDownCapture={onKeyDownCapture}
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
        >
          <ReactFlow<BuilderNode, BuilderEdge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            proOptions={proOptions}
            minZoom={0.25}
            maxZoom={2}
            fitViewOptions={FIT_VIEW_OPTIONS}
            {...(initialViewport
              ? { defaultViewport: initialViewport }
              : { fitView: true })}
            onMoveEnd={onMoveEnd}
            nodesDraggable={!isReadOnly}
            nodesConnectable={!isReadOnly}
            elementsSelectable
            // Delete only. Backspace is too easy to hit by accident, and there
            // is no undo — autosave persists the deletion a second later.
            deleteKeyCode={isReadOnly ? null : ["Delete"]}
            onlyRenderVisibleElements
            defaultEdgeOptions={{ type: "workflow" }}
            panOnScroll={panOnScroll}
            zoomOnScroll={!panOnScroll}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} />
            <BuilderControls
              panOnScroll={panOnScroll}
              onTogglePanOnScroll={togglePanOnScroll}
            />
          </ReactFlow>
        </div>
      </ResizablePanel>
      {showResults && <ResizableHandle withHandle />}
      {showResults && (
        <ResizablePanel id="results" order={3} defaultSize={24} minSize={18}>
          <TestRunPanel />
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
}
