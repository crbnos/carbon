import {
  Badge,
  Button,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger
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
import { ContainmentList } from "./ContainmentList";
import { ACTIVITY_KIND_META, activityKindFor } from "./metadata";
import { StepRecordsList } from "./StepRecordsList";
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

  const stepRecordsForActivity = useMemo(() => {
    if (!activity || !payload?.stepRecords?.length) return [];
    const opId = (activity.attributes as Record<string, any> | null)?.[
      "Job Operation"
    ];
    if (!opId) return [];
    return payload.stepRecords.filter((r) => r.operationId === opId);
  }, [activity, payload?.stepRecords]);

  const containmentsForEntity = useMemo(() => {
    if (!entity || !payload?.containments?.length) return [];
    return payload.containments.filter((c) => c.trackedEntityId === entity.id);
  }, [entity, payload?.containments]);

  const hasMultiSelect = selectedIds && selectedIds.length > 1;

  return (
    <aside className="w-[426px] flex-shrink-0 bg-sidebar h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm">
      {hasMultiSelect && (
        <div className="flex items-center justify-between gap-2 bg-muted/40 mx-3 mt-3 rounded-md px-2 py-1">
          <div className="flex items-center gap-2 min-w-0">
            <Badge
              variant="secondary"
              className="uppercase tracking-wide text-[10px]"
            >
              {selectedIds.length} selected
            </Badge>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {(focusedIndex ?? 0) + 1} / {selectedIds.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous selected"
              className="p-1 h-6 w-6"
              onClick={() => {
                const i = focusedIndex ?? 0;
                const next = (i - 1 + selectedIds.length) % selectedIds.length;
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
          </div>
        </div>
      )}

      <header className="px-3 pt-3 pb-2.5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {entity ? (
              <Badge
                variant="secondary"
                className="uppercase tracking-wide text-[10px] shrink-0"
              >
                Entity
              </Badge>
            ) : activity ? (
              <>
                <Badge
                  variant="outline"
                  className="uppercase tracking-wide text-[10px] shrink-0"
                >
                  Activity
                </Badge>
                <ActivityTypeChip type={activity.type} />
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy link`}
                  size="sm"
                  className="p-1 h-7 w-7"
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
                  className="p-1 h-7 w-7"
                  onClick={() => copyToClipboard(selectedNode?.id ?? "")}
                >
                  <LuCopy className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Copy {capitalize(selectedNodeType)} ID
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <h2 className="text-[15px] font-semibold leading-5 text-foreground truncate">
          {headline}
        </h2>
        <p className="text-[11px] text-muted-foreground/70 font-mono break-all leading-4 mt-0.5">
          {selectedNode?.id}
        </p>
      </header>

      <div className="flex flex-col divide-y divide-border/40">
        {(selectedNodeType === "entity" || sourceDoc) && (
          <Section>
            <dl className="divide-y divide-border/30">
              {selectedNodeType === "entity" && (
                <>
                  <PropRow label="Status">
                    <TrackedEntityStatus status={entity?.status} />
                  </PropRow>
                  <PropRow label="Quantity">
                    <span className="text-sm font-medium tabular-nums">
                      {entity?.quantity}
                    </span>
                  </PropRow>
                  {entity?.readableId && (
                    <PropRow label="Serial / Batch">
                      <span className="text-sm font-mono">
                        {entity.readableId}
                      </span>
                    </PropRow>
                  )}
                </>
              )}
              {sourceDoc && (
                <PropRow label={sourceDoc}>
                  <SourceDocValue
                    readableId={sourceDocReadableId}
                    fallbackId={sourceDocId}
                    href={sourceHref}
                  />
                </PropRow>
              )}
            </dl>
          </Section>
        )}

        {producedBy.length > 0 && (
          <Section title="Produced by" count={producedBy.length}>
            <ul className="divide-y divide-border/30">
              {producedBy.map((item) => (
                <RelatedActivityRow
                  key={item.activity.id}
                  item={item}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </Section>
        )}
        {consumedBy.length > 0 && (
          <Section title="Consumed by" count={consumedBy.length}>
            <ul className="divide-y divide-border/30">
              {consumedBy.map((item) => (
                <RelatedActivityRow
                  key={item.activity.id}
                  item={item}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </Section>
        )}
        {inputs.length > 0 && (
          <Section title="Inputs" count={inputs.length}>
            <ul className="divide-y divide-border/30">
              {inputs.map((item) => (
                <RelatedEntityRow
                  key={item.entity.id}
                  item={item}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </Section>
        )}
        {outputs.length > 0 && (
          <Section title="Outputs" count={outputs.length}>
            <ul className="divide-y divide-border/30">
              {outputs.map((item) => (
                <RelatedEntityRow
                  key={item.entity.id}
                  item={item}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </Section>
        )}

        {containmentsForEntity.length > 0 && (
          <Section title="Containments" count={containmentsForEntity.length}>
            <ContainmentList items={containmentsForEntity} />
          </Section>
        )}

        {stepRecordsForActivity.length > 0 && (
          <Section title="Step records" count={stepRecordsForActivity.length}>
            <StepRecordsList
              records={stepRecordsForActivity}
              jobId={
                (activity?.attributes as Record<string, any> | null)?.Job ??
                null
              }
            />
          </Section>
        )}

        {hasRenderedAttributes(selectedNodeAttributes) && (
          <Section title="Attributes">
            <AttributeList attrs={selectedNodeAttributes} />
          </Section>
        )}
      </div>
    </aside>
  );
}

type RelatedActivity = { activity: Activity; quantity: number };
type RelatedEntity = { entity: TrackedEntity; quantity: number };

function Section({
  title,
  count,
  children
}: {
  title?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="px-3 py-3">
      {title && (
        <header className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          <span>{title}</span>
          {typeof count === "number" && (
            <span className="tabular-nums text-muted-foreground/60">
              {count}
            </span>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

function PropRow({
  label,
  children
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3 py-1.5 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground truncate">{label}</dt>
      <dd className="text-right min-w-0 truncate">{children}</dd>
    </div>
  );
}

function ActivityTypeChip({ type }: { type: string | null | undefined }) {
  const kind = activityKindFor(type);
  const meta = ACTIVITY_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="size-3.5 rounded-sm flex items-center justify-center shrink-0"
        style={{ background: meta.color }}
      >
        <Icon className="size-2.5 text-white" />
      </span>
      <span className="text-xs truncate">{type ?? meta.label}</span>
    </div>
  );
}

function SourceDocValue({
  readableId,
  fallbackId,
  href
}: {
  readableId: string | null | undefined;
  fallbackId: string | null | undefined;
  href: string | null;
}) {
  const label = readableId ?? fallbackId ?? "—";
  if (href) {
    return (
      <Link
        to={href}
        className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{label}</span>
        <LuExternalLink className="size-3 text-muted-foreground shrink-0" />
      </Link>
    );
  }
  return <span className="text-sm font-medium truncate">{label}</span>;
}

function RelatedActivityRow({
  item,
  onSelect
}: {
  item: RelatedActivity;
  onSelect?: (id: string) => void;
}) {
  const kind = activityKindFor(item.activity.type);
  const meta = ACTIVITY_KIND_META[kind];
  const Icon = meta.icon;
  const label = activityHeadline(item.activity, 8);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(item.activity.id)}
        className={cn(
          "group w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left rounded-md",
          "hover:bg-accent/50 transition-colors"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="size-3.5 rounded-sm flex items-center justify-center shrink-0"
            style={{ background: meta.color }}
          >
            <Icon className="size-2.5 text-white" />
          </span>
          <span className="text-sm truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">
            {item.quantity}
          </span>
          <LuChevronRight className="size-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
        </div>
      </button>
    </li>
  );
}

function RelatedEntityRow({
  item,
  onSelect
}: {
  item: RelatedEntity;
  onSelect?: (id: string) => void;
}) {
  const label = entityHeadline(item.entity, 8);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(item.entity.id)}
        className={cn(
          "group w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left rounded-md",
          "hover:bg-accent/50 transition-colors"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <TrackedEntityStatus status={item.entity.status} />
          <span className="text-sm truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs tabular-nums text-muted-foreground">
            {item.quantity}
          </span>
          <LuChevronRight className="size-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
        </div>
      </button>
    </li>
  );
}
