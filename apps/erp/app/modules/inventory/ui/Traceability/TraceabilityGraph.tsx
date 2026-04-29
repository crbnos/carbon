import { cn } from "@carbon/react";
import {
  Background,
  BackgroundVariant,
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
import { useShallow } from "zustand/react/shallow";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";
import { clampDepth } from "./constants";
import { QuantityEdge } from "./edges/QuantityEdge";
import { GraphLegend } from "./GraphLegend";
import { GraphToolbar } from "./GraphToolbar";
import { useExpandNode } from "./hooks/useExpandNode";
import { useProbeBoundary } from "./hooks/useProbeBoundary";
import {
  ACTIVITY_KIND_META,
  activityKindFor,
  entityStatusMeta
} from "./metadata";
import { NodeSearchDialog } from "./NodeSearchDialog";
import { ActivityNode } from "./nodes/ActivityNode";
import { EntityNode } from "./nodes/EntityNode";
import { useTraceabilityStore } from "./store";
import { TraceabilityTable } from "./TraceabilityTable";
import {
  type LineageEdge,
  type LineageNode,
  type LineagePayload,
  mergePayloads
} from "./utils";
import {
  useAsyncLayout,
  useAsyncSelectionPath,
  useTracingGraphManager
} from "./worker/hooks";

const nodeTypes: NodeTypes = {
  entity: EntityNode as any,
  activity: ActivityNode as any
};

const edgeTypes: EdgeTypes = {
  quantity: QuantityEdge as any
};

const proOptions = { hideAttribution: true };

const EMPTY_NODES: LineageNode[] = [];
const EMPTY_EDGES: LineageEdge[] = [];

type Props = {
  entities: TrackedEntity[];
  activities: Activity[];
  inputs: ActivityInput[];
  outputs: ActivityOutput[];
  stepRecords?: import("./utils").StepRecord[];
  containments?: import("./utils").IssueContainment[];
  rootId: string;
  rootType: "entity" | "activity" | "job";
  width: number;
  height: number;
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
  stepRecords,
  containments,
  rootId,
  rootType,
  width,
  height
}: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastFitSignatureRef = useRef<string>("");

  const initialPayload = useMemo<LineagePayload>(
    () => ({
      entities,
      activities,
      inputs,
      outputs,
      stepRecords,
      containments
    }),
    [entities, activities, inputs, outputs, stepRecords, containments]
  );

  const expansions = useTraceabilityStore((s) => s.expansions);
  const expandable = useTraceabilityStore((s) => s.expandable);
  const {
    addExpansion,
    removeExpansion,
    markExpandable,
    markExhausted,
    reset: resetStore,
    setDirection,
    setView,
    setSpacing,
    setIsolate,
    setSelectedSingle,
    toggleSelected
  } = useTraceabilityStore(
    useShallow((s) => ({
      addExpansion: s.addExpansion,
      removeExpansion: s.removeExpansion,
      markExpandable: s.markExpandable,
      markExhausted: s.markExhausted,
      reset: s.reset,
      setDirection: s.setDirection,
      setView: s.setView,
      setSpacing: s.setSpacing,
      setIsolate: s.setIsolate,
      setSelectedSingle: s.setSelectedSingle,
      toggleSelected: s.toggleSelected
    }))
  );
  const probeCacheRef = useRef<Map<string, LineagePayload>>(new Map());
  const probedRef = useRef<Set<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on payload identity change (loader refetch)
  useEffect(() => {
    resetStore(rootId);
    probeCacheRef.current = new Map();
    probedRef.current = new Set();
  }, [initialPayload, resetStore, rootId]);

  const payload = useMemo<LineagePayload>(() => {
    let merged = initialPayload;
    for (const exp of expansions.values()) {
      merged = mergePayloads(merged, exp);
    }
    return merged;
  }, [initialPayload, expansions]);

  const direction = useTraceabilityStore((s) => s.direction);
  const view = useTraceabilityStore((s) => s.view);
  const spacing = useTraceabilityStore((s) => s.spacing);
  const isolate = useTraceabilityStore((s) => s.isolate);
  const [searchOpen, setSearchOpen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (e.key === "/" || isMeta) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          if (!isMeta) return;
        }
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const handleRelayout = useCallback(() => {
    setLayoutVersion((v) => v + 1);
  }, []);

  const [draggedIds, setDraggedIds] = useState<Set<string>>(new Set());
  const [fitted, setFitted] = useState(false);

  useEffect(() => {
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

  const tracingGraphManager = useTracingGraphManager();
  const layoutResult = useAsyncLayout(
    tracingGraphManager,
    payload,
    direction,
    spacing,
    rejectIds,
    layoutVersion
  );
  const laidNodes = layoutResult?.nodes ?? EMPTY_NODES;
  const laidEdges = layoutResult?.edges ?? EMPTY_EDGES;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    laidNodes as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    laidEdges as Edge[]
  );

  const [layoutAnimating, setLayoutAnimating] = useState(false);
  useEffect(() => {
    setNodes(laidNodes as Node[]);
    setEdges(laidEdges as Edge[]);
    setDraggedIds(new Set());
    setLayoutAnimating(true);
    const t = setTimeout(() => setLayoutAnimating(false), 260);
    return () => clearTimeout(t);
  }, [laidNodes, laidEdges, setNodes, setEdges]);

  const selectedIds = useTraceabilityStore((s) => s.selectedIds);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedId = selectedIds[0] ?? null;

  const onExpandResult = useCallback(
    (incoming: LineagePayload, originId: string) => {
      const knownEntityIds = new Set(payload.entities.map((e) => e.id));
      const knownActivityIds = new Set(payload.activities.map((a) => a.id));
      const hasNewEntity = incoming.entities.some(
        (e) => !knownEntityIds.has(e.id)
      );
      const hasNewActivity = incoming.activities.some(
        (a) => !knownActivityIds.has(a.id)
      );

      if (!hasNewEntity && !hasNewActivity) {
        markExhausted(originId);
        return;
      }

      addExpansion(originId, incoming);
    },
    [payload, markExhausted, addExpansion]
  );

  const { expand, isLoading: isExpanding } = useExpandNode(onExpandResult);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      const shift = event.shiftKey;
      if (shift) {
        toggleSelected(node.id);
        return;
      }
      setSelectedSingle(node.id);
    },
    [setSelectedSingle, toggleSelected]
  );

  const onExpandNode = useCallback(
    (id: string, direction: "up" | "down" | "both") => {
      const cached = probeCacheRef.current.get(id);
      if (cached) {
        addExpansion(id, cached);
        return;
      }
      expand(id, direction, 1);
    },
    [expand, addExpansion]
  );

  const onCollapseNode = useCallback(
    (id: string) => {
      removeExpansion(id);
    },
    [removeExpansion]
  );

  const onPaneClick = useCallback(() => {
    setSelectedSingle(null);
  }, [setSelectedSingle]);

  const selectionPath = useAsyncSelectionPath(
    tracingGraphManager,
    edges as unknown as LineageEdge[],
    selectedIds
  );

  const isolated = useMemo(() => {
    if (!isolate || selectedIds.length === 0) return null;
    if (selectionPath) return selectionPath;
    return {
      nodeIds: new Set(selectedIds),
      edgeIds: new Set<string>()
    };
  }, [isolate, selectedIds, selectionPath]);

  const boundaryByNode = useMemo(() => {
    const incoming = new Set<string>();
    const outgoing = new Set<string>();
    for (const e of edges) {
      incoming.add(e.target);
      outgoing.add(e.source);
    }
    return { incoming, outgoing };
  }, [edges]);

  useProbeBoundary({
    payload,
    boundaryByNode,
    markExpandable,
    markExhausted,
    probeCacheRef,
    probedRef
  });

  const containmentByEntity = useMemo(() => {
    const m = new Map<string, "Contained" | "Uncontained">();
    for (const c of payload.containments ?? []) {
      const prev = m.get(c.trackedEntityId);
      if (c.containmentStatus === "Uncontained" || !prev) {
        m.set(c.trackedEntityId, c.containmentStatus);
      }
    }
    return m;
  }, [payload.containments]);

  const enrichedNodes = useMemo<Node[]>(() => {
    const isJobRoot = rootType === "job";
    return nodes.map((n) => {
      const isRoot = !isJobRoot && n.id === rootId;
      const selected = selectedIdSet.has(n.id);
      const inPath = selectionPath?.nodeIds.has(n.id) ?? false;
      const dimmed = isolated ? !isolated.nodeIds.has(n.id) : false;
      const isExpanded = expansions.has(n.id);
      const isEntity = (n.data as any)?.kind === "entity";
      const isExpandable = expandable.has(n.id);
      const canExpandUp =
        isEntity && isExpandable && !boundaryByNode.incoming.has(n.id);
      const canExpandDown =
        isEntity && isExpandable && !boundaryByNode.outgoing.has(n.id);
      const containmentStatus = isEntity
        ? containmentByEntity.get(n.id)
        : undefined;
      return {
        ...n,
        data: {
          ...(n.data as any),
          isRoot,
          selected,
          inPath,
          dimmed,
          isExpanded,
          canExpandUp,
          canExpandDown,
          containmentStatus,
          onExpand: onExpandNode,
          onCollapse: onCollapseNode
        },
        selected
      };
    });
  }, [
    nodes,
    rootId,
    rootType,
    selectedIdSet,
    isolated,
    expansions,
    boundaryByNode,
    expandable,
    selectionPath,
    containmentByEntity,
    onExpandNode,
    onCollapseNode
  ]);

  const enrichedEdges = useMemo<Edge[]>(() => {
    return edges.map((e) => {
      const dimmed = isolated ? !isolated.edgeIds.has(e.id) : false;
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
    const isFirstFit = lastFitSignatureRef.current === "";
    lastFitSignatureRef.current = sig;
    const raf = requestAnimationFrame(() => {
      fitView({
        padding: 0.2,
        duration: isFirstFit ? 0 : 250,
        maxZoom: 1
      });
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
            onSelect={(id) => setSelectedSingle(id)}
          />
        </div>
        <GraphToolbar
          depth={clampDepth(Number(searchParams.get("depth") ?? 1))}
          onDepthChange={handleDepthChange}
          direction={direction}
          onDirectionChange={setDirection}
          view={view}
          onViewChange={setView}
          isolate={isolate}
          onIsolateChange={setIsolate}
          hasSelection={selectedIds.length > 0}
          onOpenSearch={() => setSearchOpen(true)}
          spacing={spacing}
          onSpacingChange={setSpacing}
        />
        <NodeSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          payload={payload}
          onSelect={(id) => setSelectedSingle(id)}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full h-full",
        layoutAnimating && "trace-layout-animating"
      )}
      style={{ width, height }}
    >
      <style>{`
        .trace-layout-animating .react-flow__node {
          transition: transform 220ms cubic-bezier(0.645, 0.045, 0.355, 1);
          will-change: transform;
        }
        .trace-fade-in {
          transition: opacity 150ms cubic-bezier(0.215, 0.61, 0.355, 1);
        }
        .trace-edge-path {
          transition: opacity 150ms cubic-bezier(0.215, 0.61, 0.355, 1),
                      stroke-width 150ms cubic-bezier(0.215, 0.61, 0.355, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .trace-layout-animating .react-flow__node { transition: none; }
          .trace-fade-in { transition: none; }
          .trace-edge-path { transition: none; }
        }
      `}</style>
      <ReactFlow
        nodes={enrichedNodes as Node[]}
        edges={enrichedEdges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        className="trace-fade-in"
        style={{ opacity: fitted ? 1 : 0 }}
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
        onlyRenderVisibleElements
        defaultEdgeOptions={{ type: "quantity", zIndex: 0 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={28}
          size={1}
          color="hsl(var(--muted-foreground) / 0.15)"
        />
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border-border"
          nodeColor={(n) => {
            const data = (n as any).data;
            if (data?.kind === "entity") {
              return entityStatusMeta(data.entity?.status).color;
            }
            return ACTIVITY_KIND_META[activityKindFor(data?.activity?.type)]
              .color;
          }}
          nodeStrokeWidth={0}
          maskColor="hsl(var(--background) / 0.7)"
        />
      </ReactFlow>

      <GraphToolbar
        depth={Math.min(Math.max(1, Number(searchParams.get("depth") ?? 1)), 5)}
        onDepthChange={handleDepthChange}
        direction={direction}
        onDirectionChange={setDirection}
        view={view}
        onViewChange={setView}
        isolate={isolate}
        onIsolateChange={setIsolate}
        hasSelection={selectedIds.length > 0}
        onRelayout={handleRelayout}
        onOpenSearch={() => setSearchOpen(true)}
        spacing={spacing}
        onSpacingChange={setSpacing}
      />

      <GraphLegend />

      <NodeSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        payload={payload}
        onSelect={(id) => setSelectedSingle(id)}
      />

      {isExpanding && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm">
          Loading...
        </div>
      )}
    </div>
  );
}
