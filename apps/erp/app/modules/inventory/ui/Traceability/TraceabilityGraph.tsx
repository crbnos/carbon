import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type EdgeTypes,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";
import { QuantityEdge } from "./edges/QuantityEdge";
import { GraphToolbar, type ViewMode } from "./GraphToolbar";
import {
  computeDagreLayout,
  type LayoutDirection
} from "./hooks/useDagreLayout";
import { useExpandNode } from "./hooks/useExpandNode";
import { ActivityNode } from "./nodes/ActivityNode";
import { EntityNode } from "./nodes/EntityNode";
import { TraceabilityTable } from "./TraceabilityTable";
import {
  annotateEdgeWeights,
  type LineageEdge,
  type LineagePayload,
  lineagePathEdges,
  lineageReachable,
  mergePayloads,
  payloadToFlow
} from "./utils";

const nodeTypes: NodeTypes = {
  entity: EntityNode as any,
  activity: ActivityNode as any
};

const edgeTypes: EdgeTypes = {
  quantity: QuantityEdge as any
};

const proOptions = { hideAttribution: true };

const DIR_KEY = "traceability:dir:v1";
const VIEW_KEY = "traceability:view:v1";

type Props = {
  entities: TrackedEntity[];
  activities: Activity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
  rootId: string;
  rootType: "entity" | "activity";
  width: number;
  height: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
};

