import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  ClientOnly,
  cn,
  HStack,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDebounce
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs, Location } from "react-router";
import { useLoaderData } from "react-router";
import { DateTime, Empty } from "~/components";
import { Gantt } from "~/components/Gantt";
import { useReplaceLocation } from "~/hooks/useReplaceLocation";
import { getCapacityReservationsForResources } from "~/modules/production";
import { ScheduleNavigation } from "~/modules/production/ui/Schedule/Kanban/ScheuleNavigation";
import { buildResourceTimeline } from "~/modules/production/ui/Schedule/resourceTimeline";
import {
  formatTimelineDate,
  TIMELINE_DATE_TRIGGER_CLASSES,
  TimelineDetail
} from "~/modules/production/ui/Schedule/TimelineDetail";
import type { TimelineNodeDetail } from "~/modules/production/ui/Schedule/timeline";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import {
  getResizableGanttSettings,
  setResizableGanttSettings
} from "~/utils/resizable-panels";

export const handle: Handle = {
  breadcrumb: msg`Capacity`,
  to: path.to.scheduleResources,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const resizeSettings = await getResizableGanttSettings(request);

  const reservations = await getCapacityReservationsForResources(
    client,
    companyId
  );

  const rows = reservations.data ?? [];

  // Resolve resource names: work centers + named operators + legacy
  // ability (operator pool) rows
  const workCenterIds = new Set<string>();
  const abilityIds = new Set<string>();
  const employeeIds = new Set<string>();
  for (const r of rows) {
    if (r.resourceKind === "WorkCenter") workCenterIds.add(r.resourceId);
    else if (r.resourceKind === "Employee") employeeIds.add(r.resourceId);
    else abilityIds.add(r.resourceId);
  }

  const [workCenters, abilities, operators] = await Promise.all([
    workCenterIds.size > 0
      ? client
          .from("workCenter")
          .select("id, name")
          .in("id", Array.from(workCenterIds))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    abilityIds.size > 0
      ? client
          .from("ability")
          .select("id, name")
          .in("id", Array.from(abilityIds))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    employeeIds.size > 0
      ? client
          .from("user")
          .select("id, fullName")
          .in("id", Array.from(employeeIds))
      : Promise.resolve({
          data: [] as { id: string; fullName: string | null }[]
        })
  ]);

  const workCenterNames = new Map(
    (workCenters.data ?? []).map((w) => [w.id, w.name])
  );
  const abilityNames = new Map(
    (abilities.data ?? []).map((a) => [a.id, a.name])
  );
  const operatorNames = new Map(
    (operators.data ?? []).map((u) => [u.id, u.fullName])
  );

  const timeline = buildResourceTimeline({
    reservations: rows.map((r) => ({
      id: r.id,
      resourceKind: r.resourceKind,
      resourceId: r.resourceId,
      resourceName:
        r.resourceKind === "WorkCenter"
          ? (workCenterNames.get(r.resourceId) ?? "Work Center")
          : r.resourceKind === "Employee"
            ? (operatorNames.get(r.resourceId) ?? "Operator")
            : (abilityNames.get(r.resourceId) ?? "Operator Pool"),
      startAt: r.startAt,
      endAt: r.endAt,
      jobId: r.jobId,
      jobReadableId: r.job?.jobId ?? r.jobId,
      operationDescription: r.jobOperation?.description ?? null,
      hasConflict: r.jobOperation?.hasConflict ?? false,
      conflictReason: r.jobOperation?.conflictReason ?? null,
      scheduleNote: r.scheduleNote,
      workHours: r.workHours
    }))
  });

  const jobCount = new Set(rows.map((r) => r.jobId)).size;
  const conflictCount = new Set(
    rows.filter((r) => r.jobOperation?.hasConflict).map((r) => r.operationId)
  ).size;

  return {
    resourceCount: workCenterIds.size + abilityIds.size + employeeIds.size,
    reservationCount: rows.length,
    jobCount,
    conflictCount,
    trace:
      timeline.events.length > 1
        ? {
            events: timeline.events,
            duration: timeline.totalDuration,
            rootSpanStatus: "completed" as const,
            rootStartedAt: timeline.windowStart
          }
        : null,
    detailsById: timeline.detailsById as Record<string, TimelineNodeDetail>,
    resizeSettings
  };
}

