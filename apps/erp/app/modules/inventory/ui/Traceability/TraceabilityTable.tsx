import {
  Badge,
  cn,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { ACTIVITY_KIND_META, activityKindFor } from "./activityIcons";
import TrackedEntityStatus from "./TrackedEntityStatus";
import type { LineagePayload } from "./utils";

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
  parentEdgeId?: string;
  edgeQuantity?: number;
  edgeKind?: "input" | "output";
};

export function TraceabilityTable({
  payload,
  rootId,
  selectedId,
  onSelect
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
    }
    for (const o of payload.outputs) {
      push(downstream, o.trackedActivityId, {
        targetId: o.trackedEntityId,
        quantity: o.quantity,
        kind: "output"
      });
    }

    return { entityById, activityById, downstream };
  }, [payload]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const visited = new Set<string>();

    function walk(
      id: string,
      depth: number,
      parentEdgeId?: string,
      edgeQuantity?: number,
      edgeKind?: "input" | "output"
    ) {
      if (visited.has(id)) {
        out.push({
          kind: kindOf(id),
          id,
          depth,
          parentEdgeId,
          edgeQuantity,
          edgeKind
        });
        return;
      }
      visited.add(id);
      out.push({
        kind: kindOf(id),
        id,
        depth,
        parentEdgeId,
        edgeQuantity,
        edgeKind
      });

      if (collapsed.has(id)) return;

      const children = downstream.get(id) ?? [];
      for (const c of children) {
        walk(c.targetId, depth + 1, `${id}->${c.targetId}`, c.quantity, c.kind);
      }
    }

    function kindOf(id: string): "entity" | "activity" {
      return entityById.has(id) ? "entity" : "activity";
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

  return (
    <div className="w-full h-full overflow-auto">
      <Table>
        <Thead>
          <Tr>
            <Th>Node</Th>
            <Th>Type</Th>
            <Th>Status</Th>
            <Th className="text-right">Quantity</Th>
            <Th>Source</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row, i) => {
            const isCollapsed = collapsed.has(row.id);
            const hasChildren = (downstream.get(row.id)?.length ?? 0) > 0;
            const isSelected = row.id === selectedId;

            if (row.kind === "entity") {
              const entity = entityById.get(row.id);
              if (!entity) return null;
              const headline =
                entity.sourceDocumentReadableId ??
                entity.readableId ??
                entity.id.slice(0, 12);
              return (
                <Tr
                  key={`${row.id}:${i}`}
                  className={cn("cursor-pointer", isSelected && "bg-accent/30")}
                  onClick={() => onSelect?.(row.id)}
                >
                  <Td>
                    <HStack spacing={1} style={{ paddingLeft: row.depth * 16 }}>
                      {hasChildren ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(row.id);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={isCollapsed ? "Expand" : "Collapse"}
                        >
                          {isCollapsed ? (
                            <LuChevronRight className="w-3.5 h-3.5" />
                          ) : (
                            <LuChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <div className="w-3.5" />
                      )}
                      <span
                        className={cn("text-sm", isSelected && "font-medium")}
                      >
                        {headline}
                      </span>
                    </HStack>
                  </Td>
                  <Td>
                    <Badge variant="secondary">Entity</Badge>
                  </Td>
                  <Td>
                    <TrackedEntityStatus status={entity.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{entity.quantity}</Td>
                  <Td className="text-xs text-muted-foreground">
                    {entity.sourceDocument}
                    {entity.sourceDocumentReadableId
                      ? ` · ${entity.sourceDocumentReadableId}`
                      : ""}
                  </Td>
                  <Td>
                    <SourceLink
                      sourceDocument={entity.sourceDocument}
                      sourceDocumentId={entity.sourceDocumentId}
                    />
                  </Td>
                </Tr>
              );
            }

            const activity = activityById.get(row.id);
            if (!activity) return null;
            const kind = activityKindFor(activity.type);
            const meta = ACTIVITY_KIND_META[kind];
            return (
              <Tr
                key={`${row.id}:${i}`}
                className={cn("cursor-pointer", isSelected && "bg-accent/30")}
                onClick={() => onSelect?.(row.id)}
              >
                <Td>
                  <HStack spacing={1} style={{ paddingLeft: row.depth * 16 }}>
                    {hasChildren ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(row.id);
                        }}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={isCollapsed ? "Expand" : "Collapse"}
                      >
                        {isCollapsed ? (
                          <LuChevronRight className="w-3.5 h-3.5" />
                        ) : (
                          <LuChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    ) : (
                      <div className="w-3.5" />
                    )}
                    <span
                      className="w-2 h-2 rounded-sm"
                      style={{ background: meta.color }}
                    />
                    <span
                      className={cn("text-sm", isSelected && "font-medium")}
                    >
                      {activity.type ?? meta.label}
                    </span>
                  </HStack>
                </Td>
                <Td>
                  <Badge variant="outline">Activity</Badge>
                </Td>
                <Td>—</Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {row.edgeQuantity ?? "—"}
                </Td>
                <Td className="text-xs text-muted-foreground">
                  {activity.sourceDocument}
                  {activity.sourceDocumentReadableId
                    ? ` · ${activity.sourceDocumentReadableId}`
                    : ""}
                </Td>
                <Td>
                  <SourceLink
                    sourceDocument={activity.sourceDocument}
                    sourceDocumentId={activity.sourceDocumentId}
                  />
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </div>
  );
}

function SourceLink({
  sourceDocument,
  sourceDocumentId
}: {
  sourceDocument?: string | null;
  sourceDocumentId?: string | null;
}) {
  if (!sourceDocument || !sourceDocumentId) return null;
  const href = sourceLinkHref(sourceDocument, sourceDocumentId);
  if (!href) return null;
  return (
    <Link
      to={href}
      className="text-muted-foreground hover:text-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <LuExternalLink className="w-3.5 h-3.5" />
    </Link>
  );
}

function sourceLinkHref(doc: string, id: string): string | null {
  switch (doc) {
    case "Job":
      return `/x/job/${id}`;
    case "Receipt":
      return `/x/inventory/receipts/${id}`;
    case "Shipment":
      return `/x/inventory/shipments/${id}`;
    case "Purchase Order":
      return `/x/purchase-order/${id}`;
    case "Sales Order":
      return `/x/sales/orders/${id}`;
    default:
      return null;
  }
}