export function TraceabilityGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <TraceabilityGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function TraceabilityGraphInner({
  entities,
  activities,
  inputs,
  outputs,
  rootId,
  width,
  height,
  selectedId: selectedIdProp,
  onSelect
}: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastFitSignatureRef = useRef<string>("");

  const initialPayload = useMemo<LineagePayload>(
    () => ({ entities, activities, inputs, outputs }),
    [entities, activities, inputs, outputs]
  );

  const [payload, setPayload] = useState<LineagePayload>(initialPayload);

  useEffect(() => {
    setPayload(initialPayload);
  }, [initialPayload]);

  const [direction, setDirection] = useState<LayoutDirection>(() => {
    if (typeof window === "undefined") return "TB";
    return (localStorage.getItem(DIR_KEY) as LayoutDirection) ?? "TB";
  });

  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "graph";
    return (localStorage.getItem(VIEW_KEY) as ViewMode) ?? "graph";
  });

  const [isolate, setIsolate] = useState(false);

  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [fitted, setFitted] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(DIR_KEY, direction);
  }, [direction]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(VIEW_KEY, view);
    if (view === "graph") {
      lastFitSignatureRef.current = "";
      setFitted(false);
    }
  }, [view]);

  const rejectIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of payload.entities)
      if (e.status === "Rejected") set.add(e.id);
    return set;
  }, [payload.entities]);

  const { laidNodes, laidEdges } = useMemo(() => {
    const flow = payloadToFlow(payload);
    const weightedEdges = annotateEdgeWeights(flow.edges, rejectIds);
    const { positioned, backEdges, edgePoints } = computeDagreLayout(
      flow.nodes,
      weightedEdges,
      direction
    );
    const finalEdges: LineageEdge[] = weightedEdges.map((e) => ({
      ...e,
      data: {
        ...(e.data as any),
        isBackEdge: backEdges.has(e.id),
        points: edgePoints.get(e.id)
      }
    }));
    return { laidNodes: positioned, laidEdges: finalEdges };
  }, [payload, direction, rejectIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    laidNodes as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    laidEdges as Edge[]
  );

  useEffect(() => {
    setNodes(laidNodes as Node[]);
    setEdges(laidEdges as Edge[]);
    setDraggedIds(new Set());
  }, [laidNodes, laidEdges, setNodes, setEdges]);

  const selectedId = selectedIdProp ?? null;

  const setSelected = useCallback(
    (id: string | null) => {
      onSelect?.(id);
    },
    [onSelect]
  );

  const expandedRef = useRef<Set<string>>(new Set());

  const onExpandResult = useCallback(
    (incoming: LineagePayload, _originId: string) => {
      setPayload((current) => mergePayloads(current, incoming));
    },
    []
  );

  const { expand, isLoading: isExpanding } = useExpandNode(onExpandResult);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      setSelected(node.id);
      if ((node.data as any)?.kind !== "entity") return;
      if (expandedRef.current.has(node.id)) return;

      const hasOutgoing = edges.some((e) => e.source === node.id);
      const hasIncoming = edges.some((e) => e.target === node.id);
      const direction =
        !hasOutgoing && !hasIncoming
          ? "both"
          : !hasOutgoing
            ? "down"
            : !hasIncoming
              ? "up"
              : "both";
      expandedRef.current.add(node.id);
      expand(node.id, direction, 1);
    },
    [setSelected, edges, expand]
  );

  const onPaneClick = useCallback(() => {
    setSelected(null);
  }, [setSelected]);

  const selectionPath = useMemo(() => {
    if (!selectedId) return null;
    return lineagePathEdges(selectedId, edges as unknown as LineageEdge[]);
  }, [selectedId, edges]);

  const isolated = useMemo(() => {
    if (!isolate || !selectedId) return null;
    return lineageReachable(selectedId, edges as unknown as LineageEdge[]);
  }, [isolate, selectedId, edges]);

  const enrichedNodes = useMemo<Node[]>(() => {
    return nodes.map((n) => {
      const isRoot = n.id === rootId;
      const selected = n.id === selectedId;
      const dimmed = isolated ? !isolated.has(n.id) : false;
      return {
        ...n,
        data: { ...(n.data as any), isRoot, selected, dimmed },
        selected
      };
    });
  }, [nodes, rootId, selectedId, isolated]);

  const enrichedEdges = useMemo<Edge[]>(() => {
    return edges.map((e) => {
      const dimmed = isolated
        ? !(isolated.has(e.source) && isolated.has(e.target))
        : false;
      const highlighted = selectionPath?.edgeIds.has(e.id) ?? false;
      const touchesDragged =
        draggedIds.has(e.source) || draggedIds.has(e.target);
      const baseData = { ...((e.data as any) ?? {}) };
      if (touchesDragged) baseData.points = undefined;
      return {
        ...e,
        data: { ...baseData, dimmed, highlighted }
      };
    });
  }, [edges, isolated, selectionPath, draggedIds]);

  useEffect(() => {
    if (!nodesInitialized) return;
    if (view !== "graph") return;
    if (nodes.length === 0) return;
    if (width === 0 || height === 0) return;
    const sig = `${nodes.length}:${edges.length}:${rootId}:${direction}:${width}x${height}`;
    if (lastFitSignatureRef.current === sig) return;
    lastFitSignatureRef.current = sig;
    const raf = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 0, maxZoom: 1 });
      requestAnimationFrame(() => setFitted(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [
    nodesInitialized,
    nodes.length,
    edges.length,
    rootId,
    direction,
    view,
    width,
    height,
    fitView
  ]);

  const handleDepthChange = useCallback(
    (next: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("depth", String(next));
      navigate(`/x/traceability/graph?${params.toString()}`);
    },
    [navigate, searchParams]
  );

  if (view === "table") {
    return (
      <div className="relative w-full h-full" style={{ width, height }}>
        <div className="pt-14 w-full h-full overflow-auto">
          <TraceabilityTable
            payload={payload}
            rootId={rootId}
            selectedId={selectedId}
            onSelect={setSelected}
          />
        </div>
        <GraphToolbar
          depth={Math.min(
            Math.max(1, Number(searchParams.get("depth") ?? 2)),
            5
          )}
          onDepthChange={handleDepthChange}
          direction={direction}
          onDirectionChange={setDirection}
          view={view}
          onViewChange={setView}
          isolate={isolate}
          onIsolateChange={setIsolate}
          hasSelection={!!selectedId}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ width, height }}>
      <ReactFlow
        nodes={enrichedNodes as Node[]}
        edges={enrichedEdges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        style={{
          opacity: fitted ? 1 : 0,
          transition: "opacity 120ms ease-out"
        }}
        onNodeDragStart={(_, node) =>
          setDraggedIds((prev) => {
            if (prev.has(node.id)) return prev;
            const next = new Set(prev);
            next.add(node.id);
            return next;
          })
        }
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        proOptions={proOptions}
        minZoom={0.15}
        maxZoom={3}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
        elevateNodesOnSelect={false}
        defaultEdgeOptions={{ type: "quantity", zIndex: 0 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="hsl(var(--muted-foreground) / 0.15)"
        />
        <Controls
          showInteractive={false}
          className="!border-border !rounded-md overflow-hidden"
          style={
            {
              ["--xy-controls-button-background-color" as any]:
                "hsl(var(--card))",
              ["--xy-controls-button-background-color-hover" as any]:
                "hsl(var(--accent))",
              ["--xy-controls-button-color" as any]: "hsl(var(--foreground))",
              ["--xy-controls-button-color-hover" as any]:
                "hsl(var(--foreground))",
              ["--xy-controls-button-border-color" as any]: "hsl(var(--border))"
            } as React.CSSProperties
          }
        />
        <MiniMap
          pannable
          zoomable
          className="!bg-card/80 !backdrop-blur !border-border"
          nodeColor={(n) => {
            const data = (n as any).data;
            if (data?.kind === "entity") {
              const status = data.entity?.status;
              if (status === "Available") return "hsl(142 71% 45%)";
              if (status === "Rejected") return "hsl(0 84% 60%)";
              if (status === "On Hold") return "hsl(25 95% 53%)";
              if (status === "Reserved") return "hsl(220 9% 46%)";
              return "hsl(217 91% 60%)";
            }
            return "hsl(280 65% 60%)";
          }}
          nodeStrokeWidth={0}
          maskColor="hsl(var(--background) / 0.7)"
        />
      </ReactFlow>

      <GraphToolbar
        depth={Math.min(Math.max(1, Number(searchParams.get("depth") ?? 2)), 5)}
        onDepthChange={handleDepthChange}
        direction={direction}
        onDirectionChange={setDirection}
        view={view}
        onViewChange={setView}
        isolate={isolate}
        onIsolateChange={setIsolate}
        hasSelection={!!selectedId}
      />

      {isExpanding && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm">
          Loading...
        </div>
      )}
    </div>
  );
}
