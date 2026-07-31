import type { WorkflowNodeType } from "@carbon/workflows";
import type { IsValidConnection } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow
} from "@xyflow/react";
import type { KeyboardEvent } from "react";
import { useCallback } from "react";
import type { BuilderEdge, BuilderNode } from "../../types";
import { NODE_DRAG_TYPE } from "./constants";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { edgeTypes } from "./edges/WorkflowEdge";
import { wouldCreateCycle } from "./graph";
import { NodePalette } from "./NodePalette";
import { nodeTypes } from "./nodes";

const proOptions = { hideAttribution: true };

// Overlays portal to document.body, so their keys are theirs — never the canvas's.
const OVERLAY_SELECTOR =
  "[data-radix-popper-content-wrapper],[role=menu],[role=listbox],[role=dialog]";

export function WorkflowBuilder() {
  const store = useBuilderStoreApi();
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useBuilderStore((state) => state.nodes);
  const edges = useBuilderStore((state) => state.edges);
  const isReadOnly = useBuilderStore((state) => state.isReadOnly);
  const onNodesChange = useBuilderStore((state) => state.onNodesChange);
  const onEdgesChange = useBuilderStore((state) => state.onEdgesChange);
  const onConnect = useBuilderStore((state) => state.onConnect);
  const setSelected = useBuilderStore((state) => state.setSelected);
  const addNode = useBuilderStore((state) => state.addNode);

  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      if (!connection.source || !connection.target) return false;
      return !wouldCreateCycle(
        store.getState().edges,
        connection.source,
        connection.target
      );
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
    <div className="flex flex-1 overflow-hidden">
      {!isReadOnly && <NodePalette />}
      <div
        className="relative flex-1"
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
          fitView
          nodesDraggable={!isReadOnly}
          nodesConnectable={!isReadOnly}
          elementsSelectable
          deleteKeyCode={isReadOnly ? null : ["Backspace", "Delete"]}
          onlyRenderVisibleElements
          defaultEdgeOptions={{ type: "workflow" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
