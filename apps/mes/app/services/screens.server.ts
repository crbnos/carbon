// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Permission } from "@carbon/auth";
import type { Database } from "@carbon/database";
import {
  activeJobStatuses,
  getCompanyTimeZone,
  getLocationTimeZone
} from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  getOrCreateJobOperationInspection,
  getRecentInspectionGauges,
  reconcileInspectionSamplingPlans
} from "@carbon/database/quality";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type {
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import type { Column, Item } from "~/components/Kanban";
import {
  getAvailableTrackedEntities,
  getCompanySettings,
  getPickingListRecommendations,
  getPickOrder
} from "~/services/inventory.service";
import {
  getActiveJobOperationsByEmployee,
  getActiveJobOperationsByLocation,
  getAssemblyPlaybackByOperationId,
  getBatchMaterialTotals,
  getBatchWorkInstructions,
  getCustomers,
  getJobByOperationId,
  getJobFiles,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobMethodBomIdMap,
  getJobOperationBatch,
  getJobOperationBatchMembers,
  getJobOperationById,
  getJobOperationForCompany,
  getJobOperationProcedure,
  getJobOperationsAssignedToEmployee,
  getKanbanByJobId,
  getModelUploadsByIds,
  getMyPeopleAssignment,
  getNcrsByJobOperationId,
  getNextIncompleteSerialEntity,
  getNonConformanceActions,
  getProcessesList,
  getProductionEventsForBatch,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getRecentJobOperationsByEmployee,
  getThumbnailPathByItemId,
  getToolsByOperationId,
  getTrackedEntitiesByMakeMethodId,
  getUpstreamOperations,
  getWorkCenter,
  getWorkCentersByCompany,
  getWorkCentersByLocation,
  isSerialEntityIncompleteForOperation
} from "~/services/operations.service";
import { getOpenClockEntry } from "~/services/people.service";
import {
  getAssignedPickingLists,
  getPickingListForExecution
} from "~/services/picking.service";
import {
  getInspection,
  getInspectionDrawing,
  getInspectionGauges,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getIssueTypesList
} from "~/services/quality.service";
import { resolveStation, type Station } from "~/services/station";
import type { InspectionSample, OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { resolveOperationView } from "~/utils/operationView";
import { path } from "~/utils/path";
import type { ScreenResult } from "./api-result.server";
import { failed, ok } from "./api-result.server";

/**
 * The screen reads behind the MES mobile API, extracted from the web loaders so
 * both clients see the SAME data.
 *
 * Why the API does not read these tables directly as the signed-in user: the
 * web loaders read with the SERVICE ROLE after a sign-in check, while RLS on
 * `productionEvent` requires `production_view` and on `pickingList` requires
 * `inventory_view`. A direct read would show an operator less than the web does
 * (spec, "Why the main screens read through the API").
 *
 * Every function here takes its scope as ARGUMENTS. `userContext` — which holds
 * the location and the effective (pinned) user on the web — is set by
 * `userMiddleware`, registered only under `x+/_layout.tsx` and
 * `display+/_layout.tsx`. Under `api+/` it is null.
 */

const log = getLogger("mes");
// Scope kept as it was in `x+/inspection.$operationId.tsx` so existing log
// queries for its one warn keep matching.
const inspectionLog = getLogger("mes", "inspection");
// Likewise for `x+/assembly.$operationId.tsx` and its one warn.
const assemblyLog = getLogger("mes", "assembly");

type BatchTotals = {
  size: number;
  quantity: number;
  targetQuantity: number;
  jobReadableIds: string[];
};

function getBatchTotals(
  members: NonNullable<
    Awaited<ReturnType<typeof getJobOperationBatchMembers>>["data"]
  >
): Map<string, BatchTotals> {
  const totals = new Map<string, BatchTotals>();
  for (const member of members) {
    if (!member.jobOperationBatchId) continue;
    const total = totals.get(member.jobOperationBatchId) ?? {
      size: 0,
      quantity: 0,
      targetQuantity: 0,
      jobReadableIds: []
    };
    total.size += 1;
    total.quantity += member.operationQuantity ?? 0;
    total.targetQuantity +=
      member.targetQuantity ?? member.operationQuantity ?? 0;
    if (member.job?.jobId) total.jobReadableIds.push(member.job.jobId);
    totals.set(member.jobOperationBatchId, total);
  }
  return totals;
}

// Collapse operations sharing a jobOperationBatchId into one card: keep the first
// as the card, tag it with the member count and summed quantities.
function collapseBatches(
  items: Item[],
  batchTotals: Map<string, BatchTotals>
): Item[] {
  const byBatch = new Map<string, Item[]>();
  const result: Item[] = [];
  for (const item of items) {
    // Require a resolvable batch (readableId comes from the join to
    // jobOperationBatch): a stale batchId whose header is gone must not suppress
    // the op — render it as an individual card, mirroring the ERP board.
    if (item.batchId && item.batchReadableId) {
      const arr = byBatch.get(item.batchId);
      if (arr) arr.push(item);
      else byBatch.set(item.batchId, [item]);
    } else {
      result.push(item);
    }
  }
  for (const [batchId, members] of byBatch) {
    const total = batchTotals.get(batchId);
    result.push({
      ...members[0],
      batchSize: total?.size ?? members.length,
      batchJobReadableIds:
        total?.jobReadableIds ?? members.map((m) => m.title).filter(Boolean),
      quantity:
        total?.quantity ??
        members.reduce((sum, m) => sum + (m.quantity ?? 0), 0),
      targetQuantity:
        total?.targetQuantity ??
        members.reduce((sum, m) => sum + (m.targetQuantity ?? 0), 0)
    });
  }
  return result;
}

/** The web's `key:op:value` filter strings, parsed into id lists. */
export function parseOperationFilters(filterParam: string[]) {
  let selectedWorkCenterIds: string[] = [];
  let selectedProcessIds: string[] = [];
  let selectedSalesOrderIds: string[] = [];
  let selectedTags: string[] = [];
  let selectedAssignee: string[] = [];

  for (const filter of filterParam) {
    const [key, operator, value] = filter.split(":");
    if (value === undefined) continue;
    const ids = operator === "in" ? value.split(",") : [value];
    if (operator !== "in" && operator !== "eq") continue;
    if (key === "workCenterId") selectedWorkCenterIds = ids;
    else if (key === "processId") selectedProcessIds = ids;
    else if (key === "salesOrderId") selectedSalesOrderIds = ids;
    else if (key === "tag") selectedTags = ids;
    else if (key === "assignee") selectedAssignee = ids;
  }

  return {
    selectedWorkCenterIds,
    selectedProcessIds,
    selectedSalesOrderIds,
    selectedTags,
    selectedAssignee
  };
}

export type OperationsScreenArgs = {
  companyId: string;
  locationId: string;
  /** The pinned operator on a shared terminal, else the signed-in user. */
  effectiveUserId: string | undefined;
  /** The web's own `key:op:value` strings, so both clients encode a filter alike. */
  filters: string[];
  search: string | null;
  /**
   * The day the operator dismissed their manning-board station default for,
   * read from a cookie on the web. The app has no such cookie, so it passes
   * null and always gets the station default.
   */
  peopleOverrideDate: string | null;
};

export type OperationsScreen = {
  peopleStation: { workCenterId: string; name: string } | null;
  peopleDate: string | null;
  columns: Column[];
  items: Item[];
  processes: NonNullable<Awaited<ReturnType<typeof getProcessesList>>["data"]>;
  workCenters: NonNullable<
    Awaited<ReturnType<typeof getWorkCentersByLocation>>["data"]
  >;
  customers: NonNullable<Awaited<ReturnType<typeof getCustomers>>["data"]>;
  availableTags: string[];
};

export async function getOperationsScreen(
  client: SupabaseClient<Database>,
  args: OperationsScreenArgs
): Promise<ScreenResult<OperationsScreen>> {
  const { companyId, locationId, effectiveUserId, search } = args;

  let {
    selectedWorkCenterIds,
    selectedProcessIds,
    selectedSalesOrderIds,
    selectedTags,
    selectedAssignee
  } = parseOperationFilters(args.filters);

  // People-assignment station default: when the operator has a manning-board
  // assignment for today and no explicit work-center filter (and hasn't
  // dismissed the default this session), open on their station.
  //
  // `peopleStation` reports the station that was APPLIED, and `myStation` the
  // one the operator HAS. They are the same thing on web, where the station is
  // applied unless dismissed — but the mobile board opens on the whole floor
  // and offers the station as a filter to turn ON, so it needs the name of a
  // station that is not currently applied. Reporting it through `peopleStation`
  // instead would make web's chip reappear after a dismissal, with an ✕ that
  // did nothing.
  let peopleStation: Station | null = null;
  let myStation: Station | null = null;
  let peopleDate: string | null = null;
  if (selectedWorkCenterIds.length === 0 && effectiveUserId && locationId) {
    const today = datetime
      .today(await getLocationTimeZone(client, locationId, companyId))
      .toString();
    peopleDate = today;
    // Runs even when the default was dismissed, which it did not before: the
    // mobile board needs the station's NAME to offer it as a filter, and that
    // is exactly the case where it was never looked up. One small indexed
    // select on a board load that had skipped it.
    const myAssignment = await getMyPeopleAssignment(client, {
      companyId,
      employeeId: effectiveUserId,
      date: today
    });
    const resolved = resolveStation({
      assignment: myAssignment.data?.[0],
      overrideDate: args.peopleOverrideDate,
      today
    });
    peopleStation = resolved.applied;
    myStation = resolved.mine;
    if (peopleStation) selectedWorkCenterIds = [peopleStation.workCenterId];
  }

  const [workCenters, processes, operations] = await Promise.all([
    getWorkCentersByLocation(client, locationId),
    getProcessesList(client, companyId),
    getActiveJobOperationsByLocation(client, locationId, selectedWorkCenterIds)
  ]);

  if (operations.error) {
    log.error("Failed to load operations", { error: operations.error });
  }

  const activeWorkCenters = new Set();
  operations.data?.forEach((op) => {
    if (op.operationStatus === "In Progress") {
      activeWorkCenters.add(op.workCenterId);
    }
  });

  let filteredOperations = selectedWorkCenterIds.length
    ? (operations.data?.filter((op) =>
        selectedWorkCenterIds.includes(op.workCenterId)
      ) ?? [])
    : (operations.data ?? []);

  if (selectedSalesOrderIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedSalesOrderIds.includes(op.salesOrderId)
    );
  }

  if (selectedTags.length) {
    filteredOperations = filteredOperations.filter((op) =>
      op.tags?.some((tag) => selectedTags.includes(tag))
    );
  }

  if (selectedAssignee.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedAssignee.includes(op.assignee)
    );
  }

  if (selectedProcessIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedProcessIds.includes(op.processId)
    );
  }

  if (search) {
    const term = search.toLowerCase();
    filteredOperations = filteredOperations.filter(
      (op) =>
        op.jobReadableId?.toLowerCase().includes(term) ||
        op.itemReadableId?.toLowerCase().includes(term) ||
        op.itemDescription?.toLowerCase().includes(term) ||
        op.description?.toLowerCase().includes(term) ||
        op.batchReadableId?.toLowerCase().includes(term)
    );
  }

  const batchIds = Array.from(
    new Set(
      filteredOperations
        .map((op) => op.jobOperationBatchId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const batchMembers = batchIds.length
    ? await getJobOperationBatchMembers(client, batchIds, companyId)
    : null;
  if (batchMembers?.error) {
    log.error("Failed to load batch members", { error: batchMembers.error });
  }
  const batchTotals = getBatchTotals(batchMembers?.data ?? []);

  const filteredWorkCenters =
    workCenters.data?.filter((wc: any) => {
      if (selectedWorkCenterIds.length && selectedProcessIds.length) {
        return (
          selectedWorkCenterIds.includes(wc.id!) &&
          wc.processes?.some((p: string) => selectedProcessIds.includes(p))
        );
      } else if (selectedWorkCenterIds.length) {
        return selectedWorkCenterIds.includes(wc.id!);
      } else if (selectedProcessIds.length) {
        return wc.processes?.some((p: string) =>
          selectedProcessIds.includes(p)
        );
      }
      return true;
    }) ?? [];

  const customerIds = filteredOperations.map((op) => op.jobCustomerId);
  const customers = await getCustomers(client, companyId, customerIds);

  // Get unique tags and assignees for filters
  const availableTags = Array.from(
    new Set(filteredOperations.flatMap((op) => op.tags || []))
  ).sort();

  // Named from the full work-center list, not the filtered one: when the
  // station is only OFFERED rather than applied, the filtered list may not
  // contain it at all.
  const stationName = (id: string | undefined) =>
    workCenters.data?.find((wc: any) => wc.id === id)?.name ?? "";
  if (peopleStation)
    peopleStation.name = stationName(peopleStation.workCenterId);
  if (myStation) myStation.name = stationName(myStation.workCenterId);

  return ok({
    peopleStation,
    myStation,
    peopleDate,
    columns: filteredWorkCenters
      .map((wc: any) => ({
        id: wc.id!,
        title: wc.name!,
        type: wc.processes ?? [],
        active: activeWorkCenters.has(wc.id),
        isBlocked: wc.isBlocked ?? false,
        blockingDispatchId: wc.blockingDispatchId ?? undefined,
        blockingDispatchReadableId: wc.blockingDispatchReadableId ?? undefined
      }))
      .sort((a, b) => a.title.localeCompare(b.title)) satisfies Column[],
    items: collapseBatches(
      (filteredOperations.map((op) => {
        const operation = makeDurations(op);
        return {
          id: op.id,
          assignee: op.assignee,
          tags: op.tags,
          columnId: op.workCenterId,
          columnType: op.processId,
          priority: op.priority,
          title: op.jobReadableId,
          subtitle: op.itemReadableId,
          description: op.description,
          dueDate: op.operationDueDate,
          duration:
            operation.setupDuration +
            Math.max(operation.laborDuration, operation.machineDuration),
          deadlineType: op.jobDeadlineType,
          customerId: op.jobCustomerId,
          operationQuantity: op.operationQuantity,
          targetQuantity: op.targetQuantity ?? op.operationQuantity,
          jobReadableId: op.jobReadableId,
          itemReadableId: op.itemReadableId,
          itemDescription: op.itemDescription,
          salesOrderReadableId: op.salesOrderReadableId,
          salesOrderId: op.salesOrderId,
          salesOrderLineId: op.salesOrderLineId,
          status: op.operationStatus,
          thumbnailPath: op.thumbnailPath,
          quantity: op.operationQuantity,
          quantityCompleted: op.quantityComplete,
          quantityReworked: op.quantityReworked,
          quantityScrapped: op.quantityScrapped,
          reworkId: op.reworkId,
          setupDuration: operation.setupDuration,
          laborDuration: operation.laborDuration,
          machineDuration: operation.machineDuration,
          batchId: op.jobOperationBatchId,
          batchReadableId: op.batchReadableId,
          hasConflict: op.hasConflict ?? undefined,
          conflictReason: op.conflictReason ?? undefined
        };
      }) ?? []) satisfies Item[],
      batchTotals
    ),
    processes: processes.data ?? [],
    workCenters: workCenters.data ?? [],
    customers: customers.data ?? [],
    availableTags
  });
}

// ---------------------------------------------------------------------------
// Operation queues — Assigned / Active / Recent
// ---------------------------------------------------------------------------

/**
 * The three PERSONAL operation queues, extracted from `x+/assigned.tsx`,
 * `x+/active.tsx` and `x+/recent.tsx`.
 *
 * They are three different questions about one employee, not one query under
 * three filters, and each has its own RPC:
 *
 *  - ASSIGNED (`get_assigned_job_operations`) — what a planner put on this
 *    person's name, whatever its status.
 *  - ACTIVE (`get_active_job_operations_by_employee`) — what this person has
 *    an open production event on. This is the number web MES badges in its
 *    sidebar.
 *  - RECENT (`get_recent_job_operations_by_employee`) — what they last
 *    touched, so picking a job back up is one tap instead of a search.
 *
 * All three RPCs return the SAME row shape, so the three functions differ only
 * in which one they call — but the CLIENT is deliberately not shared. The web
 * `assigned` loader reads with the service role (it also loads every work
 * center, for its board's empty columns) while `active` and `recent` read as
 * the signed-in user, so the client stays the caller's argument and neither
 * the web nor the app can widen what the other sees.
 *
 * Each returns an `Ok` rather than a `ScreenResult`: every one of the three web
 * loaders reads `?? []` and cannot fail, so no caller has to narrow a branch
 * that does not exist — `getPickingScreen` does the same.
 */
export type OperationQueueScreenArgs = {
  companyId: string;
  /**
   * Whose queue this is. The web page passes its signed-in user; the API
   * passes `user.userId` — the pinned operator on a shared terminal — so a
   * tablet shows the work of whoever is standing at it, which is also whose
   * name the start/stop commands write.
   */
  userId: string;
};

export type AssignedScreenArgs = OperationQueueScreenArgs & {
  /**
   * Which location's work centers may appear as EMPTY board columns. The web
   * reads it from `userContext` (null under `api+/`). It filters NOTHING here —
   * it is echoed back for the client to compare against `workCenter.locationId`
   * — so passing null only costs the board's "empty work centers" toggle.
   */
  locationId: string | null | undefined;
};

/** `x+/assigned.tsx`'s loader. */
export async function getAssignedScreen(
  client: SupabaseClient<Database>,
  args: AssignedScreenArgs
) {
  const [operations, workCenters] = await Promise.all([
    getJobOperationsAssignedToEmployee(client, args.userId, args.companyId),
    getWorkCentersByCompany(client, args.companyId)
  ]);

  if (operations.error) {
    log.error("Failed to load assigned operations", {
      companyId: args.companyId,
      error: operations.error
    });
  }

  if (workCenters.error) {
    log.error("Failed to load work centers", {
      companyId: args.companyId,
      error: workCenters.error
    });
  }

  return ok({
    operations: operations?.data?.map(makeDurations) ?? [],
    workCenters: workCenters?.data ?? [],
    locationId: args.locationId
  });
}

export type AssignedScreen = Awaited<
  ReturnType<typeof getAssignedScreen>
>["data"];

/** `x+/active.tsx`'s loader. */
export async function getActiveScreen(
  client: SupabaseClient<Database>,
  args: OperationQueueScreenArgs
) {
  const operations = await getActiveJobOperationsByEmployee(client, {
    employeeId: args.userId,
    companyId: args.companyId
  });

  if (operations.error) {
    log.error("Failed to load active operations", {
      companyId: args.companyId,
      error: operations.error
    });
  }

  return ok({ operations: operations?.data?.map(makeDurations) ?? [] });
}

export type ActiveScreen = Awaited<ReturnType<typeof getActiveScreen>>["data"];

/** `x+/recent.tsx`'s loader. */
export async function getRecentScreen(
  client: SupabaseClient<Database>,
  args: OperationQueueScreenArgs
) {
  const operations = await getRecentJobOperationsByEmployee(client, {
    employeeId: args.userId,
    companyId: args.companyId
  });

  if (operations.error) {
    log.error("Failed to load recent operations", {
      companyId: args.companyId,
      error: operations.error
    });
  }

  return ok({ operations: operations?.data?.map(makeDurations) ?? [] });
}

export type RecentScreen = Awaited<ReturnType<typeof getRecentScreen>>["data"];

// ---------------------------------------------------------------------------
// Operation detail
// ---------------------------------------------------------------------------

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export type OperationScreenArgs = {
  companyId: string;
  userId: string;
  operationId: string;
  trackedEntityId: string | null;
};

/**
 * `x+/operation.$operationId.tsx`'s loader, moved.
 *
 * Three things about the shape it returns:
 *
 *  - The deferred reads (`files`, `materials`, `procedure`, `workCenter`,
 *    `nonConformanceActions`, `batchWorkInstructions`) are still PROMISES. The
 *    web streams them through `Await`; the API awaits them before responding.
 *    Resolving them here would take the streaming away from the web.
 *  - Every `throw redirect(..., flash(...))` the loader had is a
 *    `{ kind: "redirect" }` failure carrying the same message and target, so
 *    the route throws exactly what it throws today and the API answers 409
 *    with the message the operator would have read.
 *  - The serial auto-select is a REDIRECT on the web (it puts the unit in the
 *    URL). An API caller has no URL to redirect, so the resolved unit comes
 *    back as `autoSelectTrackedEntityId` and the route turns that into its
 *    redirect.
 */
export async function getOperationScreen(
  client: SupabaseClient<Database>,
  args: OperationScreenArgs
) {
  const { companyId, userId, operationId, trackedEntityId } = args;

  // Every read below is service-role, so verify the caller-supplied ids belong
  // to this company first (the tracked entity feeds the genealogy lookup).
  const [ownedOperation, ownedEntity] = await Promise.all([
    getJobOperationForCompany(client, operationId, companyId),
    trackedEntityId
      ? client
          .from("trackedEntity")
          .select("id")
          .eq("id", trackedEntityId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);
  if (!ownedOperation.data || (ownedEntity && !ownedEntity.data)) {
    log.warn("Operation or tracked entity not found in company", {
      companyId,
      operationId,
      trackedEntityId,
      error: ownedOperation.error ?? ownedEntity?.error
    });
    return failed({
      kind: "not_found",
      message: "Operation not found",
      redirectTo: path.to.operations
    });
  }

  let [events, quantities, job, operation] = await Promise.all([
    getProductionEventsForJobOperation(client, { operationId, userId }),
    getProductionQuantitiesForJobOperation(client, operationId),
    getJobByOperationId(client, operationId),
    getJobOperationById(client, operationId)
  ]);

  if (job.error) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch job",
      redirectTo: path.to.operations,
      details: job.error
    });
  }

  if (operation.error) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch operation",
      redirectTo: path.to.operations,
      details: operation.error
    });
  }

  if (!job.data.itemId) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch item",
      redirectTo: path.to.operations,
      details: "Item ID is required"
    });
  }

  const op = operation.data?.[0];

  // Redirect guard (ADR-0005): each view has its own route. Guards only
  // redirect kinds they don't serve, so no loop. The caller appends its own
  // search string — the web carries the selected unit across the hop.
  const view = resolveOperationView(op?.operationType);
  if (view === "assembly" || view === "inspection") {
    return failed({
      kind: "redirect",
      message: "",
      redirectTo:
        view === "assembly"
          ? path.to.assembly(operationId)
          : path.to.inspection(operationId),
      details: { view }
    });
  }

  // Batch membership. get_job_operation_by_id omits jobOperationBatchId, so read
  // it directly. When the op belongs to a batch that is still Active/Completing,
  // the operation view runs in batch mode: it shows the shared batch timer and
  // completes the whole batch. A Completed batch was already re-sliced per member
  // — it renders as a plain operation view.
  const batchMembership = await client
    .from("jobOperation")
    .select("jobOperationBatchId")
    .eq("id", operationId)
    .single();
  let batch: Awaited<ReturnType<typeof getJobOperationBatch>>["data"] | null =
    null;
  const batchId = batchMembership.data?.jobOperationBatchId ?? null;
  if (batchId) {
    const batchResult = await getJobOperationBatch(client, batchId, companyId);
    // Floor rule: a batched operation is only floor-visible once its batch
    // has been released (Active/Completing). A Planned batch stays off the
    // floor regardless of its members' job statuses.
    if (batchResult.data?.status === "Planned") {
      return failed({
        kind: "redirect",
        message:
          "This operation is part of a batch that has not been released to the floor",
        redirectTo: path.to.operations
      });
    }
    if (
      batchResult.data &&
      (batchResult.data.status === "Active" ||
        batchResult.data.status === "Completing")
    ) {
      batch = batchResult.data;
      // Read the batch's events (all members' timers) instead of this op's.
      events = await getProductionEventsForBatch(client, batchId);
    }
  } else if (
    !job.data.status ||
    !(activeJobStatuses as readonly string[]).includes(job.data.status)
  ) {
    // Floor rule: an unbatched operation is only floor-visible while its job
    // is released (Ready/In Progress/Paused).
    return failed({
      kind: "redirect",
      message: "This operation's job has not been released to the floor",
      redirectTo: path.to.operations
    });
  }

  const [
    thumbnailPath,
    trackedEntities,
    jobMakeMethod,
    kanban,
    bomIdMap,
    companySettings
  ] = await Promise.all([
    getThumbnailPathByItemId(client, operation.data?.[0].itemId),
    getTrackedEntitiesByMakeMethodId(
      client,
      operation.data?.[0].jobMakeMethodId,
      companyId
    ),
    getJobMakeMethod(client, operation.data?.[0].jobMakeMethodId),
    getKanbanByJobId(client, job.data.id),
    getJobMethodBomIdMap(client, job.data.id!),
    getCompanySettings(client, companyId)
  ]);

  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";
  const autoSelectMaterialWithoutPickingList =
    companySettings.data?.autoSelectMaterialWithoutPickingList ?? false;

  // Is this the first operation in the routing? A serial unit only earns a
  // printed label when it is completed at its first operation, so:
  //  - first operation: no labels exist yet → the operator flows unit-by-unit
  //    (auto-select here on arrival, and in the client after each completion);
  //  - later operations: every unit already has a label → the operator
  //    scans/selects each unit (no auto-select, here or in the client).
  // An operation is "first" when nothing precedes it in THIS make method's
  // routing — i.e. it has no jobOperationDependency whose predecessor lives in
  // the same jobMakeMethod. Dependencies also model subassembly ordering (a
  // parent-assembly op waits on its child subassembly's ops), and those cross
  // make-method dependencies must NOT count: the parent serial still has no
  // printed label just because a subassembly finished first. `order` is only a
  // display/sort field and isn't a reliable precedence signal, so it's not used.
  const priorDependency = await client
    .from("jobOperationDependency")
    .select(
      "dependsOn:jobOperation!jobOperationDependency_dependsOnId_fk!inner(jobMakeMethodId)"
    )
    .eq("operationId", operationId)
    .eq("dependsOn.jobMakeMethodId", op.jobMakeMethodId)
    .limit(1)
    .maybeSingle();
  // Fail closed: a query error also returns null data, so treat an errored lookup
  // as "not first" — later ops require scan/select, which is the safe default when
  // we can't confirm the operation has no predecessor.
  const isFirstOperation = !priorDependency.error && !priorDependency.data;

  // On the first operation only, auto-select the first incomplete unit when none
  // is in the URL. Later operations leave it unset so the client presents the
  // scan/select picker for every unit (including the first one picked up).
  let autoSelectTrackedEntityId: string | null = null;
  if (
    !trackedEntityId &&
    isFirstOperation &&
    trackedEntities.data &&
    trackedEntities.data.length > 0
  ) {
    autoSelectTrackedEntityId =
      trackedEntities.data.find((entity) =>
        isSerialEntityIncompleteForOperation(entity, operationId)
      )?.id ?? null;
  }

  return ok({
    /** The web turns this into a redirect that puts the unit in the URL. */
    autoSelectTrackedEntityId,
    batch,
    bomIdMap: Object.fromEntries(bomIdMap),
    events: events.data ?? [],
    quantities: (quantities.data ?? []).reduce(
      (acc, curr) => {
        if (curr.type === "Scrap") {
          acc.scrap += curr.quantity;
        } else if (curr.type === "Production") {
          acc.production += curr.quantity;
        } else if (curr.type === "Rework") {
          acc.rework += curr.quantity;
        }
        return acc;
      },
      { scrap: 0, production: 0, rework: 0 }
    ),
    job: job.data,
    jobMakeMethod: jobMakeMethod.data,
    kanban: kanban.data,
    files: getJobFiles(client, companyId, job.data, operation.data),
    // Batch mode: the combined per-item requirement across every member, so
    // the materials panel can show the one shared pick.
    batchMaterialTotals: batch
      ? await getBatchMaterialTotals(client, {
          batchId: batch.id as string,
          companyId
        })
      : null,
    // Batch mode: steps, parameters and files across every member (deferred).
    batchWorkInstructions: batch
      ? getBatchWorkInstructions(client, {
          batchId: batch.id as string,
          companyId
        })
      : null,
    materials: getJobMaterialsByOperationId(client, {
      operation: operation.data?.[0],
      trackedEntityId:
        trackedEntityId ??
        getNextIncompleteSerialEntity(trackedEntities.data ?? [], operationId)
          ?.id,
      requiresSerialTracking:
        jobMakeMethod.data?.requiresSerialTracking ?? false
    }),
    trackedEntities: trackedEntities.data ?? [],
    isFirstOperation,
    nonConformanceActions: getNonConformanceActions(client, {
      itemId: operation.data?.[0].itemId,
      processId: operation.data?.[0].processId,
      companyId
    }),
    operation: makeDurations(operation.data?.[0]) as OperationWithDetails,
    expiredEntityPolicy,
    autoSelectMaterialWithoutPickingList,
    procedure: getJobOperationProcedure(client, operation.data?.[0].id),
    workCenter: getWorkCenter(
      client,
      operation.data?.[0].workCenterId
    ) as Promise<
      PostgrestSingleResponse<{
        name: string;
        id: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      }>
    >,
    thumbnailPath
  });
}

