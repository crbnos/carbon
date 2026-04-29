import {
  Badge,
  Button,
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuCopy,
  LuExternalLink,
  LuLink
} from "react-icons/lu";
import { Link } from "react-router";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { capitalize, copyToClipboard } from "~/utils/string";
import { AttributeList, hasRenderedAttributes } from "./attributeRenderers";
import { ACTIVITY_KIND_META, activityKindFor } from "./metadata";
import { useTraceabilityStore } from "./store";
import TrackedEntityStatus from "./TrackedEntityStatus";
import {
  activityHeadline,
  entityHeadline,
  type LineagePayload,
  sourceLinkHref
} from "./utils";

type SidebarProps = {
  entity: TrackedEntity | null;
  activity: Activity | null;
  payload?: LineagePayload;
  onSelect?: (id: string) => void;
};

export function TraceabilitySidebar({
  entity,
  activity,
  payload,
  onSelect
}: SidebarProps) {
  const selectedIds = useTraceabilityStore((s) => s.selectedIds);
  const focusedIndex = useTraceabilityStore((s) => s.focusedIndex);
  const onFocusedIndexChange = useTraceabilityStore((s) => s.setFocusedIndex);
  const { t } = useLingui();
  const selectedNode = entity ?? activity;
  const selectedNodeType = entity ? "entity" : "activity";
  const selectedNodeAttributes = (
    entity ? (entity.attributes ?? {}) : (activity?.attributes ?? {})
  ) as Record<string, any>;

  const headline = entity
    ? entityHeadline(entity)
    : activity
      ? (activity.type ?? activity.id)
      : "No selection";

  const sourceDoc = entity?.sourceDocument ?? activity?.sourceDocument;
  const sourceDocId = entity?.sourceDocumentId ?? activity?.sourceDocumentId;
  const sourceDocReadableId =
    entity?.sourceDocumentReadableId ?? activity?.sourceDocumentReadableId;
  const sourceHref = sourceLinkHref(sourceDoc, sourceDocId);

  const { producedBy, consumedBy, inputs, outputs } = useMemo(() => {
    if (!payload) {
      return {
        producedBy: [] as RelatedActivity[],
        consumedBy: [] as RelatedActivity[],
        inputs: [] as RelatedEntity[],
        outputs: [] as RelatedEntity[]
      };
    }
    const activityById = new Map(payload.activities.map((a) => [a.id, a]));
    const entityById = new Map(payload.entities.map((e) => [e.id, e]));

    const producedBy: RelatedActivity[] = [];
    const consumedBy: RelatedActivity[] = [];
    const inputs: RelatedEntity[] = [];
    const outputs: RelatedEntity[] = [];

    if (entity) {
      for (const o of payload.outputs) {
        if (o.trackedEntityId !== entity.id) continue;
        const a = activityById.get(o.trackedActivityId);
        if (a) producedBy.push({ activity: a, quantity: o.quantity });
      }
      for (const i of payload.inputs) {
        if (i.trackedEntityId !== entity.id) continue;
        const a = activityById.get(i.trackedActivityId);
        if (a) consumedBy.push({ activity: a, quantity: i.quantity });
      }
    } else if (activity) {
      for (const i of payload.inputs) {
        if (i.trackedActivityId !== activity.id) continue;
        const e = entityById.get(i.trackedEntityId);
        if (e) inputs.push({ entity: e, quantity: i.quantity });
      }
      for (const o of payload.outputs) {
        if (o.trackedActivityId !== activity.id) continue;
        const e = entityById.get(o.trackedEntityId);
        if (e) outputs.push({ entity: e, quantity: o.quantity });
      }
    }

    return { producedBy, consumedBy, inputs, outputs };
  }, [payload, entity, activity]);

  return (
    <VStack
      spacing={4}
      className="w-96 flex-shrink-0 bg-sidebar h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-5 py-5 text-sm"
    >
      <VStack spacing={3}>
        {selectedIds && selectedIds.length > 1 && (
          <HStack className="w-full justify-between items-center bg-muted/40 rounded-md px-2 py-1">
            <HStack spacing={2} className="items-center">
              <Badge
                variant="secondary"
                className="uppercase tracking-wide text-[10px]"
              >
                {selectedIds.length} selected
              </Badge>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {(focusedIndex ?? 0) + 1} / {selectedIds.length}
              </span>
            </HStack>
            <HStack spacing={1}>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Previous selected"
                className="p-1 h-6 w-6"
                onClick={() => {
                  const i = focusedIndex ?? 0;
                  const next =
                    (i - 1 + selectedIds.length) % selectedIds.length;
                  onFocusedIndexChange?.(next);
                }}
              >
                <LuChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Next selected"
                className="p-1 h-6 w-6"
                onClick={() => {
                  const i = focusedIndex ?? 0;
                  const next = (i + 1) % selectedIds.length;
                  onFocusedIndexChange?.(next);
                }}
              >
                <LuChevronRight className="w-3.5 h-3.5" />
              </Button>
            </HStack>
          </HStack>
        )}
        <HStack className="w-full justify-between items-start">
          <HStack spacing={2} className="items-center flex-wrap">
            {entity ? (
              <Badge
                variant="secondary"
                className="uppercase tracking-wide text-[10px]"
              >
                Entity
              </Badge>
            ) : activity ? (
              <>
                <Badge
                  variant="outline"
                  className="uppercase tracking-wide text-[10px]"
                >
                  Activity
                </Badge>
                <ActivityTypeChip type={activity.type} />
              </>
            ) : null}
          </HStack>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy link`}
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(window.location.href)}
                >
                  <LuLink className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy ID`}
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(selectedNode?.id ?? "")}
                >
                  <LuCopy className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Copy {capitalize(selectedNodeType)} ID
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>

        <VStack spacing={0}>
          <span className="text-base font-semibold leading-tight">
            {headline}
          </span>
          <span className="text-xs text-muted-foreground font-mono break-all mt-1">
            {selectedNode?.id}
          </span>
        </VStack>
      </VStack>

      {selectedNodeType === "entity" && (
        <VStack spacing={2}>
          <HStack className="w-full justify-between items-center min-h-[28px]">
            <span className="text-xs text-muted-foreground">Status</span>
            <TrackedEntityStatus status={entity?.status} />
          </HStack>
          <HStack className="w-full justify-between items-center min-h-[28px]">
            <span className="text-xs text-muted-foreground">Quantity</span>
            <span className="text-sm font-medium tabular-nums">
              {entity?.quantity}
            </span>
          </HStack>
          {entity?.readableId && (
            <HStack className="w-full justify-between items-center min-h-[28px]">
              <span className="text-xs text-muted-foreground">
                Serial / Batch
              </span>
              <span className="text-sm font-mono">{entity.readableId}</span>
            </HStack>
          )}
        </VStack>
      )}

      {sourceDoc && (
        <VStack spacing={2}>
          <SectionHeader>Source Document</SectionHeader>
          <SourceDocCard
            sourceDoc={sourceDoc}
            sourceDocId={sourceDocId ?? null}
            sourceDocReadableId={sourceDocReadableId ?? null}
            href={sourceHref}
          />
        </VStack>
      )}

      {producedBy.length > 0 && (
        <RelatedActivitySection
          title="Produced by"
          items={producedBy}
          onSelect={onSelect}
        />
      )}
      {consumedBy.length > 0 && (
        <RelatedActivitySection
          title="Consumed by"
          items={consumedBy}
          onSelect={onSelect}
        />
      )}
      {inputs.length > 0 && (
        <RelatedEntitySection
          title="Inputs"
          items={inputs}
          onSelect={onSelect}
        />
      )}
      {outputs.length > 0 && (
        <RelatedEntitySection
          title="Outputs"
          items={outputs}
          onSelect={onSelect}
        />
      )}

      {hasRenderedAttributes(selectedNodeAttributes) && (
        <VStack spacing={3}>
          <SectionHeader>Attributes</SectionHeader>
          <AttributeList attrs={selectedNodeAttributes} />
        </VStack>
      )}
    </VStack>
  );
}

