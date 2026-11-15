// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  useViewport,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  Background,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowRight,
  LuArrowRightLeft,
  LuInfo,
  LuMaximize
} from "react-icons/lu";
import { JobOperationEdge } from "./JobOperationEdge";
import { JobOperationNode } from "./JobOperationNode";
import {
  dependencyHandles,
  type LayoutDirection,
  layoutOperations,
  NODE_HEIGHT,
  NODE_WIDTH
} from "./layout";

const nodeTypes: NodeTypes = {
  jobOperation: JobOperationNode as any
};

const edgeTypes: EdgeTypes = {
  jobOperationEdge: JobOperationEdge as any
};

const proOptions = { hideAttribution: true };

type Dependency = {
  operationId: string;
  dependsOnId: string;
};

type Operation = {
  id: string;
  description: string | null;
  status: string | null;
  quantityComplete: number | null;
  targetQuantity: number | null;
  quantityReworked: number | null;
  quantityScrapped: number | null;
  reworkId: string | null;
  jobOperationBatch?: {
    readableId: string | null;
    status: string | null;
  } | null;
  jobMakeMethod: {
    item: { readableIdWithRevision: string | null } | null;
  } | null;
};

type Props = {
  operations: Operation[];
  dependencies: Dependency[];
};

function computeLayout(
  operations: Operation[],
  dependencies: Dependency[],
  direction: LayoutDirection,
  compact: boolean,
  width: number
): { nodes: Node[]; edges: Edge[] } {
  const opsById = new Map(operations.map((op) => [op.id, op]));
  const positions = layoutOperations(
    operations.map((op) => op.id),
    dependencies,
    direction,
    width,
    compact
  );

  const nodes: Node[] = operations.map((op) => {
    const position = positions.get(op.id)!;
    return {
      id: op.id,
      type: "jobOperation",
      position: { x: position.x, y: position.y },
      data: {
        id: op.id,
        description: op.description ?? "Untitled",
        itemId: op.jobMakeMethod?.item?.readableIdWithRevision ?? null,
        status: op.status ?? "Todo",
        quantityComplete: Number(op.quantityComplete ?? 0),
        targetQuantity: Number(op.targetQuantity ?? 0),
        quantityReworked: Number(op.quantityReworked ?? 0),
        quantityScrapped: Number(op.quantityScrapped ?? 0),
        isRework: !!op.reworkId,
        // Only a live batch is a working state worth labelling on the DAG.
        batchReadableId:
          op.jobOperationBatch &&
          (op.jobOperationBatch.status === "Active" ||
            op.jobOperationBatch.status === "Completing")
            ? op.jobOperationBatch.readableId
            : null
      }
    };
  });

  const edges: Edge[] = dependencies.map((dep) => {
    const upstream = opsById.get(dep.dependsOnId);
    const downstream = opsById.get(dep.operationId);
    const handles = dependencyHandles(
      positions.get(dep.dependsOnId)!,
      positions.get(dep.operationId)!,
      direction
    );
    return {
      id: `${dep.dependsOnId}-${dep.operationId}`,
      source: dep.dependsOnId,
      target: dep.operationId,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      // React Flow's default names the edge by raw operation ids.
      ariaLabel: `${upstream?.description ?? dep.dependsOnId} → ${
        downstream?.description ?? dep.operationId
      }`,
      type: "jobOperationEdge",
      data: {
        quantity: Number(upstream?.quantityComplete ?? 0),
        vertical: direction === "Winding" && handles.vertical
      }
    };
  });

  return { nodes, edges };
}