export type OperationScreen = Extract<
  Awaited<ReturnType<typeof getOperationScreen>>,
  { ok: true }
>["data"];

/** `x+/rework-targets.$operationId.tsx`'s loader. */
export async function getReworkTargetsScreen(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const operations = await getUpstreamOperations(client, operationId);
  return ok({ operations });
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

export type PickingScreenArgs = {
  companyId: string;
  /** The pinned operator on a shared terminal, else the signed-in user. */
  effectiveUserId: string;
};

/**
 * `x+/picking._index.tsx`'s loader — the lists assigned to this kitter.
 *
 * Never fails: the web loader reads the error-tolerant `?? []`, so the shape is
 * always `ok`. The return type is left inferred (an `Ok`, not a `ScreenResult`)
 * so neither caller has to narrow a branch that cannot happen, exactly as
 * `getReworkTargetsScreen` does.
 */
export async function getPickingScreen(
  client: SupabaseClient<Database>,
  args: PickingScreenArgs
) {
  const pickingLists = await getAssignedPickingLists(
    client,
    args.effectiveUserId,
    args.companyId
  );
  if (pickingLists.error) {
    log.error("Failed to load assigned picking lists", {
      companyId: args.companyId,
      error: pickingLists.error
    });
  }
  return ok({ pickingLists: pickingLists.data ?? [] });
}

export type PickingScreen = Awaited<
  ReturnType<typeof getPickingScreen>
>["data"];

export type PickingListScreenArgs = {
  companyId: string;
  pickingListId: string;
};

/**
 * `x+/picking.$pickingListId.tsx`'s loader.
 *
 * `recommendations` stays a PROMISE: the web streams it through `Await` so the
 * at-a-glance lot subtext never blocks first render. The API awaits it.
 *
 * `pickingListId` comes from a URL on both clients, so the read is scoped to
 * `companyId` (inside `getPickingListForExecution`, which is the header read —
 * no second pre-check query) and a miss is `not_found`, which the web throws as
 * the 404 it threw before.
 */
export async function getPickingListScreen(
  client: SupabaseClient<Database>,
  args: PickingListScreenArgs
) {
  const { companyId, pickingListId } = args;

  const result = await getPickingListForExecution(
    client,
    pickingListId,
    companyId
  );

  if (result.error || !result.data) {
    log.warn("Picking list not found in company", {
      companyId,
      pickingListId,
      error: result.error
    });
    return failed({ kind: "not_found", message: "Picking list not found" });
  }

  return ok({
    pickingList: result.data,
    // Deferred (not awaited): recommended serial/batch lots per line, streamed in
    // after the list paints so the at-a-glance subtext never blocks first render.
    recommendations: getPickingListRecommendations(client, pickingListId)
  });
}

export type PickingListScreen = Extract<
  Awaited<ReturnType<typeof getPickingListScreen>>,
  { ok: true }
>["data"];

export type PickingTrackedOptionsArgs = {
  companyId: string;
  /** The list in the URL; the line must belong to it. */
  pickingListId: string | undefined;
  lineId: string;
};

/**
 * `x+/picking.$pickingListId.tracked.$lineId.tsx`'s loader — the available
 * tracked lots for one picking line (non-lineside, deduped), smart-ordered for
 * the `TrackedEntityPicker`.
 *
 * Both ids come from a URL, so the line is re-read under `companyId` AND
 * checked against the list in the path before anything is looked up for it.
 */
export async function getPickingTrackedOptionsScreen(
  client: SupabaseClient<Database>,
  args: PickingTrackedOptionsArgs
) {
  const { companyId, lineId, pickingListId } = args;

  const lineResult = await client
    .from("pickingListLine")
    .select(
      "id, itemId, pickingListId, quantityToPick, quantityPicked, pickingList(locationId), item(itemTrackingType)"
    )
    .eq("id", lineId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (lineResult.error || !lineResult.data) {
    log.warn("Picking line not found for company", {
      companyId,
      lineId,
      error: lineResult.error
    });
    return failed({ kind: "not_found", message: "Line not found" });
  }

  const line = lineResult.data;

  // The line must belong to the list in the path. Both clients always send the
  // pair together, so this only ever refuses a hand-made URL that pairs one
  // company's list with another list's line.
  if (pickingListId && line.pickingListId !== pickingListId) {
    log.warn("Picking line does not belong to the list in the path", {
      companyId,
      lineId,
      pickingListId
    });
    return failed({ kind: "not_found", message: "Line not found" });
  }

  const locationId = (line.pickingList as { locationId: string } | null)
    ?.locationId;
  const trackingType =
    (line.item as { itemTrackingType: string } | null)?.itemTrackingType ??
    "Batch";

  const [entities, settings, defaultOrder] = await Promise.all([
    locationId
      ? getAvailableTrackedEntities(client, {
          itemId: line.itemId,
          companyId,
          locationId,
          excludeLineside: true,
          excludeAllocated: true,
          excludeLineId: lineId
        })
      : { data: [] },
    getCompanySettings(client, companyId),
    locationId
      ? getPickOrder(client, { itemId: line.itemId, locationId, companyId })
      : ("Default" as const)
  ]);
  const shelfLife = (settings.data?.inventoryShelfLife ?? {}) as {
    nearExpiryWarningDays?: number | null;
    expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
  };

  return ok({
    entities: entities.data ?? [],
    trackingType,
    quantityRequired: Math.max(
      0,
      Number(line.quantityToPick ?? 0) - Number(line.quantityPicked ?? 0)
    ),
    nearExpiryWarningDays: shelfLife.nearExpiryWarningDays ?? 0,
    expiredEntityPolicy: shelfLife.expiredEntityPolicy ?? "Warn",
    defaultOrder
  });
}

export type PickingTrackedOptionsScreen = Extract<
  Awaited<ReturnType<typeof getPickingTrackedOptionsScreen>>,
  { ok: true }
>["data"];

// ---------------------------------------------------------------------------
// Time card
// ---------------------------------------------------------------------------

export type TimecardScreenArgs = {
  companyId: string;
  /**
   * Whose hours these are. The web page passes its signed-in user; the API
   * passes `user.userId` — the pinned operator on a shared terminal — so the
   * card shows the hours the clock-in/clock-out commands actually wrote.
   */
  userId: string;
  /** 0 = this week, -1 = last week. The web reads it from `?week=`. */
  weekOffset: number;
};

/**
 * `x+/timecard.tsx`'s loader.
 *
 * Never fails (the web reads `?? []` and `openEntry.data`), so like
 * `getPickingScreen` the return type is an `Ok` and needs no narrowing.
 */
export async function getTimecardScreen(
  client: SupabaseClient<Database>,
  args: TimecardScreenArgs
) {
  const { companyId, userId, weekOffset } = args;

  // Week runs Monday → Sunday on the company calendar (one payroll boundary
  // per books, not the server's zone).
  const tz = await getCompanyTimeZone(client, companyId);
  const { from, to } = datetime.weekBounds(tz, weekOffset);
  // Calendar days of the window on the COMPANY calendar — the client renders
  // these directly so the header never shifts a day in a different browser tz.
  const weekStart = datetime.businessDay(from, tz).toString();
  const weekEnd = datetime.businessDay(to, tz).toString();

  const [entries, openEntry] = await Promise.all([
    client
      .from("timeCardEntry")
      .select("*")
      .eq("employeeId", userId)
      .eq("companyId", companyId)
      .gte("clockIn", from)
      .lte("clockIn", to)
      .order("clockIn", { ascending: false }),
    getOpenClockEntry(client, userId, companyId)
  ]);

  return ok({
    entries: entries.data ?? [],
    openEntry: openEntry.data,
    weekOffset,
    weekStart,
    weekEnd
  });
}

export type TimecardScreen = Awaited<
  ReturnType<typeof getTimecardScreen>
>["data"];

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export type InspectionScreenArgs = {
  companyId: string;
  /** Whose open timers the events read returns. */
  userId: string;
  /** The JOB OPERATION in the URL — the lot is found or created from it. */
  operationId: string;
};

/**
 * `x+/inspection.$operationId.tsx`'s loader, moved.
 *
 * Four things about it:
 *
 *  - It takes BOTH clients the loader used: the service-role supabase client
 *    for the reads (RLS on `productionEvent` needs `production_view`, which an
 *    operator does not have — a direct read would show them less than the web
 *    does) and the Kysely pool for the three engine calls (the lot
 *    find-or-create, the plan reconcile, the gauge history). The caller passes
 *    `getDatabaseClient()`, exactly as the loader did.
 *  - It WRITES, despite being a read: `getOrCreateJobOperationInspection` is a
 *    lazy find-or-create (idempotent per `(sourceDocument,
 *    sourceDocumentLineId)`, settled by the partial unique index) and
 *    `reconcileInspectionSamplingPlans` resolves plan rows for features added
 *    to the live document after the lot existed. Opening the screen is what
 *    creates the lot on both clients; that is the flow, not a side effect to
 *    factor out.
 *  - Every `throw redirect(..., flash(...))` the loader had is a failure
 *    carrying the SAME message and target, so the web route throws exactly
 *    what it throws today. A company-scope miss is `not_found` (the API's 404);
 *    everything else is `redirect` (409). `message: ""` means the loader
 *    redirected with no flash, and `details: { view }` is the wrong-view guard,
 *    whose redirect the web route appends its own search string to.
 *  - The DRAWING is carried as `drawing` — the document's name and its balloon
 *    geometry — but never as a PDF or a url to one. `react-pdf` and
 *    `react-konva` are DOM-only, so a native client has no engine to open a
 *    PDF with and renders a page through `GET /inspections/:id/drawing?page=N`
 *    instead, which rasterises it server-side. The balloon coordinates are
 *    normalized 0–1, so the same numbers place the overlay over a page
 *    rendered at any scale. The web route still does its own
 *    `getInspectionDocumentWithBalloons` read: it needs the `pdfUrl` this
 *    deliberately does not carry.
 */
export async function getInspectionScreen(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: InspectionScreenArgs
) {
  const { companyId, userId, operationId } = args;

  // Every read below uses the service role, so prove the operation belongs to
  // this company before any of them runs.
  const scopedOperation = await client
    .from("jobOperation")
    .select("id")
    .eq("id", operationId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (scopedOperation.error || !scopedOperation.data) {
    inspectionLog.warn("Job operation not found for company", {
      companyId,
      operationId,
      error: scopedOperation.error
    });
    return failed({
      kind: "not_found",
      message: "Failed to fetch operation",
      redirectTo: path.to.operations,
      details: scopedOperation.error
    });
  }

  const [job, operation] = await Promise.all([
    getJobByOperationId(client, operationId),
    getJobOperationById(client, operationId)
  ]);

  if (job.error) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch job",
      redirectTo: path.to.operations,
      details: job.error
    });
  }
  if (operation.error) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch operation",
      redirectTo: path.to.operations,
      details: operation.error
    });
  }

  const op = operation.data?.[0];
  if (!op) {
    return failed({
      kind: "redirect",
      message: "",
      redirectTo: path.to.operations
    });
  }

  // Redirect guard (ADR-0005): only Inspection operations render here.
  // Guards only redirect kinds they don't serve, so no loop. The caller
  // appends its own search string — the web carries the selected unit across
  // the hop.
  const view = resolveOperationView(op.operationType);
  if (view !== "inspection") {
    return failed({
      kind: "redirect",
      message: "",
      redirectTo: path.to.operation(operationId),
      details: { view }
    });
  }

  // Lazy find-or-create of the inspection lot for this operation — mirrors
  // post-receipt lot creation (plan snapshot + per-feature plans from the
  // operation's inspectionDocumentId FK). Idempotent per (sourceDocument,
  // sourceDocumentLineId).
  const lot = await getOrCreateJobOperationInspection(db, {
    jobOperationId: operationId,
    companyId,
    userId
  });
  if (lot.error || !lot.data) {
    return failed({
      kind: "redirect",
      message: "Failed to create inspection",
      redirectTo: path.to.operations,
      details: lot.error
    });
  }

  const inspectionResult = await getInspection(client, lot.data.id);
  if (inspectionResult.error || !inspectionResult.data) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch inspection",
      redirectTo: path.to.operations,
      details: inspectionResult.error
    });
  }
  const inspection = inspectionResult.data as any;

  // The lot references its document live: features added to the document
  // after lot creation get their per-lot plan rows resolved lazily.
  if (inspection.inspectionDocumentId) {
    await reconcileInspectionSamplingPlans(db, lot.data.id, companyId);
  }

  // The drawing, as a client with no PDF engine can use it: the name and the
  // balloons. Both come from the same read the web pane uses, so the two panes
  // cannot disagree about where a balloon sits; only `pdfUrl` is dropped.
  // Scoped by `companyId` as well as by id — the document id comes off the lot
  // row, but a drawing is the one thing here that is shared across lots.
  const drawing = inspection.inspectionDocumentId
    ? await getInspectionDrawing(
        client,
        inspection.inspectionDocumentId,
        companyId
      )
    : null;

  const [
    features,
    measurements,
    issueTypes,
    trackedEntities,
    jobMakeMethod,
    events,
    quantities,
    linkedQuantities,
    gauges,
    recentGauges
  ] = await Promise.all([
    getInspectionSamplingPlans(client, lot.data.id, companyId),
    getInspectionMeasurements(client, lot.data.id, companyId),
    getIssueTypesList(client, companyId),
    getTrackedEntitiesByMakeMethodId(client, op.jobMakeMethodId, companyId),
    getJobMakeMethod(client, op.jobMakeMethodId),
    getProductionEventsForJobOperation(client, { operationId, userId }),
    getProductionQuantitiesForJobOperation(client, operationId),
    // Verdict-driven postings link back to their sample — the UI derives
    // "Complete passed (n)" from what is passed but not yet posted.
    client
      .from("productionQuantity")
      .select("id, type, quantity, inspectionSampleId")
      .eq("inspectionId", lot.data.id),
    getInspectionGauges(client, companyId, lot.data.id),
    getRecentInspectionGauges(db, {
      inspectionId: lot.data.id,
      companyId
    })
  ]);

  const linkedProductionRows = (linkedQuantities.data ?? []).filter(
    (row) => row.type === "Production"
  );

  const productionQuantities = (quantities.data ?? []).reduce(
    (acc, curr) => {
      if (curr.type === "Scrap") acc.scrap += curr.quantity;
      else if (curr.type === "Production") acc.production += curr.quantity;
      else if (curr.type === "Rework") acc.rework += curr.quantity;
      return acc;
    },
    { scrap: 0, production: 0, rework: 0 }
  );

  // Sample column order must match the engine's required-feature derivation
  // (createdAt asc, id asc).
  const samples = (
    [...(inspection.inspectionSample ?? [])] as InspectionSample[]
  ).sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id)
  );

  return ok({
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    inspection,
    drawing,
    samples,
    features: features.data ?? [],
    measurements: measurements.data ?? [],
    gauges: gauges.data ?? [],
    recentGaugeIds: recentGauges.data ?? [],
    issueTypes: issueTypes.data ?? [],
    trackedEntities: trackedEntities.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    events: events.data ?? [],
    productionQuantities,
    linkedSampleIds: linkedProductionRows
      .map((row) => row.inspectionSampleId)
      .filter((sampleId): sampleId is string => Boolean(sampleId)),
    linkedProductionQuantity: linkedProductionRows.reduce(
      (sum, row) => sum + (row.quantity ?? 0),
      0
    ),
    jobId: job.data.id ?? null
  });
}

