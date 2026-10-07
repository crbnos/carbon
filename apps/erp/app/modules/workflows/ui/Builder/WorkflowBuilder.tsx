// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WorkflowNodeType } from "@carbon/ee/workflows";
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  IconButton,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { IsValidConnection } from "@xyflow/react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow
} from "@xyflow/react";
import type { KeyboardEvent } from "react";
import { useCallback, useState } from "react";
import { LuPlus } from "react-icons/lu";
import { AppBarActions } from "~/components/Layout/Mobile";
import type { BuilderEdge, BuilderNode } from "../../types";
import type { WorkflowCanvasState } from "../../workflows.models";
import { BuilderControls } from "./BuilderControls";
import { NODE_DRAG_TYPE } from "./constants";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { edgeTypes } from "./edges/WorkflowEdge";
import { canConnect } from "./graph";
import { stopCanvasKeys } from "./NodeCard";
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
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const canChangeDefinition = useBuilderStore(
    (state) => state.canChangeDefinition
  );
  const canMoveNodes = useBuilderStore((state) => state.canMoveNodes);
  const isReadOnly = !canChangeDefinition;
  const showResults = useBuilderStore(
    (state) => state.testRunStatus === "running" || state.testRunResult !== null
  );
  const onNodesChange = useBuilderStore((state) => state.onNodesChange);
  const onEdgesChange = useBuilderStore((state) => state.onEdgesChange);
  const onConnect = useBuilderStore((state) => state.onConnect);
  const setSelected = useBuilderStore((state) => state.setSelected);
  const addNode = useBuilderStore((state) => state.addNode);
  const setTestRunResult = useBuilderStore((state) => state.setTestRunResult);
  const setTestRunStatus = useBuilderStore((state) => state.setTestRunStatus);

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
  // Node cards stop these at their own body — this is the backstop for anything
  // else in the canvas, and it leaves a bare pane's Delete alone.
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (
      target.closest(OVERLAY_SELECTOR) ||
      target.closest("input,textarea,select,[contenteditable=true]")
    ) {
      stopCanvasKeys(event);
    }
  }, []);

  const canvas = (
    <div
      className="relative h-full"
      onKeyDown={onKeyDown}
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
        nodesDraggable={canMoveNodes}
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
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <BuilderControls
          panOnScroll={panOnScroll}
          onTogglePanOnScroll={togglePanOnScroll}
        />
      </ReactFlow>
    </div>
  );

  // Phones: the canvas fills the page. The palette opens from the app bar +,
  // and a test run's result opens as a full-screen sheet; closing it discards
  // the result, as the desktop panel's close does.
  if (isPhone) {
    return (
      <div className="flex-1 overflow-hidden">
        {canvas}
        {!isReadOnly && (
          <>
            <AppBarActions>
              <IconButton
                aria-label={t`Add step`}
                icon={<LuPlus />}
                variant="ghost"
                size="lg"
                onClick={() => setPaletteOpen(true)}
              />
            </AppBarActions>
            <BottomSheet open={paletteOpen} onOpenChange={setPaletteOpen}>
              <BottomSheetContent>
                <BottomSheetHeader>
                  <BottomSheetTitle>
                    <Trans>Add step</Trans>
                  </BottomSheetTitle>
                </BottomSheetHeader>
                <BottomSheetBody>
                  <NodePalette onAdd={() => setPaletteOpen(false)} />
                </BottomSheetBody>
              </BottomSheetContent>
            </BottomSheet>
          </>
        )}
        <BottomSheet
          open={showResults}
          onOpenChange={(open) => {
            if (open) return;
            setTestRunResult(null);
            setTestRunStatus("idle");
          }}
        >
          <BottomSheetContent size="full">
            <BottomSheetTitle className="sr-only">
              <Trans>Test run</Trans>
            </BottomSheetTitle>
            <div className="min-h-0 flex-1">
              <TestRunPanel />
            </div>
          </BottomSheetContent>
        </BottomSheet>
      </div>
    );
  }

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
        {canvas}
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
