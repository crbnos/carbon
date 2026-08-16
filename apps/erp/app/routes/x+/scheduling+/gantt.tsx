import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  ClientOnly,
  Combobox,
  cn,
  HStack,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDebounce
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs, Location } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { DateTime, Empty } from "~/components";
import { useLocations } from "~/components/Form/Location";
import { Gantt } from "~/components/Gantt";
import { useReplaceLocation } from "~/hooks/useReplaceLocation";
import { getDepartmentsList } from "~/modules/people";
import { getCapacityReservationsForResources } from "~/modules/production";
import { buildResourceTimeline } from "~/modules/production/ui/Schedule/resourceTimeline";
import {
  TIMELINE_DATE_OPTIONS,
  TimelineDetail
} from "~/modules/production/ui/Schedule/TimelineDetail";
import type { TimelineNodeDetail } from "~/modules/production/ui/Schedule/timeline";
import { getWorkCentersByLocation } from "~/modules/resources";
import { resolveLocationId } from "~/modules/shared/location.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import {
  getResizableGanttSettings,
  setResizableGanttSettings
} from "~/utils/resizable-panels";

export const handle: Handle = {
  breadcrumb: msg`Simulations`,
  to: path.to.scheduleGantt,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production"
  });

  const resizeSettings = await getResizableGanttSettings(request);

  const url = new URL(request.url);
  const locationId = await resolveLocationId(client, request, {
    searchParams: url.searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.production,
    onNoLocations: path.to.production
  });

  const departmentId = url.searchParams.get("department");

  const [reservations, locationWorkCenters, departmentsList] =
    await Promise.all([
      getCapacityReservationsForResources(client, companyId, locationId),
      getWorkCentersByLocation(client, locationId),
      getDepartmentsList(client, companyId)
    ]);

  // Every active work center in the plant — seeded as a lane so a station with
  // no scheduled work still shows up on the board. Narrowed to the selected
  // department when one is chosen.
  const plantWorkCenters = (locationWorkCenters.data ?? [])
    .filter(
      (workCenter) => !departmentId || workCenter.departmentId === departmentId
    )
    .map((workCenter) => ({
      id: workCenter.id as string,
      name: (workCenter.name ?? "Work Center") as string
    }));
  const departmentWorkCenterIds = new Set(plantWorkCenters.map((wc) => wc.id));

  // A department scopes the board to its work centers and their reservations —
  // employee/operator-pool lanes are not department-scoped, so they drop out
  // while a department filter is active.
  const rows = departmentId
    ? (reservations.data ?? []).filter(
        (r) =>
          r.resourceKind === "WorkCenter" &&
          departmentWorkCenterIds.has(r.resourceId)
      )
    : (reservations.data ?? []);

  const departments = (departmentsList.data ?? []).map((department) => ({
    value: department.id,
    label: department.name
  }));

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
    workCenters: plantWorkCenters,
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

  // Count every station shown, not just the ones carrying reservations —
  // include plant work centers, plus any resource a reservation references.
  const shownWorkCenterIds = new Set<string>([
    ...plantWorkCenters.map((workCenter) => workCenter.id),
    ...workCenterIds
  ]);

  return {
    locationId,
    departmentId,
    departments,
    resourceCount: shownWorkCenterIds.size + abilityIds.size + employeeIds.size,
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

function getLocationPath(locationId: string) {
  return `${path.to.scheduleGantt}?location=${locationId}`;
}

export default function ResourceGanttView() {
  const {
    locationId,
    departmentId,
    departments,
    resourceCount,
    reservationCount,
    jobCount,
    conflictCount,
    trace,
    detailsById,
    resizeSettings
  } = useLoaderData<typeof loader>();

  const { t } = useLingui();
  const navigate = useNavigate();
  const locations = useLocations();
  const { location, replaceSearchParam } = useReplaceLocation();
  const selectedSpanId = getSpanId(location);

  // Department filters server-side, so it needs a real navigation (loader
  // re-run) — not replaceSearchParam, which only rewrites the URL client-side.
  const changeDepartment = (value: string) => {
    const params = new URLSearchParams(location.search);
    params.set("location", locationId);
    if (value && value !== "all") params.set("department", value);
    else params.delete("department");
    params.delete("span");
    navigate(`${path.to.scheduleGantt}?${params.toString()}`);
  };

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
          <Combobox
            asButton
            size="sm"
            value={locationId}
            options={locations}
            onChange={(selected) => {
              // hard refresh because the loader's location default won't
              // otherwise pick up the new selection
              window.location.href = getLocationPath(selected);
            }}
          />
          {departments.length > 0 && (
            <Combobox
              asButton
              size="sm"
              value={departmentId ?? "all"}
              options={[
                { value: "all", label: t`All departments` },
                ...departments
              ]}
              onChange={changeDepartment}
            />
          )}
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
                  variant="date"
                  dateOptions={TIMELINE_DATE_OPTIONS}
                />
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