type RelatedActivity = { activity: Activity; quantity: number };
type RelatedEntity = { entity: TrackedEntity; quantity: number };

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pb-1 border-b border-border/40">
      {children}
    </span>
  );
}

function ActivityTypeChip({ type }: { type: string | null | undefined }) {
  const kind = activityKindFor(type);
  const meta = ACTIVITY_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <HStack spacing={2} className="items-center">
      <span
        className="w-4 h-4 rounded-sm flex items-center justify-center"
        style={{ background: meta.color }}
      >
        <Icon className="w-2.5 h-2.5 text-white" />
      </span>
      <span className="text-sm">{type ?? meta.label}</span>
    </HStack>
  );
}

function SourceDocCard({
  sourceDoc,
  sourceDocId,
  sourceDocReadableId,
  href
}: {
  sourceDoc: string;
  sourceDocId: string | null;
  sourceDocReadableId: string | null;
  href: string | null;
}) {
  const inner = (
    <HStack className="w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
      <VStack spacing={0}>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {sourceDoc}
        </span>
        <span className="font-medium">
          {sourceDocReadableId ?? sourceDocId ?? "—"}
        </span>
      </VStack>
      {href && (
        <LuExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
    </HStack>
  );
  if (!href) return inner;
  return (
    <Link
      to={href}
      className="block hover:opacity-80 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </Link>
  );
}

function RelatedActivitySection({
  title,
  items,
  onSelect
}: {
  title: string;
  items: RelatedActivity[];
  onSelect?: (id: string) => void;
}) {
  return (
    <VStack spacing={1}>
      <SectionHeader>{title}</SectionHeader>
      <VStack spacing={1}>
        {items.map((item) => {
          const kind = activityKindFor(item.activity.type);
          const meta = ACTIVITY_KIND_META[kind];
          const Icon = meta.icon;
          const label = activityHeadline(item.activity, 8);
          return (
            <button
              key={item.activity.id}
              type="button"
              onClick={() => onSelect?.(item.activity.id)}
              className={cn(
                "group w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left",
                "border border-transparent bg-card hover:bg-accent/40 hover:border-border transition-colors"
              )}
            >
              <HStack spacing={2} className="items-center min-w-0">
                <span
                  className="w-4 h-4 rounded-sm flex items-center justify-center shrink-0"
                  style={{ background: meta.color }}
                >
                  <Icon className="w-2.5 h-2.5 text-white" />
                </span>
                <span className="text-sm truncate">{label}</span>
              </HStack>
              <HStack spacing={1} className="items-center shrink-0">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {item.quantity}
                </span>
                <LuChevronRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
              </HStack>
            </button>
          );
        })}
      </VStack>
    </VStack>
  );
}

function RelatedEntitySection({
  title,
  items,
  onSelect
}: {
  title: string;
  items: RelatedEntity[];
  onSelect?: (id: string) => void;
}) {
  return (
    <VStack spacing={1}>
      <SectionHeader>{title}</SectionHeader>
      <VStack spacing={1}>
        {items.map((item) => {
          const label = entityHeadline(item.entity, 8);
          return (
            <button
              key={item.entity.id}
              type="button"
              onClick={() => onSelect?.(item.entity.id)}
              className={cn(
                "group w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left",
                "border border-transparent bg-card hover:bg-accent/40 hover:border-border transition-colors"
              )}
            >
              <HStack spacing={2} className="items-center min-w-0">
                <TrackedEntityStatus status={item.entity.status} />
                <span className="text-sm truncate">{label}</span>
              </HStack>
              <HStack spacing={1} className="items-center shrink-0">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {item.quantity}
                </span>
                <LuChevronRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
              </HStack>
            </button>
          );
        })}
      </VStack>
    </VStack>
  );
}
