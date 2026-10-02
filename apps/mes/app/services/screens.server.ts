// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { activeJobStatuses, getLocationTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type {
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import type { Column, Item } from "~/components/Kanban";
import { getCompanySettings } from "~/services/inventory.service";
import {
  getActiveJobOperationsByLocation,
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
  getKanbanByJobId,
  getMyPeopleAssignment,
  getNextIncompleteSerialEntity,
  getNonConformanceActions,
  getProcessesList,
  getProductionEventsForBatch,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getThumbnailPathByItemId,
  getTrackedEntitiesByMakeMethodId,
  getUpstreamOperations,
  getWorkCenter,
  getWorkCentersByLocation,
  isSerialEntityIncompleteForOperation
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
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
  let peopleStation: { workCenterId: string; name: string } | null = null;
  let peopleDate: string | null = null;
  if (selectedWorkCenterIds.length === 0 && effectiveUserId && locationId) {
    const today = datetime
      .today(await getLocationTimeZone(client, locationId, companyId))
      .toString();
    peopleDate = today;
    if (args.peopleOverrideDate !== today) {
      const myAssignment = await getMyPeopleAssignment(client, {
        companyId,
        employeeId: effectiveUserId,
        date: today
      });
      const assignment = myAssignment.data?.[0];
      if (assignment) {
        selectedWorkCenterIds = [assignment.workCenterId];
        peopleStation = { workCenterId: assignment.workCenterId, name: "" };
      }
    }
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

  if (peopleStation) {
    peopleStation.name =
      workCenters.data?.find((wc: any) => wc.id === peopleStation?.workCenterId)
        ?.name ?? "";
  }

  return ok({
    peopleStation,
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