export type InspectionScreen = Extract<
  Awaited<ReturnType<typeof getInspectionScreen>>,
  { ok: true }
>["data"];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type AssemblyScreenArgs = {
  companyId: string;
  /**
   * Whose screen this is: the open Labor timer is read for this employee. Both
   * clients pass the EFFECTIVE user — the pinned operator on a shared
   * terminal, which is `requirePermissions`' `userId` on the web and
   * `user.userId` on the API — so the timer shown is the one the start/stop
   * commands write in that person's name.
   */
  userId: string;
  /** The JOB OPERATION in the URL. */
  operationId: string;
  /**
   * `?unit=` exactly as it arrived: the 0-based index of the unit to open.
   * Parsed here rather than by the caller, so both clients agree on which
   * strings are an index and which fall back to the next unit still to build.
   */
  unit: string | null;
  /**
   * `?trackedEntityId=`: an explicit unit of a serial parent. It wins over
   * `unit`. It is only ever COMPARED against this operation's own entities
   * (read under `companyId`), never looked up, so an id from anywhere else is
   * simply ignored.
   */
  trackedEntityId: string | null;
  /**
   * The claims of `userId`, which decide the manager override. An ARGUMENT
   * rather than a read in here because the two clients must not share a claims
   * cache: the web's `getUserClaims` keys on the user alone (safe while the
   * company lives in the session), and the API takes its company from a
   * per-request header, so it keeps its own per-(user, company) key. Each
   * caller loads the claims its own way and this decides from them once.
   */
  claims: { permissions?: Record<string, Permission> } | null | undefined;
};

