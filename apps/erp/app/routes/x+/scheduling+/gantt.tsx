import { requirePermissions } from "@carbon/auth/auth.server";
import { activeJobStatuses } from "@carbon/database";
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
import { Empty } from "~/components";
import { Gantt } from "~/components/Gantt";
import { useDateFormatter } from "~/hooks";
import { useReplaceLocation } from "~/hooks/useReplaceLocation";
import {
  getCapacityReservationsByJob,
  getJobOperationsForTimeline,
  getProductionEventsByJob
} from "~/modules/production";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { ScheduleNavigation } from "~/modules/production/ui/Schedule/Kanban/ScheuleNavigation";
import { TimelineDetail } from "~/modules/production/ui/Schedule/TimelineDetail";
import type { TimelineNodeDetail } from "~/modules/production/ui/Schedule/timeline";
import { buildJobTimeline } from "~/modules/production/ui/Schedule/timeline";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import {
  getResizableGanttSettings,
  setResizableGanttSettings
} from "~/utils/resizable-panels";

export const handle: Handle = {
  breadcrumb: msg`Production`,
  to: path.to.production,
  module: "production"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production"
  });

  const url = new URL(request.url);
  const requestedJobId = url.searchParams.get("jobId");

  const resizeSettings = await getResizableGanttSettings(request);

  const jobs = await client
    .from("job")
    .select("id, jobId, status")
    .eq("companyId", companyId)
    .in("status", [...activeJobStatuses])
    .order("createdAt", { ascending: false })
    .limit(100);

  const jobOptions = (jobs.data ?? []).map((j) => ({
    value: j.id,
    label: j.jobId
  }));

  const selectedJobId = requestedJobId ?? jobs.data?.[0]?.id ?? null;

  if (!selectedJobId) {
    return {
      jobOptions,
      selectedJobId: null,
      jobStatus: null,
      jobDueDate: null,
      conflictCount: 0,
      trace: null,
      detailsById: {} as Record<string, TimelineNodeDetail>,
      resizeSettings
    };
  }

  const [job, operations, reservations, productionEvents] = await Promise.all([
    client
      .from("job")
      .select("id, jobId, status, dueDate")
      .eq("id", selectedJobId)
      .eq("companyId", companyId)
      .single(),
    getJobOperationsForTimeline(client, selectedJobId),
    getCapacityReservationsByJob(client, selectedJobId),
    getProductionEventsByJob(client, selectedJobId)
  ]);

  if (job.error || !job.data) {
    return {
      jobOptions,
      selectedJobId: null,
      jobStatus: null,
      jobDueDate: null,
      conflictCount: 0,
      trace: null,
      detailsById: {} as Record<string, TimelineNodeDetail>,
      resizeSettings
    };
  }

  // Resolve display names: work centers + abilities for reservations, users
  // for assignees and timecards
  const workCenterIds = new Set<string>();
  const abilityIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of reservations.data ?? []) {
    if (r.resourceKind === "WorkCenter") workCenterIds.add(r.resourceId);
    else if (r.resourceKind === "Employee") userIds.add(r.resourceId);
    else abilityIds.add(r.resourceId);
  }
  for (const o of operations.data ?? []) {
    if (o.assignee) userIds.add(o.assignee);
  }
  for (const e of productionEvents.data ?? []) {
    if (e.employeeId) userIds.add(e.employeeId);
  }
  // A make method's parentMaterialId points at a jobMaterial row in the
  // PARENT make method — resolve that ownership so the Gantt can nest
  // subassemblies under the assembly that consumes them
  const parentMaterialIds = new Set<string>();
  for (const o of operations.data ?? []) {
    if (o.jobMakeMethod?.parentMaterialId) {
      parentMaterialIds.add(o.jobMakeMethod.parentMaterialId);
    }
  }

  const [workCenters, abilities, users, parentMaterials] = await Promise.all([
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
    userIds.size > 0
      ? client.from("user").select("id, fullName").in("id", Array.from(userIds))
      : Promise.resolve({
          data: [] as { id: string; fullName: string | null }[]
        }),
    parentMaterialIds.size > 0
      ? client
          .from("jobMaterial")
          .select("id, jobMakeMethodId, order")
          .in("id", Array.from(parentMaterialIds))
      : Promise.resolve({
          data: [] as {
            id: string;
            jobMakeMethodId: string;
            order: number | null;
          }[]
        })
  ]);

  const workCenterNames = new Map(
    (workCenters.data ?? []).map((w) => [w.id, w.name])
  );
  const abilityNames = new Map(
    (abilities.data ?? []).map((a) => [a.id, a.name])
  );
  const userNames = new Map((users.data ?? []).map((u) => [u.id, u.fullName]));
  const materialOwnerMethod = new Map(
    (parentMaterials.data ?? []).map((m) => [m.id, m.jobMakeMethodId])
  );
  const materialOrder = new Map(
    (parentMaterials.data ?? []).map((m) => [m.id, m.order])
  );

  const timeline = buildJobTimeline({
    job: {
      id: job.data.id,
      readableId: job.data.jobId,
      status: job.data.status
    },
    operations: (operations.data ?? []).map((o) => ({
      id: o.id,
      description: o.description,
      order: o.order ?? 0,
      status: o.status,
      startDate: o.startDate,
      dueDate: o.dueDate,
      hasConflict: o.hasConflict,
      conflictReason: o.conflictReason,
      assigneeName: o.assignee ? (userNames.get(o.assignee) ?? null) : null,
      workCenterName: o.workCenter?.name ?? null,
      makeMethodId: o.jobMakeMethod?.id ?? null,
      makeMethodParentMaterialId: o.jobMakeMethod?.parentMaterialId ?? null,
      makeMethodParentMakeMethodId: o.jobMakeMethod?.parentMaterialId
        ? (materialOwnerMethod.get(o.jobMakeMethod.parentMaterialId) ?? null)
        : null,
      makeMethodParentMaterialOrder: o.jobMakeMethod?.parentMaterialId
        ? (materialOrder.get(o.jobMakeMethod.parentMaterialId) ?? null)
        : null,
      makeMethodItemReadableId: o.jobMakeMethod?.item?.readableId ?? null
    })),
    reservations: (reservations.data ?? []).map((r) => ({
      id: r.id,
      operationId: r.operationId,
      resourceKind: r.resourceKind,
      resourceName:
        r.resourceKind === "WorkCenter"
          ? (workCenterNames.get(r.resourceId) ?? "Work Center")
          : r.resourceKind === "Employee"
            ? (userNames.get(r.resourceId) ?? "Operator")
            : (abilityNames.get(r.resourceId) ?? "Operator Pool"),
      startAt: r.startAt,
      endAt: r.endAt,
      earliestStartAt: r.earliestStartAt,
      scheduleNote: r.scheduleNote,
      workHours: r.workHours
    })),
    productionEvents: (productionEvents.data ?? []).map((e) => ({
      id: e.id,
      operationId: e.jobOperationId,
      type: e.type,
      employeeName: e.employeeId ? (userNames.get(e.employeeId) ?? null) : null,
      startTime: e.startTime,
      endTime: e.endTime
    }))
  });

  return {
    jobOptions,
    selectedJobId,
    jobStatus: job.data.status,
    jobDueDate: job.data.dueDate,
    conflictCount: (operations.data ?? []).filter((o) => o.hasConflict).length,
    trace: {
      events: timeline.events,
      duration: timeline.totalDuration,
      rootSpanStatus: "completed" as const,
      rootStartedAt: timeline.windowStart
    },
    detailsById: timeline.detailsById,
    resizeSettings
  };
}

