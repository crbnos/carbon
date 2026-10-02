// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { getLocationTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Column, Item } from "~/components/Kanban";
import {
  getActiveJobOperationsByLocation,
  getCustomers,
  getJobOperationBatchMembers,
  getMyPeopleAssignment,
  getProcessesList,
  getWorkCentersByLocation
} from "~/services/operations.service";
import { makeDurations } from "~/utils/durations";
import type { ScreenResult } from "./api-result.server";
import { ok } from "./api-result.server";

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
