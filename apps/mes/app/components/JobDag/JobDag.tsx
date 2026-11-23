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
  type Rect,
  useReactFlow,
  useStore,
  useStoreApi
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
  dependencyId,
  effectiveDirection,
  fitViewport,
  type LayoutDirection,
  layoutOperations,
  MAX_ZOOM,
  MIN_ZOOM,
  openingViewport,
  windingColumns
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

const EMPTY_BOUNDS: Rect = { x: 0, y: 0, width: 0, height: 0 };

function computeLayout(
  operations: Operation[],
  dependencies: Dependency[],
  direction: LayoutDirection,
  columns: number,
  compact: boolean
): { nodes: Node[]; edges: Edge[]; bounds: Rect } {
  const opsById = new Map(operations.map((op) => [op.id, op]));
  const { positions, routes, bounds } = layoutOperations(
    operations.map((op) => op.id),
    dependencies,
    direction,
    columns,
    compact
  );

  const nodes: Node[] = operations.map((op) => {
    const position = positions.get(op.id)!;
    return {
      id: op.id,
      type: "jobOperation",
      position: { x: position.x, y: position.y },
      sourcePosition: position.sourcePosition,
      targetPosition: position.targetPosition,
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

  const edges: Edge[] = dependencies.flatMap((dep) => {
    const upstream = opsById.get(dep.dependsOnId);
    const downstream = opsById.get(dep.operationId);
    // A dependency on an operation that did not load has no node to reach.
    if (!upstream || !downstream) return [];
    const id = dependencyId(dep);
    return {
      id,
      source: dep.dependsOnId,
      target: dep.operationId,
      // React Flow's default names the edge by raw operation ids.
      ariaLabel: `${upstream.description ?? dep.dependsOnId} → ${
        downstream.description ?? dep.operationId
      }`,
      type: "jobOperationEdge",
      data: {
        quantity: Number(upstream.quantityComplete ?? 0),
        route: routes.get(id)
      }
    };
  });

  return { nodes, edges, bounds };
}

function JobDagInner({ operations, dependencies }: Props) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  // Phones read top to bottom until the operator picks a direction.
  const [chosenDirection, setDirection] = useState<LayoutDirection | null>(
    null
  );
  const store = useStoreApi();
  const { setViewport } = useReactFlow();
  // Subscribe to what the layout depends on, not to the pane size itself: a
  // resize that fits the same number of columns must not lay the graph out again.
  const ready = useStore((state) => state.width > 0 && state.height > 0);
  const columns = useStore((state) => windingColumns(state.width, isPhone));
  const direction = effectiveDirection(
    chosenDirection ?? (isPhone ? "TB" : "Winding"),
    ready ? columns : 2
  );
  const layoutColumns = direction === "Winding" ? columns : 1;
  // On a phone, fitting the whole graph shrinks nodes past reading size, so
  // fit no smaller than 0.6 and let the operator pan the rest.
  const minZoom = isPhone ? 0.6 : MIN_ZOOM;

  const { nodes, edges, bounds } = useMemo(
    () =>
      ready
        ? computeLayout(
            operations,
            dependencies,
            direction,
            layoutColumns,
            isPhone
          )
        : { nodes: [], edges: [], bounds: EMPTY_BOUNDS },
    [ready, operations, dependencies, direction, layoutColumns, isPhone]
  );

  // Position the viewport when the graph's shape changes. A refresh that only
  // changes quantities, or a resize, keeps the operator's pan and zoom.
  const { x, y, width, height } = bounds;
  useEffect(() => {
    if (!width || !height) return;
    void setViewport(
      openingViewport(
        { x, y, width, height },
        store.getState(),
        direction,
        minZoom
      )
    );
  }, [x, y, width, height, direction, minZoom, store, setViewport]);

  const toggleDirection = () => {
    const order: LayoutDirection[] =
      columns > 1 ? ["Winding", "LR", "TB"] : ["LR", "TB"];
    setDirection(order[(order.indexOf(direction) + 1) % order.length]);
  };

  const fit = () => {
    void setViewport(fitViewport(bounds, store.getState(), minZoom), {
      duration: 200
    });
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
          onClick={fit}
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
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={proOptions}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // The link inside each node is the one tab stop.
          nodesFocusable={false}
          edgesFocusable={false}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
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
