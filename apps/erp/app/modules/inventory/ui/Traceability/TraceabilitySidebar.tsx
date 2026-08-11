import {
  Badge,
  Button,
  cn,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { indexBy, pluckUnique } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuCopy,
  LuExternalLink,
  LuLink
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { path } from "~/utils/path";
import { capitalize, copyToClipboard } from "~/utils/string";
import { AttributeList, hasRenderedAttributes } from "./attributeRenderers";
import { ContainmentList } from "./ContainmentList";
import type { ClusterMember, EntityCluster } from "./cluster";
import { edgeKey } from "./cluster";
import {
  ACTIVITY_KIND_META,
  activityKindFor,
  isMovementActivity
} from "./metadata";
import { StepRecordsList } from "./StepRecordsList";
import TrackedEntityStatus from "./TrackedEntityStatus";
import {
  activityHeadline,
  entityHeadline,
  type LineagePayload,
  type StepRecord,
  sourceLinkHref
} from "./utils";

type SidebarProps = {
  entity: TrackedEntity | null;
  activity: Activity | null;
  /** Set when a serial group node is selected instead of a single entity. */
  cluster?: EntityCluster | null;
  /** Every cluster in the current graph, for collapsing an activity's
   *  input/output lists. */
  clusters?: EntityCluster[];
  /** Member to scroll to and highlight — set when search picked a clustered
   *  serial, whose group node got selected in its place. */
  highlightMemberId?: string | null;
  payload?: LineagePayload;
  onSelect?: (id: string) => void;
  selectedIds: string[];
  focusedIndex: number;
  onFocusedIndexChange: (i: number) => void;
};

export function TraceabilitySidebar({
  entity,
  activity,
  cluster = null,
  clusters,
  highlightMemberId = null,
  payload,
  onSelect,
  selectedIds,
  focusedIndex,
  onFocusedIndexChange
}: SidebarProps) {
  const { t } = useLingui();
  const selectedNode = entity ?? activity;
  const selectedNodeType = cluster ? "group" : entity ? "entity" : "activity";
  const selectedNodeAttributes = (
    entity ? (entity.attributes ?? {}) : (activity?.attributes ?? {})
  ) as Record<string, any>;

  const clusterByMember = useMemo(() => {
    const m = new Map<string, EntityCluster>();
    for (const c of clusters ?? []) {
      for (const member of c.members) m.set(member.id, c);
    }
    return m;
  }, [clusters]);

  const headline = cluster
    ? cluster.headline
    : entity
      ? entityHeadline(entity)
      : activity
        ? (activity.type ?? activity.id)
        : "No selection";

  // `selectedNode` is null for a cluster, so the header and the Copy ID button
  // both read from here rather than each deriving the id separately.
  const copyId = cluster ? cluster.id : (selectedNode?.id ?? "");

  const sourceDoc = entity?.sourceDocument ?? activity?.sourceDocument;
  const sourceDocId = entity?.sourceDocumentId ?? activity?.sourceDocumentId;
  const sourceDocReadableId =
    entity?.sourceDocumentReadableId ?? activity?.sourceDocumentReadableId;
  const sourceHref = sourceLinkHref(sourceDoc, sourceDocId);

  const { producedBy, consumedBy, movedBy, splits, inputs, outputs } =
    useMemo(() => {
      if (!payload) {
        return {
          producedBy: [] as RelatedActivity[],
          consumedBy: [] as RelatedActivity[],
          movedBy: [] as RelatedActivity[],
          splits: [] as RelatedActivity[],
          inputs: [] as RelatedEntity[],
          outputs: [] as RelatedEntity[]
        };
      }
      const activityById = indexBy(payload.activities, (a) => a.id);
      const entityById = indexBy(payload.entities, (e) => e.id);

      const producedBy: RelatedActivity[] = [];
      const consumedBy: RelatedActivity[] = [];
      const movedBy: RelatedActivity[] = [];
      const splits: RelatedActivity[] = [];
      const inputs: RelatedEntityItem[] = [];
      const outputs: RelatedEntityItem[] = [];

      if (cluster) {
        // Every member sits on the same edges by construction — one row per
        // signature entry, carrying the summed quantity.
        for (const entry of cluster.signature) {
          const a = activityById.get(entry.activityId);
          if (!a) continue;
          const quantity =
            cluster.quantitiesByEdge[edgeKey(entry.activityId, entry.side)] ??
            0;
          if (entry.side === "output") {
            producedBy.push({ activity: a, quantity });
          } else if (isMovementActivity(a.type)) {
            movedBy.push({ activity: a, quantity });
          } else {
            consumedBy.push({ activity: a, quantity });
          }
        }
      } else if (entity) {
        // A historical split survivor is recorded as both input and output of
        // its own Split activity. That self-loop is neither production nor
        // consumption — surface it as a Split instead of lying on both sides.
        const inputActivityIds = new Set(
          pluckUnique(payload.inputs, (i) =>
            i.trackedEntityId === entity.id ? i.trackedActivityId : null
          )
        );
        const selfLoopActivityIds = new Set(
          pluckUnique(payload.outputs, (o) =>
            o.trackedEntityId === entity.id &&
            inputActivityIds.has(o.trackedActivityId)
              ? o.trackedActivityId
              : null
          )
        );

        for (const o of payload.outputs) {
          if (o.trackedEntityId !== entity.id) continue;
          const a = activityById.get(o.trackedActivityId);
          if (!a) continue;
          if (selfLoopActivityIds.has(o.trackedActivityId)) {
            // The output row's quantity is what the entity kept.
            splits.push({ activity: a, quantity: o.quantity });
          } else {
            producedBy.push({ activity: a, quantity: o.quantity });
          }
        }
        for (const i of payload.inputs) {
          if (i.trackedEntityId !== entity.id) continue;
          if (selfLoopActivityIds.has(i.trackedActivityId)) continue;
          const a = activityById.get(i.trackedActivityId);
          if (!a) continue;
          // A Split draws a portion off this lot and leaves the rest on the
          // shelf — the lot is an input but was NOT consumed. (Legacy splits
          // recorded the survivor as input AND output; the self-loop skip above
          // catches those.)
          if (a.type === "Split") {
            splits.push({ activity: a, quantity: i.quantity });
          } else if (isMovementActivity(a.type)) {
            // A transfer/pick relocated the lot — it did not consume it.
            movedBy.push({ activity: a, quantity: i.quantity });
          } else {
            consumedBy.push({ activity: a, quantity: i.quantity });
          }
        }
      } else if (activity) {
        // Clustered members collapse into one row per group — a 50-serial fan
        // is unreadable as 50 identical lines.
        const collect = (
          rows: { trackedEntityId: string; quantity: number }[],
          into: RelatedEntityItem[]
        ) => {
          const clusterTotals = new Map<string, number>();
          const clusterOrder: EntityCluster[] = [];
          for (const row of rows) {
            const memberCluster = clusterByMember.get(row.trackedEntityId);
            if (memberCluster) {
              if (!clusterTotals.has(memberCluster.id)) {
                clusterOrder.push(memberCluster);
              }
              clusterTotals.set(
                memberCluster.id,
                (clusterTotals.get(memberCluster.id) ?? 0) + row.quantity
              );
              continue;
            }
            const e = entityById.get(row.trackedEntityId);
            if (e) into.push({ entity: e, quantity: row.quantity });
          }
          for (const c of clusterOrder) {
            into.push({ cluster: c, quantity: clusterTotals.get(c.id) ?? 0 });
          }
        };

        collect(
          payload.inputs.filter((i) => i.trackedActivityId === activity.id),
          inputs
        );
        collect(
          payload.outputs.filter((o) => o.trackedActivityId === activity.id),
          outputs
        );
      }

      return { producedBy, consumedBy, movedBy, splits, inputs, outputs };
    }, [payload, entity, activity, cluster, clusterByMember]);

  const stepRecordsFetcher = useFetcher<{ stepRecords: StepRecord[] }>();
  const lastLoadedActivityIdRef = useRef<string | null>(null);
  const stepRecordsLoad = stepRecordsFetcher.load;
  const activityId = activity?.id ?? null;
  useEffect(() => {
    if (!activityId) return;
    if (lastLoadedActivityIdRef.current === activityId) return;
    lastLoadedActivityIdRef.current = activityId;
    stepRecordsLoad(
      `/api/traceability/sidebar?activityId=${encodeURIComponent(activityId)}`
    );
  }, [activityId, stepRecordsLoad]);

  const stepRecordsForActivity = useMemo(() => {
    const list = stepRecordsFetcher.data?.stepRecords ?? [];
    if (!activity || list.length === 0) return [];
    const attrs = activity.attributes as Record<string, any> | null;
    const opId = attrs?.["Job Operation"];
    if (!opId) return [];
    // A production activity is scoped to one unit (its "Unit" is the 0-based
    // unit-axis index that step records key off). Isolate this unit's records
    // from the operation's other units. Activities without a Unit (older data
    // or the operation view) fall back to all records for the operation.
    const unit = attrs?.Unit;
    const hasUnit = typeof unit === "number";
    return list.filter(
      (r) => r.operationId === opId && (!hasUnit || r.index === unit)
    );
  }, [activity, stepRecordsFetcher.data]);

  // Where the lot sits now: destination of the latest movement that took it as
  // an input. Bin names are enriched server-side (enrichActivityBinNames).
  const storageUnit = useMemo(() => {
    if (!entity || !payload) return null;
    // A fully consumed lot was last moved somewhere, but nothing is there now —
    // showing a bin would read as "the stock is in here". Rejected and On Hold
    // lots still physically occupy a bin, so they keep the row.
    if (entity.status === "Consumed" || !(Number(entity.quantity) > 0)) {
      return null;
    }
    const activityById = indexBy(payload.activities, (a) => a.id);
    let latest: { at: string; bin: string } | null = null;
    for (const i of payload.inputs) {
      if (i.trackedEntityId !== entity.id) continue;
      const activity = activityById.get(i.trackedActivityId);
      if (!activity || !isMovementActivity(activity.type)) continue;
      const bin = (activity.attributes as Record<string, unknown> | null)?.[
        "To Storage Unit Name"
      ];
      if (typeof bin !== "string" || !bin) continue;
      const at = (activity.createdAt as string | undefined) ?? "";
      if (!latest || at >= latest.at) latest = { at, bin };
    }
    return latest?.bin ?? null;
  }, [entity, payload]);

  const containmentsForEntity = useMemo(() => {
    if (!entity || !payload?.containments?.length) return [];
    return payload.containments.filter((c) => c.trackedEntityId === entity.id);
  }, [entity, payload?.containments]);

  const hasMultiSelect = selectedIds && selectedIds.length > 1;

  return (
    <aside className="w-[426px] flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border text-sm">
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
            {cluster ? (
              <Badge
                variant="secondary"
                className="uppercase tracking-wide text-[10px] shrink-0"
              >
                Serial Group
              </Badge>
            ) : entity ? (
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
                  onClick={() => copyToClipboard(copyId)}
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
          {copyId}
        </p>
      </header>

      <div className="flex flex-col divide-y divide-border/40">
        {cluster && (
          <Section>
            <dl className="divide-y divide-border/30">
              <PropRow label="Status">
                <TrackedEntityStatus status={cluster.status} />
              </PropRow>
              <PropRow label="Serials">
                <span className="text-sm font-medium tabular-nums">
                  {cluster.members.length}
                </span>
              </PropRow>
              {cluster.readableIdRange && (
                <PropRow label="Range">
                  <span className="text-sm font-mono">
                    {cluster.readableIdRange[0] === cluster.readableIdRange[1]
                      ? cluster.readableIdRange[0]
                      : `${cluster.readableIdRange[0]}…${cluster.readableIdRange[1]}`}
                  </span>
                </PropRow>
              )}
            </dl>
          </Section>
        )}
        {(selectedNodeType === "entity" || sourceDoc) && (
          <Section>
            <dl className="divide-y divide-border/30">
              {selectedNodeType === "entity" && (
                <>
                  <PropRow label="Status">
                    <TrackedEntityStatus status={entity?.status} />
                  </PropRow>
                  <PropRow label="Current Quantity">
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
                  {storageUnit && (
                    <PropRow label="Storage Unit">
                      <span className="text-sm font-medium">{storageUnit}</span>
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
        {splits.length > 0 && (
          <Section title="Splits" count={splits.length}>
            <ul className="divide-y divide-border/30">
              {splits.map((item) => (
                <RelatedActivityRow
                  key={item.activity.id}
                  item={item}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </Section>
        )}
        {movedBy.length > 0 && (
          <Section title="Moved by" count={movedBy.length}>
            <ul className="divide-y divide-border/30">
              {movedBy.map((item) => (
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
                <RelatedEntityItemRow
                  key={"cluster" in item ? item.cluster.id : item.entity.id}
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
                <RelatedEntityItemRow
                  key={"cluster" in item ? item.cluster.id : item.entity.id}
                  item={item}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </Section>
        )}

        {cluster && (
          <Section title="Serials" count={cluster.members.length}>
            <ClusterMemberList
              members={cluster.members}
              highlightMemberId={highlightMemberId}
            />
          </Section>
        )}

        {containmentsForEntity.length > 0 && (
          <Section title="Containments" count={containmentsForEntity.length}>
            <ContainmentList items={containmentsForEntity} />
          </Section>
        )}

        {activity &&
          (stepRecordsFetcher.state === "loading" &&
          stepRecordsFetcher.data === undefined ? (
            <Section title="Step records">
              <StepRecordsSkeleton />
            </Section>
          ) : stepRecordsForActivity.length > 0 ? (
            <Section title="Step records" count={stepRecordsForActivity.length}>
              <StepRecordsList
                records={stepRecordsForActivity}
                jobId={
                  (activity?.attributes as Record<string, any> | null)?.Job ??
                  null
                }
              />
            </Section>
          ) : null)}

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
type RelatedCluster = { cluster: EntityCluster; quantity: number };
type RelatedEntityItem = RelatedEntity | RelatedCluster;

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

function RelatedEntityItemRow({
  item,
  onSelect
}: {
  item: RelatedEntityItem;
  onSelect?: (id: string) => void;
}) {
  if ("cluster" in item) {
    return <RelatedClusterRow item={item} onSelect={onSelect} />;
  }
  return <RelatedEntityRow item={item} onSelect={onSelect} />;
}

function RelatedClusterRow({
  item,
  onSelect
}: {
  item: RelatedCluster;
  onSelect?: (id: string) => void;
}) {
  const { cluster } = item;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(cluster.id)}
        className={cn(
          "group w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left rounded-md",
          "hover:bg-accent/50 transition-colors"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <TrackedEntityStatus status={cluster.status} />
          <span className="text-sm truncate">{cluster.headline}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
            ×{cluster.members.length}
          </span>
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

/**
 * A group's members. Plain scroll, no virtualization — even at the 500-entity
 * ceiling these are single-line text rows, and adding a dependency for that
 * isn't worth it.
 */
function ClusterMemberList({
  members,
  highlightMemberId
}: {
  members: ClusterMember[];
  highlightMemberId: string | null;
}) {
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!highlightMemberId) return;
    highlightRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlightMemberId]);

  return (
    <ul className="divide-y divide-border/30 max-h-[320px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
      {members.map((member) => {
        const highlighted = member.id === highlightMemberId;
        return (
          <li key={member.id} ref={highlighted ? highlightRef : undefined}>
            <Link
              to={`${path.to.traceabilityGraph}?trackedEntityId=${encodeURIComponent(member.id)}`}
              className={cn(
                "group w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left rounded-md",
                "hover:bg-accent/50 transition-colors",
                highlighted && "bg-accent/60 ring-1 ring-ring"
              )}
            >
              <span className="text-sm font-mono truncate">
                {member.readableId ?? member.id.slice(0, 8)}
              </span>
              <LuChevronRight className="size-3 text-muted-foreground/60 group-hover:text-foreground transition-colors shrink-0" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function StepRecordsSkeleton() {
  return (
    <ul className="divide-y divide-border/30">
      {[0, 1, 2].map((i) => (
        <li key={i} className="px-2 py-1.5 flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-20 opacity-70" />
          </div>
          <Skeleton className="h-3 w-10 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
