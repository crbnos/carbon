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
import Dagre from "@dagrejs/dagre";
import { useLingui } from "@lingui/react/macro";
import {
  Background,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuArrowDown, LuArrowRight, LuInfo, LuMaximize } from "react-icons/lu";
import { JobOperationEdge } from "./JobOperationEdge";
import { JobOperationNode } from "./JobOperationNode";

type LayoutDirection = "LR" | "TB";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 90;

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
  compact: boolean
): { nodes: Node[]; edges: Edge[] } {
  const g = new Dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    // Phones: tighter spacing, so less panning at the 0.6 fit.
    nodesep: compact ? 24 : 80,
    ranksep: compact ? 56 : 120,
    edgesep: 30,
    marginx: 40,
    marginy: 40
  });
  g.setDefaultEdgeLabel(() => ({}));

  const opsById = new Map(operations.map((op) => [op.id, op]));

  for (const op of operations) {
    g.setNode(op.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const dep of dependencies) {
    g.setEdge(dep.dependsOnId, dep.operationId);
  }

  Dagre.layout(g);

  const isHorizontal = direction === "LR";

  const nodes: Node[] = operations.map((op) => {
    const pos = g.node(op.id);
    return {
      id: op.id,
      type: "jobOperation",
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2
      },
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
            : null,
        direction
      },
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      targetPosition: isHorizontal ? Position.Left : Position.Top
    };
  });

  const edges: Edge[] = dependencies.map((dep) => {
    const upstream = opsById.get(dep.dependsOnId);
    return {
      id: `${dep.dependsOnId}-${dep.operationId}`,
      source: dep.dependsOnId,
      target: dep.operationId,
      type: "jobOperationEdge",
      data: {
        quantity: Number(upstream?.quantityComplete ?? 0)
      }
    };
  });

  return { nodes, edges };
}

function JobDagInner({ operations, dependencies }: Props) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  // Phones read top to bottom until the operator picks a direction.
  const [chosenDirection, setDirection] = useState<LayoutDirection | null>(
    null
  );
  const direction = chosenDirection ?? (isPhone ? "TB" : "LR");
  const { fitView } = useReactFlow();
  // On a phone, fitting the whole graph shrinks nodes past reading size, so
  // fit no smaller than 0.6 and let the operator pan the rest.
  const fitViewOptions = useMemo(
    () => (isPhone ? { padding: 0.1, minZoom: 0.6 } : { padding: 0.1 }),
    [isPhone]
  );

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => computeLayout(operations, dependencies, direction, isPhone),
    [operations, dependencies, direction, isPhone]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
    setTimeout(() => fitView(fitViewOptions), 50);
  }, [layoutNodes, layoutEdges, setNodes, setEdges, fitView, fitViewOptions]);

  const toggleDirection = useCallback(() => {
    setDirection(direction === "LR" ? "TB" : "LR");
  }, [direction]);

  const handleFitView = useCallback(() => {
    fitView(fitViewOptions);
  }, [fitView, fitViewOptions]);

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
          {direction === "LR" ? (
            <LuArrowRight className="w-3.5 h-3.5" />
          ) : (
            <LuArrowDown className="w-3.5 h-3.5" />
          )}
          {direction === "LR" ? t`Left to Right` : t`Top to Bottom`}
        </button>
        <button
          type="button"
          onClick={handleFitView}
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
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={proOptions}
          fitView
          fitViewOptions={fitViewOptions}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background gap={20} size={1} />
          <MiniMap
            nodeStrokeWidth={3}
            pannable
            zoomable
            className="!bg-card !border-border max-md:!hidden"
          />
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
            aria-label="Show legend"
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
          <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Operation Status
          </span>
          <VStack spacing={2}>
            {entries.map((entry) => (
              <HStack key={entry.label} spacing={3} className="items-center">
                <div
                  className={cn("w-4 h-4 rounded border-2", entry.className)}
                />
                <span className="text-[13px] text-foreground">
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