function getSpanId(location: Location<any>): string | undefined {
  const search = new URLSearchParams(location.search);
  return search.get("span") ?? undefined;
}

export default function ResourceGanttView() {
  const {
    resourceCount,
    reservationCount,
    jobCount,
    conflictCount,
    trace,
    detailsById,
    resizeSettings
  } = useLoaderData<typeof loader>();
  const { locale } = useLocale();

  const { location, replaceSearchParam } = useReplaceLocation();
  const selectedSpanId = getSpanId(location);

  const changeToSpan = useDebounce((selectedSpan: string) => {
    replaceSearchParam("span", selectedSpan);
  }, 250);

  const selectedDetail = selectedSpanId
    ? detailsById[selectedSpanId]
    : undefined;

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full bg-background">
      <HStack className="justify-between px-4 py-2 border-b border-border bg-card">
        <HStack spacing={2}>
          <ScheduleNavigation />
          <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
            <Trans>
              {resourceCount} resources · {reservationCount} reservations ·{" "}
              {jobCount} jobs
            </Trans>
          </span>
          {conflictCount > 0 && (
            <Badge
              variant="destructive"
              className="gap-1 whitespace-nowrap tabular-nums"
            >
              <LuTriangleAlert className="size-3" />
              {conflictCount === 1 ? (
                <Trans>1 conflict</Trans>
              ) : (
                <Trans>{conflictCount} conflicts</Trans>
              )}
            </Badge>
          )}
        </HStack>
        <HStack spacing={4} className="text-xs text-muted-foreground">
          <HStack className="gap-x-1">
            <span className="inline-block h-2 w-4 rounded-sm bg-emerald-500" />
            <Trans>Scheduled</Trans>
          </HStack>
          <HStack className="gap-x-1">
            <span className="inline-block h-2 w-4 rounded-sm bg-red-500" />
            <Trans>Conflict</Trans>
          </HStack>
          {trace?.rootStartedAt && (
            <span className="whitespace-nowrap">
              <Trans>
                Starts{" "}
                <DateTime
                  value={trace.rootStartedAt.toISOString()}
                  variant="absolute"
                  className={TIMELINE_DATE_TRIGGER_CLASSES}
                >
                  {formatTimelineDate(
                    trace.rootStartedAt.toISOString(),
                    locale
                  )}
                </DateTime>
              </Trans>
            </span>
          )}
        </HStack>
      </HStack>
      {!trace ? (
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <Trans>
              No capacity reservations to visualize. Schedule a job to see
              work-center load.
            </Trans>
          </Empty>
        </div>
      ) : (
        <div
          className={cn(
            "grid flex-1 min-h-0 grid-cols-1 overflow-hidden bg-background"
          )}
        >
          <ClientOnly fallback={null}>
            {() => (
              <ResizablePanelGroup
                direction="horizontal"
                className="h-full max-h-full"
                onLayout={(layout) => {
                  if (layout.length !== 2) return;
                  if (!selectedSpanId) return;
                  setResizableGanttSettings(document, layout);
                }}
              >
                <ResizablePanel
                  order={1}
                  minSize={30}
                  defaultSize={resizeSettings.layout?.[0]}
                >
                  <Gantt
                    selectedId={selectedSpanId}
                    key={trace.events[0]?.id ?? "-"}
                    events={trace.events}
                    onSelectedIdChanged={(selectedSpan) => {
                      if (!selectedSpan) {
                        replaceSearchParam("span");
                        return;
                      }
                      changeToSpan(selectedSpan);
                    }}
                    totalDuration={trace.duration}
                    rootSpanStatus={trace.rootSpanStatus}
                    rootStartedAt={
                      trace.rootStartedAt
                        ? new Date(trace.rootStartedAt)
                        : undefined
                    }
                  />
                </ResizablePanel>
                {selectedSpanId && selectedDetail && (
                  <>
                    <ResizableHandle withHandle />
                    <ResizablePanel
                      order={2}
                      minSize={25}
                      defaultSize={resizeSettings.layout?.[1]}
                    >
                      <TimelineDetail
                        detail={selectedDetail}
                        onClose={() => replaceSearchParam("span")}
                      />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            )}
          </ClientOnly>
        </div>
      )}
    </div>
  );
}
