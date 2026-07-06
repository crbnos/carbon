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
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
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
  containments?: import("./utils").IssueContainment[];
  rootId: string;
  rootType: "entity" | "activity" | "job";
  width: number;
  height: number;
};

export function TraceabilityGraph(props: Props) {
  return <TraceabilityGraphInner {...props} />;
}

function TraceabilityGraphInner({
  entities,
  activities,
  inputs,
  outputs,
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
      containments
    }),
    [entities, activities, inputs, outputs, containments]
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
    toggleExcluded,
    clearExcluded,
    toggleAdditionalRoot,
    clearAdditionalRoots
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
      toggleExcluded: s.toggleExcluded,
      clearExcluded: s.clearExcluded,
      toggleAdditionalRoot: s.toggleAdditionalRoot,
      clearAdditionalRoots: s.clearAdditionalRoots
    }))
  );
  const excludedIds = useTraceabilityStore((s) => s.excludedIds);
  const additionalRootIds = useTraceabilityStore((s) => s.additionalRootIds);
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

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node>(
    laidNodes as Node[]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    laidEdges as Edge[]
  );

  const shiftDownRef = useRef(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      // Auto-repeat fires keydown continuously; bail if already tracked.
      if (e.key !== "Shift" || shiftDownRef.current) return;
      shiftDownRef.current = true;
      setShiftHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !shiftDownRef.current) return;
      shiftDownRef.current = false;
      setShiftHeld(false);
    };
    const onBlur = () => {
      if (!shiftDownRef.current) return;
      shiftDownRef.current = false;
      setShiftHeld(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const onNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChangeRaw>[0]) => {
      if (shiftDownRef.current) {
        const filtered = changes.filter((c) => c.type !== "select");
        if (filtered.length > 0) onNodesChangeRaw(filtered);
        return;
      }
      onNodesChangeRaw(changes);
    },
    [onNodesChangeRaw]
  );

  const selectionPathRef = useRef<{ nodeIds: Set<string> } | null>(null);
  const additionalRootIdsRef = useRef<Set<string>>(additionalRootIds);
  additionalRootIdsRef.current = additionalRootIds;
  const excludedIdsRef = useRef<Set<string>>(excludedIds);
  excludedIdsRef.current = excludedIds;

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (event.shiftKey) {
        const id = node.id;
        if (excludedIdsRef.current.has(id)) {
          toggleExcluded(id);
          return;
        }
        if (additionalRootIdsRef.current.has(id)) {
          toggleAdditionalRoot(id);
          return;
        }
        const inPath = selectionPathRef.current?.nodeIds.has(id) ?? false;
        if (inPath) toggleExcluded(id);
        else toggleAdditionalRoot(id);
      } else {
        clearExcluded();
        clearAdditionalRoots();
      }
    },
    [toggleExcluded, toggleAdditionalRoot, clearExcluded, clearAdditionalRoots]
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

  const selectedIds = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].selected) out.push(nodes[i].id);
    }
    return out;
  }, [nodes]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedId = selectedIds[0] ?? null;

  const selectNode = useCallback(
    (id: string | null) => {
      setNodes((ns) =>
        ns.map((n) => {
          const wantsSelected = id !== null && n.id === id;
          if (n.selected === wantsSelected) return n;
          return { ...n, selected: wantsSelected };
        })
      );
    },
    [setNodes]
  );

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

  const selectionPath = useAsyncSelectionPath(
    tracingGraphManager,
    edges as unknown as LineageEdge[],
    selectedIds,
    excludedIds,
    additionalRootIds
  );
  selectionPathRef.current = selectionPath;

  const isolated = useMemo(() => {
    if (!isolate) return null;
    if (selectedIds.length === 0 && additionalRootIds.size === 0) return null;
    if (selectionPath) return selectionPath;
    const nodeIds = new Set<string>(selectedIds);
    for (const id of additionalRootIds) nodeIds.add(id);
    return { nodeIds, edgeIds: new Set<string>() };
  }, [isolate, selectedIds, additionalRootIds, selectionPath]);

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
      const excluded = excludedIds.has(n.id);
      const inPath = !excluded && (selectionPath?.nodeIds.has(n.id) ?? false);
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
          excluded,
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
    excludedIds,
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
            onSelect={(id) => selectNode(id)}
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
          hasSelection={selectedIds.length > 0 || additionalRootIds.size > 0}
          onOpenSearch={() => setSearchOpen(true)}
          spacing={spacing}
          onSpacingChange={setSpacing}
        />
        <NodeSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          payload={payload}
          onSelect={(id) => selectNode(id)}
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
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        onNodeClick={onNodeClick}
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
        hasSelection={selectedIds.length > 0 || additionalRootIds.size > 0}
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
        onSelect={(id) => selectNode(id)}
      />

      {isExpanding && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm">
          Loading...
        </div>
      )}

      {(() => {
        const traceCount =
          selectionPath?.nodeIds.size ??
          selectedIds.length + additionalRootIds.size;
        const traceActive =
          selectedIds.length > 0 ||
          additionalRootIds.size > 0 ||
          excludedIds.size > 0;
        const visible = shiftHeld || traceActive;
        if (!visible) return null;
        const clearAll = () => {
          if (selectedIds.length > 0) selectNode(null);
          clearExcluded();
          clearAdditionalRoots();
        };
        return (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full border border-border bg-card/95 backdrop-blur pl-2 pr-1 py-1 text-xs shadow-md">
            {traceActive ? (
              <>
                <span className="px-1 tabular-nums font-medium">
                  {traceCount}
                </span>
                <span className="text-muted-foreground">in trace</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="ml-1 flex items-center justify-center w-5 h-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Clear trace"
                  title="Clear trace"
                >
                  <LuX className="w-3 h-3" />
                </button>
              </>
            ) : (
              <span className="px-1 flex items-center gap-1.5 text-muted-foreground">
                <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-none text-foreground">
                  Shift
                </kbd>
                click to add or remove
              </span>
            )}
          </div>
        );
      })()}
    </div>
  );
}
