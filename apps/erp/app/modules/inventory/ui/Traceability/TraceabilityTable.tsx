import { Badge, cn, HStack } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { ACTIVITY_KIND_META, activityKindFor } from "./metadata";
import TrackedEntityStatus from "./TrackedEntityStatus";
import { entityHeadline, type LineagePayload, sourceLinkHref } from "./utils";

type Props = {
  payload: LineagePayload;
  rootId: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

type Row = {
  kind: "entity" | "activity";
  id: string;
  depth: number;
  edgeQuantity?: number;
  edgeKind?: "input" | "output";
  isReference?: boolean;
  isLast?: boolean;
};

export function TraceabilityTable({
  payload,
  rootId,
  selectedId,
  onSelect
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const { entityById, activityById, downstream } = useMemo(() => {
    const entityById = new Map<string, TrackedEntity>();
    const activityById = new Map<string, Activity>();
    for (const e of payload.entities) entityById.set(e.id, e);
    for (const a of payload.activities) activityById.set(a.id, a);

    const downstream = new Map<
      string,
      { targetId: string; quantity: number; kind: "input" | "output" }[]
    >();
    const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    };

    for (const i of payload.inputs) {
      push(downstream, i.trackedEntityId, {
        targetId: i.trackedActivityId,
        quantity: i.quantity,
        kind: "input"
      });
      push(downstream, i.trackedActivityId, {
        targetId: i.trackedEntityId,
        quantity: i.quantity,
        kind: "input"
      });
    }
    for (const o of payload.outputs) {
      push(downstream, o.trackedActivityId, {
        targetId: o.trackedEntityId,
        quantity: o.quantity,
        kind: "output"
      });
      push(downstream, o.trackedEntityId, {
        targetId: o.trackedActivityId,
        quantity: o.quantity,
        kind: "output"
      });
    }

    return { entityById, activityById, downstream };
  }, [payload]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visited = new Set<string>();

    function kindOf(id: string): "entity" | "activity" {
      return entityById.has(id) ? "entity" : "activity";
    }

    function walk(
      id: string,
      depth: number,
      edgeQuantity?: number,
      edgeKind?: "input" | "output",
      isLast = true
    ) {
      if (visited.has(id)) {
        out.push({
          kind: kindOf(id),
          id,
          depth,
          edgeQuantity,
          edgeKind,
          isReference: true,
          isLast
        });
        return;
      }
      visited.add(id);
      out.push({
        kind: kindOf(id),
        id,
        depth,
        edgeQuantity,
        edgeKind,
        isLast
      });

      if (collapsed.has(id)) return;

      const children = downstream.get(id) ?? [];
      children.forEach((c, idx) => {
        walk(
          c.targetId,
          depth + 1,
          c.quantity,
          c.kind,
          idx === children.length - 1
        );
      });
    }

    walk(rootId, 0);
    return out;
  }, [rootId, downstream, entityById, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // When a selection arrives (e.g. from search), expand all ancestors and
  // scroll the row into view.
  useEffect(() => {
    if (!selectedId || selectedId === rootId) return;
    const path: string[] = [];
    const visited = new Set<string>();
    function find(id: string): boolean {
      if (visited.has(id)) return false;
      visited.add(id);
      if (id === selectedId) return true;
      const children = downstream.get(id) ?? [];
      for (const c of children) {
        if (find(c.targetId)) {
          path.push(id);
          return true;
        }
      }
      return false;
    }
    find(rootId);

    if (path.length > 0) {
      setCollapsed((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const ancestor of path) {
          if (next.has(ancestor)) {
            next.delete(ancestor);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    // Scroll row into view after expansion settles
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(selectedId);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [selectedId, rootId, downstream]);

  return (
    <div className="w-full h-full overflow-auto py-2">
      <div className="bg-card border-y border-border/40">
        {rows.map((row, i) => (
          <TreeRow
            key={`${row.id}:${i}`}
            row={row}
            entity={entityById.get(row.id)}
            activity={activityById.get(row.id)}
            isSelected={row.id === selectedId}
            isCollapsed={collapsed.has(row.id)}
            hasChildren={
              !row.isReference && (downstream.get(row.id)?.length ?? 0) > 0
            }
            onToggle={() => toggle(row.id)}
            onSelect={() => onSelect?.(row.id)}
            registerRef={(el) => {
              if (el) rowRefs.current.set(row.id, el);
              else rowRefs.current.delete(row.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  row,
  entity,
  activity,
  isSelected,
  isCollapsed,
  hasChildren,
  onToggle,
  onSelect,
  registerRef
}: {
  row: Row;
  entity: TrackedEntity | undefined;
  activity: Activity | undefined;
  isSelected: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onSelect: () => void;
  registerRef?: (el: HTMLButtonElement | null) => void;
}) {
  if (row.kind === "entity") {
    if (!entity) return null;
    const headline = entityHeadline(entity, 12);
    const href = sourceLinkHref(entity.sourceDocument, entity.sourceDocumentId);
    return (
      <button
        ref={registerRef}
        type="button"
        onClick={onSelect}
        className={cn(
          "group w-full flex items-center gap-2 px-4 text-left h-12",
          "border-b border-border/40 last:border-b-0 transition-colors",
          isSelected ? "bg-accent/40" : "hover:bg-accent/20",
          row.isReference && "text-muted-foreground italic"
        )}
      >
        <Indent depth={row.depth} />
        <ToggleOrLeaf
          hasChildren={hasChildren}
          isCollapsed={isCollapsed}
          isReference={!!row.isReference}
          onToggle={onToggle}
        />
        <HStack spacing={2} className="flex-1 min-w-0 items-center">
          <span
            className={cn(
              "text-sm truncate",
              isSelected && "font-medium",
              row.isReference && "underline decoration-dotted"
            )}
          >
            {headline}
          </span>
          {row.isReference && <RefBadge />}
          {!row.isReference && <TrackedEntityStatus status={entity.status} />}
        </HStack>
        {!row.isReference && (
          <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-12 text-right">
            {entity.quantity}
          </span>
        )}
        {!row.isReference && entity.sourceDocument && (
          <span className="text-[11px] text-muted-foreground truncate max-w-[140px] hidden md:inline">
            {entity.sourceDocument}
          </span>
        )}
        {href && (
          <Link
            to={href}
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Open source document"
          >
            <LuExternalLink className="w-3.5 h-3.5" />
          </Link>
        )}
      </button>
    );
  }

  if (!activity) return null;
  const kind = activityKindFor(activity.type);
  const meta = ACTIVITY_KIND_META[kind];
  const Icon = meta.icon;
  const label = activity.type ?? meta.label;
  const href = sourceLinkHref(
    activity.sourceDocument,
    activity.sourceDocumentId
  );

  return (
    <button
      ref={registerRef}
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-full flex items-center gap-2 px-4 text-left h-12",
        "border-b border-border/40 last:border-b-0 transition-colors",
        isSelected ? "bg-accent/40" : "hover:bg-accent/20",
        row.isReference && "text-muted-foreground italic"
      )}
    >
      <Indent depth={row.depth} />
      <ToggleOrLeaf
        hasChildren={hasChildren}
        isCollapsed={isCollapsed}
        isReference={!!row.isReference}
        onToggle={onToggle}
      />
      <HStack spacing={2} className="flex-1 min-w-0 items-center">
        <span
          className="w-4 h-4 rounded-sm flex items-center justify-center shrink-0"
          style={{ background: meta.color }}
        >
          <Icon className="w-2.5 h-2.5 text-white" />
        </span>
        <span
          className={cn(
            "text-sm truncate",
            isSelected && "font-medium",
            row.isReference && "underline decoration-dotted"
          )}
        >
          {label}
        </span>
        {row.isReference && <RefBadge />}
      </HStack>
      {!row.isReference && row.edgeQuantity != null && (
        <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-12 text-right">
          {row.edgeQuantity}
        </span>
      )}
      {!row.isReference && activity.sourceDocument && (
        <span className="text-[11px] text-muted-foreground truncate max-w-[140px] hidden md:inline">
          {activity.sourceDocument}
        </span>
      )}
      {href && (
        <Link
          to={href}
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Open source document"
        >
          <LuExternalLink className="w-3.5 h-3.5" />
        </Link>
      )}
    </button>
  );
}

function Indent({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <div className="flex shrink-0">
      {Array.from({ length: depth }).map((_, i) => (
        <div key={i} className="w-4 h-12 border-l border-border/50 ml-px" />
      ))}
    </div>
  );
}

function ToggleOrLeaf({
  hasChildren,
  isCollapsed,
  isReference,
  onToggle
}: {
  hasChildren: boolean;
  isCollapsed: boolean;
  isReference: boolean;
  onToggle: () => void;
}) {
  if (hasChildren) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label={isCollapsed ? "Expand" : "Collapse"}
      >
        {isCollapsed ? (
          <LuChevronRight className="size-4.5" />
        ) : (
          <LuChevronDown className="size-4.5" />
        )}
      </button>
    );
  }
  return <div className="w-3.5 shrink-0" />;
}

function RefBadge() {
  return (
    <Badge
      variant="outline"
      className="text-[9px] px-1 py-0 uppercase tracking-wide"
    >
      ref
    </Badge>
  );
}
