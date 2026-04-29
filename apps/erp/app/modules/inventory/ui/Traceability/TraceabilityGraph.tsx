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
import { cn } from "@carbon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  TrackedEntity
} from "~/modules/inventory";
import { QuantityEdge } from "./edges/QuantityEdge";
import { GraphLegend } from "./GraphLegend";
import { GraphToolbar, type ViewMode } from "./GraphToolbar";
import {
  computeDagreLayout,
  type LayoutDirection
} from "./hooks/useDagreLayout";
import { useExpandNode } from "./hooks/useExpandNode";
import { NodeSearchDialog } from "./NodeSearchDialog";
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

  const [expansions, setExpansions] = useState<Map<string, LineagePayload>>(
    () => new Map()
  );
  const [, setExhausted] = useState<Set<string>>(() => new Set());
  const [expandable, setExpandable] = useState<Set<string>>(() => new Set());
  const probeCacheRef = useRef<Map<string, LineagePayload>>(new Map());
  const probedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setExpansions(new Map());
    setExhausted(new Set());
    setExpandable(new Set());
    probeCacheRef.current = new Map();
    probedRef.current = new Set();
  }, [initialPayload]);

  const payload = useMemo<LineagePayload>(() => {
    let merged = initialPayload;
    for (const exp of expansions.values()) {
      merged = mergePayloads(merged, exp);
    }
    return merged;
  }, [initialPayload, expansions]);

  const [direction, setDirection] = useState<LayoutDirection>(() => {
    if (typeof window === "undefined") return "TB";
    return (localStorage.getItem(DIR_KEY) as LayoutDirection) ?? "TB";
  });

  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "graph";
    return (localStorage.getItem(VIEW_KEY) as ViewMode) ?? "graph";
  });

  const [isolate, setIsolate] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [spacing, setSpacing] = useState<number>(() => {
    if (typeof window === "undefined") return 2;
    const stored = Number(localStorage.getItem("traceability:spacing:v1"));
    return Number.isFinite(stored) && stored >= 1 && stored <= 5 ? stored : 2;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("traceability:spacing:v1", String(spacing));
    }
  }, [spacing]);

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
      direction,
      spacing
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
  }, [payload, direction, rejectIds, layoutVersion, spacing]);

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
    const t = setTimeout(() => setLayoutAnimating(false), 220);
    return () => clearTimeout(t);
  }, [laidNodes, laidEdges, setNodes, setEdges]);

  const selectedId = selectedIdProp ?? null;

  const setSelected = useCallback(
    (id: string | null) => {
      onSelect?.(id);
    },
    [onSelect]
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
        setExhausted((prev) => {
          if (prev.has(originId)) return prev;
          const next = new Set(prev);
          next.add(originId);
          return next;
        });
        return;
      }

      setExpansions((prev) => {
        const next = new Map(prev);
        next.set(originId, incoming);
        return next;
      });
    },
    [payload]
  );

  const { expand, isLoading: isExpanding } = useExpandNode(onExpandResult);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      setSelected(node.id);
      if ((node.data as any)?.kind !== "entity") return;
      if (expansions.has(node.id)) {
        setExpansions((prev) => {
          const next = new Map(prev);
          next.delete(node.id);
          return next;
        });
        return;
      }
      const cached = probeCacheRef.current.get(node.id);
      if (cached) {
        setExpansions((prev) => {
          const next = new Map(prev);
          next.set(node.id, cached);
          return next;
        });
        return;
      }
      expand(node.id, "both", 1);
    },
    [setSelected, expand, expansions]
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

  const boundaryByNode = useMemo(() => {
    const incoming = new Set<string>();
    const outgoing = new Set<string>();
    for (const e of edges) {
      incoming.add(e.target);
      outgoing.add(e.source);
    }
    return { incoming, outgoing };
  }, [edges]);

  useEffect(() => {
    let cancelled = false;
    const candidates = payload.entities.filter((e) => {
      if (probedRef.current.has(e.id)) return false;
      const hasIn = boundaryByNode.incoming.has(e.id);
      const hasOut = boundaryByNode.outgoing.has(e.id);
      return !hasIn || !hasOut;
    });
    if (candidates.length === 0) return;

    const knownEntityIds = new Set(payload.entities.map((e) => e.id));
    const knownActivityIds = new Set(payload.activities.map((a) => a.id));

    for (const ent of candidates) {
      probedRef.current.add(ent.id);
      const params = new URLSearchParams({
        trackedEntityId: ent.id,
        direction: "both",
        depth: "1"
      });
      fetch(`/api/traceability/expand?${params.toString()}`)
        .then((r) => r.json() as Promise<LineagePayload>)
        .then((res) => {
          if (cancelled) return;
          const hasNew =
            res.entities.some((e) => !knownEntityIds.has(e.id)) ||
            res.activities.some((a) => !knownActivityIds.has(a.id));
          if (hasNew) {
            probeCacheRef.current.set(ent.id, res);
            setExpandable((prev) => {
              if (prev.has(ent.id)) return prev;
              const next = new Set(prev);
              next.add(ent.id);
              return next;
            });
          } else {
            setExhausted((prev) => {
              if (prev.has(ent.id)) return prev;
              const next = new Set(prev);
              next.add(ent.id);
              return next;
            });
          }
        })
        .catch(() => {
          // probe fail = silently leave indicator off
        });
    }

    return () => {
      cancelled = true;
    };
  }, [payload, boundaryByNode]);

  const enrichedNodes = useMemo<Node[]>(() => {
    return nodes.map((n) => {
      const isRoot = n.id === rootId;
      const selected = n.id === selectedId;
      const dimmed = isolated ? !isolated.has(n.id) : false;
      const isExpanded = expansions.has(n.id);
      const isEntity = (n.data as any)?.kind === "entity";
      const isExpandable = expandable.has(n.id);
      const canExpandUp =
        isEntity && isExpandable && !boundaryByNode.incoming.has(n.id);
      const canExpandDown =
        isEntity && isExpandable && !boundaryByNode.outgoing.has(n.id);
      return {
        ...n,
        data: {
          ...(n.data as any),
          isRoot,
          selected,
          dimmed,
          isExpanded,
          canExpandUp,
          canExpandDown
        },
        selected
      };
    });
  }, [
    nodes,
    rootId,
    selectedId,
    isolated,
    expansions,
    boundaryByNode,
    expandable
  ]);

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
          onOpenSearch={() => setSearchOpen(true)}
          spacing={spacing}
          onSpacingChange={setSpacing}
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
          transition: transform 180ms ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          .trace-layout-animating .react-flow__node { transition: none; }
        }
      `}</style>
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
        <MiniMap
          pannable
          zoomable
          className="!bg-card !border-border"
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
        onSelect={(id) => setSelected(id)}
      />

      {isExpanding && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-sm">
          Loading...
        </div>
      )}
    </div>
  );
}