/**
 * `x+/assembly.$operationId.tsx`'s loader, moved.
 *
 * Five things about it:
 *
 *  - It is a pure READ. Unlike the inspection screen, opening it creates
 *    nothing; the containment steps the web adds for an open non-conformance
 *    are written by the view afterwards (`x+/steps.inspection.tsx`), not here.
 *  - Every read is SERVICE ROLE, as it was in the loader: RLS on
 *    `productionEvent` needs `production_view`, which an operator does not
 *    hold, so reading as the operator would show them less than the web does.
 *    `operationId` comes from a URL on both clients, so it is re-read under
 *    `companyId` before anything else runs, and every later read is keyed off
 *    that operation.
 *  - Every `throw redirect(..., flash(...))` the loader had is a failure
 *    carrying the SAME message and target, so the web route throws exactly
 *    what it throws today. A company-scope miss is `not_found` (the API's 404);
 *    everything else is `redirect` (409). `message: ""` means the loader
 *    redirected with no flash, and `details: { view }` is the wrong-view guard,
 *    whose redirect the web route appends its own search string to.
 *  - The UNIT is resolved here, not by the caller: an explicit
 *    `trackedEntityId` wins, then the `unit` index, else the next unit still
 *    to build. The entity it lands on comes back as `trackedEntityId`, and it
 *    is what `materials` is attributed to — so a client that pages units has
 *    to ask again, exactly as the web revalidates on a search-param change.
 *  - The 3D model travels as storage PATHS (`modelPath`, `slideModels`,
 *    `assemblyPlayback.glbPath` / `graphPath`), never as bytes or signed urls.
 *    `assemblyPlayback` is null when the operation has no linked instruction
 *    or its model has no converted artifacts, which is also when the view
 *    falls back to the static slides — none of them is required to open it.
 */