function getSpanId(location: Location<any>): string | undefined {
  const search = new URLSearchParams(location.search);
  return search.get("span") ?? undefined;
}

export default function GanttView() {
  const {
    jobOptions,
    selectedJobId,
    jobStatus,
    jobDueDate,
    conflictCount,
    trace,
    detailsById,
    resizeSettings
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();

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
          <Combobox
            size="sm"
            className="w-56"
            value={selectedJobId ?? ""}
            options={jobOptions}
            placeholder={t`Select a job`}
            onChange={(jobId) => {
              if (jobId) navigate(path.to.scheduleGantt(jobId));
            }}
          />
          {jobStatus && <div className="h-4 w-px bg-border" />}
          <JobStatus status={jobStatus} />
          {jobDueDate && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              <Trans>Due {formatDate(jobDueDate)}</Trans>
            </span>
          )}
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
            <span className="inline-block h-2 w-4 rounded-sm bg-blue-500 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.45)_2px,rgba(255,255,255,0.45)_4px)]" />
            <Trans>Estimated</Trans>
          </HStack>
          <HStack className="gap-x-1">
            <span className="inline-block h-2 w-4 rounded-sm bg-gray-500 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.45)_2px,rgba(255,255,255,0.45)_4px)]" />
            <Trans>In progress</Trans>
          </HStack>
          <HStack className="gap-x-1">
            <span className="inline-block h-2 w-4 rounded-sm bg-red-500" />
            <Trans>Conflict</Trans>
          </HStack>
          {trace?.rootStartedAt && (
            <span className="whitespace-nowrap">
              <Trans>
                Starts {new Date(trace.rootStartedAt).toLocaleString()}
              </Trans>
            </span>
          )}
        </HStack>
      </HStack>
      {!trace || !selectedJobId ? (
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <Trans>
              No released jobs to visualize. Release a job to see its schedule.
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
                    key={`${selectedJobId}-${trace.events[0]?.id ?? "-"}`}
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
                        jobId={selectedJobId}
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
