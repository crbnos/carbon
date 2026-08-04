import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type DisplayDispatch,
  type DisplaySchedule,
  isUnplanned,
  openDispatchStatuses,
  UNPLANNED_COST_DAYS
} from "~/utils/display";

/**
 * Data for the wall-mounted work center displays (`/display/:workCenterId/*`).
 *
 * These loaders run against the service-role client: `maintenanceSchedule` RLS
 * requires `resources_view`, which shop-floor operators typically lack, and the
 * "upcoming maintenance" rows would silently read zero for exactly the audience
 * this feature exists for. Every query is therefore scoped by `companyId` in
 * application code, and `getDisplayWorkCenter` must be called first to prove the
 * work center belongs to the session's company before anything else is read.
 */

const daysAgoISO = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

export type DisplayWorkCenter = {
  id: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
  isBlocked: boolean;
  blockingDispatchId: string | null;
  blockingDispatchReadableId: string | null;
};

/**
 * Resolves the work center and proves it belongs to `companyId`. Returns null
 * when it does not exist or belongs to another tenant — callers turn that into
 * a 404 so a guessed id cannot confirm another company's work center exists.
 */
export async function getDisplayWorkCenter(
  client: SupabaseClient<Database>,
  args: { workCenterId: string; companyId: string }
): Promise<DisplayWorkCenter | null> {
  const { data, error } = await client
    .from("workCentersWithBlockingStatus")
    .select(
      "id, name, locationId, locationName, isBlocked, blockingDispatchId, blockingDispatchReadableId"
    )
    .eq("id", args.workCenterId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id!,
    name: data.name ?? "",
    locationId: data.locationId ?? null,
    locationName: data.locationName ?? null,
    isBlocked: data.isBlocked ?? false,
    blockingDispatchId: data.blockingDispatchId ?? null,
    blockingDispatchReadableId: data.blockingDispatchReadableId ?? null
  };
}

export async function getWorkCentersForDisplayPicker(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string }
) {
  return client
    .from("workCentersWithBlockingStatus")
    .select("id, name, locationName, isBlocked")
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId)
    .eq("active", true)
    .order("name", { ascending: true });
}

const DISPATCH_COLUMNS =
  "id, maintenanceDispatchId, status, source, oeeImpact, priority, severity, plannedStartTime, plannedEndTime, actualStartTime, completedAt, createdAt, assignee, maintenanceScheduleId";

export type MaintenanceDisplayData = {
  dispatches: (DisplayDispatch & {
    priority: string | null;
    severity: string | null;
    actualStartTime: string | null;
    assignee: string | null;
    assigneeName: string | null;
  })[];
  schedules: DisplaySchedule[];
  unplannedCost: number;
  lastCompleted: { completedAt: string | null; by: string | null };
};

/**
 * One read of everything the maintenance scoreboard needs.
 *
 * Dispatches come from two queries rather than one `or(...)`: open work matters
 * however old it is, while closed work only matters inside the reporting
 * window. A single filter cannot express that, and PostgREST `or` with an enum
 * value containing a space ("In Progress") is fragile.
 */
