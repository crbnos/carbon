import {
  Badge,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Heading,
  HStack,
  useMount
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { LuBarcode, LuQrCode, LuRoute } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { TRACE_API } from "~/modules/inventory/ui/Traceability/constants";
import { entityStatusMeta } from "~/modules/inventory/ui/Traceability/metadata";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Traceability`,
  to: path.to.traceability,
  module: "inventory"
};

const RECENT_SEARCHES_KEY = "traceability-searches";

type EntityRow = {
  id: string;
  readableId: string | null;
  sourceDocument: string | null;
  sourceDocumentId: string | null;
  sourceDocumentReadableId: string | null;
  quantity: number;
  status: string | null;
  attributes: Record<string, unknown> | null;
  createdAt: string;
};

type SearchResult = {
  entities: EntityRow[];
  activities: unknown[];
};

export default function TraceabilityRoute() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<SearchResult>();
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<EntityRow[]>([]);
  const debounceRef = useRef<number | null>(null);

  useMount(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setRecentSearches(parsed);
      } catch {
        // ignore parse failures
      }
    }
  });

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    debounceRef.current = window.setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, kind: "entity" });
      fetcher.load(`${TRACE_API.search}?${params.toString()}`);
    }, 350);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, fetcher.load]);

  const isLoading = fetcher.state !== "idle";
  const trimmed = query.trim();
  const showSearchResults = trimmed.length >= 2;
  const entities = showSearchResults ? (fetcher.data?.entities ?? []) : [];

  const recordRecent = (entity: EntityRow) => {
    const next = [
      entity,
      ...recentSearches.filter((e) => e.id !== entity.id)
    ].slice(0, 5);
    setRecentSearches(next);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  };

  const openEntity = (entity: EntityRow) => {
    recordRecent(entity);
    navigate(
      `${path.to.traceabilityGraph}?trackedEntityId=${encodeURIComponent(entity.id)}`
    );
  };

  const openId = (id: string) => {
    navigate(
      `${path.to.traceabilityGraph}?trackedEntityId=${encodeURIComponent(id)}`
    );
  };

  return (
    <div
      className="relative flex w-full h-full flex-1 items-center justify-center bg-card overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.12) 1px, transparent 0)"
      }}
    >
      <div className="relative flex flex-col items-center w-full max-w-md px-6 gap-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-foreground/5 border border-border text-foreground">
            <LuRoute className="w-6 h-6" />
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <Heading size="h1" className="tracking-tight">
              {t`Traceability`}
            </Heading>
            <p className="text-sm text-muted-foreground max-w-[42ch]">
              {t`Scan a label or search by ID, serial number, or batch number.`}
            </p>
          </div>
        </div>

        <div className="w-full rounded-xl border border-border bg-background shadow-md overflow-hidden">
          <Command shouldFilter={false} className="bg-background">
            <div className="relative">
              <CommandInput
                placeholder={t`Scan or search...`}
                value={query}
                onValueChange={setQuery}
                className="h-12 text-base pr-12"
              />
              <LuQrCode className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
            </div>
            <CommandList className="h-[320px] border-t border-border">
              {showSearchResults ? (
                <>
                  {entities.length > 0 ? (
                    <CommandGroup heading={t`Entities`}>
                      {entities.map((entity) => (
                        <EntityRowItem
                          key={entity.id}
                          entity={entity}
                          onSelect={() => openEntity(entity)}
                        />
                      ))}
                    </CommandGroup>
                  ) : (
                    <CommandEmpty className="py-12 text-center text-sm text-muted-foreground">
                      {isLoading ? t`Searching...` : t`No matches`}
                    </CommandEmpty>
                  )}
                </>
              ) : recentSearches.length > 0 ? (
                <CommandGroup heading={t`Recent`}>
                  {recentSearches.map((entity) => (
                    <EntityRowItem
                      key={entity.id}
                      entity={entity}
                      onSelect={() => openId(entity.id)}
                    />
                  ))}
                </CommandGroup>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
                  <LuBarcode className="w-6 h-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {t`Start typing or scan a label to begin tracing`}
                  </p>
                </div>
              )}
            </CommandList>
          </Command>
        </div>
      </div>
    </div>
  );
}

function EntityRowItem({
  entity,
  onSelect
}: {
  entity: EntityRow;
  onSelect: () => void;
}) {
  const meta = entityStatusMeta(entity.status);
  const Icon = meta.icon;
  const headline = headlineFor(entity);
  const batch = entity.attributes?.["Batch Number"] as string | undefined;
  const serial = entity.attributes?.["Serial Number"] as string | undefined;
  const trackingHint = serial
    ? `Serial · ${serial}`
    : batch
      ? `Batch · ${batch}`
      : (entity.sourceDocument ?? "—");

  return (
    <CommandItem
      value={`${headline} ${entity.id} ${serial ?? ""} ${batch ?? ""} ${entity.sourceDocumentReadableId ?? ""} ${entity.readableId ?? ""}`}
      onSelect={onSelect}
      className="!py-2.5 !px-3 gap-3 cursor-pointer"
    >
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: meta.color }}
      >
        <Icon className="w-4 h-4 text-white" />
      </span>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{headline}</span>
        <span className="text-[11px] text-muted-foreground truncate">
          {trackingHint}
        </span>
      </div>
      <HStack spacing={2} className="items-center shrink-0">
        {entity.status && (
          <Badge variant="secondary" className="text-[10px]">
            {entity.status}
          </Badge>
        )}
        <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
          {entity.quantity}
        </span>
      </HStack>
    </CommandItem>
  );
}

function headlineFor(entity: EntityRow): string {
  return (
    (entity.attributes?.["Serial Number"] as string | undefined) ??
    (entity.attributes?.["Batch Number"] as string | undefined) ??
    entity.sourceDocumentReadableId ??
    entity.readableId ??
    entity.id.slice(0, 12)
  );
}