export async function getAssemblyScreen(
  client: SupabaseClient<Database>,
  args: AssemblyScreenArgs
) {
  const { companyId, userId, operationId, unit, trackedEntityId, claims } =
    args;

  // Manager-only "complete all steps" override is gated on the Production DELETE permission:
  // operators hold view/create/update (they record steps) but not delete, so delete cleanly
  // separates managers from operators regardless of how a company names its employee types.
  const canOverrideComplete =
    claims?.permissions?.production?.delete?.some(
      (c) => c === "0" || c === companyId
    ) ?? false;

  // Every read below is service-role: verify the operation is this company's.
  const ownedOperation = await getJobOperationForCompany(
    client,
    operationId,
    companyId
  );
  if (!ownedOperation.data) {
    assemblyLog.warn("Operation not found in company", {
      companyId,
      operationId,
      error: ownedOperation.error
    });
    return failed({
      kind: "not_found",
      message: "Operation not found",
      redirectTo: path.to.operations
    });
  }

  const [job, operation] = await Promise.all([
    getJobByOperationId(client, operationId),
    getJobOperationById(client, operationId)
  ]);

  if (job.error) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch job",
      redirectTo: path.to.operations,
      details: job.error
    });
  }
  if (operation.error) {
    return failed({
      kind: "redirect",
      message: "Failed to fetch operation",
      redirectTo: path.to.operations,
      details: operation.error
    });
  }

  const op = operation.data?.[0];
  if (!op) {
    return failed({
      kind: "redirect",
      message: "",
      redirectTo: path.to.operations
    });
  }

  // Redirect guard (ADR-0005): only Assembly operations render here. Anything else goes
  // back to the operation route (which renders its own view, or redirects again). Guards
  // only redirect kinds they don't serve, so no loop. The caller appends its own search
  // string — the web carries the selected unit across the hop.
  const view = resolveOperationView(op.operationType);
  if (view !== "assembly") {
    return failed({
      kind: "redirect",
      message: "",
      redirectTo: path.to.operation(operationId),
      details: { view }
    });
  }

  const [
    thumbnailPath,
    trackedEntities,
    jobMakeMethod,
    procedure,
    tools,
    ncrs,
    events,
    nonConformanceActions,
    assemblyPlayback
  ] = await Promise.all([
    getThumbnailPathByItemId(client, op.itemId),
    getTrackedEntitiesByMakeMethodId(client, op.jobMakeMethodId, companyId),
    getJobMakeMethod(client, op.jobMakeMethodId),
    getJobOperationProcedure(client, operationId),
    getToolsByOperationId(client, operationId),
    getNcrsByJobOperationId(client, operationId),
    getProductionEventsForJobOperation(client, { operationId, userId }),
    getNonConformanceActions(client, {
      itemId: op.itemId,
      processId: op.processId,
      companyId
    }),
    getAssemblyPlaybackByOperationId(client, operationId)
  ]);

  // 3D model slides reference modelUpload rows; resolve their render metadata
  // (glbPath / modelPath / thumbnail) in one query.
  const slideModelIds = Array.from(
    new Set(
      procedure.attributes.flatMap((step) =>
        (step.jobOperationStepSlide ?? []).map((slide) => slide.modelUploadId)
      )
    )
  ).filter((id): id is string => !!id);

  const [quantities, workCenter, kanban, slideModelUploads] = await Promise.all(
    [
      getProductionQuantitiesForJobOperation(client, operationId),
      getWorkCenter(client, op.workCenterId),
      job.data.id ? getKanbanByJobId(client, job.data.id) : null,
      slideModelIds.length > 0
        ? getModelUploadsByIds(client, slideModelIds)
        : null
    ]
  );

  const productionQuantities = (quantities.data ?? []).reduce(
    (acc, curr) => {
      if (curr.type === "Scrap") acc.scrap += curr.quantity;
      else if (curr.type === "Production") acc.production += curr.quantity;
      else if (curr.type === "Rework") acc.rework += curr.quantity;
      return acc;
    },
    { scrap: 0, production: 0, rework: 0 }
  );

  // Expiry policy for the issue-material modal — same source as the operation view.
  const companySettings = await getCompanySettings(client, companyId);
  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";

  // Passive operation timer (opt-in). When on, the assembly view auto-starts the operator's
  // timer on open (see AutoTimer in AssemblyView). It never auto-ends a timer.
  const autoStartOperationTimer =
    companySettings.data?.autoStartOperationTimer ?? false;

  // Resolve the unit the materials/consume target key off. Only serial/batch parents
  // bind per-unit tracked entities; inventory/non-inventory parents page purely by index,
  // so their stray inventory entities must NOT seed the unit axis. Navigable units are
  // capped to the operation quantity (a job can pre-generate extra serials). An explicit
  // ?trackedEntityId wins; otherwise honor the ?unit index, so client navigation to an
  // untracked unit isn't snapped back to unit 0.
  const allEntities = trackedEntities.data ?? [];
  const opQty = Math.max(
    1,
    Math.round((op.operationQuantity as number) ?? allEntities.length)
  );
  const isParentTracked =
    (jobMakeMethod.data?.requiresSerialTracking ?? false) ||
    (jobMakeMethod.data?.requiresBatchTracking ?? false);
  const navEntities = isParentTracked ? allEntities.slice(0, opQty) : [];
  const unitParam = Number.parseInt(unit ?? "", 10);
  const entityIndex = trackedEntityId
    ? navEntities.findIndex((te) => te.id === trackedEntityId)
    : -1;
  // Must match AssemblyView.currentUnitIndex: with no explicit ?unit/?trackedEntityId,
  // land on the NEXT unit still to build (quantityComplete), not unit 0 — for EVERY
  // tracking type. A serial parent seeds trackedEntityId to this unit's entity below,
  // so a fresh load resumes on the in-progress unit instead of a finished unit 1. The
  // component deletes ?unit after completing a unit and rolls forward on quantityComplete;
  // material issue attribution also keys off this unit, so a stale 0 would mis-credit it.
  const quantityComplete = Math.max(
    0,
    Math.round((op.quantityComplete as number) ?? 0)
  );
  const defaultUnitIndex = Math.min(quantityComplete, Math.max(0, opQty - 1));
  const unitIndex =
    entityIndex >= 0
      ? entityIndex
      : Number.isInteger(unitParam) && unitParam >= 0 && unitParam < opQty
        ? unitParam
        : defaultUnitIndex;
  // A batch parent shares ONE lot across every unit, so its lot entity binds to all
  // units regardless of the unit index; a serial parent binds a distinct entity per
  // unit (navEntities[unitIndex]).
  const effectiveEntityId =
    (jobMakeMethod.data?.requiresBatchTracking ?? false)
      ? navEntities[0]?.id
      : navEntities[unitIndex]?.id;

  const [materials, openEvent, priorDependency] = await Promise.all([
    getJobMaterialsByOperationId(client, {
      operation: op,
      trackedEntityId: effectiveEntityId,
      requiresSerialTracking:
        jobMakeMethod.data?.requiresSerialTracking ?? false,
      requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
      unitIndex
    }),
    // Open Labor production event for this operator+operation drives the timer.
    client
      .from("productionEvent")
      .select("id, startTime")
      .eq("jobOperationId", op.id)
      .eq("employeeId", userId)
      .eq("type", "Labor")
      .is("endTime", null)
      .order("startTime", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Is this the first operation in the routing? A serial unit only earns a printed
    // label when completed at its first operation, so the first op flows unit-by-unit
    // (auto-select), and later ops scan/select (labels exist). "First" means nothing
    // precedes it within THIS make method — no jobOperationDependency whose predecessor
    // shares this op's jobMakeMethodId. Cross make-method (subassembly) dependencies are
    // ignored: a parent-assembly op still has no printed label just because a subassembly
    // finished first. `order` is only a display/sort field and isn't a reliable signal.
    client
      .from("jobOperationDependency")
      .select(
        "dependsOn:jobOperation!jobOperationDependency_dependsOnId_fk!inner(jobMakeMethodId)"
      )
      .eq("operationId", operationId)
      .eq("dependsOn.jobMakeMethodId", op.jobMakeMethodId)
      .limit(1)
      .maybeSingle()
  ]);
  // Fail closed: a query error also returns null data, so treat an errored lookup
  // as "not first" — later ops require scan/select, which is the safe default when
  // we can't confirm the operation has no predecessor.
  const isFirstOperation = !priorDependency.error && !priorDependency.data;

  return ok({
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    thumbnailPath,
    trackedEntities: trackedEntities.data ?? [],
    // The resolved entity for the current unit, or null for untracked units, so the
    // component falls back to the ?unit index instead of snapping back to unit 0.
    trackedEntityId: effectiveEntityId ?? null,
    materials,
    procedure,
    tools: tools.data ?? [],
    ncrs: ncrs.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    isFirstOperation,
    openEvent: openEvent.data ?? null,
    events: events.data ?? [],
    nonConformanceActions,
    expiredEntityPolicy,
    autoStartOperationTimer,
    productionQuantities,
    workCenter:
      (workCenter.data as {
        id: string;
        name: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      } | null) ?? null,
    kanban: kanban?.data ?? null,
    jobId: job.data.id ?? null,
    canOverrideComplete,
    modelPath:
      (op as { itemModelPath?: string | null }).itemModelPath ??
      (job.data as { modelPath?: string | null }).modelPath ??
      null,
    slideModels: Object.fromEntries(
      (slideModelUploads?.data ?? []).map((model) => [model.id, model])
    ),
    assemblyPlayback
  });
}

export type AssemblyScreen = Extract<
  Awaited<ReturnType<typeof getAssemblyScreen>>,
  { ok: true }
>["data"];