export async function getMaintenanceDisplayData(
  client: SupabaseClient<Database>,
  args: { workCenterId: string; companyId: string }
): Promise<MaintenanceDisplayData> {
  const since = daysAgoISO(UNPLANNED_COST_DAYS);

  const [openDispatches, recentDispatches, schedules] = await Promise.all([
    client
      .from("maintenanceDispatch")
      .select(DISPATCH_COLUMNS)
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .in("status", [...openDispatchStatuses]),
    client
      .from("maintenanceDispatch")
      .select(DISPATCH_COLUMNS)
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .gte("createdAt", since),
    client
      .from("maintenanceSchedule")
      .select("id, name, frequency, active, nextDueAt, estimatedDuration")
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .order("nextDueAt", { ascending: true })
  ]);

  // A wall display that reads green because a query silently failed is worse
  // than one that shows an error: the whole board's status is derived from the
  // dispatches and schedules, so a partial read could hide a machine that is
  // down. Fail loud instead — the route lets the error boundary render.
  const queryError =
    openDispatches.error ?? recentDispatches.error ?? schedules.error;
  if (queryError) throw queryError;

  const byId = new Map<string, any>();
  for (const row of [
    ...(openDispatches.data ?? []),
    ...(recentDispatches.data ?? [])
  ]) {
    byId.set(row.id, row);
  }
  const dispatches = [...byId.values()];

  // Cost of unplanned work: the parts consumed by reactive / non-conformance
  // dispatches inside the window. `totalCost` is generated (quantity * unitCost)
  // on the item row, so no unit conversion is needed here.
  const unplannedIds = dispatches
    .filter((d) => isUnplanned(d.source) && d.createdAt >= since)
    .map((d) => d.id);

  const [items, lastCompleted] = await Promise.all([
    unplannedIds.length > 0
      ? client
          .from("maintenanceDispatchItem")
          .select("totalCost")
          .eq("companyId", args.companyId)
          .in("maintenanceDispatchId", unplannedIds)
      : Promise.resolve({ data: [] as { totalCost: number | null }[] }),
    client
      .from("maintenanceDispatch")
      .select("completedAt, assignee")
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .eq("status", "Completed")
      .not("completedAt", "is", null)
      .order("completedAt", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if ("error" in items && items.error) throw items.error;
  if (lastCompleted.error) throw lastCompleted.error;

  const unplannedCost = (items.data ?? []).reduce(
    (sum, item) => sum + (item.totalCost ?? 0),
    0
  );

  const userIds = new Set<string>();
  for (const d of dispatches) if (d.assignee) userIds.add(d.assignee);
  if (lastCompleted.data?.assignee) userIds.add(lastCompleted.data.assignee);

  const names = await getUserNames(client, [...userIds]);

  return {
    dispatches: dispatches.map((d) => ({
      id: d.id,
      maintenanceDispatchId: d.maintenanceDispatchId ?? null,
      status: d.status ?? null,
      source: d.source ?? null,
      oeeImpact: d.oeeImpact ?? null,
      priority: d.priority ?? null,
      severity: d.severity ?? null,
      plannedStartTime: d.plannedStartTime ?? null,
      plannedEndTime: d.plannedEndTime ?? null,
      actualStartTime: d.actualStartTime ?? null,
      completedAt: d.completedAt ?? null,
      createdAt: d.createdAt ?? null,
      assignee: d.assignee ?? null,
      assigneeName: d.assignee ? (names.get(d.assignee) ?? null) : null
    })),
    schedules: (schedules.data ?? []).map((s) => ({
      id: s.id,
      name: s.name ?? null,
      frequency: s.frequency ?? null,
      active: s.active ?? null,
      nextDueAt: s.nextDueAt ?? null
    })),
    unplannedCost,
    lastCompleted: {
      completedAt: lastCompleted.data?.completedAt ?? null,
      by: lastCompleted.data?.assignee
        ? (names.get(lastCompleted.data.assignee) ?? null)
        : null
    }
  };
}

export type ActiveWork = {
  eventId: string;
  type: string | null;
  startTime: string;
  employeeId: string | null;
  employeeName: string | null;
  operationId: string;
  operationDescription: string | null;
  operationStatus: string | null;
  operationQuantity: number | null;
  quantityComplete: number | null;
  quantityScrapped: number | null;
  jobReadableId: string | null;
  jobDueDate: string | null;
  itemReadableId: string | null;
  itemDescription: string | null;
};

export type WorkDisplayQueueRow = {
  id: string;
  jobReadableId: string | null;
  itemReadableId: string | null;
  itemDescription: string | null;
  operationStatus: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  tags: string[] | null;
};

export type WorkDisplayData = {
  activeWork: ActiveWork[];
  queue: WorkDisplayQueueRow[];
  /** When the last production event at this work center ended, for the idle timer. */
  lastEventEndedAt: string | null;
};

/**
 * What is running at the work center right now, plus what is queued behind it.
 *
 * "Running" is an open `productionEvent` (no `endTime`) — the same signal the
 * operator surfaces use, so the display never disagrees with the tablet the
 * operator is holding.
 */
export async function getWorkDisplayData(
  client: SupabaseClient<Database>,
  args: { workCenterId: string; companyId: string; locationId: string }
): Promise<WorkDisplayData> {
  const [events, queue, lastEnded] = await Promise.all([
    client
      .from("productionEvent")
      .select(
        `
        id,
        type,
        startTime,
        employeeId,
        jobOperationId,
        jobOperation:jobOperationId (
          id,
          description,
          status,
          operationQuantity,
          quantityComplete,
          quantityScrapped,
          job:jobId (
            jobId,
            dueDate,
            item:itemId (readableId, name)
          )
        )
      `
      )
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .is("endTime", null)
      .order("startTime", { ascending: true }),
    client.rpc("get_active_job_operations_by_location", {
      location_id: args.locationId,
      work_center_ids: [args.workCenterId]
    }),
    client
      .from("productionEvent")
      .select("endTime")
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .not("endTime", "is", null)
      .order("endTime", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const rows = (events.data ?? []) as any[];
  const queueRows = (queue.data ?? []) as any[];

  const names = await getUserNames(client, [
    ...rows.map((row) => row.employeeId),
    ...queueRows.map((row) => row.assignee)
  ]);

  const activeWork: ActiveWork[] = rows.map((row) => {
    const operation = row.jobOperation ?? {};
    const job = operation.job ?? {};
    const item = job.item ?? {};

    return {
      eventId: row.id,
      type: row.type ?? null,
      startTime: row.startTime,
      employeeId: row.employeeId ?? null,
      employeeName: row.employeeId ? (names.get(row.employeeId) ?? null) : null,
      operationId: row.jobOperationId,
      operationDescription: operation.description ?? null,
      operationStatus: operation.status ?? null,
      operationQuantity: operation.operationQuantity ?? null,
      quantityComplete: operation.quantityComplete ?? null,
      quantityScrapped: operation.quantityScrapped ?? null,
      jobReadableId: job.jobId ?? null,
      jobDueDate: job.dueDate ?? null,
      itemReadableId: item.readableId ?? null,
      itemDescription: item.name ?? null
    };
  });

  // Whatever is already on screen in the hero must not appear again in the
  // queue below it — the display would otherwise show the running job twice.
  const runningOperationIds = new Set(activeWork.map((w) => w.operationId));

  // Sorted the way the operator's own screens sort it: work already underway
  // first, then soonest-needed.
  const queueOrder = ["In Progress", "Paused", "Ready", "Waiting", "Todo"];
  const orderedQueue = queueRows
    .filter((row) => !runningOperationIds.has(row.id))
    .sort((a, b) => {
      const statusDiff =
        indexOrLast(queueOrder, a.operationStatus) -
        indexOrLast(queueOrder, b.operationStatus);
      if (statusDiff !== 0) return statusDiff;
      return compareDueDates(
        a.operationDueDate ?? a.jobDueDate,
        b.operationDueDate ?? b.jobDueDate
      );
    });

  return {
    activeWork,
    lastEventEndedAt: lastEnded.data?.endTime ?? null,
    queue: orderedQueue.map((row) => ({
      id: row.id,
      jobReadableId: row.jobReadableId ?? null,
      itemReadableId: row.itemReadableId ?? null,
      itemDescription: row.itemDescription ?? null,
      operationStatus: row.operationStatus ?? null,
      assigneeName: row.assignee ? (names.get(row.assignee) ?? null) : null,
      dueDate: row.operationDueDate ?? row.jobDueDate ?? null,
      tags: row.tags ?? null
    }))
  };
}

function indexOrLast(order: string[], value: string | null): number {
  const index = order.indexOf(value ?? "");
  return index === -1 ? order.length : index;
}

/** Undated work sorts last rather than pretending to be due at the epoch. */
function compareDueDates(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

async function getUserNames(
  client: SupabaseClient<Database>,
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data } = await client
    .from("user")
    .select("id, fullName")
    .in("id", unique);

  return new Map(
    (data ?? []).map((user) => [user.id, user.fullName ?? ""] as const)
  );
}