function useGraphViewport(
  nodes: Node[],
  direction: LayoutDirection,
  width: number,
  height: number,
  isPhone: boolean
) {
  const { fitView, setViewport } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    if (!width || !height || !nodesInitialized || !nodes.length) return;

    // Start long winding graphs at the first row instead of centering their
    // full height at tiny zoom.
    const frame = requestAnimationFrame(() => {
      let graphWidth = 0;
      let graphHeight = 0;
      for (const node of nodes) {
        graphWidth = Math.max(graphWidth, node.position.x + NODE_WIDTH + 40);
        graphHeight = Math.max(graphHeight, node.position.y + NODE_HEIGHT + 40);
      }
      if (direction === "Winding" && graphHeight > height) {
        const zoom = Math.min(1, Math.max(0.6, (width - 32) / graphWidth));
        void setViewport({
          x: (width - graphWidth * zoom) / 2,
          y: 24 - 40 * zoom,
          zoom
        });
      } else {
        void fitView({ padding: 0.1, minZoom: isPhone ? 0.6 : 0.1 });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [
    nodes,
    direction,
    width,
    height,
    isPhone,
    nodesInitialized,
    fitView,
    setViewport
  ]);
}

function JobDagInner({ operations, dependencies }: Props) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  // Phones read top to bottom until the operator picks a direction.
  const [chosenDirection, setDirection] = useState<LayoutDirection | null>(
    null
  );
  const direction = chosenDirection ?? (isPhone ? "TB" : "Winding");
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const { fitView } = useReactFlow();

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => computeLayout(operations, dependencies, direction, isPhone, width),
    [operations, dependencies, direction, isPhone, width]
  );

  useGraphViewport(layoutNodes, direction, width, height, isPhone);

  const toggleDirection = () => {
    setDirection(
      direction === "Winding" ? "LR" : direction === "LR" ? "TB" : "Winding"
    );
  };

  return (
    <div className="relative flex flex-col h-full w-full">
      {/* Phones: the toolbar floats over the canvas, bottom-right. */}
      <HStack
        className="border-b border-border px-3 py-1.5 bg-card max-md:absolute max-md:right-4 max-md:bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:z-20 max-md:border-0 max-md:bg-transparent max-md:p-0"
        spacing={2}
      >
        <button
          type="button"
          onClick={toggleDirection}
          className={cn(
            "h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1.5 max-md:h-11 max-md:px-3",
            "border border-border bg-background hover:bg-accent/60 transition-colors"
          )}
        >
          {direction === "Winding" ? (
            <LuArrowRightLeft className="w-3.5 h-3.5" />
          ) : direction === "LR" ? (
            <LuArrowRight className="w-3.5 h-3.5" />
          ) : (
            <LuArrowDown className="w-3.5 h-3.5" />
          )}
          {direction === "Winding"
            ? t`Winding`
            : direction === "LR"
              ? t`Left to Right`
              : t`Top to Bottom`}
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.1, duration: 200 })}
          className={cn(
            "h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1.5 max-md:h-11 max-md:px-3",
            "border border-border bg-background hover:bg-accent/60 transition-colors"
          )}
        >
          <LuMaximize className="w-3.5 h-3.5" />
          {t`Fit`}
        </button>
      </HStack>

      <div className="relative flex-1">
        <ReactFlow
          nodes={layoutNodes}
          edges={layoutEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={proOptions}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // The link inside each node is the one tab stop.
          nodesFocusable={false}
          edgesFocusable={false}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background gap={20} size={1} />
          {direction !== "Winding" && (
            <MiniMap
              nodeStrokeWidth={3}
              pannable
              zoomable
              className="!bg-card !border-border max-md:!hidden"
            />
          )}
        </ReactFlow>
        <DagLegend />
      </div>
    </div>
  );
}

export function JobDag(props: Props) {
  return (
    <ReactFlowProvider>
      <JobDagInner {...props} />
    </ReactFlowProvider>
  );
}

function DagLegend() {
  const { t } = useLingui();
  const entries = [
    { label: "Done", className: "border-green-500 bg-green-500" },
    { label: "In Progress", className: "border-blue-500 bg-blue-500" },
    { label: "Ready", className: "border-teal-500 bg-teal-500" },
    { label: "Waiting", className: "border-gray-400 bg-gray-400" },
    { label: "Todo", className: "border-gray-300 bg-gray-300" },
    { label: "Paused", className: "border-amber-500 bg-amber-500" },
    { label: "Canceled", className: "border-red-500 bg-red-500" }
  ];

  return (
    <div className="absolute bottom-3 left-3 z-20">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t`Show legend`}
            className={cn(
              "h-8 w-8 rounded-md flex items-center justify-center transition-colors",
              "border border-border bg-card/90 backdrop-blur shadow-sm",
              "text-muted-foreground hover:text-foreground hover:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <LuInfo className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="w-auto p-3 border-border"
        >
          <span className="block text-[0.625rem] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Operation Status
          </span>
          <VStack spacing={2}>
            {entries.map((entry) => (
              <HStack key={entry.label} spacing={3} className="items-center">
                <div
                  className={cn("w-4 h-4 rounded border-2", entry.className)}
                />
                <span className="text-[0.8125rem] text-foreground">
                  {entry.label}
                </span>
              </HStack>
            ))}
          </VStack>
        </PopoverContent>
      </Popover>
    </div>
  );
}
