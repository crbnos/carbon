import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  HStack
} from "@carbon/react";
import { useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { TRACE_API } from "./constants";
import {
  ACTIVITY_KIND_META,
  activityKindFor,
  entityStatusMeta
} from "./metadata";
import { entityHeadline, type LineagePayload } from "./utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: LineagePayload;
  onSelect?: (id: string) => void;
};

type SearchResult = {
  entities: TrackedEntity[];
  activities: Activity[];
};

export function NodeSearchDialog({
  open,
  onOpenChange,
  payload,
  onSelect
}: Props) {
  const { getNode, setCenter } = useReactFlow();
  const navigate = useNavigate();
  const fetcher = useFetcher<SearchResult>();
  const [query, setQuery] = useState("");
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    debounceRef.current = window.setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, kind: "all" });
      fetcher.load(`${TRACE_API.search}?${params.toString()}`);
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open, fetcher.load]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const localIds = useMemo(() => {
    const e = new Set(payload.entities.map((x) => x.id));
    const a = new Set(payload.activities.map((x) => x.id));
    return { e, a };
  }, [payload]);

  const showLocal = query.trim().length < 2;
  const entities: TrackedEntity[] = showLocal
    ? payload.entities
    : (fetcher.data?.entities ?? []);
  const activities: Activity[] = showLocal
    ? payload.activities
    : (fetcher.data?.activities ?? []);

  function focusOrNavigate(kind: "entity" | "activity", id: string) {
    onOpenChange(false);
    const inGraph = kind === "entity" ? localIds.e.has(id) : localIds.a.has(id);
    if (inGraph) {
      const node = getNode(id);
      if (node) {
        const w = node.measured?.width ?? node.width ?? 44;
        const h = node.measured?.height ?? node.height ?? 44;
        setCenter(node.position.x + w / 2, node.position.y + h / 2, {
          zoom: 1.1,
          duration: 250
        });
      }
      onSelect?.(id);
      return;
    }
    const param = kind === "entity" ? "trackedEntityId" : "trackedActivityId";
    navigate(`/x/traceability/graph?${param}=${encodeURIComponent(id)}`);
  }

  const isLoading = fetcher.state !== "idle";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search entities, activities, status, source doc..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[420px]">
        {!showLocal &&
        isLoading &&
        entities.length === 0 &&
        activities.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Searching...
          </div>
        ) : (
          <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
            No matches
          </CommandEmpty>
        )}

        {entities.length > 0 && (
          <CommandGroup
            heading={
              showLocal
                ? `Entities in graph (${entities.length})`
                : `Entities (${entities.length})`
            }
          >
            {entities.map((entity) => {
              const label = entityHeadline(entity, 12);
              const meta = entityStatusMeta(entity.status);
              const Icon = meta.icon;
              const inGraph = localIds.e.has(entity.id);
              return (
                <CommandItem
                  key={entity.id}
                  value={`${label} ${entity.id} ${entity.sourceDocument ?? ""} ${entity.sourceDocumentReadableId ?? ""} ${entity.readableId ?? ""} ${entity.status ?? ""}`}
                  onSelect={() => focusOrNavigate("entity", entity.id)}
                  className="!py-2 !px-2 gap-3"
                >
                  <span
                    className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: meta.color }}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </span>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {entity.sourceDocument ?? "—"}
                    </span>
                  </div>
                  <HStack spacing={2} className="items-center shrink-0">
                    <StatusPill status={entity.status} />
                    <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                      {entity.quantity}
                    </span>
                    {!inGraph && <OpenBadge />}
                  </HStack>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {activities.length > 0 && (
          <CommandGroup
            heading={
              showLocal
                ? `Activities in graph (${activities.length})`
                : `Activities (${activities.length})`
            }
          >
            {activities.map((activity) => {
              const meta = ACTIVITY_KIND_META[activityKindFor(activity.type)];
              const Icon = meta.icon;
              const label = activity.type ?? meta.label;
              const inGraph = localIds.a.has(activity.id);
              return (
                <CommandItem
                  key={activity.id}
                  value={`${label} ${activity.id} ${activity.sourceDocument ?? ""} ${activity.sourceDocumentReadableId ?? ""}`}
                  onSelect={() => focusOrNavigate("activity", activity.id)}
                  className="!py-2 !px-2 gap-3"
                >
                  <span
                    className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: meta.color }}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </span>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {activity.sourceDocumentReadableId ??
                        activity.sourceDocument ??
                        "—"}
                    </span>
                  </div>
                  {!inGraph && <OpenBadge />}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const color = entityStatusMeta(status).color;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-foreground bg-muted/60 rounded px-1.5 py-0.5 leading-none">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {status}
    </span>
  );
}

function OpenBadge() {
  return (
    <span className="text-[9px] uppercase tracking-wider font-medium text-muted-foreground border border-border rounded px-1 py-0.5 leading-none">
      Open
    </span>
  );
}
