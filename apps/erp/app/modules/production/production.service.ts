// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  InvalidInputError,
  NotFoundError,
  ServerFnError
} from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import {
  batchOperationsInput,
  type PostProductionEventResult,
  postProductionEventInput,
  recalculateInput,
  rescheduleInput,
  triggerReworkInput
} from "@carbon/api/postings";
import type {
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import {
  fetchAllByIds,
  fetchAllFromTable,
  fetchAllRecords,
  getCompanyTimeZone,
  journalReference
} from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import {
  type Kysely,
  type KyselyDatabase,
  withTransaction
} from "@carbon/database/client";
import {
  runConfigurationRule,
  transpileRule
} from "@carbon/database/configuration-rule";
import {
  type ComputedJobQuantityNode,
  computeJobQuantities,
  flattenJobQuantityTree
} from "@carbon/database/job-quantities-engine";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus,
  MissingAccountDefaultError,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { toJson, toJsonColumns } from "@carbon/database/json";
import {
  calculateQuoteLinePrices,
  getJobMethodTree,
  getQuoteMethodTree,
  getRatesFromSupplierProcesses,
  getRatesFromWorkCenters,
  type JobMethodTreeItem,
  type QuoteMethodTreeItem,
  traverseJobMethod,
  traverseJobMethodAsync,
  traverseQuoteMethod
} from "@carbon/database/methods";
import { effectiveReplenishment } from "@carbon/database/mrp-engine";
import type * as rows from "@carbon/database/rows";
import {
  inOrder,
  isNull,
  many,
  maybeSingle,
  neq,
  notNull,
  selectRow,
  selectRows,
  single,
  updateRows
} from "@carbon/database/rows";
import {
  getNextRevisionSequence,
  getNextSequence,
  getNextSerialNumbers
} from "@carbon/database/sequence";
import { getStrictBackflushSettings } from "@carbon/database/strict-backflush";
import {
  buildConsumeFirstHops,
  buildConsumeFirstRules,
  buildSupersessionRedirectMap,
  consumableInWholeAssemblies,
  consumeFirstStockItems,
  pullBackQuantities,
  reserveConsumeFirstStock,
  resolveMadeLinePull,
  type SupersessionContext,
  type SupersessionRow,
  settleConsumeFirstLine,
  withoutStockedConsumeFirst
} from "@carbon/database/supersession-pick";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { storage } from "@carbon/files";
import { TiptapText } from "@carbon/files/markdown";
import { trigger } from "@carbon/jobs";
import type { JobSource } from "@carbon/lib/telemetry";
import { asJobSource, trackWorkEvent } from "@carbon/lib/telemetry";
import { raiseMoment } from "@carbon/lib/workflows";
import { getLogger } from "@carbon/logger";
import {
  type LadderShiftRow,
  resolveLocationWindows,
  subtractIntervals
} from "@carbon/planning";
import type { JSONContent } from "@carbon/react";
import {
  assertAllOperationsClaimed,
  assertBatchCompletionMembership,
  assertBatchWorkCenterMutable,
  async,
  BATCH_RULE_DIMENSIONS,
  type BatchRules,
  buildBatchCompletionPlan,
  chunkArray,
  credit,
  datetime,
  debit,
  getErrorMessage,
  groupBy,
  HOUR_MS,
  isUniqueViolation,
  type MemberValueSets,
  mustViolations,
  nameSimilarity,
  planBatchCompletion,
  resolveBatchRules,
  round,
  scrapAllowance,
  searchFilter,
  unchecked
} from "@carbon/utils";
import type {
  AssemblyGraph,
  AssemblyGraphIndex,
  AssemblyPlan
} from "@carbon/viewer";
import {
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION,
  describeStep,
  groupComponentNodeIds,
  indexAssemblyGraph,
  validateSubAssemblies
} from "@carbon/viewer";
import {
  getDayOfWeek,
  parseDate,
  parseDateTime,
  toCalendarDateTime
} from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { ExpressionBuilder } from "kysely";
import { type QueryCreator, sql, type Transaction } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createDocumentUploadUrl } from "~/modules/documents/documents.service";
import {
  assertCompanyRecords,
  attributesContain,
  chunked,
  getCurrentAccountingPeriod,
  getDefaultPostingGroup,
  getStorageUnitId,
  TIME_ENTRY_BEFORE_CUTOVER_ERROR
} from "~/modules/shared/shared.service";
import type { StorageItem } from "~/types";
import { makeDurations } from "~/utils/duration";
import type { GenericQueryFilters } from "~/utils/query";
import {
  getGenericFilter,
  LIST_COUNT,
  setGenericQueryFilters
} from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import * as inventoryPostings from "../inventory/inventory.service";
import { getDefaultStorageUnitForJob } from "../inventory/inventory.utils";
import { getEmployeeJob } from "../people/people.service";
import { resolveJobConfiguration } from "../sales/sales.utils";
import type {
  operationParameterValidator,
  operationStepSlideValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared/shared.models";
import { normalizeOperationSourceIds } from "../shared/shared.models";
import { invokePosting } from "../shared/shared.service";
import { updateSortOrder } from "../shared/sort-order";
import type { MethodType } from "../shared/types";
import {
  claimPlanningActions,
  releasePlanningActionClaims
} from "./planning-action-claims";
import type {
  assemblyInstructionStatuses,
  assemblyStepStatuses,
  deadlineTypes,
  failureModeValidator,
  jobMaterialValidator,
  jobOperationValidator,
  jobStatus,
  jobValidator,
  maintenanceDispatchCommentValidator,
  maintenanceDispatchEventValidator,
  maintenanceDispatchItemValidator,
  maintenanceDispatchValidator,
  maintenanceDispatchWorkCenterValidator,
  maintenanceScheduleItemValidator,
  maintenanceScheduleValidator,
  procedureParameterValidator,
  procedureStepValidator,
  procedureValidator,
  productionEventValidator,
  productionQuantityValidator,
  scrapReasonValidator
} from "./production.models";
import {
  ACTIVE_JOB_STATUSES,
  type cameraSchema,
  type fastenerSchema,
  getAssemblyModelState,
  isJobLocked,
  isJobOrderStatusHidden,
  JOB_LOCKED_MESSAGE,
  JOB_LOCKED_STATUSES,
  JOB_SUPPLY_STATUS_PRIORITY,
  makeToAssetReleaseError,
  motionSchema,
  type orientationSchema,
  PLANNING_EDITABLE_JOB_STATUSES,
  PO_STATUS_PRIORITY,
  WEEKDAYS_MONDAY_FIRST
} from "./production.models";
import type {
  ItemOrderStatus,
  ItemShortfall,
  Job,
  JobMaterialPurchaseOrderLine,
  JobMaterialSupplyJobLine
} from "./types";
import {
  makeMethodsMissingOperations,
  materialsWithoutStorageUnit,
  outsideOperationsNeedingPurchaseOrders,
  resolveOperationSupplier
} from "./ui/Jobs/job-release-logic";
import {
  type MachineTimeListFilters,
  machineTimeQueueKeyset
} from "./ui/MachineTime/machine-time-filters.ee";

const logger = getLogger("erp", "production");

export async function convertSalesOrderLinesToJobs(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    orderId,
    companyId,
    userId,
    refusedItems
  }: {
    orderId: string;
    companyId: string;
    userId: string;
    /** Items no job may be made for, with the reason; their lines are skipped. */
    refusedItems?: Map<string, string>;
  }
) {
  const salesOrder = await client
    .from("salesOrder")
    .select("*")
    .eq("id", orderId)
    .single();

  const salesOrderLines = await client
    .from("salesOrderLines")
    .select("*")
    .eq("salesOrderId", orderId)
    .order("itemReadableId", { ascending: true });

  if (companyId !== salesOrder.data?.companyId) {
    return { data: null, error: "Company ID mismatch" };
  }

  if (salesOrder.error) {
    return salesOrder;
  }

  if (salesOrderLines.error) {
    return salesOrderLines;
  }

  const lines = salesOrderLines.data;
  if (!lines) {
    return { data: null, error: "No lines found" };
  }

  // Lines converted individually must not be converted a second time here
  const existingJobs = await client
    .from("job")
    .select("salesOrderLineId")
    .eq("companyId", companyId)
    .in("salesOrderLineId", lines.map((line) => line.id).filter(Boolean));

  if (existingJobs.error) {
    return existingJobs;
  }

  const lineIdsWithJobs = new Set(
    existingJobs.data.map((job) => job.salesOrderLineId)
  );

  const opportunity = await client
    .from("opportunity")
    .select("*, quotes(*), salesOrders(*)")
    .eq("id", salesOrder.data?.opportunityId ?? "")
    .single();

  const quoteId = opportunity.data?.quotes[0]?.id;
  const salesOrderId = opportunity.data?.salesOrders[0]?.id;

  // A converted quote line shares its id with the order line, so its
  // configuration is the fallback for an order line configured nowhere else.
  const quoteLineConfigurations = new Map<string, unknown>();
  if (quoteId) {
    const quoteLines = await client
      .from("quoteLine")
      .select("id, configuration")
      .eq("quoteId", quoteId)
      .eq("companyId", companyId)
      .in("id", lines.map((line) => line.id).filter(Boolean) as string[]);
    for (const quoteLine of quoteLines.data ?? []) {
      quoteLineConfigurations.set(quoteLine.id, quoteLine.configuration);
    }
  }

  const errors: string[] = [];
  let jobsCreated = 0;

  for await (const line of lines) {
    if (
      line.methodType === "Make to Order" &&
      line.itemId &&
      !lineIdsWithJobs.has(line.id)
    ) {
      const refused = refusedItems?.get(line.itemId);
      if (refused) {
        errors.push(refused);
        continue;
      }

      const manufacturing = await client
        .from("itemReplenishment")
        .select("*")
        .eq("itemId", line.itemId)
        .eq("companyId", companyId)
        .maybeSingle();

      const lotSize = manufacturing.data?.lotSize ?? 0;
      const totalQuantity = line.saleQuantity ?? 0;
      const totalJobs = lotSize > 0 ? Math.ceil(totalQuantity / lotSize) : 1;

      const jobsToCreate = Math.max(1, totalJobs);

      const { configuration, reconfigured } = resolveJobConfiguration(
        line.configuration,
        line.id ? quoteLineConfigurations.get(line.id) : null
      );

      const defaultLocation = await client
        .from("location")
        .select("id")
        .eq("companyId", companyId)
        .limit(1);

      for await (const index of Array.from({ length: jobsToCreate }).keys()) {
        const nextSequence = await client.rpc("get_next_sequence", {
          sequence_name: "job",
          company_id: companyId
        });

        if (!nextSequence.data) {
          errors.push(`Failed to get sequence for line ${line.itemReadableId}`);
          continue;
        }

        const isLastJob = index === jobsToCreate - 1;
        const jobQuantity =
          lotSize > 0
            ? isLastJob
              ? totalQuantity - lotSize * (jobsToCreate - 1)
              : lotSize
            : totalQuantity;

        const dueDate = line.promisedDate ?? undefined;

        let locationId = line.locationId ?? salesOrder.data?.locationId;
        if (!locationId) {
          if (defaultLocation.data && defaultLocation.data.length > 0) {
            locationId = defaultLocation.data?.[0]?.id;
          } else {
            errors.push(`No location found for line ${line.itemReadableId}`);
            continue;
          }
        }

        // Services are Non-Inventory and never have storage units
        const storageUnitId =
          line.salesOrderLineType === "Service"
            ? null
            : await getDefaultStorageUnitForJob(
                client,
                line.itemId,
                locationId!,
                companyId
              );

        // Calculate scrap quantity based on item's scrap percentage
        const scrapPercentage = manufacturing.data?.scrapPercentage ?? 0;
        const scrapQuantity = scrapAllowance(jobQuantity, scrapPercentage);

        const data = {
          customerId: salesOrder.data?.customerId ?? undefined,
          deadlineType: "Hard Deadline" as const,
          dueDate,
          startDate: dueDate
            ? parseDate(dueDate)
                .subtract({ days: manufacturing.data?.leadTime ?? 7 })
                .toString()
            : undefined,
          itemId: line.itemId,
          locationId: locationId!,
          modelUploadId: line.modelUploadId ?? undefined,
          quantity: jobQuantity,
          quoteId: quoteId ?? undefined,
          quoteLineId: quoteId ? line.id : undefined,
          salesOrderId: salesOrderId ?? undefined,
          salesOrderLineId: line.id,
          scrapQuantity,
          storageUnitId: storageUnitId ?? undefined,
          unitOfMeasureCode: line.unitOfMeasureCode ?? "EA",
          configuration: configuration as Json
        };

        // Calculate priority based on due date and deadline type
        const priority = await calculateJobPriority(client, {
          dueDate: data.dueDate ?? null,
          deadlineType: data.deadlineType,
          companyId,
          locationId: locationId!
        });

        const createJob = await client
          .from("job")
          .insert({
            ...data,
            jobId: nextSequence.data,
            priority,
            companyId,
            createdBy: userId,
            updatedBy: userId
          })
          .select("id")
          .single();

        if (createJob.error) {
          errors.push(
            `Failed to create job for line ${line.itemReadableId}: ${createJob.error.message}`
          );
          continue;
        }

        // This function inserts into `job` itself rather than going through
        // insertJob, so it inherits none of its instrumentation. Without this,
        // "Create Jobs" on a sales order — the make-to-order path, and for some
        // shops the only way jobs are ever raised — produced no job_created at
        // all, and the account would read as not running production.
        trackWorkEvent("job_created", {
          companyId,
          userId,
          jobId: createJob.data.id,
          itemId: data.itemId,
          quantity: data.quantity,
          scrapQuantity: data.scrapQuantity ?? 0,
          locationId: locationId ?? null,
          salesOrderLineId: line.id,
          deadlineType: data.deadlineType ?? null,
          source: "salesOrder"
        });

        if (quoteId && !reconfigured) {
          const upsertMethod = await invokePosting(
            { client, db, companyId, userId },
            "get-method",
            {
              type: "quoteLineToJob",
              sourceId: `${quoteId}:${line.id}`,
              targetId: createJob.data.id
            },
            getMethod,
            { as: getMethodPermission }
          );

          if (upsertMethod.error) {
            errors.push(
              `Failed to create method for job ${nextSequence.data} (Line item ${line.itemReadableId}): ${upsertMethod.error.message || "unknown error"}`
            );
            continue;
          }
        } else {
          const upsertMethod = await invokePosting(
            { client, db, companyId, userId },
            "get-method",
            {
              type: "itemToJob",
              sourceId: data.itemId,
              targetId: createJob.data.id,
              ...(configuration ? { configuration } : {})
            },
            getMethod,
            { as: getMethodPermission }
          );

          if (upsertMethod.error) {
            errors.push(
              `Failed to create method for job ${nextSequence.data} (Line item ${line.itemReadableId}): ${upsertMethod.error.message || "unknown error"}`
            );
            continue;
          }
        }

        await invokePosting(
          { client, db, companyId, userId },
          "recalculate",
          {
            type: "jobRequirements",
            id: createJob.data.id
          },
          recalculateRequirements,
          { as: recalculateRequirementsPermission }
        );

        await assignJobSerialNumbers(client, db, {
          jobId: createJob.data.id,
          itemId: data.itemId,
          companyId,
          userId
        });

        jobsCreated++;
      }
    }
  }

  if (errors.length > 0) {
    logger.error("Failed to convert sales order lines to jobs", { errors });
    return {
      data: null,
      error: {
        message: `Failed to create ${errors.length} job(s). ${errors.join(
          "; "
        )}`,
        details: errors.join("; "),
        code: "JOB_CREATION_ERROR"
      } as PostgrestError
    };
  }

  if (jobsCreated === 0) {
    const skippedLines = lines.map((l) => l.itemReadableId).filter(Boolean);
    const skippedLinesStr =
      skippedLines.length > 0
        ? ` (Lines checked: ${skippedLines.join(", ")})`
        : "";
    return {
      data: null,
      error: {
        message: "No jobs were created",
        details: `No Make items found on sales order lines${skippedLinesStr}`,
        code: "NO_JOBS_CREATED"
      } as PostgrestError
    };
  }

  return salesOrder;
}

/**
 * Calculate the priority for a job based on its dueDate and deadlineType.
 * Priority ordering: ASAP > Hard Deadline > Soft Deadline > No Deadline
 *
 * @param client - Supabase client
 * @param params - Job details
 * @returns The calculated priority number
 */
export async function calculateJobPriority(
  client: SupabaseClient<Database>,
  params: {
    jobId?: string; // Optional - if updating an existing job
    dueDate: string | null;
    deadlineType: (typeof deadlineTypes)[number];
    companyId: string;
    locationId: string;
  }
): Promise<number> {
  const { jobId, dueDate, deadlineType, companyId, locationId } = params;

  // Query all jobs with the same dueDate (or null if dueDate is null)
  let query = client
    .from("job")
    .select("id, priority, deadlineType")
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .order("priority", { ascending: true });

  if (dueDate) {
    query = query.eq("dueDate", dueDate);
  } else {
    query = query.is("dueDate", null);
  }

  // Exclude the current job if we're updating
  if (jobId) {
    query = query.neq("id", jobId);
  }

  const { data: existingJobs } = await query;

  return nextJobPriority(existingJobs ?? [], deadlineType);
}

type DeadlineType = Database["public"]["Enums"]["deadlineType"];

const DEADLINE_TYPE_PRIORITY: Record<DeadlineType, number> = {
  ASAP: 0,
  "Hard Deadline": 1,
  "Soft Deadline": 2,
  "No Deadline": 3
};

/**
 * The priority of a job placed among `siblings` — the jobs that share its due
 * date (or lack of one) at its location, in priority order. Fractional
 * indexing: before the first job whose deadline type ranks lower than this
 * one's, else at the end. Pure, so a batch can place several jobs on one date
 * in turn by appending each result to the siblings it passes for the next.
 */
/**
 * The deadline type a job carries once planning gives it a due date. The job
 * form hides the due-date field for "No Deadline" (`deadlineRequiresDueDate`),
 * so a date written under that type is one the planner can neither see nor
 * edit on the job, and `nextJobPriority` would rank it with the undated
 * weight. The Order path sets Soft Deadline the same way.
 */
export function deadlineTypeForPlanningDate(
  deadlineType: DeadlineType
): DeadlineType {
  return deadlineType === "No Deadline" ? "Soft Deadline" : deadlineType;
}

export function nextJobPriority(
  siblings: { priority: number | null; deadlineType: DeadlineType }[],
  deadlineType: DeadlineType
): number {
  if (siblings.length === 0) return 0;

  const currentJobPriority = DEADLINE_TYPE_PRIORITY[deadlineType];
  let insertBeforeIndex = siblings.length;
  for (let i = 0; i < siblings.length; i++) {
    if (
      currentJobPriority < DEADLINE_TYPE_PRIORITY[siblings[i]!.deadlineType]
    ) {
      insertBeforeIndex = i;
      break;
    }
  }

  if (insertBeforeIndex === 0) {
    const firstPriority = siblings[0]!.priority ?? 0;
    return firstPriority > 0 ? firstPriority / 2 : -1;
  }
  if (insertBeforeIndex === siblings.length) {
    return (siblings[siblings.length - 1]!.priority ?? 0) + 1;
  }
  const beforePriority = siblings[insertBeforeIndex - 1]!.priority ?? 0;
  const afterPriority = siblings[insertBeforeIndex]!.priority ?? 0;
  return (beforePriority + afterPriority) / 2;
}

export async function deleteJobOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobOperationStep").delete().eq("id", id);
}

export async function deleteJobOperationStepSlide(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobOperationStepSlide").delete().eq("id", id);
}

export async function deleteJobOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobOperationParameter").delete().eq("id", id);
}

export async function deleteJobOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobOperationTool").delete().eq("id", id);
}

export async function deleteProcedure(
  client: SupabaseClient<Database>,
  procedureId: string
) {
  return client.from("procedure").delete().eq("id", procedureId);
}

export async function deleteProcedureStep(
  client: SupabaseClient<Database>,
  procedureStepId: string,
  companyId: string
) {
  return client
    .from("procedureStep")
    .delete()
    .eq("id", procedureStepId)
    .eq("companyId", companyId);
}

export async function deleteProcedureParameter(
  client: SupabaseClient<Database>,
  procedureParameterId: string,
  companyId: string
) {
  return client
    .from("procedureParameter")
    .delete()
    .eq("id", procedureParameterId)
    .eq("companyId", companyId);
}

export async function deleteProductionEvent(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  productionEventId: string,
  companyId: string,
  userId: string
) {
  const event = await client
    .from("productionEvent")
    .select("id, postedToGL")
    .eq("id", productionEventId)
    .eq("companyId", companyId)
    .single();
  if (event.error) return event;

  // A posted event's journal entry must be reversed before the row goes
  // away, otherwise WIP keeps the orphaned absorption.
  if (event.data.postedToGL) {
    const reversal = await invokePosting(
      { client, db, companyId, userId },
      "post-production-event",
      {
        productionEventId,
        reverse: true
      },
      postProductionEvent,
      { as: postProductionEventPermission }
    );
    if (reversal.error) {
      return {
        data: null,
        error: {
          message: `Failed to reverse the event's journal entry: ${
            reversal.error.message || "unknown error"
          }`
        }
      };
    }
    if (reversal.data && reversal.data.success === false) {
      return {
        data: null,
        error: {
          message: `Cannot delete a posted production event: ${
            reversal.data.reason ?? "unknown reason"
          }`
        }
      };
    }
  }

  // Recorded output quantities reference this event via ON DELETE SET NULL FKs
  // (migration below), so they survive with their link cleared — the quantities
  // are real output and outlive an individual time card.
  return client
    .from("productionEvent")
    .delete()
    .eq("id", productionEventId)
    .eq("companyId", companyId);
}

export async function deleteProductionQuantity(
  client: SupabaseClient<Database>,
  productionQuantityId: string
) {
  return client
    .from("productionQuantity")
    .delete()
    .eq("id", productionQuantityId);
}

export async function getActiveJobOperationByJobId(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
): Promise<{
  id: string;
  setupTime: number;
  laborTime: number;
  machineTime: number;
} | null> {
  const jobMakeMethod = await client
    .from("jobMakeMethod")
    .select("id")
    .eq("jobId", jobId)
    .is("parentMaterialId", null)
    .eq("companyId", companyId)
    .maybeSingle();

  if (jobMakeMethod.error || !jobMakeMethod.data) {
    return null;
  }

  const jobOperations = await client
    .from("jobOperation")
    .select("id, setupTime, laborTime, machineTime")
    .eq("jobMakeMethodId", jobMakeMethod.data?.id!)
    .eq("companyId", companyId)
    .in("status", ["Todo", "Ready", "In Progress", "Waiting", "Paused"])
    .order("order", { ascending: true })
    .limit(1);

  if (jobOperations.error || !jobOperations.data) {
    return null;
  }

  return jobOperations.data[0];
}

export async function getActiveJobOperationsByLocation(
  client: SupabaseClient<Database>,
  locationId: string,
  workCenterIds: string[] = []
) {
  return client.rpc("get_active_job_operations_by_location", {
    location_id: locationId,
    work_center_ids: workCenterIds
  });
}

export async function getJobsByDateRange(
  client: SupabaseClient<Database>,
  locationId: string,
  startDate: string,
  endDate: string
) {
  return client.rpc("get_jobs_by_date_range", {
    location_id: locationId,
    start_date: startDate,
    end_date: endDate
  });
}

export async function getUnscheduledJobs(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client.rpc("get_unscheduled_jobs", {
    location_id: locationId
  });
}

export async function getActiveProductionEvents(
  client: SupabaseClient<Database>,
  companyId: string
) {
  // TS2589 — supabase select-string instantiation depth sits on tsgo's limit;
  // the cliff shifts as unrelated modules join the program. ts-ignore, not
  // ts-expect-error, so it satisfies both tsc and tsgo.
  // @ts-ignore TS2589
  return client
    .from("productionEvent")
    .select(
      "*, ...jobOperation(description, ...job(jobId:id, jobReadableId:jobId, customerId, dueDate, deadlineType, salesOrderLineId, ...salesOrderLine(...salesOrder(salesOrderId:id, salesOrderReadableId:salesOrderId))))"
    )
    .eq("companyId", companyId)
    .is("endTime", null);
}

export async function deleteScrapReason(
  client: SupabaseClient<Database>,
  scrapReasonId: string
) {
  return client.from("scrapReason").delete().eq("id", scrapReasonId);
}

export async function deleteFailureMode(
  client: SupabaseClient<Database>,
  failureModeId: string
) {
  return client.from("maintenanceFailureMode").delete().eq("id", failureModeId);
}

export async function deleteMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client.from("maintenanceDispatch").delete().eq("id", dispatchId);
}

export async function deleteMaintenanceDispatchComment(
  client: SupabaseClient<Database>,
  commentId: string
) {
  return client.from("maintenanceDispatchComment").delete().eq("id", commentId);
}

export async function deleteMaintenanceDispatchEvent(
  client: SupabaseClient<Database>,
  eventId: string
) {
  return client.from("maintenanceDispatchEvent").delete().eq("id", eventId);
}

export async function deleteMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client.from("maintenanceDispatchItem").delete().eq("id", itemId);
}

export async function deleteMaintenanceDispatchWorkCenter(
  client: SupabaseClient<Database>,
  workCenterId: string
) {
  return client
    .from("maintenanceDispatchWorkCenter")
    .delete()
    .eq("id", workCenterId);
}

export async function deleteMaintenanceSchedule(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client.from("maintenanceSchedule").delete().eq("id", scheduleId);
}

export async function deleteMaintenanceScheduleItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client.from("maintenanceScheduleItem").delete().eq("id", itemId);
}

export async function getDemandForecasts(
  client: SupabaseClient<Database>,
  params: {
    itemId: string;
    locationId: string;
    companyId: string;
    periodIds: string[];
  }
) {
  return client
    .from("demandForecast")
    .select("*")
    .eq("itemId", params.itemId)
    .eq("locationId", params.locationId)
    .eq("companyId", params.companyId)
    .in("periodId", params.periodIds);
}

export async function getDemandProjections(
  client: SupabaseClient<Database>,
  params: {
    itemId: string;
    locationId: string;
    companyId: string;
    periodIds: string[];
  }
) {
  return client
    .from("demandProjection")
    .select("*")
    .eq("itemId", params.itemId)
    .eq("locationId", params.locationId)
    .eq("companyId", params.companyId)
    .in("periodId", params.periodIds);
}

export async function getJobDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  job: {
    id: string | null;
    salesOrderLineId?: string | null;
    quoteLineId?: string | null;
    itemId?: string | null;
  }
): Promise<StorageItem[]> {
  // Fixed positions, not a conditionally-grown array: the destructuring below
  // is positional, so a job with an itemId but no sales/quote line would
  // otherwise land its PARTS listing in `opportunityLineFiles` and label those
  // files `bucket: "opportunity-line"`, which resolves the wrong storage path.
  const opportunityLine = job.salesOrderLineId || job.quoteLineId;
  const [jobFiles, opportunityLineFiles, partsFiles] = await Promise.all([
    storage(client).company(companyId).list(`${companyId}/job/${job.id}`),
    opportunityLine
      ? storage(client)
          .company(companyId)
          .list(`${companyId}/opportunity-line/${opportunityLine}`)
      : null,
    job.itemId
      ? storage(client)
          .company(companyId)
          .list(`${companyId}/parts/${job.itemId}`)
      : null
  ]);

  // Combine and return all sets of files with their respective buckets
  return [
    ...(jobFiles.data ?? []).map((f) => ({
      ...f,
      bucket: "job"
    })),
    ...(opportunityLineFiles?.data ?? []).map((f) => ({
      ...f,
      bucket: "opportunity-line"
    })),
    ...(partsFiles?.data ?? []).map((f) => ({
      ...f,
      bucket: "parts"
    }))
  ];
}

export const getPartDocuments = async (
  client: SupabaseClient<Database>,
  companyId: string,
  ...items: Array<{ itemId: string }>
) => {
  const getFile = async (id: string) => {
    const res = await storage(client)
      .company(companyId)
      .list(`${companyId}/parts/${id}`);

    if (res.error) return null;

    return res.data.map((f) => ({
      ...f,
      bucket: "parts",
      itemId: id
    }));
  };

  const elems = items.map((el) => getFile(el.itemId));

  const results = await Promise.all(elems);

  return results.filter((f) => f !== null).flat();
};

export async function getJobDocumentsWithItemId(
  client: SupabaseClient<Database>,
  companyId: string,
  job: Pick<Job, "id" | "salesOrderLineId" | "quoteLineId">,
  itemId: string
): Promise<StorageItem[]> {
  const itemFiles = await getPartDocuments(client, companyId, { itemId });

  if (job.salesOrderLineId || job.quoteLineId) {
    const opportunityLine = job.salesOrderLineId || job.quoteLineId;

    const [opportunityLineFiles, jobFiles] = await Promise.all([
      storage(client)
        .company(companyId)
        .list(`${companyId}/opportunity-line/${opportunityLine}`),
      storage(client).company(companyId).list(`${companyId}/job/${job.id}`)
    ]);

    // Combine and return both sets of files
    return [
      ...(opportunityLineFiles.data ?? []).map((f) => ({
        ...f,
        bucket: "opportunity-line"
      })),
      ...(jobFiles.data ?? []).map((f) => ({ ...f, bucket: "job" })),
      ...itemFiles
    ];
  } else {
    const jobFiles = await storage(client)
      .company(companyId)
      .list(`${companyId}/job/${job.id}`);

    return [
      ...(jobFiles.data ?? []).map((f) => ({ ...f, bucket: "job" })),
      ...itemFiles
    ];
  }
}

export async function getJob(client: SupabaseClient<Database>, id: string) {
  return client.from("jobs").select("*").eq("id", id).single();
}

// The IN-PROCESS scheduling/MRP engines need a Node Kysely handle. It is built
// in `~/services/database.server` (getDatabaseClient) and passed in as `db` by
// the route action — NEVER constructed here. This module is also bundled for the
// browser (imported by client components via the module barrel), so it must not
// pull in `pg`/`kysely`. Enforced by the no-db-client-in-service conformance check.

// Read-only "best case" what-if: runs the job first in its location's schedule
// IN-PROCESS (persists nothing) and returns the projected completion +
// bottleneck cause. Returns null when the job isn't in the schedulable set
// (e.g. not Ready/In Progress/Paused).
export async function getJobExpediteForecast(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  jobId: string,
  companyId: string,
  userId: string
) {
  const { data: job, error: jobError } = await client
    .from("job")
    .select("locationId")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .single();

  if (jobError || !job?.locationId) {
    return { data: null, error: jobError };
  }

  // Simulate-only what-if, run IN-PROCESS (Node) — persists nothing.
  try {
    const { runExpediteWhatIf } = await import("@carbon/planning");
    const expedite = await runExpediteWhatIf({
      db,
      client,
      locationId: job.locationId,
      companyId,
      userId,
      expediteJobId: jobId
    });
    return {
      data: expedite
        ? {
            projectedCompletionAt: expedite.projectedCompletionAt,
            cause: expedite.cause
          }
        : null,
      error: null
    };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error("Failed to expedite")
    };
  }
}

export async function getJobByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  return client
    .from("jobOperation")
    .select("...job(id, companyId, customerId)")
    .eq("id", operationId)
    .single();
}

export async function getJobPurchaseOrderLines(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("purchaseOrderLine")
    .select(
      "id, itemId, purchaseQuantity, quantityReceived, quantityShipped, purchaseOrder(id, purchaseOrderId, status, supplierId, supplierInteractionId), jobOperation(id, description, operationQuantity)"
    )
    .eq("jobId", jobId);
}

export async function getJobOperationsForTimeline(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("jobOperation")
    .select(
      `id, description, order, status, startDate, dueDate, projectedCompletionAt, hasConflict, conflictReason, assignee, workCenterId,
       workCenter(name),
       jobMakeMethod(id, parentMaterialId, item(readableId, name))`
    )
    .eq("jobId", jobId)
    .order("order");
}

export async function getCapacityReservationsByJob(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("capacityReservation")
    .select(
      "id, operationId, resourceKind, resourceId, startAt, endAt, earliestStartAt, scheduleNote, workHours"
    )
    .eq("jobId", jobId)
    .is("scenarioId", null);
}

/**
 * The Outbound report: open jobs at a location that fill a sales order, with
 * where each one ships (RPC `get_completion_jobs`), ordered by the plant-calendar
 * day they complete — the report groups on that order.
 */
export async function getCompletionJobs(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    timeZone: string;
    /** Last completion day to include (YYYY-MM-DD); null reads every open job. */
    throughDate: string | null;
    search: string | null;
  }
) {
  return fetchAllRecords(() =>
    client
      .rpc("get_completion_jobs", {
        company_id: args.companyId,
        location_id: args.locationId,
        time_zone: args.timeZone,
        through_date: args.throughDate ?? undefined,
        search: args.search ?? undefined
      })
      // Day, then time within the day; `id` last keeps paging stable.
      .order("completionDate", { ascending: true, nullsFirst: false })
      .order("projectedCompletionAt", { ascending: true, nullsFirst: false })
      .order("jobId", { ascending: true })
      .order("id", { ascending: true })
  );
}

export async function getCapacityReservationsForResources(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId?: string,
  /**
   * Explicit [from, to) instant window (ISO strings) for the resource Gantt's
   * day/week/shift views — returns reservations that OVERLAP it. Omit to keep
   * the default forward horizon (everything ending within the last day onward).
   */
  window?: { from: string; to: string }
) {
  // Live/upcoming reservations across ALL jobs — feeds the resource-lane
  // Gantt. Cancelled/completed/closed jobs keep their reservation rows until
  // the next reschedule, so filter them out here — they are no longer real load.
  let query = client
    .from("capacityReservation")
    .select(
      `id, operationId, jobId, resourceKind, resourceId, startAt, endAt, scheduleNote, workHours, isPlaceholder, jobOperationBatchId,
       job!inner(jobId, status, dueDate, locationId),
       jobOperation(description, hasConflict, conflictReason, jobMakeMethod(item(readableIdWithRevision, name, thumbnailPath, type))),
       jobOperationBatch(readableId)`
    )
    .eq("companyId", companyId)
    .is("scenarioId", null)
    .not("job.status", "in", '("Cancelled","Completed","Closed")');

  if (window) {
    // A reservation [startAt, endAt) overlaps [from, to) iff it starts before
    // the window ends and ends after the window starts.
    query = query.lt("startAt", window.to).gt("endAt", window.from);
  } else {
    // Rows that ended within the last day stay visible for context.
    const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
    query = query.gte("endAt", cutoff);
  }

  // Scope to a single plant so the resource Gantt matches its work-center list.
  if (locationId) {
    query = query.eq("job.locationId", locationId);
  }

  return query.order("startAt");
}

export async function getMaintenanceDowntimeForResources(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId?: string
) {
  // Open maintenance dispatches that take a work center OFFLINE — the same rows
  // the scheduler subtracts from a machine's availability. Surfaced on the
  // resource Gantt so downtime is drawn, not just implied by the gap it leaves.
  // Few per plant, so no window filter here; the timeline clips to the view.
  let query = client
    .from("maintenanceDispatch")
    .select(
      "id, maintenanceDispatchId, workCenterId, plannedStartTime, plannedEndTime, actualStartTime, actualEndTime"
    )
    .eq("companyId", companyId)
    .eq("takesWorkCenterOffline", true)
    .not("status", "in", '("Completed","Cancelled")')
    .not("workCenterId", "is", null);

  if (locationId) {
    query = query.eq("locationId", locationId);
  }

  return query.order("plannedStartTime");
}

export async function getProductionEventsByJob(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("productionEvent")
    .select(
      "id, jobOperationId, type, startTime, endTime, employeeId, jobOperation!inner(jobId)"
    )
    .eq("jobOperation.jobId", jobId);
}

export async function getJobs(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("jobs")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("jobId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "jobId", ascending: false }
    ]);
  }

  return query;
}

export async function getJobsBySalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client
    .from("jobs")
    .select("*")
    .eq("salesOrderLineId", salesOrderLineId)
    .order("createdAt", { ascending: true });
}

export async function getJobsList(
  client: SupabaseClient<Database>,
  companyId: string,
  statuses?: Database["public"]["Enums"]["jobStatus"][]
) {
  return fetchAllFromTable<{
    id: string;
    jobId: string;
  }>(client, "job", "id, jobId", (query) => {
    let filtered = query.eq("companyId", companyId);
    if (statuses && statuses.length > 0) {
      filtered = filtered.in("status", statuses);
    }
    return filtered.order("jobId");
  });
}

export async function getJobMakeMethodById(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string,
  companyId: string
) {
  return client
    .from("jobMakeMethod")
    .select("*, ...item(itemType:type, methodRevision:revision)")
    .eq("id", jobMakeMethodId)
    .eq("companyId", companyId)
    .single();
}

export async function getRootMakeMethod(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  return client
    .from("jobMakeMethod")
    .select("*, ...item(itemType:type, methodRevision:revision)")
    .eq("jobId", jobId)
    .is("parentMaterialId", null)
    .eq("companyId", companyId)
    .single();
}

export async function getJobMaterialsWithQuantityOnHand(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string,
  locationId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client.rpc(
    "get_job_quantity_on_hand",
    {
      job_id: jobId,
      company_id: companyId,
      location_id: locationId
    },
    {
      count: "exact"
    }
  );

  if (args?.search) {
    query = query.or(
      searchFilter(["itemReadableId", "name", "description"], args.search)
    );
  }

  // Pagination/sorting intentionally skipped — the page loads every material so
  // the stock-transfer session can pre-scan the full list. (orderStatus is
  // stripped in the loader; it isn't a column the function returns.)
  args?.filters?.forEach((filter) => {
    if (!filter.value) return;
    query = getGenericFilter(
      query,
      filter.column,
      filter.operator,
      filter.value
    );
  });

  return query;
}

// Distinct item ids on a job — scopes the Materials-page Item filter.
export async function getJobMaterialItemIds(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  return client
    .from("jobMaterial")
    .select("itemId")
    .eq("jobId", jobId)
    .eq("companyId", companyId);
}

type JobItemAvailability = {
  jobMaterialItemId: string | null;
  quantityOnHandInStorageUnit: number | null;
  quantityOnHandNotInStorageUnit: number | null;
  quantityOnPurchaseOrder: number | null;
  quantityOnProductionOrder: number | null;
};

// Pull-from-Inventory lines consume on-hand before other (e.g. Purchase to Order)
// lines, matching their sourcing intent.
function methodAllocationRank(methodType: MethodType | null): number {
  return methodType === "Pull from Inventory" ? 0 : 1;
}

// Per-LINE shortfall for one job. Two-level allocation of each item's available
// pool (on hand + incoming):
//   1. Across all active jobs by priority (job.priority ascending) — higher
//      priority jobs take their full need first.
//   2. Within THIS job, split its share across its own BoM lines for the item
//      (Pull-from-Inventory first), so an item on multiple lines can read
//      "in stock" on one line and "needs order" on another.
// Stock is shared with no per-job reservation, so order matters. Result is keyed
// by jobMaterial id (the line), not item id.
export async function getJobMaterialShortfallByItem(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string,
  locationId: string,
  materials: JobItemAvailability[],
  asOfDate?: string
): Promise<Record<string, ItemShortfall>> {
  // Two pools per item, kept separate so allocation can hand out already-received
  // on-hand stock BEFORE incoming supply. quantityOnPurchaseOrder /
  // quantityOnProductionOrder already include planned/pending POs and planned
  // jobs (conversion-factor applied), so incoming is taken straight from the RPC.
  const onHandByItem = new Map<string, number>();
  const incomingByItem = new Map<string, number>();
  for (const material of materials) {
    const itemId = material.jobMaterialItemId;
    if (!itemId || onHandByItem.has(itemId)) continue;
    onHandByItem.set(
      itemId,
      (material.quantityOnHandInStorageUnit ?? 0) +
        (material.quantityOnHandNotInStorageUnit ?? 0)
    );
    incomingByItem.set(
      itemId,
      (material.quantityOnPurchaseOrder ?? 0) +
        (material.quantityOnProductionOrder ?? 0)
    );
  }

  const itemIds = Array.from(onHandByItem.keys());
  if (itemIds.length === 0) return {};

  const successorByItem = new Map<string, { itemId: string; factor: number }>();
  const rules = await client
    .from("itemSupersession")
    .select(
      "itemId, successorItemId, successorEffectivityDate, conversionFactor"
    )
    .in("itemId", itemIds)
    .eq("companyId", companyId)
    .eq("supersessionMode", "Consume First");
  for (const rule of rules.data ?? []) {
    if (!rule.successorItemId) continue;
    if (
      asOfDate &&
      rule.successorEffectivityDate &&
      rule.successorEffectivityDate > asOfDate
    ) {
      continue;
    }
    successorByItem.set(rule.itemId, {
      itemId: rule.successorItemId,
      factor: Number(rule.conversionFactor ?? 1) || 1
    });
  }
  const successorIds = Array.from(
    new Set(
      Array.from(successorByItem.values())
        .map((s) => s.itemId)
        .filter((id) => !onHandByItem.has(id))
    )
  );
  const successorQuantities = await async.map(
    successorIds,
    async (successorId) =>
      await client.rpc("get_inventory_quantities", {
        location_id: locationId,
        company_id: companyId,
        item_id: successorId
      })
  );
  successorIds.forEach((successorId, index) => {
    const row = successorQuantities[index]?.data?.[0];
    onHandByItem.set(successorId, Number(row?.quantityOnHand ?? 0));
    incomingByItem.set(
      successorId,
      Number(row?.quantityOnPurchaseOrder ?? 0) +
        Number(row?.quantityOnProductionOrder ?? 0)
    );
  });

  // Remaining demand for those items across every active job at this location.
  const { data } = await client
    .from("jobMaterial")
    .select(
      "id, itemId, jobId, methodType, quantity, quantityToIssue, job!inner(priority, status, locationId)"
    )
    .in("itemId", [...itemIds, ...successorIds])
    .eq("companyId", companyId)
    .neq("methodType", "Make to Order")
    .in("job.status", ACTIVE_JOB_STATUSES)
    .eq("job.locationId", locationId);

  // Other jobs' demand is lumped per (item, job); THIS job's demand is also kept
  // per-line so its allocation can be split across its own BoM lines.
  type Demand = { jobId: string; priority: number; remaining: number };
  type Line = {
    materialId: string;
    remaining: number;
    perAssembly: number;
    methodType: MethodType | null;
  };
  const demandByItem = new Map<string, Map<string, Demand>>();
  const thisJobLinesByItem = new Map<string, Line[]>();

  for (const row of data ?? []) {
    const itemId = row.itemId;
    const rowJobId = row.jobId;
    const remaining = row.quantityToIssue ?? 0;
    if (!itemId || !rowJobId || remaining <= 0) continue;
    const job = (Array.isArray(row.job) ? row.job[0] : row.job) as {
      priority: number | null;
    } | null;
    const priority = job?.priority ?? Number.POSITIVE_INFINITY;

    let jobs = demandByItem.get(itemId);
    if (!jobs) {
      jobs = new Map();
      demandByItem.set(itemId, jobs);
    }
    const existing = jobs.get(rowJobId);
    if (existing) existing.remaining += remaining;
    else jobs.set(rowJobId, { jobId: rowJobId, priority, remaining });

    if (rowJobId === jobId && row.id) {
      const lines = thisJobLinesByItem.get(itemId) ?? [];
      lines.push({
        materialId: row.id,
        remaining,
        perAssembly: Number(row.quantity ?? 0),
        methodType: row.methodType
      });
      thisJobLinesByItem.set(itemId, lines);
    }
  }

  const shortfallByMaterial: Record<string, ItemShortfall> = {};
  for (const [itemId, jobsMap] of demandByItem) {
    let onHand = onHandByItem.get(itemId) ?? 0;
    let incoming = incomingByItem.get(itemId) ?? 0;
    const jobs = Array.from(jobsMap.values()).sort(
      (a, b) =>
        a.priority - b.priority ||
        (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0)
    );
    for (const job of jobs) {
      if (job.jobId !== jobId) {
        // Other jobs consume their lump share off the top of the pools.
        const fromOnHand = Math.min(job.remaining, Math.max(onHand, 0));
        onHand -= fromOnHand;
        const need = job.remaining - fromOnHand;
        incoming -= Math.min(need, Math.max(incoming, 0));
        continue;
      }
      // THIS job: split the remaining pool across its lines (Pull-from-Inventory
      // first, then a stable order by material id).
      const lines = (thisJobLinesByItem.get(itemId) ?? [])
        .slice()
        .sort(
          (a, b) =>
            methodAllocationRank(a.methodType) -
              methodAllocationRank(b.methodType) ||
            (a.materialId < b.materialId
              ? -1
              : a.materialId > b.materialId
                ? 1
                : 0)
        );
      const consumeFirst = successorByItem.has(itemId);
      for (const line of lines) {
        const usable = consumeFirst
          ? consumableInWholeAssemblies(onHand, line.perAssembly)
          : Math.max(onHand, 0);
        const fromOnHand = Math.min(line.remaining, usable);
        onHand -= fromOnHand;
        let need = line.remaining - fromOnHand;
        const fromIncoming = Math.min(need, Math.max(incoming, 0));
        incoming -= fromIncoming;
        need -= fromIncoming;
        shortfallByMaterial[line.materialId] = {
          shortfall: need > 0 ? need : 0,
          // Fully met without leaning on incoming supply.
          coveredByOnHand: need <= 0 && fromIncoming === 0
        };
      }
    }
    onHandByItem.set(itemId, onHand);
    incomingByItem.set(itemId, incoming);
  }

  for (const [itemId, lines] of thisJobLinesByItem) {
    const successor = successorByItem.get(itemId);
    if (!successor) continue;
    for (const line of lines) {
      const current = shortfallByMaterial[line.materialId];
      if (!current || current.shortfall <= 0) continue;
      let need = current.shortfall * successor.factor;
      let onHand = onHandByItem.get(successor.itemId) ?? 0;
      let incoming = incomingByItem.get(successor.itemId) ?? 0;
      const fromOnHand = Math.min(need, Math.max(onHand, 0));
      onHand -= fromOnHand;
      need -= fromOnHand;
      const fromIncoming = Math.min(need, Math.max(incoming, 0));
      incoming -= fromIncoming;
      need -= fromIncoming;
      onHandByItem.set(successor.itemId, onHand);
      incomingByItem.set(successor.itemId, incoming);
      shortfallByMaterial[line.materialId] = {
        shortfall: need > 0 ? need : 0,
        coveredByOnHand: need <= 0 && fromIncoming === 0,
        substituteItemId: successor.itemId
      };
    }
  }
  return shortfallByMaterial;
}

type OrderStatusMaterial = {
  itemTrackingType: string | null;
  methodType: MethodType | null;
  estimatedQuantity: number | null;
  quantityIssued: number | null;
};

type OrderStatusBuildMaterial = OrderStatusMaterial & {
  id: string | null;
  jobMaterialItemId: string | null;
};

// Builds one material's ItemOrderStatus from its PO lines, supply jobs, and
// priority-adjusted shortfall. Pure — all DB reads happen in the callers.
function getJobMaterialOrderStatus(
  material: OrderStatusMaterial,
  poLines: JobMaterialPurchaseOrderLine[],
  supplyJobLines: JobMaterialSupplyJobLine[],
  shortfall: number,
  coveredByOnHand: boolean,
  substituteItemId: string | null = null
): ItemOrderStatus {
  // Fully pulled into the job (its whole requirement has been issued/consumed).
  const estimated = material.estimatedQuantity ?? 0;
  const isIssued = estimated > 0 && (material.quantityIssued ?? 0) >= estimated;

  const needsOrder =
    material.itemTrackingType !== "Non-Inventory" &&
    material.methodType !== "Make to Order" &&
    shortfall > 0;

  const status =
    PO_STATUS_PRIORITY.find((candidate) =>
      poLines.some((line) => line.status === candidate)
    ) ?? null;

  const supplyJobStatus =
    JOB_SUPPLY_STATUS_PRIORITY.find((candidate) =>
      supplyJobLines.some((line) => line.status === candidate)
    ) ?? null;

  // A made-to-order material with no job producing it yet still needs to be made
  // — the make-side counterpart to needsOrder.
  const needsJob =
    material.methodType === "Make to Order" &&
    !isIssued &&
    supplyJobStatus === null;

  let ordered = 0;
  let received = 0;
  if (status) {
    for (const line of poLines) {
      if (line.status !== status) continue;
      ordered += line.purchaseQuantity ?? 0;
      received += line.quantityReceived ?? 0;
    }
  }

  return {
    needsOrder,
    needsJob,
    shortfall,
    substituteItemId,
    status,
    supplyJobStatus,
    coveredByOnHand,
    isIssued,
    ordered,
    received
  };
}

// One ItemOrderStatus per material id (= the tree node's methodMaterialId) — the
// single source the table, tree, and filter all read from.
function getJobOrderStatusByMaterial(
  materials: OrderStatusBuildMaterial[],
  purchaseOrderLines: JobMaterialPurchaseOrderLine[],
  supplyJobLines: JobMaterialSupplyJobLine[],
  shortfallByMaterialId: Record<string, ItemShortfall>
): Record<string, ItemOrderStatus> {
  const linesByItemId = new Map<string, JobMaterialPurchaseOrderLine[]>();
  for (const line of purchaseOrderLines) {
    if (!line.itemId) continue;
    const lines = linesByItemId.get(line.itemId) ?? [];
    lines.push(line);
    linesByItemId.set(line.itemId, lines);
  }

  const jobLinesByItemId = new Map<string, JobMaterialSupplyJobLine[]>();
  for (const line of supplyJobLines) {
    if (!line.itemId) continue;
    const lines = jobLinesByItemId.get(line.itemId) ?? [];
    lines.push(line);
    jobLinesByItemId.set(line.itemId, lines);
  }

  const byMaterialId: Record<string, ItemOrderStatus> = {};
  for (const material of materials) {
    if (!material.id) continue;
    const lineShortfall = shortfallByMaterialId[material.id];
    const supplyItemIds = [
      material.jobMaterialItemId,
      lineShortfall?.substituteItemId
    ].filter((id): id is string => Boolean(id));
    const poLines = supplyItemIds.flatMap((id) => linesByItemId.get(id) ?? []);
    const jobLines = supplyItemIds.flatMap(
      (id) => jobLinesByItemId.get(id) ?? []
    );
    byMaterialId[material.id] = getJobMaterialOrderStatus(
      material,
      poLines,
      jobLines,
      lineShortfall?.shortfall ?? 0,
      lineShortfall?.coveredByOnHand ?? false,
      lineShortfall?.substituteItemId ?? null
    );
  }
  return byMaterialId;
}

// One status per material id for a job — the single source the table and tree
// both consume. Empty for jobs that show no indicators.
export async function getJobOrderStatusMap(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string,
  locationId: string,
  jobStatus: string | null | undefined,
  materials: NonNullable<
    Awaited<ReturnType<typeof getJobMaterialsWithQuantityOnHand>>["data"]
  >,
  asOfDate?: string
): Promise<Record<string, ItemOrderStatus>> {
  // Completed/Draft/Cancelled/Closed jobs show no procurement indicators.
  if (isJobOrderStatusHidden(jobStatus)) return {};

  // PO lines + supply jobs drive the badge's status/supply indicators; the
  // shortfall reads incoming supply from the RPC totals, so all three run together.
  const [purchaseOrderLines, supplyJobLines, shortfallByMaterialId] =
    await Promise.all([
      getJobMaterialPurchaseOrderLines(client, materials, locationId),
      getJobMaterialSupplyJobLines(client, materials, companyId, locationId),
      getJobMaterialShortfallByItem(
        client,
        jobId,
        companyId,
        locationId,
        materials,
        asOfDate
      )
    ]);

  const materialItemIds = new Set(
    materials.map((material) => material.jobMaterialItemId)
  );
  const substitutes = Array.from(
    new Set(
      Object.values(shortfallByMaterialId)
        .map((shortfall) => shortfall.substituteItemId)
        .filter(
          (id): id is string =>
            typeof id === "string" && !materialItemIds.has(id)
        )
    )
  ).map((jobMaterialItemId) => ({ jobMaterialItemId }));
  const [substitutePurchaseOrderLines, substituteSupplyJobLines] =
    substitutes.length > 0
      ? await Promise.all([
          getJobMaterialPurchaseOrderLines(client, substitutes, locationId),
          getJobMaterialSupplyJobLines(
            client,
            substitutes,
            companyId,
            locationId
          )
        ])
      : [[], []];

  return getJobOrderStatusByMaterial(
    materials,
    purchaseOrderLines.concat(substitutePurchaseOrderLines),
    supplyJobLines.concat(substituteSupplyJobLines),
    shortfallByMaterialId
  );
}

export async function getJobMaterial(
  client: SupabaseClient<Database>,
  materialId: string
) {
  return client
    .from("jobMaterialWithMakeMethodId")
    .select("*")
    .eq("id", materialId)
    .single();
}

// The step-link `quantity` column ships with this branch's migration, which only
// runs on main — previews (and the prod window between app deploy and migration)
// run this code against the pre-migration schema. PostgREST fails the WHOLE
// select on an unknown embedded column, so fall back to the quantity-less query
// instead of rendering an empty BOM. 42703 = Postgres undefined_column; PGRST204
// = PostgREST's schema-cache miss for a written column.
function isMissingQuantityColumn(
  error: { code?: string; message?: string } | null
) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

export async function getJobMaterialsByMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string
) {
  const result = await client
    .from("jobMaterial")
    .select(
      "*, item(replenishmentSystem, itemTrackingType), jobMaterialStep(jobOperationStepId, quantity)"
    )
    .eq("jobMakeMethodId", jobMakeMethodId)
    .order("order", { ascending: true });
  if (isMissingQuantityColumn(result.error)) {
    return (await client
      .from("jobMaterial")
      .select(
        "*, item(replenishmentSystem, itemTrackingType), jobMaterialStep(jobOperationStepId)"
      )
      .eq("jobMakeMethodId", jobMakeMethodId)
      .order("order", { ascending: true })) as unknown as typeof result;
  }
  return result;
}

export async function getJobOperation(
  client: SupabaseClient<Database>,
  jobOperationId: string
) {
  return client
    .from("jobOperation")
    .select("*")
    .eq("id", jobOperationId)
    .single();
}

export async function getJobOperations(
  client: SupabaseClient<Database>,
  jobId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("jobOperation")
    .select(
      "*, jobMakeMethod(parentMaterialId, item(readableIdWithRevision))",
      {
        count: LIST_COUNT
      }
    )
    .eq("jobId", jobId);

  if (args?.search) {
    query = query.ilike("description", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "description", ascending: true },
      { column: "order", ascending: true },
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getJobOperationDependencies(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("jobOperationDependency")
    .select("operationId, dependsOnId")
    .eq("jobId", jobId);
}

export async function getJobOperationsAssignedToEmployee(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("jobOperation")
    .select(
      "id, description, workCenterId, ...job(jobId:id, jobReadableId:jobId)"
    )
    .eq("assignee", employeeId)
    .eq("companyId", companyId);
}

export async function getJobOperationAttachments(
  client: SupabaseClient<Database>,
  jobOperationIds: string[]
): Promise<Record<string, string[]>> {
  if (jobOperationIds.length === 0) return {};

  const { data: operationAttributes } = await client
    .from("jobOperationStep")
    .select("*, jobOperationStepRecord(*)")
    .in("operationId", jobOperationIds);

  if (!operationAttributes) return {};

  const attachmentsByOperation: Record<string, string[]> = {};
  operationAttributes.forEach((attr) => {
    if (
      attr.jobOperationStepRecord &&
      Array.isArray(attr.jobOperationStepRecord)
    ) {
      attr.jobOperationStepRecord.forEach((record) => {
        if (attr.type === "File" && record.value) {
          if (!attachmentsByOperation[attr.operationId]) {
            attachmentsByOperation[attr.operationId] = [];
          }
          attachmentsByOperation[attr.operationId].push(record.value);
        }
      });
    }
  });

  return attachmentsByOperation;
}

export async function getJobOperationsList(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("jobOperation")
    .select("id, description, order")
    .eq("jobId", jobId)
    .order("order", { ascending: true });
}

const JOB_OPERATION_DETAIL_COLUMNS =
  "*, jobOperationBatch(id, readableId, status), jobOperationTool(*, jobOperationToolStep(jobOperationStepId)), jobOperationParameter(*), jobOperationStep(*, jobOperationStepRecord(*), jobOperationStepSlide(*))" as const;

export async function getJobOperationsByMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string
) {
  return client
    .from("jobOperation")
    .select(JOB_OPERATION_DETAIL_COLUMNS)
    .eq("jobMakeMethodId", jobMakeMethodId)
    .order("order", { ascending: true });
}

/** `getJobOperationsByMethodId` for several make methods of one company. */
export async function getJobOperationsByMethodIds(
  client: SupabaseClient<Database>,
  jobMakeMethodIds: string[],
  companyId: string
) {
  return client
    .from("jobOperation")
    .select(JOB_OPERATION_DETAIL_COLUMNS)
    .in("jobMakeMethodId", jobMakeMethodIds)
    .eq("companyId", companyId)
    .order("order", { ascending: true });
}

export async function getJobOperationStepRecords(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc("get_job_operation_step_records", {
    p_job_id: jobId,
    p_company_id: companyId
  });

  if (args.search) {
    query = query.or(
      searchFilter(["name", "operationDescription"], args.search)
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);

  return query;
}

export async function getOutsideOperationsByJobId(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  return client
    .from("jobOperation")
    .select("id, description")
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .eq("operationType", "Outside Processing");
}

export async function getProcedure(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("procedure")
    .select("*, procedureStep(*), procedureParameter(*)")
    .eq("id", id)
    .single();
}

export async function getProcedureSteps(
  client: SupabaseClient<Database>,
  procedureId: string
) {
  return client
    .from("procedureStep")
    .select("*")
    .eq("procedureId", procedureId);
}

export async function getProcedureParameters(
  client: SupabaseClient<Database>,
  procedureId: string
) {
  return client
    .from("procedureParameter")
    .select("*")
    .eq("procedureId", procedureId);
}

export async function getProcedureVersions(
  client: SupabaseClient<Database>,
  procedure: { name: string; version: number },
  companyId: string
) {
  return client
    .from("procedure")
    .select("*")
    .eq("name", procedure.name)
    .eq("companyId", companyId)
    .neq("version", procedure.version)
    .order("version", { ascending: false });
}

export async function getProcedures(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("procedures")
    .select("*", {
      count: LIST_COUNT
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getProceduresList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
    version: number;
    processId: string;
    status: string;
  }>(client, "procedure", "id, name, version, processId, status", (query) =>
    query
      .eq("companyId", companyId)
      .order("name", { ascending: true })
      .order("version", { ascending: false })
  );
}

export async function getProductionEvent(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("productionEvent")
    .select("*, jobOperation(description)")
    .eq("id", id)
    .single();
}

export async function getProductionEvents(
  client: SupabaseClient<Database>,
  jobOperationIds: string[],
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("productionEvent")
    .select(
      "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableIdWithRevision)))",
      {
        count: LIST_COUNT
      }
    )
    .in("jobOperationId", jobOperationIds)
    .order("startTime", { ascending: true });

  if (args?.search) {
    query = query.or(searchFilter(["jobOperation.description"], args.search));
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getProductionEventsByOperations(
  client: SupabaseClient<Database>,
  jobOperationIds: string[]
) {
  return client
    .from("productionEvent")
    .select(
      "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableIdWithRevision)))"
    )
    .in("jobOperationId", jobOperationIds)
    .order("startTime", { ascending: true });
}

export async function getProductionPlanning(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  periods: string[],
  args: GenericQueryFilters & {
    search: string | null;
    /** Today on the location's calendar (ISO date): the day each item's
     *  planning horizon is counted from. */
    asOf: string;
    /** Keep only items with an OPEN planning action of one of these types
     *  inside the item's planning horizon (the grid's Actions filter). */
    actionTypes?: string[];
    /** Keep only items with such an action assigned to this user ("Assigned
     *  to me"). Combined with `actionTypes` on the SAME action. */
    actionAssignees?: string[];
  }
) {
  // The grid RPC wraps get_production_planning: same rows and projection, plus the
  // item group, the planning horizon / time fence date, the first week the
  // projection goes negative and the latest order date — and it evaluates the
  // action filter in the database, so it is complete at any volume and paging
  // stays correct.
  let query = client.rpc(
    "get_production_planning_grid",
    {
      location_id: locationId,
      company_id: companyId,
      periods,
      as_of: args.asOf,
      action_types: args.actionTypes,
      action_assignees: args.actionAssignees
    },
    {
      count: LIST_COUNT
    }
  );

  if (args?.search) {
    query = query.or(
      searchFilter(["name", "readableIdWithRevision"], args.search)
    );
  }

  // What the row's Order / Make button offers (the grid RPC's orderQuantity,
  // from MRP's open new-supply actions), then the part number so a page is
  // stable when many rows have nothing to order.
  query = setGenericQueryFilters(query, args, [
    { column: "orderQuantity", ascending: false },
    { column: "readableIdWithRevision", ascending: true }
  ]);

  return query;
}

export async function getProductionProjections(
  client: SupabaseClient<Database>,
  locationId: string,
  periods: string[],
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc(
    "get_production_projections",
    {
      location_id: locationId,
      company_id: companyId,
      periods
    },
    {
      count: LIST_COUNT
    }
  );

  if (args?.search) {
    query = query.or(
      searchFilter(["name", "readableIdWithRevision"], args.search)
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true }
  ]);

  return query;
}

export async function getProductionQuantity(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("productionQuantity")
    .select("*, jobOperation(description)")
    .eq("id", id)
    .single();
}

export async function getProductionQuantities(
  client: SupabaseClient<Database>,
  jobOperationIds: string[],
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("productionQuantity")
    .select(
      "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableIdWithRevision)))",
      {
        count: LIST_COUNT
      }
    )
    .in("jobOperationId", jobOperationIds);

  if (args?.search) {
    query = query.or(searchFilter(["jobOperation.description"], args.search));
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getProductionDataByOperations(
  client: SupabaseClient<Database>,
  jobOperationIds: string[]
) {
  const [quantities, events, notes] = await Promise.all([
    client
      .from("productionQuantity")
      .select(
        "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableIdWithRevision)))"
      )
      .in("jobOperationId", jobOperationIds),
    client
      .from("productionEvent")
      .select(
        "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableIdWithRevision)))"
      )
      .in("jobOperationId", jobOperationIds),
    client
      .from("jobOperationNote")
      .select("*")
      .in("jobOperationId", jobOperationIds)
  ]);

  return {
    quantities: quantities.data ?? [],
    events: events.data ?? [],
    notes: notes.data ?? []
  };
}

export async function getScrapReasonsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("scrapReason")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getScrapReason(
  client: SupabaseClient<Database>,
  scrapReasonId: string
) {
  return client
    .from("scrapReason")
    .select("*")
    .eq("id", scrapReasonId)
    .single();
}

export async function getScrapReasons(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("scrapReason")
    .select("id, name, customFields", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getFailureMode(
  client: SupabaseClient<Database>,
  failureModeId: string
) {
  return client
    .from("maintenanceFailureMode")
    .select("*")
    .eq("id", failureModeId)
    .single();
}

export async function getFailureModes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("maintenanceFailureMode")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getFailureModesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("maintenanceFailureMode")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatch")
    .select(
      `*,
      assignee:user!maintenanceDispatch_assignee_fkey(id, fullName, avatarUrl),
      suspectedFailureMode:maintenanceFailureMode!maintenanceDispatch_suspectedFailureModeId_fkey(id, name),
      actualFailureMode:maintenanceFailureMode!maintenanceDispatch_actualFailureModeId_fkey(id, name),
      schedule:maintenanceSchedule(id, name)`
    )
    .eq("id", dispatchId)
    .single();
}

export async function getMaintenanceDispatches(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; status?: string }
) {
  let query = client
    .from("maintenanceDispatch")
    .select(`*`, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("maintenanceDispatchId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getMaintenanceDispatchComments(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchComment")
    .select(
      `id, comment, createdAt,
       createdBy:user!maintenanceDispatchComment_createdBy_fkey(id, fullName, avatarUrl)`
    )
    .eq("maintenanceDispatchId", dispatchId)
    .order("createdAt", { ascending: false });
}

export async function getMaintenanceDispatchEvents(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchEvent")
    .select(
      `id, startTime, endTime, duration, notes,
       employee:user!maintenanceDispatchEvent_employeeId_fkey(id, fullName, avatarUrl),
       workCenter:workCenter!maintenanceDispatchEvent_workCenterId_fkey(id, name)`
    )
    .eq("maintenanceDispatchId", dispatchId)
    .order("startTime", { ascending: false });
}

export async function getMaintenanceDispatchItems(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchItem")
    .select(
      `id, itemId, quantity, unitOfMeasureCode, unitCost, totalCost,
       item:item!maintenanceDispatchItem_itemId_fkey(id, name)`
    )
    .eq("maintenanceDispatchId", dispatchId);
}

export async function getMaintenanceDispatchWorkCenters(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchWorkCenter")
    .select(
      `id, workCenterId,
       workCenter:workCenter!maintenanceDispatchWorkCenter_workCenterId_fkey(id, name)`
    )
    .eq("maintenanceDispatchId", dispatchId);
}

export async function getMaintenanceSchedule(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client
    .from("maintenanceSchedule")
    .select(
      `*,
       workCenter:workCenter!maintenanceSchedule_workCenterId_fkey(id, name)`
    )
    .eq("id", scheduleId)
    .single();
}

export async function getMaintenanceSchedules(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; active?: boolean }
) {
  let query = client
    .from("maintenanceSchedules")
    .select(`*`, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args?.active !== undefined) {
    query = query.eq("active", args.active);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaintenanceScheduleItems(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client
    .from("maintenanceScheduleItem")
    .select(
      `id, quantity, unitOfMeasureCode,
       item:item!maintenanceScheduleItem_itemId_fkey(id, name)`
    )
    .eq("maintenanceScheduleId", scheduleId);
}

export async function getTrackedEntityByJobId(
  client: SupabaseClient<Database>,
  jobId: string
) {
  const jobMakeMethod = await client
    .from("jobMakeMethod")
    .select("*")
    .eq("jobId", jobId)
    .is("parentMaterialId", null)
    .single();
  if (jobMakeMethod.error) {
    return {
      data: null,
      error: jobMakeMethod.error
    };
  }

  // Survivors carry NEITHER pointer key: the legacy key marks old departed
  // originals, the new key marks split children — filtering both returns
  // exactly the live root entity across mixed-convention history.
  const result = await client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Job Make Method", jobMakeMethod.data.id)
    .eq("companyId", jobMakeMethod.data.companyId)
    .is("attributes ->> Split Entity ID", null)
    .is("attributes ->> Split From Entity ID", null)
    .limit(1);

  return {
    data: result.data?.[0] ?? null,
    error: result.error
  };
}

export async function getTrackedEntitiesByJobId(
  client: SupabaseClient<Database>,
  jobId: string
) {
  const jobMakeMethod = await client
    .from("jobMakeMethod")
    .select("*")
    .eq("jobId", jobId)
    .is("parentMaterialId", null)
    .single();
  if (jobMakeMethod.error) {
    return {
      data: null,
      error: jobMakeMethod.error
    };
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Job Make Method", jobMakeMethod.data.id)
    .eq("companyId", jobMakeMethod.data.companyId)
    .is("attributes ->> Split Entity ID", null)
    .is("attributes ->> Split From Entity ID", null);
}

/**
 * What a job has already received to inventory: its received quantity and the
 * tracked entities its receipts posted. One statement, so both come from the
 * same snapshot and a receipt committing mid-read cannot pair a new quantity
 * with old units. Kysely because itemLedger is readable only with inventory or
 * accounting view, and production users need the answer; the route authorizes.
 */
export async function getJobReceiptSnapshot(
  db: Kysely<KyselyDatabase>,
  jobId: string,
  companyId: string
) {
  return db
    .selectFrom("job")
    .leftJoin("itemLedger", (join) =>
      join
        .onRef("itemLedger.documentId", "=", "job.id")
        .onRef("itemLedger.companyId", "=", "job.companyId")
        .on("itemLedger.documentType", "=", "Job Receipt")
    )
    .select([
      "job.quantityReceivedToInventory",
      sql<
        string[]
      >`COALESCE(array_agg("itemLedger"."trackedEntityId") FILTER (WHERE "itemLedger"."trackedEntityId" IS NOT NULL), '{}')`.as(
        "trackedEntityIds"
      )
    ])
    .where("job.id", "=", jobId)
    .where("job.companyId", "=", companyId)
    .groupBy(["job.id", "job.companyId"])
    .executeTakeFirst();
}

/**
 * Reschedule a job using the unified scheduling engine.
 * This recalculates dates, work centers, and priorities for all operations.
 */
export async function recalculateJobOperationDependencies(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  params: {
    jobId: string;
    companyId: string;
    userId: string;
  }
) {
  // Forecast-first scheduling regenerates the WHOLE LOCATION; resolve the job's
  // location and regenerate it (the job is part of that pass).
  const { data: job, error } = await client
    .from("job")
    .select("locationId")
    .eq("id", params.jobId)
    .eq("companyId", params.companyId)
    .single();
  if (error || !job?.locationId) {
    return { data: null, error: error ?? new Error("Job has no location") };
  }
  // Regenerate the whole location IN-PROCESS (Node). The caller's
  // client reads the (same-company) master data; writes go through the Node
  // Kysely pool.
  try {
    const { runLocationSchedule } = await import("@carbon/planning");
    const data = await runLocationSchedule({
      db,
      client,
      locationId: job.locationId,
      companyId: params.companyId,
      userId: params.userId
    });
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error("Failed to reschedule")
    };
  }
}
export async function recalculateJobRequirements(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  params: {
    id: string; // job id
    companyId: string;
    userId: string;
  }
) {
  return invokePosting(
    { client, db, companyId: params.companyId, userId: params.userId },
    "recalculate",
    {
      type: "jobRequirements",
      ...params
    },
    recalculateRequirements,
    { as: recalculateRequirementsPermission }
  );
}

export async function recalculateJobMakeMethodRequirements(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  params: {
    id: string; // job make method id
    companyId: string;
    userId: string;
  }
) {
  return invokePosting(
    { client, db, companyId: params.companyId, userId: params.userId },
    "recalculate",
    {
      type: "jobMakeMethodRequirements",
      ...params
    },
    recalculateRequirements,
    { as: recalculateRequirementsPermission }
  );
}

export async function runMRP(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  params: {
    type:
      | "company"
      | "location"
      | "job"
      | "salesOrder"
      | "item"
      | "purchaseOrder";
    id: string;
    companyId: string;
    userId: string;
  }
) {
  // Run MRP IN-PROCESS (Node). The caller's service-role client does
  // the PostgREST reads; the atomic Phase-7 write goes through the Node Kysely
  // pool. Preserves the `{ data, error }` shape the caller (api+/mrp.ts) returns.
  try {
    const { runMrp } = await import("@carbon/planning");
    const data = await runMrp(client, db, params);
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error("Failed to run MRP")
    };
  }
}

export async function updateJobBatchNumber(
  client: SupabaseClient<Database>,
  companyId: string,
  trackedEntityId: string,
  value: string | null
) {
  return client
    .from("trackedEntity")
    .update({
      readableId: value
    })
    .eq("id", trackedEntityId)
    .eq("companyId", companyId)
    .select("id, readableId");
}

export type JobReleaseReadiness = {
  jobs: {
    id: string;
    jobId: string;
    status: (typeof jobStatus)[number] | null;
    manufacturingBlocked: boolean;
    // Quantity and scrap are both 0: the job page disables Release for it.
    nothingToMake: boolean;
    // A Make to Asset job that cannot complete to its asset.
    makeToAssetError: string | null;
    missingAssemblies: { makeMethodId: string; description: string }[];
    // Outside operations release cannot put on a PO: the process has no
    // supplier, or several and none chosen on the operation.
    outsideOperationsWithoutSupplier: {
      id: string;
      description: string;
      missing: "none" | "choose";
    }[];
    // The suppliers this job's outside operations go on a purchase order for.
    supplierIds: string[];
    materialsWithoutStorageUnit: { id: string; description: string }[];
  }[];
  // Suppliers whose outside operations release will put on a purchase order,
  // with the Draft POs the planner may add them to instead of a new one.
  suppliers: {
    supplierId: string;
    draftPurchaseOrders: { id: string; purchaseOrderId: string }[];
  }[];
};

async function getMaterialsWithoutStorageUnit(
  client: SupabaseClient<Database>,
  jobIds: string[],
  companyId: string
): Promise<{
  data: Record<string, { id: string; description: string }[]>;
  error: PostgrestError | null;
}> {
  const settings = await client
    .from("companySettings")
    .select("requireBackflushStorageUnit")
    .eq("id", companyId)
    .maybeSingle();
  if (settings.error) return { data: {}, error: settings.error };
  if (settings.data?.requireBackflushStorageUnit !== true)
    return { data: {}, error: null };

  const lines = await fetchAllByIds(jobIds, (batch) =>
    client
      .from("jobMaterial")
      .select(
        "id, jobId, description, methodType, itemType, storageUnitId, item(itemTrackingType, readableIdWithRevision), job(locationId)"
      )
      .in("jobId", batch)
      .eq("companyId", companyId)
      .is("storageUnitId", null)
      .order("id")
  );
  if (lines.error) return { data: {}, error: lines.error };

  const jobLocationIds = [
    ...new Set(
      (lines.data ?? []).flatMap((line) =>
        line.job?.locationId ? [line.job.locationId] : []
      )
    )
  ];
  const pullFromLocations =
    jobLocationIds.length === 0
      ? { data: [], error: null }
      : await client
          .from("location")
          .select("id, workCenter!inner(id), storageUnit!inner(id)")
          .in("id", jobLocationIds)
          .eq("companyId", companyId)
          .eq("workCenter.active", true)
          .eq("storageUnit.active", true)
          .limit(1, { referencedTable: "workCenter" })
          .limit(1, { referencedTable: "storageUnit" });
  if (pullFromLocations.error)
    return { data: {}, error: pullFromLocations.error };
  const strictLocationIds = new Set(
    (pullFromLocations.data ?? []).map((location) => location.id)
  );

  const byJob: Record<string, { id: string; description: string }[]> = {};
  for (const [jobId, jobLines] of Object.entries(
    groupBy(
      (lines.data ?? []).filter(
        (line) =>
          line.job?.locationId && strictLocationIds.has(line.job.locationId)
      ),
      (line) => line.jobId
    )
  )) {
    const missing = materialsWithoutStorageUnit(jobLines);
    if (missing.length > 0) byJob[jobId] = missing;
  }
  return { data: byJob, error: null };
}

// What stands between these jobs and release, read in one query per table for
// any number of jobs. The job Release dialog and batch release both read it, so
// a job released through a batch is held to the job page's rules.
export async function getJobReleaseReadiness(
  client: SupabaseClient<Database>,
  jobIds: string[],
  companyId: string
): Promise<{ data: JobReleaseReadiness | null; error: PostgrestError | null }> {
  if (jobIds.length === 0)
    return { data: { jobs: [], suppliers: [] }, error: null };

  const [jobs, roots, materials, operations] = await Promise.all([
    fetchAllByIds(jobIds, (batch) =>
      client
        .from("job")
        .select(
          "id, jobId, status, quantity, scrapQuantity, salesOrderLineId, fixedAssetClassId, fixedAssetId, item(itemTrackingType, itemReplenishment(manufacturingBlocked))"
        )
        .in("id", batch)
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAllByIds(jobIds, (batch) =>
      client
        .from("jobMakeMethod")
        .select("id, jobId")
        .in("jobId", batch)
        .eq("companyId", companyId)
        .is("parentMaterialId", null)
        .order("id")
    ),
    fetchAllByIds(jobIds, (batch) =>
      client
        .from("jobMaterialWithMakeMethodId")
        .select(
          "jobId, jobMaterialMakeMethodId, methodType, kit, description, itemReadableId"
        )
        .in("jobId", batch)
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAllByIds(jobIds, (batch) =>
      client
        .from("jobOperation")
        .select(
          "id, jobId, jobMakeMethodId, operationType, operationSupplierProcessId, processId, description"
        )
        .in("jobId", batch)
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  const failed =
    jobs.error ?? roots.error ?? materials.error ?? operations.error;
  if (failed) return { data: null, error: failed };

  const withoutStorageUnit = await getMaterialsWithoutStorageUnit(
    client,
    jobIds,
    companyId
  );
  if (withoutStorageUnit.error)
    return { data: null, error: withoutStorageUnit.error };

  const outsideOperationIds = (operations.data ?? [])
    .filter((op) => op.operationType === "Outside Processing")
    .map((op) => op.id);
  const purchaseOrderLines = await fetchAllByIds(outsideOperationIds, (batch) =>
    client
      .from("purchaseOrderLine")
      .select("jobOperationId")
      .in("jobOperationId", batch)
      .eq("companyId", companyId)
      .order("id")
  );
  if (purchaseOrderLines.error)
    return { data: null, error: purchaseOrderLines.error };

  const needingPurchaseOrders = outsideOperationsNeedingPurchaseOrders(
    operations.data ?? [],
    new Set(
      (purchaseOrderLines.data ?? [])
        .map((line) => line.jobOperationId)
        .filter((id): id is string => !!id)
    )
  );
  const ownSupplierProcessIds = [
    ...new Set(
      needingPurchaseOrders
        .map((op) => op.operationSupplierProcessId)
        .filter((id): id is string => !!id)
    )
  ];
  const processIds = [
    ...new Set(
      needingPurchaseOrders
        .map((op) => op.processId)
        .filter((id): id is string => !!id)
    )
  ];
  const [ownSupplierProcesses, processSupplierProcesses] = await Promise.all([
    fetchAllByIds(ownSupplierProcessIds, (batch) =>
      client
        .from("supplierProcess")
        .select("id, supplierId, processId")
        .in("id", batch)
        .eq("companyId", companyId)
        .order("id")
    ),
    fetchAllByIds(processIds, (batch) =>
      client
        .from("supplierProcess")
        .select("id, supplierId, processId")
        .in("processId", batch)
        .eq("companyId", companyId)
        .order("id")
    )
  ]);
  const supplierProcessError =
    ownSupplierProcesses.error ?? processSupplierProcesses.error;
  if (supplierProcessError) return { data: null, error: supplierProcessError };

  const supplierProcessById = new Map(
    [
      ...(ownSupplierProcesses.data ?? []),
      ...(processSupplierProcesses.data ?? [])
    ].map((sp) => [sp.id, sp])
  );
  const supplierProcessesByProcessId = new Map(
    Object.entries(
      groupBy(processSupplierProcesses.data ?? [], (sp) => sp.processId)
    )
  );
  const resolved = needingPurchaseOrders.map((op) => ({
    op,
    supplier: resolveOperationSupplier(
      op,
      supplierProcessById,
      supplierProcessesByProcessId
    )
  }));
  const supplierIds = [
    ...new Set(
      resolved.flatMap(({ supplier }) =>
        "supplierProcess" in supplier
          ? [supplier.supplierProcess.supplierId]
          : []
      )
    )
  ];
  const withoutSupplierByJob = groupBy(
    resolved.filter(({ supplier }) => "missing" in supplier),
    ({ op }) => op.jobId
  );
  const resolvedByJob = groupBy(resolved, ({ op }) => op.jobId);
  const drafts = await fetchAllByIds(supplierIds, (batch) =>
    client
      .from("purchaseOrder")
      .select("id, purchaseOrderId, supplierId")
      .eq("status", "Draft")
      .in("supplierId", batch)
      .eq("companyId", companyId)
      .order("id")
  );
  if (drafts.error) return { data: null, error: drafts.error };

  const materialsByJob = groupBy(materials.data ?? [], (m) => m.jobId ?? "");
  const operationsByJob = groupBy(operations.data ?? [], (op) => op.jobId);
  const rootByJob = new Map((roots.data ?? []).map((r) => [r.jobId, r.id]));
  const descriptionByMakeMethod = new Map(
    (materials.data ?? []).map((m) => [
      m.jobMaterialMakeMethodId,
      m.description || m.itemReadableId || ""
    ])
  );

  return {
    data: {
      jobs: (jobs.data ?? []).map((job) => ({
        id: job.id,
        jobId: job.jobId,
        status: job.status,
        manufacturingBlocked:
          job.item?.itemReplenishment?.manufacturingBlocked === true,
        nothingToMake:
          Number(job.quantity ?? 0) === 0 &&
          Number(job.scrapQuantity ?? 0) === 0,
        makeToAssetError: makeToAssetReleaseError({
          ...job,
          itemTrackingType: job.item?.itemTrackingType
        }),
        missingAssemblies: makeMethodsMissingOperations(
          rootByJob.get(job.id) ?? null,
          materialsByJob[job.id] ?? [],
          operationsByJob[job.id] ?? []
        ).map((makeMethodId) => ({
          makeMethodId,
          description:
            makeMethodId === rootByJob.get(job.id)
              ? job.jobId
              : (descriptionByMakeMethod.get(makeMethodId) ?? makeMethodId)
        })),
        outsideOperationsWithoutSupplier: (
          withoutSupplierByJob[job.id] ?? []
        ).map(({ op, supplier }) => ({
          id: op.id,
          description: op.description ?? op.id,
          missing: "missing" in supplier ? supplier.missing : "none"
        })),
        supplierIds: [
          ...new Set(
            (resolvedByJob[job.id] ?? []).flatMap(({ supplier }) =>
              "supplierProcess" in supplier
                ? [supplier.supplierProcess.supplierId]
                : []
            )
          )
        ],
        materialsWithoutStorageUnit: withoutStorageUnit.data[job.id] ?? []
      })),
      suppliers: supplierIds.map((supplierId) => ({
        supplierId,
        draftPurchaseOrders: (drafts.data ?? [])
          .filter((po) => po.supplierId === supplierId)
          .map((po) => ({ id: po.id, purchaseOrderId: po.purchaseOrderId }))
      }))
    },
    error: null
  };
}

/**
 * Set a job's status, and nothing else. Not published: a release, a cancel or
 * a close does more than the status write (requirements, MRP, purchase
 * orders, picked material). The API's `production.job.*` operations do it.
 */
export async function updateJobStatus(
  client: SupabaseClient<Database>,
  params: {
    id: string;
    companyId: string;
    status: (typeof jobStatus)[number];
    assignee?: string | null;
    updatedBy: string;
    // Flip only from one of these statuses. A release reads the status, then
    // runs for a while (recalculate, MRP) before it writes; a job someone
    // cancelled in between must not come back as Ready. `updated` is false
    // when the row no longer matched.
    fromStatuses?: (typeof jobStatus)[number][];
  },
  { source = "erp" }: { source?: JobSource } = {}
) {
  const { id, companyId, status, assignee, updatedBy, fromStatuses } = params;

  // Reopening a job (leaving a completed state) must clear completedDate so it
  // isn't left stale. Done in the same UPDATE as status so the job event
  // interceptor (sync_job_recompute_service_line) fires once and re-derives the
  // linked service line's fulfillment. Setting a completed state here does not
  // set completedDate — that is the complete route's / complete_job_to_inventory's job.
  const clearsCompletion = !["Completed", "Closed"].includes(status);

  // The prior status is what tells a real release/hold apart from a re-save.
  const prior = await client
    .from("job")
    .select("status")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();

  const update = client
    .from("job")
    .update({
      status,
      assignee,
      updatedBy,
      updatedAt: new Date().toISOString(),
      ...(clearsCompletion ? { completedDate: null } : {})
    })
    .eq("id", id)
    .eq("companyId", companyId);
  const result = fromStatuses
    ? await update.in("status", fromStatuses).select("id")
    : await update;
  const updated =
    !result.error && (!fromStatuses || (result.data?.length ?? 0) > 0);

  if (updated && prior.data && prior.data.status !== status) {
    if (status === "Ready") {
      await raiseMoment("production.jobReleased", {
        outputs: { job: { id }, releasedBy: { id: updatedBy } },
        companyId,
        actorId: updatedBy
      });
      // Same guard as the moment above: a real transition, never a re-save.
      trackWorkEvent("job_released", {
        companyId,
        userId: updatedBy,
        jobId: id,
        priorStatus: prior.data.status,
        source
      });
    } else if (status === "Paused") {
      await raiseMoment("production.jobHeld", {
        outputs: { job: { id }, heldBy: { id: updatedBy } },
        companyId,
        actorId: updatedBy
      });
    }
  }

  return { ...result, updated };
}

export async function updateJobMaterialOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("jobMaterial").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

/** A job's operations in their new order, as one statement scoped to the job. Throws. */
export async function updateJobOperationOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  jobId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "jobOperation",
    column: "order",
    companyId,
    userId,
    parent: { column: "jobId", id: jobId },
    updates
  });
}

export async function updateJobOperationStepOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client
      .from("jobOperationStep")
      .update({ sortOrder, updatedBy })
      .eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateKanbanJob(
  client: SupabaseClient<Database>,
  params: {
    id: string;
    jobId: string | null;
    companyId: string;
    userId: string;
  }
) {
  const { id, jobId, companyId, userId } = params;
  return client
    .from("kanban")
    .update({ jobId, updatedBy: userId, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function updateQuoteOperationStepOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client
      .from("quoteOperationStep")
      .update({ sortOrder, updatedBy })
      .eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateMethodOperationStepOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client
      .from("methodOperationStep")
      .update({ sortOrder, updatedBy })
      .eq("id", id)
  );
  return Promise.all(updatePromises);
}

/**
 * Returns picked-but-unconsumed material an operation left at lineside once it
 * is Done; when that completed the job, the whole job's remainder. Pass a
 * service-role client so the picking lines are readable regardless of the
 * caller's inventory permissions. Idempotent.
 */
export async function returnPickedRemaindersForOperation(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { jobOperationId: string; userId: string; companyId: string }
) {
  return invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "post-picking",
    {
      type: "returnOperationRemainders",
      ...args
    },
    inventoryPostings.postPicking,
    { as: inventoryPostings.postPickingPermission }
  );
}

/**
 * Job-scope sweep after a job is completed or cancelled. post-picking sweeps
 * only a Completed or Cancelled job, and is idempotent.
 */
export async function returnPickedRemaindersForJob(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { jobId: string; userId: string; companyId: string }
) {
  return invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "post-picking",
    {
      type: "returnJobRemainders",
      jobId: args.jobId
    },
    inventoryPostings.postPicking,
    { as: inventoryPostings.postPickingPermission }
  );
}

export async function updateProcedureStepOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client.from("procedureStep").update({ sortOrder, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

/** The row write only; `createProductionEvent` / `updateProductionEvent` also post the time to the GL. */
export async function upsertProductionEvent(
  client: SupabaseClient<Database>,
  productionEvent:
    | (Omit<z.infer<typeof productionEventValidator>, "id"> & {
        createdBy: string;
        companyId: string;
      })
    | (Omit<z.infer<typeof productionEventValidator>, "id"> & {
        id: string;
        updatedBy: string;
        companyId: string;
      })
) {
  if ("createdBy" in productionEvent) {
    return client
      .from("productionEvent")
      .insert([productionEvent])
      .select("id")
      .single();
  } else {
    const { id, updatedBy, companyId, ...updateData } = productionEvent;

    return client
      .from("productionEvent")
      .update({
        ...sanitize(updateData),
        updatedBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select()
      .single();
  }
}

/** The row write only; `createProductionQuantity` also refuses a locked job. */
export async function upsertProductionQuantity(
  client: SupabaseClient<Database>,
  productionQuantity:
    | (Omit<z.infer<typeof productionQuantityValidator>, "id"> & {
        companyId: string;
      })
    | (Omit<z.infer<typeof productionQuantityValidator>, "id"> & {
        id: string;
        updatedBy: string;
        companyId: string;
      })
) {
  if ("updatedBy" in productionQuantity) {
    const { id, updatedBy, companyId, ...updateData } = productionQuantity;

    return client
      .from("productionQuantity")
      .update({
        ...sanitize(updateData),
        updatedBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .eq("companyId", companyId)
      .select()
      .single();
  } else {
    return (
      client
        .from("productionQuantity")
        // @ts-expect-error TS2769 - TODO: fix type
        .insert([productionQuantity])
        .select("id")
        .single()
    );
  }
}

/**
 * `options.source` is telemetry-only: which surface raised the job. Five
 * routes, MRP, the MCP tools and the workflow engine all funnel through here
 * and the `job` row cannot tell them apart, so the caller has to say.
 *
 * Unset is reported as `unknown`, never as `erp`. The MCP tool and the
 * workflow engine both reach this through `dispatch(call, context, inputs)`,
 * which has nowhere to put an option, and an `erp` default would file
 * automated job creation as human work — the one thing the field separates.
 *
 * Kept out of the options type literal on purpose: the MCP metadata generator
 * parses that object textually and turns a JSDoc block above a property into a
 * property name of its own, which then ships in the public tool schema.
 */
export async function insertJob(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    itemId: string;
    quantity: number;
    companyId: string;
    createdBy: string;
    jobId?: string;
    locationId?: string;
    dueDate?: string;
    startDate?: string;
    priority?: number;
    status?: (typeof jobStatus)[number];
    deadlineType?: (typeof deadlineTypes)[number];
    storageUnitId?: string;
    unitOfMeasureCode?: string;
    customerId?: string;
    salesOrderId?: string;
    salesOrderLineId?: string;
    quoteId?: string;
    quoteLineId?: string;
    modelUploadId?: string;
    notes?: string;
    customFields?: Json;
    configuration?: Record<string, unknown>;
    fixedAssetClassId?: string | null;
    fixedAssetId?: string | null;
  },
  options?: {
    skipMethod?: boolean;
    skipRecalculate?: boolean;
    methodSource?: "item" | "quoteLine";
    source?: JobSource;
  }
): Promise<{
  data: { id: string; jobId: string } | null;
  error: PostgrestError | null;
}> {
  let jobId: string;
  if (input.jobId) {
    jobId = input.jobId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "job",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({ message: "Failed to generate job sequence" } as PostgrestError)
      };
    }
    jobId = seq.data;
  }

  let locationId = input.locationId;
  if (!locationId) {
    const employeeJob = await getEmployeeJob(
      client,
      input.createdBy,
      input.companyId
    );
    locationId = employeeJob.data?.locationId ?? undefined;

    if (!locationId) {
      const defaultLocation = await client
        .from("location")
        .select("id")
        .eq("companyId", input.companyId)
        .limit(1)
        .single();
      locationId = defaultLocation.data?.id ?? undefined;
    }

    if (!locationId) {
      return {
        data: null,
        error: { message: "No location found for job" } as PostgrestError
      };
    }
  }

  const replenishment = await client
    .from("itemReplenishment")
    .select("leadTime, scrapPercentage, lotSize")
    .eq("itemId", input.itemId)
    .eq("companyId", input.companyId)
    .maybeSingle();

  const leadTime = replenishment.data?.leadTime ?? 7;
  const scrapPercentage = replenishment.data?.scrapPercentage ?? 0;

  const dueDate = input.dueDate ?? null;
  const startDate =
    input.startDate ??
    (dueDate
      ? parseDate(dueDate).subtract({ days: leadTime }).toString()
      : null);

  const deadlineType =
    input.deadlineType ?? (dueDate ? "Hard Deadline" : "No Deadline");

  const priority =
    input.priority ??
    (await calculateJobPriority(client, {
      dueDate,
      deadlineType,
      companyId: input.companyId,
      locationId
    }));

  const storageUnitId =
    input.storageUnitId ??
    (await getDefaultStorageUnitForJob(
      client,
      input.itemId,
      locationId,
      input.companyId
    ));

  const scrapQuantity = scrapAllowance(input.quantity, scrapPercentage);

  const job = await client
    .from("job")
    .insert({
      jobId,
      itemId: input.itemId,
      quantity: input.quantity,
      scrapQuantity,
      locationId,
      dueDate,
      startDate,
      deadlineType,
      priority,
      status: input.status ?? "Draft",
      storageUnitId,
      unitOfMeasureCode: input.unitOfMeasureCode ?? "EA",
      customerId: input.customerId,
      salesOrderId: input.salesOrderId,
      salesOrderLineId: input.salesOrderLineId,
      quoteId: input.quoteId,
      quoteLineId: input.quoteLineId,
      modelUploadId: input.modelUploadId,
      notes: input.notes,
      customFields: input.customFields,
      fixedAssetClassId: input.fixedAssetClassId ?? null,
      fixedAssetId: input.fixedAssetId ?? null,
      configuration: (input.configuration as Json | undefined) ?? null,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id")
    .single();

  if (job.error) {
    return { data: null, error: job.error };
  }

  const createdJobId = job.data.id;

  trackWorkEvent("job_created", {
    companyId: input.companyId,
    userId: input.createdBy,
    jobId: createdJobId,
    itemId: input.itemId,
    quantity: input.quantity,
    scrapQuantity,
    locationId: locationId ?? null,
    salesOrderLineId: input.salesOrderLineId ?? null,
    deadlineType,
    // Narrowed, not trusted: this arrives from an MCP caller as an untyped
    // schema field, so TypeScript is not a guard on it.
    source: asJobSource(options?.source)
  });

  if (!options?.skipMethod) {
    const methodSource =
      options?.methodSource ??
      (input.quoteId && input.quoteLineId ? "quoteLine" : "item");

    if (methodSource === "quoteLine" && input.quoteId && input.quoteLineId) {
      const { error } = await invokePosting(
        { client, db, companyId: input.companyId, userId: input.createdBy },
        "get-method",
        {
          type: "quoteLineToJob",
          sourceId: `${input.quoteId}:${input.quoteLineId}`,
          targetId: createdJobId,
          configuration: input.configuration || undefined
        },
        getMethod,
        { as: getMethodPermission }
      );
      if (error) {
        logger.error("Failed to copy method from quote line", { error });
      }
    } else {
      const { error } = await invokePosting(
        { client, db, companyId: input.companyId, userId: input.createdBy },
        "get-method",
        {
          type: "itemToJob",
          sourceId: input.itemId,
          targetId: createdJobId,
          configuration: input.configuration || undefined
        },
        getMethod,
        { as: getMethodPermission }
      );
      if (error) {
        logger.error("Failed to copy method from item", { error });
      }
    }
  }

  // Assign configured serial numbers to the job's tracked entities (best-effort).
  await assignJobSerialNumbers(client, db, {
    jobId: createdJobId,
    itemId: input.itemId,
    companyId: input.companyId,
    userId: input.createdBy
  });

  if (!options?.skipRecalculate) {
    await invokePosting(
      { client, db, companyId: input.companyId, userId: input.createdBy },
      "recalculate",
      {
        type: "jobRequirements",
        id: createdJobId
      },
      recalculateRequirements,
      { as: recalculateRequirementsPermission }
    );
  }

  return { data: { id: createdJobId, jobId }, error: null };
}

/**
 * Assign configured serial numbers to a freshly-created job's tracked entities.
 * Best-effort and cheap: it skips the operation entirely unless the item has
 * an `itemSerialSequence` configured. Shared by every job-creation path so serial
 * numbering is applied consistently (insertJob, sales-order conversion, ...).
 */
async function assignJobSerialNumbers(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { jobId: string; itemId: string; companyId: string; userId: string }
) {
  const serialSequence = await client
    .from("itemSerialSequence")
    .select("id")
    .eq("itemId", args.itemId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  // A query error (DB/RLS) also returns null data — distinguish it from "no
  // sequence configured" so a failure can't silently create an unnumbered job.
  if (serialSequence.error) {
    logger.error("Failed to check item serial sequence", {
      error: serialSequence.error,
      itemId: args.itemId,
      companyId: args.companyId
    });
    return;
  }
  if (!serialSequence.data) return;
  const { error } = await invokePosting(
    { client, db, companyId: args.companyId, userId: args.userId },
    "assign-serial-numbers",
    { jobId: args.jobId },
    assignSerialNumbers,
    { as: assignSerialNumbersPermission }
  );
  if (error) {
    logger.error("Failed to assign serial numbers", { error });
  }
}

/** The row write only; `updateJobDetails` also checks the job and recalculates it. */
export async function updateJob(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    companyId: string;
    updatedBy: string;
    quantity?: number;
    dueDate?: string | null;
    startDate?: string | null;
    status?: (typeof jobStatus)[number];
    priority?: number;
    deadlineType?: (typeof deadlineTypes)[number];
    locationId?: string;
    storageUnitId?: string;
    unitOfMeasureCode?: string;
    customerId?: string | null;
    salesOrderId?: string | null;
    salesOrderLineId?: string | null;
    quoteId?: string | null;
    quoteLineId?: string | null;
    modelUploadId?: string | null;
    notes?: string | null;
    customFields?: Json;
    scrapQuantity?: number;
    itemId?: string;
    fixedAssetClassId?: string | null;
    fixedAssetId?: string | null;
  }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const { id, companyId, updatedBy, ...updates } = input;

  const priority = await priorityForDateChange(client, id, companyId, updates);

  return client
    .from("job")
    .update(
      unchecked({
        ...sanitize(updates),
        ...(priority !== undefined && { priority }),
        updatedBy,
        updatedAt: new Date().toISOString()
      })
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/**
 * The job's priority when its due date or deadline type changes, so a date
 * change re-ranks the job; undefined when neither changes or the caller sets
 * the priority itself.
 */
async function priorityForDateChange(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string,
  updates: {
    dueDate?: string | null;
    deadlineType?: (typeof deadlineTypes)[number];
    priority?: number;
  }
): Promise<number | undefined> {
  if (
    (updates.dueDate === undefined && updates.deadlineType === undefined) ||
    updates.priority !== undefined
  ) {
    return updates.priority;
  }

  const existing = await client
    .from("job")
    .select("dueDate, deadlineType, companyId, locationId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (!existing.data) return undefined;

  return calculateJobPriority(client, {
    jobId: id,
    dueDate: updates.dueDate ?? existing.data.dueDate,
    deadlineType: updates.deadlineType ?? existing.data.deadlineType,
    companyId: existing.data.companyId,
    locationId: existing.data.locationId
  });
}

/**
 * The scrap allowance a job needs for a new quantity, from its item's scrap
 * rate — the same derivation `insertJob` makes. `job.quantity` is the good
 * units; `scrapQuantity` rides on top of it (`productionQuantity` is their
 * generated sum), so a quantity change that leaves the old allowance in place
 * builds the wrong number of units.
 */
async function scrapQuantityForPlanningQuantity(
  client: SupabaseClient<Database>,
  job: { id: string; companyId: string },
  quantity: number
): Promise<{ scrapQuantity: number; error: PostgrestError | null }> {
  const existing = await client
    .from("job")
    .select("itemId")
    .eq("id", job.id)
    .eq("companyId", job.companyId)
    .single();
  if (existing.error) return { scrapQuantity: 0, error: existing.error };

  const replenishment = await client
    .from("itemReplenishment")
    .select("scrapPercentage")
    .eq("itemId", existing.data.itemId)
    .eq("companyId", job.companyId)
    .maybeSingle();
  if (replenishment.error) {
    return { scrapQuantity: 0, error: replenishment.error };
  }
  return {
    scrapQuantity: scrapAllowance(
      quantity,
      replenishment.data?.scrapPercentage ?? 0
    ),
    error: null
  };
}

/**
 * Change a job's quantity or due date from planning (Apply, the order drawer).
 * The Draft / Planned condition is part of the UPDATE, so a job released
 * after the caller read it is left alone rather than edited: `updated` is
 * false, and the caller sends the planner to the job instead.
 *
 * A quantity change restates `scrapQuantity` for the new quantity. The
 * planning Decrease / Increase quantities are good units, so the job's own
 * scrap allowance must follow them — left alone, a Decrease to 80 kept the
 * allowance of the old quantity and the next run offered the Decrease again.
 */
export async function updatePlanningJob(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    companyId: string;
    updatedBy: string;
    quantity?: number;
    dueDate?: string;
  }
): Promise<{ updated: boolean; error: PostgrestError | null }> {
  const { id, companyId, updatedBy, ...changes } = input;
  const updates: typeof changes & { deadlineType?: DeadlineType } = {
    ...changes
  };
  if (updates.dueDate !== undefined) {
    const existing = await client
      .from("job")
      .select("deadlineType")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
    if (existing.error) return { updated: false, error: existing.error };
    const deadlineType = deadlineTypeForPlanningDate(
      existing.data.deadlineType
    );
    if (deadlineType !== existing.data.deadlineType) {
      updates.deadlineType = deadlineType;
    }
  }
  const priority = await priorityForDateChange(client, id, companyId, updates);

  let scrap: { scrapQuantity: number } | undefined;
  if (updates.quantity !== undefined) {
    const derived = await scrapQuantityForPlanningQuantity(
      client,
      { id, companyId },
      updates.quantity
    );
    if (derived.error) return { updated: false, error: derived.error };
    scrap = { scrapQuantity: derived.scrapQuantity };
  }

  const result = await client
    .from("job")
    .update({
      ...updates,
      ...scrap,
      ...(priority !== undefined && { priority }),
      updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .in("status", [...PLANNING_EDITABLE_JOB_STATUSES])
    .select("id");

  return {
    updated: (result.data ?? []).length > 0,
    error: result.error
  };
}

/**
 * @deprecated Use insertJob for new jobs, updateJob for existing jobs
 */
export async function upsertJob(
  client: SupabaseClient<Database>,
  job:
    | (Omit<z.infer<typeof jobValidator>, "id" | "jobId"> & {
        jobId: string;
        storageUnitId?: string;
        startDate?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof jobValidator>, "id" | "jobId"> & {
        id: string;
        jobId: string;
        updatedBy: string;
        customFields?: Json;
      }),
  status?: (typeof jobStatus)[number]
) {
  if ("updatedBy" in job) {
    return client
      .from("job")
      .update({
        ...sanitize(job),
        ...(status && { status })
      })
      .eq("id", job.id)
      .select("id")
      .single();
  } else {
    return client
      .from("job")
      .insert([
        {
          ...job,
          ...(status && { status })
        }
      ])
      .select("id")
      .single();
  }
}

export async function upsertJobMaterial(
  client: SupabaseClient<Database>,
  jobMaterial:
    | (z.infer<typeof jobMaterialValidator> & {
        jobId: string;
        jobOperationId?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof jobMaterialValidator> & {
        jobId: string;
        jobOperationId?: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in jobMaterial) {
    // A material never moves between jobs, make methods or tenants — strip the
    // parent columns so an update cannot re-parent the row, and scope it to
    // the caller's company (callers may pass a service-role client).
    const {
      id,
      companyId,
      jobId: _jobId,
      jobMakeMethodId: _jobMakeMethodId,
      ...update
    } = jobMaterial;
    return client
      .from("jobMaterial")
      .update(sanitize(update))
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id, methodType")
      .single();
  }
  return client
    .from("jobMaterial")
    .insert([jobMaterial])
    .select("id, methodType")
    .single();
}

/** The row write only; `createJobOperation` / `updateJobOperation` are the operations. */
export async function upsertJobOperation(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  jobOperation:
    | (z.infer<typeof jobOperationValidator> & {
        jobId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof jobOperationValidator> & {
        jobId: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  const normalized = normalizeOperationSourceIds(jobOperation);
  if ("updatedBy" in normalized) {
    // An operation never moves between jobs, make methods or tenants — strip
    // the parent columns so an update cannot re-parent the row.
    const {
      id,
      companyId,
      jobId: _jobId,
      jobMakeMethodId: _jobMakeMethodId,
      ...update
    } = normalized;
    return client
      .from("jobOperation")
      .update(sanitize(update))
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }
  const operationInsert = await client
    .from("jobOperation")
    .insert([normalized])
    .select("id")
    .single();

  if (operationInsert.error) {
    return operationInsert;
  }
  const operationId = operationInsert.data?.id;
  if (!operationId) return operationInsert;

  if (normalized.procedureId && "createdBy" in normalized) {
    const { error } = await invokePosting(
      {
        client,
        db,
        companyId: normalized.companyId,
        userId: normalized.createdBy
      },
      "get-method",
      {
        type: "procedureToOperation",
        sourceId: normalized.procedureId,
        targetId: operationId
      },
      getMethod,
      { as: getMethodPermission }
    );
    if (error) {
      return {
        data: null,
        error: { message: "Failed to get procedure" } as PostgrestError
      };
    }
  }
  return operationInsert;
}

export async function upsertJobOperationStep(
  client: SupabaseClient<Database>,
  jobOperationStep:
    | (Omit<z.infer<typeof operationStepValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepValidator>,
        "id" | "minValue" | "maxValue"
      > & {
        id: string;
        minValue: number | null;
        maxValue: number | null;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in jobOperationStep) {
    return client
      .from("jobOperationStep")
      .insert(jobOperationStep)
      .select("id")
      .single();
  }

  return client
    .from("jobOperationStep")
    .update(sanitize(jobOperationStep))
    .eq("id", jobOperationStep.id)
    .select("id")
    .single();
}

// Job-tier twin of duplicateMethodOperationStep (items.service.ts). Deep-copies a job
// step's DEFINITION — the step row, its slides (incl. size/annotations), and its
// step-scoped tool + part/material links — but NOT its jobOperationStepRecord rows: those
// are captured operator results, not part of the template, and must start empty on a copy.
// NCR linkage (nonConformance*Id) is intentionally dropped so a clone isn't a second step
// claiming the same containment action.
export async function duplicateJobOperationStep(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; createdBy: string }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const source = await client
    .from("jobOperationStep")
    .select("*")
    .eq("id", args.id)
    .single();
  if (source.error || !source.data) {
    return { data: null, error: source.error };
  }
  const src = source.data;

  // Append after the highest sortOrder in the operation.
  const siblings = await client
    .from("jobOperationStep")
    .select("sortOrder")
    .eq("operationId", src.operationId);
  const nextSortOrder =
    (siblings.data ?? []).reduce(
      (max, s) => Math.max(max, s.sortOrder ?? 0),
      0
    ) + 1;

  const insert = await client
    .from("jobOperationStep")
    .insert({
      operationId: src.operationId,
      name: `${src.name} (copy)`,
      description: src.description,
      type: src.type,
      unitOfMeasureCode: src.unitOfMeasureCode,
      minValue: src.minValue,
      maxValue: src.maxValue,
      listValues: src.listValues,
      sortOrder: nextSortOrder,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("id")
    .single();
  if (insert.error || !insert.data) {
    return { data: null, error: insert.error };
  }
  const newStepId = insert.data.id;

  const slides = await client
    .from("jobOperationStepSlide")
    .select("*")
    .eq("stepId", args.id);
  if (slides.error) {
    return { data: null, error: slides.error };
  }
  if (slides.data && slides.data.length > 0) {
    const slideRows = slides.data.map((s) => ({
      stepId: newStepId,
      imagePath: s.imagePath,
      modelUploadId: s.modelUploadId,
      caption: s.caption,
      sortOrder: s.sortOrder,
      size: s.size,
      annotations: s.annotations,
      companyId: args.companyId,
      createdBy: args.createdBy
    }));
    const slideInsert = await client
      .from("jobOperationStepSlide")
      .insert(slideRows);
    if (slideInsert.error) {
      return { data: null, error: slideInsert.error };
    }
  }

  // Copy step-scoped tool links. No join rows = operation-level (shown on every step) and
  // needs nothing copied; only tools scoped to this step carry a row to repoint at the clone.
  const toolLinks = await client
    .from("jobOperationToolStep")
    .select("jobOperationToolId")
    .eq("jobOperationStepId", args.id);
  if (toolLinks.error) {
    return { data: null, error: toolLinks.error };
  }
  if (toolLinks.data && toolLinks.data.length > 0) {
    const toolLinkInsert = await client.from("jobOperationToolStep").insert(
      toolLinks.data.map((l) => ({
        jobOperationToolId: l.jobOperationToolId,
        jobOperationStepId: newStepId
      }))
    );
    if (toolLinkInsert.error) {
      return { data: null, error: toolLinkInsert.error };
    }
  }

  // Copy step-scoped part/material links (same operation-level-vs-scoped semantics as tools).
  // Pre-migration schema: no quantity column — copy the bare links instead.
  let materialLinks = await client
    .from("jobMaterialStep")
    .select("jobMaterialId, quantity")
    .eq("jobOperationStepId", args.id);
  if (isMissingQuantityColumn(materialLinks.error)) {
    materialLinks = (await client
      .from("jobMaterialStep")
      .select("jobMaterialId")
      .eq("jobOperationStepId", args.id)) as unknown as typeof materialLinks;
  }
  if (materialLinks.error) {
    return { data: null, error: materialLinks.error };
  }
  if (materialLinks.data && materialLinks.data.length > 0) {
    const materialLinkInsert = await client.from("jobMaterialStep").insert(
      materialLinks.data.map((l) => ({
        jobMaterialId: l.jobMaterialId,
        jobOperationStepId: newStepId,
        ...(l.quantity != null ? { quantity: l.quantity } : {})
      }))
    );
    if (materialLinkInsert.error) {
      return { data: null, error: materialLinkInsert.error };
    }
  }

  return { data: { id: newStepId }, error: null };
}

// Job-tier twin of upsertMethodOperationStepSlide (items.service.ts). Same generic
// validator; `stepId` here is a jobOperationStep id. On update we sanitize() so an
// omitted optional field (caption-only save) never wipes size/annotations.
export async function upsertJobOperationStepSlide(
  client: SupabaseClient<Database>,
  slide:
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in slide) {
    return client
      .from("jobOperationStepSlide")
      .insert(slide)
      .select("id")
      .single();
  }

  return client
    .from("jobOperationStepSlide")
    .update(sanitize(slide))
    .eq("id", slide.id)
    .select("id")
    .single();
}

export async function upsertJobOperationParameter(
  client: SupabaseClient<Database>,
  jobOperationParameter:
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationParameterValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in jobOperationParameter) {
    return client
      .from("jobOperationParameter")
      .insert(jobOperationParameter)
      .select("id")
      .single();
  }

  return client
    .from("jobOperationParameter")
    .update(sanitize(jobOperationParameter))
    .eq("id", jobOperationParameter.id)
    .select("id")
    .single();
}

/**
 * Promise date = the job's forward-ASAP forecast finish (`projectedCompletionAt`,
 * stamped by every regen). No operation-date fallback: `jobOperation.dueDate` is
 * now the backward need-by target, so max(op.dueDate) ≈ the job due date —
 * answering "when will it be done?" with the ask, not a forecast. Before the
 * first regen the promise date is simply null.
 * Implements the §7 `{ date, confidence? }` contract — confidence is a string
 * enum, "low" when the schedule may not hold (a conflicted op or a pending
 * replan) and "scheduled" otherwise.
 */
export async function getJobPromiseDate(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  const job = await client
    .from("job")
    .select("projectedCompletionAt, scheduleOutdatedReason")
    .eq("id", jobId)
    .eq("companyId", companyId)
    .single();
  if (job.error) return job;

  const operations = await client
    .from("jobOperation")
    .select("id, hasConflict")
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .in("status", ["Todo", "Waiting", "Ready", "In Progress", "Paused"]);
  if (operations.error) return operations;

  const hasConflict = (operations.data ?? []).some((o) => o.hasConflict);
  const confidence =
    hasConflict || job.data.scheduleOutdatedReason
      ? ("low" as const)
      : ("scheduled" as const);

  return {
    data: {
      promiseDate: job.data.projectedCompletionAt ?? null,
      basis: "schedule" as const,
      confidence
    },
    error: null
  };
}

export async function upsertJobOperationTool(
  client: SupabaseClient<Database>,
  jobOperationTool:
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof operationToolValidator>, "id"> & {
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in jobOperationTool) {
    return client
      .from("jobOperationTool")
      .insert(jobOperationTool)
      .select("id")
      .single();
  }

  return client
    .from("jobOperationTool")
    .update(sanitize(jobOperationTool))
    .eq("id", jobOperationTool.id)
    .select("id")
    .single();
}

// Replace a job tool's step links (part/tool ↔ step is many-to-many). No ids = the tool
// applies to the whole operation (shown on every step in the MES). Delete-then-insert.
// Replace a job material's step links (part ↔ step, many-to-many). See above.
export async function replaceJobMaterialSteps(
  client: SupabaseClient<Database>,
  jobMaterialId: string,
  jobOperationStepIds: string[]
) {
  // Per-step quantities are edited from the step side; a BOM-side rewrite of the
  // step set must not wipe them, so carry each retained step's quantity across
  // the delete-then-insert. Pre-migration schema: quantities don't exist, so
  // fall back to the bare link set.
  let quantityByStepId = new Map<string, number | null>();
  const existing = await client
    .from("jobMaterialStep")
    .select("jobOperationStepId, quantity")
    .eq("jobMaterialId", jobMaterialId);
  if (existing.error && !isMissingQuantityColumn(existing.error)) {
    return existing;
  }
  if (!existing.error) {
    quantityByStepId = new Map(
      (existing.data ?? []).map((l) => [l.jobOperationStepId, l.quantity])
    );
  }
  const del = await client
    .from("jobMaterialStep")
    .delete()
    .eq("jobMaterialId", jobMaterialId);
  if (del.error || jobOperationStepIds.length === 0) return del;
  return client.from("jobMaterialStep").insert(
    jobOperationStepIds.map((jobOperationStepId) => {
      const quantity = quantityByStepId.get(jobOperationStepId);
      return {
        jobMaterialId,
        jobOperationStepId,
        ...(quantity != null ? { quantity } : {})
      };
    })
  );
}

// Toggle a single part↔step link from the STEP side (the step editor's Parts picker).
// `linked` true = link the material to the step, false = unlink. Idempotent on link.
// `quantity` is the per-step share of the BOM line (NULL = the full line quantity);
// re-linking an existing link updates the quantity, so the same call edits a split.
export async function setJobMaterialStepLink(
  client: SupabaseClient<Database>,
  args: {
    jobMaterialId: string;
    jobOperationStepId: string;
    linked: boolean;
    quantity?: number | null;
  }
) {
  if (args.linked) {
    return client.from("jobMaterialStep").upsert(
      [
        {
          jobMaterialId: args.jobMaterialId,
          jobOperationStepId: args.jobOperationStepId,
          // Omit the column when unset so the default link path still works
          // against a pre-migration schema (see isMissingQuantityColumn).
          ...(args.quantity != null ? { quantity: args.quantity } : {})
        }
      ],
      {
        onConflict: "jobMaterialId,jobOperationStepId"
      }
    );
  }
  return client
    .from("jobMaterialStep")
    .delete()
    .eq("jobMaterialId", args.jobMaterialId)
    .eq("jobOperationStepId", args.jobOperationStepId);
}

// Toggle a single tool↔step link from the STEP side (the step editor's Tools picker).
// Takes the tool ITEM id: the picker offers the whole tool library, and choosing a
// tool implicitly ensures the operation-level tool row exists (quantity 1 — the same
// row the operation's Tools tab would create) before linking it to the step. Unlink
// removes only the step link; the operation tool row stays (the Tools tab owns it).
// Twin of setJobMaterialStepLink.
export async function setJobOperationToolStepLink(
  client: SupabaseClient<Database>,
  args: {
    operationId: string;
    toolId: string;
    jobOperationStepId: string;
    linked: boolean;
    companyId: string;
    createdBy: string;
  }
) {
  const existingTool = await client
    .from("jobOperationTool")
    .select("id")
    .eq("operationId", args.operationId)
    .eq("toolId", args.toolId)
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingTool.error) return existingTool;
  let jobOperationToolId = existingTool.data?.id;

  if (args.linked) {
    if (!jobOperationToolId) {
      const created = await client
        .from("jobOperationTool")
        .insert({
          operationId: args.operationId,
          toolId: args.toolId,
          quantity: 1,
          companyId: args.companyId,
          createdBy: args.createdBy
        })
        .select("id")
        .single();
      if (created.error) return created;
      jobOperationToolId = created.data.id;
    }
    return client.from("jobOperationToolStep").upsert(
      [
        {
          jobOperationToolId,
          jobOperationStepId: args.jobOperationStepId
        }
      ],
      {
        onConflict: "jobOperationToolId,jobOperationStepId",
        ignoreDuplicates: true
      }
    );
  }
  if (!jobOperationToolId) return { data: null, error: null };
  return client
    .from("jobOperationToolStep")
    .delete()
    .eq("jobOperationToolId", jobOperationToolId)
    .eq("jobOperationStepId", args.jobOperationStepId);
}

/** The copy only; `copyMethodToJob` also recalculates the job. */
export async function upsertJobMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  type: "itemToJob" | "quoteLineToJob" | "jobToJob",
  jobMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    versionId?: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  const body: {
    type: "itemToJob" | "quoteLineToJob" | "jobToJob";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    versionId?: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  } = {
    type,
    sourceId: jobMethod.sourceId,
    targetId: jobMethod.targetId,
    companyId: jobMethod.companyId,
    userId: jobMethod.userId
  };

  // Only add configuration if it exists
  if (jobMethod.configuration !== undefined) {
    body.configuration = jobMethod.configuration;
  }

  // A specific source method version (itemToJob only); absent = active method
  if (jobMethod.versionId) {
    body.versionId = jobMethod.versionId;
  }

  // Only add parts if it exists
  if (jobMethod.parts !== undefined) {
    body.parts = jobMethod.parts;
  }

  const getMethodResult = await invokePosting(
    { client, db, companyId: body.companyId, userId: body.userId },
    "get-method",
    body,
    getMethod,
    { as: getMethodPermission }
  );
  if (getMethodResult.error) {
    return {
      data: null,
      error: {
        message: getErrorMessage(
          getMethodResult.error,
          "Failed to get job method"
        )
      } as PostgrestError
    };
  }
  return recalculateJobRequirements(client, db, {
    id: jobMethod.targetId,
    companyId: jobMethod.companyId,
    userId: jobMethod.userId
  });
}

/** The copy only; `copyMethodToMaterial` is the operation. */
export async function upsertJobMaterialMakeMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  jobMaterial: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    versionId?: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  const body: {
    type: "itemToJobMakeMethod";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
    versionId?: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  } = {
    type: "itemToJobMakeMethod",
    sourceId: jobMaterial.sourceId,
    targetId: jobMaterial.targetId,
    companyId: jobMaterial.companyId,
    userId: jobMaterial.userId
  };

  // Only add configuration if it exists
  if (jobMaterial.configuration !== undefined) {
    body.configuration = jobMaterial.configuration;
  }

  // A specific source method version; absent = active method
  if (jobMaterial.versionId) {
    body.versionId = jobMaterial.versionId;
  }

  // Only add parts if it exists
  if (jobMaterial.parts !== undefined) {
    body.parts = jobMaterial.parts;
  }

  const { error } = await invokePosting(
    { client, db, companyId: body.companyId, userId: body.userId },
    "get-method",
    body,
    getMethod,
    { as: getMethodPermission }
  );

  if (error) {
    return {
      data: null,
      error: {
        message: getErrorMessage(error, "Failed to pull method")
      } as PostgrestError
    };
  }

  return { data: null, error: null };
}

/**
 * Resolve a job material's child make-method id and pull its source item's
 * method (BOM + operations) into it. Shared by the job-material create and edit
 * routes: both flip a material to "Make to Order" and must populate the newly
 * created child make method.
 */
export async function pullJobMaterialMakeMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    jobMaterialId: string;
    itemId: string;
    companyId: string;
    userId: string;
  }
) {
  const materialMakeMethod = await client
    .from("jobMaterialWithMakeMethodId")
    .select("jobMaterialMakeMethodId")
    .eq("id", args.jobMaterialId)
    .eq("companyId", args.companyId)
    .single();

  if (
    materialMakeMethod.error ||
    !materialMakeMethod.data?.jobMaterialMakeMethodId
  ) {
    return {
      data: null,
      error: (materialMakeMethod.error ?? {
        message: "Failed to resolve job material make method"
      }) as PostgrestError
    };
  }

  return upsertJobMaterialMakeMethod(client, db, {
    sourceId: args.itemId,
    targetId: materialMakeMethod.data.jobMaterialMakeMethodId,
    companyId: args.companyId,
    userId: args.userId
  });
}

export async function upsertMakeMethodFromJob(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  jobMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  return invokePosting(
    {
      client,
      db,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId
    },
    "get-method",
    {
      type: "jobToItem",
      sourceId: jobMethod.sourceId,
      targetId: jobMethod.targetId,
      parts: jobMethod.parts
    },
    getMethod,
    { as: getMethodPermission }
  );
}

export async function upsertMakeMethodFromJobMethod(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  jobMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }
) {
  const { error } = await invokePosting(
    {
      client,
      db,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId
    },
    "get-method",
    {
      type: "jobMakeMethodToItem",
      sourceId: jobMethod.sourceId,
      targetId: jobMethod.targetId,
      parts: jobMethod.parts
    },
    getMethod,
    { as: getMethodPermission }
  );

  if (error) {
    return {
      data: null,
      error: { message: "Failed to save method" } as PostgrestError
    };
  }

  return { data: null, error: null };
}

export async function upsertProcedure(
  client: SupabaseClient<Database>,
  procedure:
    | (Omit<z.infer<typeof procedureValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof procedureValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  const { copyFromId, ...rest } = procedure;
  if ("id" in rest) {
    return client
      .from("procedure")
      .update(sanitize(rest))
      .eq("id", rest.id)
      .select("id")
      .single();
  }

  const insert = await client
    .from("procedure")
    .insert([rest])
    .select("id")
    .single();
  if (insert.error) {
    return insert;
  }
  if (copyFromId) {
    const procedure = await client
      .from("procedure")
      .select("*, procedureStep(*), procedureParameter(*)")
      .eq("id", copyFromId)
      .single();

    if (procedure.error) {
      return procedure;
    }

    const attributes = procedure.data.procedureStep ?? [];
    const parameters = procedure.data.procedureParameter ?? [];
    const workInstruction = (procedure.data.content ?? {}) as JSONContent;

    const [updateWorkInstructions, insertAttributes, insertParameters] =
      await Promise.all([
        client
          .from("procedure")
          .update({
            content: workInstruction
          })
          .eq("id", insert.data.id),
        attributes.length > 0
          ? client.from("procedureStep").insert(
              attributes.map((attribute) => {
                // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
                const { id, procedureId, ...rest } = attribute;
                return {
                  ...rest,
                  procedureId: insert.data.id,
                  companyId: procedure.data.companyId!
                };
              })
            )
          : Promise.resolve({ data: null, error: null }),
        parameters.length > 0
          ? client.from("procedureParameter").insert(
              parameters.map((parameter) => {
                // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
                const { id, procedureId, ...rest } = parameter;
                return {
                  ...rest,
                  procedureId: insert.data.id,
                  companyId: procedure.data.companyId!
                };
              })
            )
          : Promise.resolve({ data: null, error: null })
      ]);

    if (updateWorkInstructions.error) {
      return updateWorkInstructions;
    }
    if (insertAttributes.error) {
      return insertAttributes;
    }
    if (insertParameters.error) {
      return insertParameters;
    }
  }
  return insert;
}

export async function upsertProcedureStep(
  client: SupabaseClient<Database>,
  procedureStep:
    | (Omit<z.infer<typeof procedureStepValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof procedureStepValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("id" in procedureStep) {
    return client
      .from("procedureStep")
      .update(sanitize(procedureStep))
      .eq("id", procedureStep.id)
      .select("id")
      .single();
  }
  return client
    .from("procedureStep")
    .insert([procedureStep])
    .select("id")
    .single();
}

export async function upsertProcedureParameter(
  client: SupabaseClient<Database>,
  procedureParameter:
    | (Omit<z.infer<typeof procedureParameterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof procedureParameterValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("id" in procedureParameter) {
    return client
      .from("procedureParameter")
      .update(sanitize(procedureParameter))
      .eq("id", procedureParameter.id)
      .select("id")
      .single();
  }
  return client
    .from("procedureParameter")
    .insert([procedureParameter])
    .select("id")
    .single();
}

export async function upsertScrapReason(
  client: SupabaseClient<Database>,
  scrapReason:
    | (Omit<z.infer<typeof scrapReasonValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof scrapReasonValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in scrapReason) {
    return client.from("scrapReason").insert([scrapReason]).select("id");
  } else {
    return client
      .from("scrapReason")
      .update(sanitize(scrapReason))
      .eq("id", scrapReason.id);
  }
}

export async function upsertFailureMode(
  client: SupabaseClient<Database>,
  failureMode:
    | (Omit<z.infer<typeof failureModeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof failureModeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  // maintenanceFailureMode has no customFields column.
  const { customFields: _customFields, ...mode } = failureMode;
  if ("createdBy" in mode) {
    return client.from("maintenanceFailureMode").insert([mode]).select("id");
  }
  return client
    .from("maintenanceFailureMode")
    .update(sanitize(mode))
    .eq("id", mode.id);
}

export async function upsertMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatch:
    | (Omit<z.infer<typeof maintenanceDispatchValidator>, "id"> & {
        maintenanceDispatchId: string;
        companyId: string;
        createdBy: string;
        content?: Json;
      })
    | (Omit<z.infer<typeof maintenanceDispatchValidator>, "id"> & {
        id: string;
        updatedBy: string;
        content?: Json;
      })
) {
  if ("createdBy" in dispatch) {
    return client
      .from("maintenanceDispatch")
      .insert([
        { ...dispatch, severity: dispatch.severity ?? "Support Required" }
      ])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatch")
      .update(sanitize(dispatch))
      .eq("id", dispatch.id);
  }
}

export async function upsertMaintenanceDispatchComment(
  client: SupabaseClient<Database>,
  comment:
    | (Omit<z.infer<typeof maintenanceDispatchCommentValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchCommentValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in comment) {
    return client
      .from("maintenanceDispatchComment")
      .insert([comment])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchComment")
      .update(sanitize(comment))
      .eq("id", comment.id);
  }
}

export async function upsertMaintenanceDispatchEvent(
  client: SupabaseClient<Database>,
  event:
    | (Omit<z.infer<typeof maintenanceDispatchEventValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchEventValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in event) {
    return client
      .from("maintenanceDispatchEvent")
      .insert([event])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchEvent")
      .update(sanitize(event))
      .eq("id", event.id);
  }
}

export async function upsertMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  item:
    | (Omit<z.infer<typeof maintenanceDispatchItemValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchItemValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in item) {
    return client
      .from("maintenanceDispatchItem")
      .insert([item])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchItem")
      .update(sanitize(item))
      .eq("id", item.id);
  }
}

export async function upsertMaintenanceDispatchWorkCenter(
  client: SupabaseClient<Database>,
  workCenter:
    | (Omit<z.infer<typeof maintenanceDispatchWorkCenterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchWorkCenterValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in workCenter) {
    return client
      .from("maintenanceDispatchWorkCenter")
      .insert([workCenter])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchWorkCenter")
      .update(sanitize(workCenter))
      .eq("id", workCenter.id);
  }
}

export async function upsertMaintenanceSchedule(
  client: SupabaseClient<Database>,
  schedule:
    | (Omit<z.infer<typeof maintenanceScheduleValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceScheduleValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in schedule) {
    return client
      .from("maintenanceSchedule")
      .insert([schedule])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceSchedule")
      .update(sanitize(schedule))
      .eq("id", schedule.id);
  }
}

export async function upsertMaintenanceScheduleItem(
  client: SupabaseClient<Database>,
  item:
    | (Omit<z.infer<typeof maintenanceScheduleItemValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceScheduleItemValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in item) {
    return client
      .from("maintenanceScheduleItem")
      .insert([item])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceScheduleItem")
      .update(sanitize(item))
      .eq("id", item.id);
  }
}

export async function getPeopleAssignments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { locationId: string; date: string }
) {
  return client
    .from("peopleAssignment")
    .select(
      "id, workCenterId, employeeId, shiftId, note, date, overtimeHours, hours"
    )
    .eq("companyId", companyId)
    .eq("locationId", args.locationId)
    .eq("date", args.date);
}

export async function getPeopleAbsences(
  client: SupabaseClient<Database>,
  companyId: string,
  date: string
) {
  return client
    .from("peopleAbsence")
    .select("id, employeeId, shiftId, note, date")
    .eq("companyId", companyId)
    .eq("date", date);
}

export async function getPeopleAssignmentsRange(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { locationId: string; startDate: string; endDate: string }
) {
  return client
    .from("peopleAssignment")
    .select(
      "id, workCenterId, employeeId, shiftId, date, note, overtimeHours, hours"
    )
    .eq("companyId", companyId)
    .eq("locationId", args.locationId)
    .gte("date", args.startDate)
    .lte("date", args.endDate)
    .order("date")
    .order("shiftId", { nullsFirst: true });
}

export async function getPeopleAbsencesRange(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { startDate: string; endDate: string }
) {
  return client
    .from("peopleAbsence")
    .select("id, employeeId, shiftId, date")
    .eq("companyId", companyId)
    .gte("date", args.startDate)
    .lte("date", args.endDate);
}

/**
 * Open job-operation hours per work center for the capacity view. Draft and
 * Planned jobs are excluded — only released (firm) work counts toward load,
 * matching the industry release-gating convention. Paginated — the default
 * PostgREST max_rows (1000) would silently truncate a busy location.
 */
export async function getPeopleCapacityOperations(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { locationId: string; startDate: string | null; endDate: string }
) {
  return fetchAllFromTable<{
    id: string;
    workCenterId: string | null;
    dueDate: string | null;
    status: string;
    operationQuantity: number | null;
    setupTime: number;
    setupUnit: string;
    laborTime: number;
    laborUnit: string;
    machineTime: number;
    machineUnit: string;
  }>(
    client,
    "jobOperation",
    `id, workCenterId, dueDate, status, operationQuantity,
     setupTime, setupUnit, laborTime, laborUnit, machineTime, machineUnit,
     job!inner(status, locationId)`,
    (query) => {
      let scoped = query
        .eq("companyId", companyId)
        .eq("job.locationId", args.locationId)
        .not("workCenterId", "is", null)
        .lte("dueDate", args.endDate)
        .not("status", "in", '("Done","Canceled")')
        .not(
          "job.status",
          "in",
          '("Draft","Planned","Completed","Cancelled","Closed")'
        );
      // Null start = no floor: overdue work back to the earliest open op counts
      // toward Past due (the released-only status filters already bound the set).
      if (args.startDate != null) {
        scoped = scoped.gte("dueDate", args.startDate);
      }
      return scoped.order("id");
    }
  );
}

/**
 * The `workCenterShift` links (rung 1 of the availability ladder) for a set of
 * work centers, in ONE `.in()` query. Feeds the Capacity view's per-work-center
 * calendar-hours DISPLAY mirror of the engine ladder.
 */
export async function getWorkCenterShifts(
  client: SupabaseClient<Database>,
  companyId: string,
  workCenterIds: string[]
) {
  return client
    .from("workCenterShift")
    .select("workCenterId, shiftId")
    .eq("companyId", companyId)
    .in("workCenterId", workCenterIds);
}

/**
 * WorkCenter-kind reservations overlapping a window — the Capacity view's
 * Scheduled series. Bounded by the window (not "recent only") so earlier days
 * of the current week keep their completed bookings, filtered to WorkCenter
 * rows server-side, and paginated past the PostgREST max_rows cap.
 */
export async function getWorkCenterReservationsRange(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { startAt: string; endAt: string }
) {
  return fetchAllFromTable<{
    id: string;
    resourceId: string;
    startAt: string;
    endAt: string;
    workHours: number | null;
  }>(
    client,
    "capacityReservation",
    `id, resourceId, startAt, endAt, workHours, job!inner(status)`,
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("resourceKind", "WorkCenter")
        .is("scenarioId", null)
        // Placeholders mark unplaceable ops — not real bookings, so they must
        // not inflate the Capacity view's Scheduled load.
        .eq("isPlaceholder", false)
        .lt("startAt", args.endAt)
        .gt("endAt", args.startAt)
        .not("job.status", "in", '("Cancelled","Completed","Closed")')
        .order("id")
  );
}

export async function getLocationEmployees(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
) {
  return client
    .from("employees")
    .select("id, name, avatarUrl")
    .eq("companyId", companyId)
    .eq("locationId", locationId);
}

/**
 * Gated abilities per work center at a location, for the people board's
 * advisory qualification badge. Chained lookups instead of a PostgREST embed —
 * the composite tenant FKs break alias:fkColumn(...) embeds.
 */
export async function getWorkCenterRequiredAbilities(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string
): Promise<{
  data:
    | { workCenterId: string; abilityId: string; abilityName: string }[]
    | null;
  error: PostgrestError | null;
}> {
  const workCenters = await client
    .from("workCenter")
    .select("id")
    .eq("companyId", companyId)
    .eq("locationId", locationId);
  if (workCenters.error) return { data: null, error: workCenters.error };
  const workCenterIds = (workCenters.data ?? []).map((w) => w.id);
  if (workCenterIds.length === 0) return { data: [], error: null };

  const workCenterProcesses = await client
    .from("workCenterProcess")
    .select("workCenterId, processId")
    .eq("companyId", companyId)
    .in("workCenterId", workCenterIds);
  if (workCenterProcesses.error)
    return { data: null, error: workCenterProcesses.error };
  const processIds = [
    ...new Set((workCenterProcesses.data ?? []).map((r) => r.processId))
  ];
  if (processIds.length === 0) return { data: [], error: null };

  const processes = await client
    .from("process")
    .select("id, requiresAbility")
    .eq("companyId", companyId)
    .in("id", processIds);
  if (processes.error) return { data: null, error: processes.error };
  const gatedProcessIds = (processes.data ?? [])
    .filter((p) => p.requiresAbility)
    .map((p) => p.id);
  if (gatedProcessIds.length === 0) return { data: [], error: null };

  // The `abilities` view carries the name from the linked process.
  const abilities = await client
    .from("abilities")
    .select("id, name, processId")
    .eq("companyId", companyId)
    .eq("active", true)
    .in("processId", gatedProcessIds);
  if (abilities.error) return { data: null, error: abilities.error };
  const abilityByProcess = new Map(
    (abilities.data ?? [])
      .filter((a) => a.processId)
      .map((a) => [a.processId as string, a])
  );

  const rows = (workCenterProcesses.data ?? []).flatMap(
    ({ workCenterId, processId }) => {
      const ability = abilityByProcess.get(processId);
      return ability
        ? [
            {
              workCenterId,
              abilityId: ability.id ?? "",
              abilityName: ability.name ?? ""
            }
          ]
        : [];
    }
  );
  return { data: rows, error: null };
}

export async function getActiveEmployeeAbilities(
  client: SupabaseClient<Database>,
  companyId: string
) {
  // Qualification is presence-based: any employeeAbility row counts (subject
  // only to expiry, applied by the caller). The ability name rides along so the
  // people board can badge each person with what they can do.
  return client
    .from("employeeAbility")
    .select("employeeId, abilityId, expiresAt, ability(process(name))")
    .eq("companyId", companyId);
}

/**
 * Filter `peopleAssignment` rows to those whose EFFECTIVE shift is `shiftId`:
 * the row's stamped shift, or — for shift-less rows — the person's own
 * `employeeShift`. The same ladder the boards' shift filter displays through,
 * so a row a filtered board shows is always a row its mutations can reach.
 */
function whereEffectiveShift(shiftId: string, companyId: string) {
  return (eb: ExpressionBuilder<KyselyDatabase, "peopleAssignment">) =>
    eb.or([
      eb("shiftId", "=", shiftId),
      eb.and([
        eb("shiftId", "is", null),
        eb(
          "employeeId",
          "in",
          eb
            .selectFrom("employeeShift")
            .select("employeeId")
            .where("shiftId", "=", shiftId)
            .where("companyId", "=", companyId)
        )
      ])
    ]);
}

/**
 * The people-board mutations write caller-supplied ids through Kysely (no
 * RLS), and the API dispatcher reaches them without the board route's own
 * check, so every referenced row must belong to `companyId` — the employee
 * as an employee of the company. One query per table; absent refs are skipped.
 * Throws, like the Kysely callers it guards.
 */
async function requirePeopleBoardRefs(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  refs: {
    employeeId?: string;
    locationId?: string;
    shiftId?: string | null;
    workCenterIds?: string[];
  }
) {
  const workCenterIds = [...new Set(refs.workCenterIds ?? [])];
  const [employee, location, shift, workCenters] = await Promise.all([
    refs.employeeId
      ? db
          .selectFrom("employee")
          .select("id")
          .where("id", "=", refs.employeeId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : null,
    refs.locationId
      ? db
          .selectFrom("location")
          .select("id")
          .where("id", "=", refs.locationId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : null,
    refs.shiftId
      ? db
          .selectFrom("shift")
          .select("id")
          .where("id", "=", refs.shiftId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : null,
    workCenterIds.length > 0
      ? db
          .selectFrom("workCenter")
          .select("id")
          .where("id", "in", workCenterIds)
          .where("companyId", "=", companyId)
          .execute()
      : []
  ]);
  if (
    (refs.employeeId && !employee) ||
    (refs.locationId && !location) ||
    (refs.shiftId && !shift) ||
    workCenters.length !== workCenterIds.length
  ) {
    logger.error("People board reference is not in the caller's company", {
      companyId,
      refs
    });
    throw new Error("Not found");
  }
}

/**
 * Move-semantics upsert: one magnet per person per date/shift — any existing
 * assignment for the person on that date/shift is replaced.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function upsertPeopleAssignment(
  db: Kysely<KyselyDatabase>,
  assignment: {
    companyId: string;
    locationId: string;
    workCenterId: string;
    employeeId: string;
    date: string;
    shiftId: string | null;
    note?: string;
    /** partial-day remainder; undefined = whole shift (replaces other rows) */
    hours?: number;
    createdBy: string;
  }
) {
  await requirePeopleBoardRefs(db, assignment.companyId, {
    employeeId: assignment.employeeId,
    locationId: assignment.locationId,
    shiftId: assignment.shiftId,
    workCenterIds: [assignment.workCenterId]
  });
  if (assignment.hours !== undefined) {
    // remainder assignment: ADD hours at this station without touching the
    // person's other stations; same-station rows merge their hours
    return db.transaction().execute(async (trx) => {
      let existing = trx
        .selectFrom("peopleAssignment")
        .select(["id", "hours"])
        .where("companyId", "=", assignment.companyId)
        .where("employeeId", "=", assignment.employeeId)
        .where("date", "=", assignment.date)
        .where("workCenterId", "=", assignment.workCenterId);
      existing = assignment.shiftId
        ? existing.where(
            whereEffectiveShift(assignment.shiftId, assignment.companyId)
          )
        : existing.where("shiftId", "is", null);
      const row = await existing.executeTakeFirst();
      if (row) {
        return trx
          .updateTable("peopleAssignment")
          .set({
            hours:
              row.hours === null
                ? null
                : Number(row.hours) + (assignment.hours ?? 0)
          })
          .where("id", "=", row.id)
          .where("companyId", "=", assignment.companyId)
          .returning(["id", "workCenterId"])
          .executeTakeFirstOrThrow();
      }
      return trx
        .insertInto("peopleAssignment")
        .values({
          companyId: assignment.companyId,
          locationId: assignment.locationId,
          workCenterId: assignment.workCenterId,
          employeeId: assignment.employeeId,
          date: assignment.date,
          shiftId: assignment.shiftId,
          note: assignment.note ?? null,
          hours: assignment.hours,
          createdBy: assignment.createdBy
        })
        .returning(["id", "workCenterId"])
        .executeTakeFirstOrThrow();
    });
  }
  return db.transaction().execute(async (trx) => {
    // Every read AND write here is location-scoped: the board is per-location,
    // so a person assigned at another site must never be read from or deleted by
    // an action taken on this one.
    let existing = trx
      .selectFrom("peopleAssignment")
      .select("overtimeHours")
      .where("companyId", "=", assignment.companyId)
      .where("locationId", "=", assignment.locationId)
      .where("employeeId", "=", assignment.employeeId)
      .where("date", "=", assignment.date);
    existing = assignment.shiftId
      ? existing.where(
          whereEffectiveShift(assignment.shiftId, assignment.companyId)
        )
      : existing.where("shiftId", "is", null);
    // moving stations keeps the person's authorized overtime for that day
    const carriedOvertime = (await existing.executeTakeFirst())?.overtimeHours;

    let del = trx
      .deleteFrom("peopleAssignment")
      .where("companyId", "=", assignment.companyId)
      .where("locationId", "=", assignment.locationId)
      .where("employeeId", "=", assignment.employeeId)
      .where("date", "=", assignment.date);
    del = assignment.shiftId
      ? del.where(whereEffectiveShift(assignment.shiftId, assignment.companyId))
      : del.where("shiftId", "is", null);
    await del.execute();
    return trx
      .insertInto("peopleAssignment")
      .values({
        companyId: assignment.companyId,
        locationId: assignment.locationId,
        workCenterId: assignment.workCenterId,
        employeeId: assignment.employeeId,
        date: assignment.date,
        shiftId: assignment.shiftId,
        note: assignment.note ?? null,
        overtimeHours: carriedOvertime ?? 0,
        createdBy: assignment.createdBy
      })
      .returning(["id", "workCenterId"])
      .executeTakeFirstOrThrow();
  });
}

/** The write only; `production.people.*` also checks the board's ids and reschedules. */
export async function deletePeopleAssignment(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("peopleAssignment")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id, workCenterId, employeeId")
    .single();
}

/** The write only; `production.people.*` also checks the board's ids and reschedules. */
export async function setPeopleAbsence(
  client: SupabaseClient<Database>,
  absence: {
    companyId: string;
    employeeId: string;
    date: string;
    shiftId: string | null;
    note?: string;
    createdBy: string;
  }
) {
  return client.from("peopleAbsence").insert([absence]).select("id").single();
}

/** The write only; `production.people.*` also checks the board's ids and reschedules. */
export async function clearPeopleAbsence(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("peopleAbsence")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id, employeeId")
    .single();
}

/**
 * Copy one day's people board to another date, skipping people already assigned
 * on the target date or marked absent there.
 */
/**
 * Move one assignment row to another station (drag = move). If the person
 * already has a row at the target station for the same shift/date, the rows
 * merge (hours add; a whole-shift row absorbs the other).
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function movePeopleAssignment(
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string; workCenterId: string }
) {
  await requirePeopleBoardRefs(db, args.companyId, {
    workCenterIds: [args.workCenterId]
  });
  return db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom("peopleAssignment")
      .selectAll()
      .where("id", "=", args.id)
      .where("companyId", "=", args.companyId)
      .executeTakeFirstOrThrow();

    // merge with target rows sharing the source's EFFECTIVE shift — a
    // shift-less row belongs to the person's own shift, like the boards show it
    const effectiveShiftId =
      source.shiftId ??
      (
        await trx
          .selectFrom("employeeShift")
          .select("shiftId")
          .where("employeeId", "=", source.employeeId)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
      )?.shiftId ??
      null;
    let targetQuery = trx
      .selectFrom("peopleAssignment")
      .select(["id", "hours"])
      .where("companyId", "=", args.companyId)
      .where("employeeId", "=", source.employeeId)
      .where("date", "=", source.date)
      .where("workCenterId", "=", args.workCenterId);
    targetQuery = effectiveShiftId
      ? targetQuery.where(whereEffectiveShift(effectiveShiftId, args.companyId))
      : targetQuery.where("shiftId", "is", null);
    const target = await targetQuery.executeTakeFirst();

    if (target) {
      const mergedHours =
        source.hours === null || target.hours === null
          ? null
          : Number(source.hours) + Number(target.hours);
      await trx
        .updateTable("peopleAssignment")
        .set({ hours: mergedHours })
        .where("id", "=", target.id)
        .where("companyId", "=", args.companyId)
        .execute();
      await trx
        .deleteFrom("peopleAssignment")
        .where("id", "=", source.id)
        .where("companyId", "=", args.companyId)
        .execute();
      return {
        id: target.id,
        workCenterId: args.workCenterId,
        previousWorkCenterId: source.workCenterId
      };
    }

    const moved = await trx
      .updateTable("peopleAssignment")
      .set({ workCenterId: args.workCenterId })
      .where("id", "=", source.id)
      .where("companyId", "=", args.companyId)
      .returning(["id", "workCenterId"])
      .executeTakeFirstOrThrow();
    return { ...moved, previousWorkCenterId: source.workCenterId };
  });
}

/**
 * Atomically make the given rows a person's day: existing rows at kept
 * stations are updated (hours/overtime), new stations inserted, stations
 * not in `rows` deleted. Scoped to the shift when one is given. One
 * transaction — the Working-hours popover's Save.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function setPeopleDay(
  db: Kysely<KyselyDatabase>,
  /** the authenticated user — filled by the caller, never the payload */
  userId: string,
  args: {
    companyId: string;
    locationId: string;
    employeeId: string;
    date: string;
    shiftId: string | null;
    /** day-scoped note, written to every surviving row of the day */
    note: string | null;
    /**
     * Day-scoped overtime, written to every surviving row of the day. The
     * scheduler reads the MAX across a day's rows (never the sum), so 2h of
     * overtime stays 2h however many stations the person splits across.
     */
    overtimeHours: number;
    rows: {
      workCenterId: string;
      hours: number | null;
    }[];
  }
) {
  await requirePeopleBoardRefs(db, args.companyId, {
    employeeId: args.employeeId,
    locationId: args.locationId,
    shiftId: args.shiftId,
    workCenterIds: args.rows.map((row) => row.workCenterId)
  });
  return db.transaction().execute(async (trx) => {
    // location-scoped: the rows this reconciliation may DELETE must be limited
    // to the board the edit was made on
    let existingQuery = trx
      .selectFrom("peopleAssignment")
      .select(["id", "workCenterId"])
      .where("companyId", "=", args.companyId)
      .where("locationId", "=", args.locationId)
      .where("employeeId", "=", args.employeeId)
      .where("date", "=", args.date);
    if (args.shiftId) {
      existingQuery = existingQuery.where(
        whereEffectiveShift(args.shiftId, args.companyId)
      );
    }
    const existing = await existingQuery.execute();
    const existingByStation = new Map(
      existing.map((row) => [row.workCenterId, row.id])
    );
    const keptStations = new Set(args.rows.map((row) => row.workCenterId));

    for (const row of args.rows) {
      const id = existingByStation.get(row.workCenterId);
      if (id) {
        await trx
          .updateTable("peopleAssignment")
          .set({
            hours: row.hours,
            overtimeHours: args.overtimeHours,
            note: args.note,
            updatedBy: userId,
            updatedAt: new Date().toISOString()
          })
          .where("id", "=", id)
          .where("companyId", "=", args.companyId)
          .execute();
      } else {
        await trx
          .insertInto("peopleAssignment")
          .values({
            companyId: args.companyId,
            locationId: args.locationId,
            workCenterId: row.workCenterId,
            employeeId: args.employeeId,
            date: args.date,
            shiftId: args.shiftId,
            hours: row.hours,
            overtimeHours: args.overtimeHours,
            note: args.note,
            createdBy: userId
          })
          .execute();
      }
    }

    const removed = existing.filter(
      (row) => !keptStations.has(row.workCenterId)
    );
    for (const row of removed) {
      await trx
        .deleteFrom("peopleAssignment")
        .where("id", "=", row.id)
        .where("companyId", "=", args.companyId)
        .execute();
    }
    return {
      updated: args.rows.length,
      removed: removed.length
    };
  });
}

/**
 * Set the hours an assignment occupies at its station (null = the whole
 * shift). Lowering hours releases the remainder back to the board's
 * free-hours pool; splitting across stations = lower here, then drag the
 * remainder card to the next station.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function setPeopleAssignmentHours(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { id: string; hours: number | null; updatedBy: string }
) {
  return client
    .from("peopleAssignment")
    .update({
      hours: args.hours,
      updatedBy: args.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.id)
    .eq("companyId", companyId)
    .select("id, workCenterId, date")
    .single();
}

/**
 * Authorize overtime for every assignment on a date, optionally scoped to a
 * department (via the location's work centers) and/or a shift. One UPDATE so
 * partial application can't happen; department resolves server-side (never a
 * client-supplied work-center list).
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function setPeopleOvertimeBulk(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    locationId: string;
    date: string;
    /** inclusive end of the range; omitted = the single `date` only */
    toDate?: string | null;
    hours: number;
    shiftId?: string | null;
    departmentId?: string | null;
    updatedBy: string;
  }
) {
  return db.transaction().execute(async (trx) => {
    let query = trx
      .updateTable("peopleAssignment")
      .set({
        overtimeHours: args.hours,
        updatedBy: args.updatedBy,
        updatedAt: new Date().toISOString()
      })
      .where("companyId", "=", args.companyId)
      .where("locationId", "=", args.locationId);
    query = args.toDate
      ? query.where("date", ">=", args.date).where("date", "<=", args.toDate)
      : query.where("date", "=", args.date);
    if (args.shiftId) {
      query = query.where(whereEffectiveShift(args.shiftId, args.companyId));
    }
    if (args.departmentId) {
      const departmentId = args.departmentId;
      query = query.where("workCenterId", "in", (eb) =>
        eb
          .selectFrom("workCenter")
          .select("id")
          .where("companyId", "=", args.companyId)
          .where("departmentId", "=", departmentId)
      );
    }
    return query.returning(["id", "workCenterId"]).execute();
  });
}

/** The write only; `production.people.*` also checks the board's ids and reschedules. */
export async function copyPeopleBoard(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    locationId: string;
    fromDate: string;
    toDate: string;
    shiftId: string | null;
    createdBy: string;
  }
) {
  return db.transaction().execute(async (trx) => {
    const result = await copyPeopleDayInTransaction(trx, args);
    return result;
  });
}

/** One day's copy inside an open transaction — shared by day and week copy.
 * Splits (`hours`) copy with the assignment; overtime deliberately does not
 * (it's a per-day authorization). */
async function copyPeopleDayInTransaction(
  trx: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    locationId: string;
    fromDate: string;
    toDate: string;
    shiftId: string | null;
    createdBy: string;
  }
) {
  let sourceQuery = trx
    .selectFrom("peopleAssignment")
    .select(["workCenterId", "employeeId", "shiftId", "note", "hours"])
    .where("companyId", "=", args.companyId)
    .where("locationId", "=", args.locationId)
    .where("date", "=", args.fromDate);
  if (args.shiftId) {
    sourceQuery = sourceQuery.where(
      whereEffectiveShift(args.shiftId, args.companyId)
    );
  }
  const source = await sourceQuery.execute();

  const [existing, absences] = await Promise.all([
    // location-scoped: a person assigned at ANOTHER site on the target date must
    // not silently suppress the copy on this board
    trx
      .selectFrom("peopleAssignment")
      .select(["employeeId"])
      .where("companyId", "=", args.companyId)
      .where("locationId", "=", args.locationId)
      .where("date", "=", args.toDate)
      .execute(),
    // peopleAbsence has no locationId — a person is absent company-wide
    trx
      .selectFrom("peopleAbsence")
      .select(["employeeId"])
      .where("companyId", "=", args.companyId)
      .where("date", "=", args.toDate)
      .execute()
  ]);
  const skip = new Set([
    ...existing.map((r) => r.employeeId),
    ...absences.map((r) => r.employeeId)
  ]);

  const rows = source
    .filter((r) => !skip.has(r.employeeId))
    .map((r) => ({
      companyId: args.companyId,
      locationId: args.locationId,
      workCenterId: r.workCenterId,
      employeeId: r.employeeId,
      date: args.toDate,
      shiftId: r.shiftId,
      note: r.note,
      hours: r.hours,
      createdBy: args.createdBy
    }));
  if (rows.length > 0) {
    await trx.insertInto("peopleAssignment").values(rows).execute();
  }
  return { copied: rows.length, skipped: source.length - rows.length };
}

const addIsoDays = (date: string, days: number) =>
  parseDate(date).add({ days }).toString();

// pg returns DATE columns as JS Date objects at server-local midnight —
// normalize with local getters, never toISOString (UTC shift can move the day)
const toIsoDate = (value: unknown) => {
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value as Date);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
};

/**
 * Assign a person to a station for a whole Monday-start week: one row per
 * working day (the shift's weekdays when a shift is given, Mon–Fri
 * otherwise), skipping days where they're absent or already assigned.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function assignPeopleWeek(
  db: Kysely<KyselyDatabase>,
  /** the authenticated user — filled by the caller, never the payload */
  userId: string,
  args: {
    companyId: string;
    locationId: string;
    employeeId: string;
    workCenterId: string;
    weekStart: string;
    shiftId: string | null;
  }
) {
  await requirePeopleBoardRefs(db, args.companyId, {
    employeeId: args.employeeId,
    locationId: args.locationId,
    shiftId: args.shiftId,
    workCenterIds: [args.workCenterId]
  });
  return db.transaction().execute(async (trx) => {
    // working days: the chosen shift's weekdays → the person's own shift's
    // weekdays → Mon–Fri
    let activeWeekdays: readonly string[] = WEEKDAYS_MONDAY_FIRST.slice(0, 5);
    let shift: Record<string, boolean | null> | undefined;
    if (args.shiftId) {
      shift = await trx
        .selectFrom("shift")
        .select([
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday"
        ])
        .where("id", "=", args.shiftId)
        .where("companyId", "=", args.companyId)
        .executeTakeFirst();
    } else {
      shift = await trx
        .selectFrom("employeeShift")
        .innerJoin("shift", "shift.id", "employeeShift.shiftId")
        .select([
          "shift.monday",
          "shift.tuesday",
          "shift.wednesday",
          "shift.thursday",
          "shift.friday",
          "shift.saturday",
          "shift.sunday"
        ])
        .where("employeeShift.employeeId", "=", args.employeeId)
        .where("employeeShift.companyId", "=", args.companyId)
        .where("shift.companyId", "=", args.companyId)
        .executeTakeFirst();
    }
    if (shift) {
      activeWeekdays = WEEKDAYS_MONDAY_FIRST.filter((day) => shift?.[day]);
    }
    const weekEnd = addIsoDays(args.weekStart, 6);
    const [existing, absences] = await Promise.all([
      // Company-wide (NOT location-scoped): the unique index is
      // peopleAssignment_person_day_key (companyId, employeeId, date,
      // COALESCE(shiftId,'')) — a person already booked for this day+shift at
      // ANY location/station collides, so a location-scoped skip let the bulk
      // insert violate the constraint and fail the whole week assignment.
      trx
        .selectFrom("peopleAssignment")
        .select(["date", "shiftId"])
        .where("companyId", "=", args.companyId)
        .where("employeeId", "=", args.employeeId)
        .where("date", ">=", args.weekStart)
        .where("date", "<=", weekEnd)
        .execute(),
      trx
        .selectFrom("peopleAbsence")
        .select(["date"])
        .where("companyId", "=", args.companyId)
        .where("employeeId", "=", args.employeeId)
        .where("date", ">=", args.weekStart)
        .where("date", "<=", weekEnd)
        .execute()
    ]);
    // Key on date + shift to mirror the unique index exactly.
    const slotKey = (date: string, shiftId: string | null) =>
      `${date}:${shiftId ?? ""}`;
    const takenSlots = new Set(
      existing.map((row) => slotKey(toIsoDate(row.date), row.shiftId))
    );
    const absentDays = new Set(absences.map((row) => toIsoDate(row.date)));

    const rows = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = addIsoDays(args.weekStart, offset);
      // weekStart is a Monday, so offset maps 1:1 onto WEEKDAYS_MONDAY_FIRST
      if (!activeWeekdays.includes(WEEKDAYS_MONDAY_FIRST[offset])) continue;
      if (absentDays.has(date)) continue;
      if (takenSlots.has(slotKey(date, args.shiftId))) continue;
      rows.push({
        companyId: args.companyId,
        locationId: args.locationId,
        workCenterId: args.workCenterId,
        employeeId: args.employeeId,
        date,
        shiftId: args.shiftId,
        createdBy: userId
      });
    }
    if (rows.length > 0) {
      await trx.insertInto("peopleAssignment").values(rows).execute();
    }
    return {
      assigned: rows.length,
      skipped: takenSlots.size + absentDays.size
    };
  });
}

/**
 * Remove a person from a station for the whole week (their other stations
 * and other weeks are untouched).
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function unassignPeopleWeek(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    employeeId: string;
    workCenterId: string;
    weekStart: string;
    shiftId: string | null;
  }
) {
  let query = db
    .deleteFrom("peopleAssignment")
    .where("companyId", "=", args.companyId)
    .where("employeeId", "=", args.employeeId)
    .where("workCenterId", "=", args.workCenterId)
    .where("date", ">=", args.weekStart)
    .where("date", "<=", addIsoDays(args.weekStart, 6));
  if (args.shiftId) {
    query = query.where(whereEffectiveShift(args.shiftId, args.companyId));
  }
  return query.execute();
}

/**
 * Move a person's whole week from one station to another. Days where they
 * already have a row at the target station keep the target row (the source
 * row is dropped); other days simply change station.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function movePeopleWeek(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    employeeId: string;
    fromWorkCenterId: string;
    workCenterId: string;
    weekStart: string;
    shiftId: string | null;
  }
) {
  await requirePeopleBoardRefs(db, args.companyId, {
    workCenterIds: [args.workCenterId]
  });
  const weekEnd = addIsoDays(args.weekStart, 6);
  return db.transaction().execute(async (trx) => {
    let sourceQuery = trx
      .selectFrom("peopleAssignment")
      .select(["id", "date", "shiftId"])
      .where("companyId", "=", args.companyId)
      .where("employeeId", "=", args.employeeId)
      .where("workCenterId", "=", args.fromWorkCenterId)
      .where("date", ">=", args.weekStart)
      .where("date", "<=", weekEnd);
    if (args.shiftId) {
      sourceQuery = sourceQuery.where(
        whereEffectiveShift(args.shiftId, args.companyId)
      );
    }
    const source = await sourceQuery.execute();

    const target = await trx
      .selectFrom("peopleAssignment")
      .select(["date", "shiftId"])
      .where("companyId", "=", args.companyId)
      .where("employeeId", "=", args.employeeId)
      .where("workCenterId", "=", args.workCenterId)
      .where("date", ">=", args.weekStart)
      .where("date", "<=", weekEnd)
      .execute();
    const occupied = new Set(
      target.map((row) => `${toIsoDate(row.date)}:${row.shiftId ?? ""}`)
    );

    let moved = 0;
    for (const row of source) {
      if (occupied.has(`${toIsoDate(row.date)}:${row.shiftId ?? ""}`)) {
        await trx
          .deleteFrom("peopleAssignment")
          .where("id", "=", row.id)
          .where("companyId", "=", args.companyId)
          .execute();
      } else {
        await trx
          .updateTable("peopleAssignment")
          .set({ workCenterId: args.workCenterId })
          .where("id", "=", row.id)
          .where("companyId", "=", args.companyId)
          .execute();
        moved += 1;
      }
    }
    return { moved, merged: source.length - moved };
  });
}

/**
 * Copy a whole Monday-start week of people assignments onto another week,
 * day by day, with the same skip rules as the day copy (people already
 * assigned or absent on the target date are left alone). One transaction.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function copyPeopleWeek(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    locationId: string;
    fromWeekStart: string;
    toWeekStart: string;
    shiftId: string | null;
    createdBy: string;
  }
) {
  const addDays = (date: string, days: number) =>
    parseDate(date).add({ days }).toString();
  return db.transaction().execute(async (trx) => {
    let copied = 0;
    let skipped = 0;
    for (let offset = 0; offset < 7; offset++) {
      const result = await copyPeopleDayInTransaction(trx, {
        companyId: args.companyId,
        locationId: args.locationId,
        fromDate: addDays(args.fromWeekStart, offset),
        toDate: addDays(args.toWeekStart, offset),
        shiftId: args.shiftId,
        createdBy: args.createdBy
      });
      copied += result.copied;
      skipped += result.skipped;
    }
    return { copied, skipped };
  });
}

/**
 * Mark a person absent for every date in [fromDate, toDate] (vacation as one
 * action). Dates that already carry an absence for the person are skipped.
 * Not published: `production.people.*` also checks the board's ids and reschedules.
 */
export async function setPeopleAbsenceRange(
  db: Kysely<KyselyDatabase>,
  /** the authenticated user — filled by the caller, never the payload */
  userId: string,
  args: {
    companyId: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    shiftId: string | null;
    note?: string;
  }
) {
  await requirePeopleBoardRefs(db, args.companyId, {
    employeeId: args.employeeId,
    shiftId: args.shiftId
  });
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("peopleAbsence")
      .select(["date"])
      .where("companyId", "=", args.companyId)
      .where("employeeId", "=", args.employeeId)
      .where("date", ">=", args.fromDate)
      .where("date", "<=", args.toDate)
      .execute();
    const have = new Set(existing.map((row) => toIsoDate(row.date)));

    const rows: {
      companyId: string;
      employeeId: string;
      date: string;
      shiftId: string | null;
      note: string | null;
      createdBy: string;
    }[] = [];
    for (
      let day = parseDate(args.fromDate);
      day.compare(parseDate(args.toDate)) <= 0;
      day = day.add({ days: 1 })
    ) {
      const date = day.toString();
      if (have.has(date)) continue;
      rows.push({
        companyId: args.companyId,
        employeeId: args.employeeId,
        date,
        shiftId: args.shiftId,
        note: args.note ?? null,
        createdBy: userId
      });
    }
    if (rows.length > 0) {
      await trx.insertInto("peopleAbsence").values(rows).execute();
    }
    return { created: rows.length, skipped: have.size };
  });
}

/**
 * Trigger a job scheduling task via Inngest.
 * Supports both initial scheduling and rescheduling.
 */
/**
 * Reactive replanning: notify that a scheduling INPUT changed (shift,
 * qualification, work center, location). Marks the company's active jobs
 * schedule-outdated immediately and schedules a debounced replan wave.
 *
 * Every caller sends it after its write has landed, so a failed send is
 * logged and returned as `false`, never thrown: the change stands either way.
 */
export async function notifyScheduleInputsChanged(
  companyId: string,
  kind:
    | "ability"
    | "shift"
    | "employee-shift"
    | "work-center"
    | "location"
    | "reorder"
    | "people",
  reason: string,
  entityId?: string
): Promise<boolean> {
  try {
    const { trigger } = await import("@carbon/jobs");
    await trigger("schedule-inputs-changed", {
      companyId,
      kind,
      reason,
      entityId
    });
    return true;
  } catch (error) {
    logger.error("Failed to notify the scheduler", {
      companyId,
      kind,
      reason,
      entityId,
      error
    });
    return false;
  }
}

// --- Job operation batching (spec: .ai/specs/2026-08-21-job-operation-batching.md) ---
// Execution lives in MES (the operation view's batch mode); ERP composes
// batches on the schedule board, mutates them via the batch-operations server fn,
// and lists past/active batches at /x/production/batches.

// Count of operations that COULD be batched but aren't yet — unbatched ops on a
// batchable process, still open (Todo/Ready/Waiting), on a live (non-terminal)
// job. Mirrors the unbatched-candidate branch of get_batchable_operations (the
// batch builder's candidate query) so the dashboard number matches what the
// builder surfaces. Head count only — no rows. !inner turns the nested filters
// on process/job into real join predicates that constrain the count.
export async function getUnbatchedBatchableOperationCount(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("jobOperation")
    .select("id, process!inner(batchable), job!inner(status)", {
      count: "exact",
      head: true
    })
    .eq("companyId", companyId)
    .is("jobOperationBatchId", null)
    .eq("process.batchable", true)
    .in("status", ["Todo", "Ready", "Waiting"])
    .not("job.status", "in", "(Completed,Closed,Cancelled)");
}

export async function getJobOperationBatches(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("jobOperationBatch")
    .select("*, process(name), workCenter(name)", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("readableId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

// The filters the Unattributed Time list and its review queue share. The
// query reads the view `unattributedMachineTimes` (for `startDate` and
// `endDate`) and must embed `workCenter!inner(name, locationId)`: the search
// and the location filter read the work center. `workCenterId` is NOT NULL, so the
// inner join drops no row.
type MachineTimeFilterableQuery<Q> = {
  ilike(column: string, pattern: string): Q;
  in(column: string, values: readonly string[]): Q;
  gte(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: null): Q;
};

export function applyMachineTimeListFilters<
  Q extends MachineTimeFilterableQuery<Q>
>(query: Q, filters: MachineTimeListFilters): Q {
  let filtered = query;
  if (filters.search) {
    filtered = filtered.ilike("workCenter.name", `%${filters.search}%`);
  }
  if (filters.workCenterIds.length > 0) {
    filtered = filtered.in("workCenterId", filters.workCenterIds);
  }
  if (filters.locationIds.length > 0) {
    filtered = filtered.in("workCenter.locationId", filters.locationIds);
  }
  // Days in the row's location timezone: the view's `startDate`/`endDate`.
  if (filters.start.from)
    filtered = filtered.gte("startDate", filters.start.from);
  if (filters.start.to) filtered = filtered.lte("startDate", filters.start.to);
  if (filters.end.from) filtered = filtered.gte("endDate", filters.end.from);
  if (filters.end.to) filtered = filtered.lte("endDate", filters.end.to);
  if (filters.state === "Running") filtered = filtered.is("endTime", null);
  if (filters.state === "Stopped") {
    filtered = filtered.not("endTime", "is", null);
  }
  return filtered;
}

// Machine run time the OEE sync could not attribute to a loaded operation,
// newest start first, then `id`: the review queue walks the same order.
export async function getUnattributedMachineTimes(
  client: SupabaseClient<Database>,
  companyId: string,
  args: {
    filters: MachineTimeListFilters;
    limit: number;
    offset: number;
  }
) {
  let query = applyMachineTimeListFilters(
    client
      .from("unattributedMachineTimes")
      .select(
        "*, workCenter!inner(name, locationId, location(name, timezone))",
        {
          count: LIST_COUNT
        }
      )
      .eq("companyId", companyId),
    args.filters
  );

  // No `filters` and no `sorts`: the filters above replace the generic ones,
  // and the list allows no column sort.
  query = setGenericQueryFilters(
    query,
    { limit: args.limit, offset: args.offset },
    [
      { column: "startTime", ascending: false },
      { column: "id", ascending: false }
    ]
  );

  // A view types every column nullable; these come from the table's own
  // NOT NULL columns.
  return query.overrideTypes<
    Database["public"]["Tables"]["unattributedMachineTime"]["Row"][]
  >();
}

export async function getUnattributedMachineTime(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("unattributedMachineTime")
    .select("*, workCenter!inner(name, locationId)")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

// Where a row sits in the queue, in the list's order (newest start first,
// then `id`) and under the list's search and filters: its position, the
// total, and its neighbours above and below. The queue holds stopped rows
// only, whatever the State filter says: a running row cannot be answered. So a
// running row has no position, but its neighbours are still the stopped rows
// around it.
export async function getUnattributedMachineTimeNeighbors(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    id: string;
    startTime: string;
    endTime: string | null;
    filters: MachineTimeListFilters;
  }
) {
  const keyset = machineTimeQueueKeyset(args);
  const queue = (options?: { count: "exact"; head: true }) =>
    applyMachineTimeListFilters(
      client
        .from("unattributedMachineTimes")
        .select("id, workCenter!inner(name, locationId)", options)
        .eq("companyId", args.companyId)
        .not("endTime", "is", null),
      args.filters
    );

  const [total, above, previous, next] = await Promise.all([
    queue({ count: "exact", head: true }),
    queue({ count: "exact", head: true }).or(keyset.above),
    queue()
      .or(keyset.above)
      .order("startTime", { ascending: true })
      .order("id", { ascending: true })
      .limit(1),
    queue()
      .or(keyset.below)
      .order("startTime", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
  ]);

  const error = total.error ?? above.error ?? previous.error ?? next.error;
  if (error) return { data: null, error };

  return {
    data: {
      position: args.endTime ? (above.count ?? 0) + 1 : null,
      total: total.count ?? 0,
      previousId: previous.data?.[0]?.id ?? null,
      nextId: next.data?.[0]?.id ?? null
    },
    error: null
  };
}

// The operation a supervisor assigns machine time to, with its job. The id
// comes from the form, so the read is scoped to the company.
export async function getMachineTimeAssignTarget(
  client: SupabaseClient<Database>,
  args: { jobOperationId: string; companyId: string }
) {
  return client
    .from("jobOperation")
    .select("id, job!inner(jobId, status)")
    .eq("id", args.jobOperationId)
    .eq("companyId", args.companyId)
    .maybeSingle();
}

// Every production event on the work center that overlaps the window (the
// days of the unattributed time), with its operation and job: what ran there,
// for the suggestion cards.
export async function getWorkCenterDayEvents(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    workCenterId: string;
    dayStart: string;
    dayEnd: string;
  }
) {
  return client
    .from("productionEvent")
    .select(
      "jobOperationId, startTime, endTime, jobOperation(id, description, status, job(id, jobId, status, item(readableIdWithRevision)))"
    )
    .eq("companyId", args.companyId)
    .eq("workCenterId", args.workCenterId)
    .lt("startTime", args.dayEnd)
    .or(`endTime.is.null,endTime.gt."${args.dayStart}"`)
    .order("startTime", { ascending: true })
    .limit(1000);
}

// The operations a supervisor can search to assign machine time to: open
// operations on open jobs at the work center's location (or on the work
// center itself when it has no location), this work center's first, In
// Progress next, then the most recent production event there.
export async function getMachineTimeOperationCandidates(
  client: SupabaseClient<Database>,
  args: { workCenterId: string; locationId: string | null; companyId: string }
) {
  const operationSelect =
    "id, description, status, workCenterId, workCenter(name), job!inner(jobId, locationId, status)";
  const lockedJobStatuses = `(${JOB_LOCKED_STATUSES.join(",")})`;

  const [here, elsewhere, events] = await Promise.all([
    client
      .from("jobOperation")
      .select(operationSelect)
      .eq("companyId", args.companyId)
      .eq("workCenterId", args.workCenterId)
      .not("status", "in", "(Done,Canceled)")
      .not("job.status", "in", lockedJobStatuses)
      .limit(1000),
    args.locationId
      ? client
          .from("jobOperation")
          .select(operationSelect)
          .eq("companyId", args.companyId)
          .eq("job.locationId", args.locationId)
          // `neq` alone drops an operation with no work center (NULL).
          .or(`workCenterId.is.null,workCenterId.neq.${args.workCenterId}`)
          .not("status", "in", "(Done,Canceled)")
          .not("job.status", "in", lockedJobStatuses)
          // The rank below sets the order; this one decides which rows the
          // cap keeps: the most recently touched.
          .order("updatedAt", { ascending: false })
          .limit(1000)
      : null,
    client
      .from("productionEvent")
      .select("jobOperationId, startTime")
      .eq("workCenterId", args.workCenterId)
      .eq("companyId", args.companyId)
      .order("startTime", { ascending: false })
      .limit(200)
  ]);

  if (here.error) return { data: null, error: here.error };
  if (elsewhere?.error) return { data: null, error: elsewhere.error };
  if (events.error) return { data: null, error: events.error };

  // This work center's operations first, then the rest of the location.
  const operations = [...(here.data ?? []), ...(elsewhere?.data ?? [])];

  // Events arrive latest first, so the first start seen per operation is its
  // latest. ISO timestamps from PostgREST share one format, so string order is
  // chronological.
  const latestEventStart = new Map<string, string>();
  for (const event of events.data ?? []) {
    if (!latestEventStart.has(event.jobOperationId)) {
      latestEventStart.set(event.jobOperationId, event.startTime);
    }
  }

  const rank = (operation: (typeof operations)[number]) => [
    operation.workCenterId === args.workCenterId ? 0 : 1,
    operation.status === "In Progress" ? 0 : 1
  ];

  const ranked = operations.sort((a, b) => {
    const [aHere, aInProgress] = rank(a);
    const [bHere, bInProgress] = rank(b);
    if (aHere !== bHere) return aHere - bHere;
    if (aInProgress !== bInProgress) return aInProgress - bInProgress;

    const aStart = latestEventStart.get(a.id) ?? "";
    const bStart = latestEventStart.get(b.id) ?? "";
    if (aStart !== bStart) return aStart < bStart ? 1 : -1;

    return (a.description ?? "").localeCompare(b.description ?? "");
  });

  return {
    data: ranked.map((operation) => ({
      value: operation.id,
      label: `${operation.job?.jobId ?? ""} · ${operation.description ?? ""}`,
      // The drawer shows the status when there is no work center: it
      // translates it, so it stays the enum here.
      workCenterName: operation.workCenter?.name ?? null,
      status: operation.status
    })),
    error: null
  };
}

// The members' shared work-center name: null when they disagree (or none are
// set), the single distinct name when they all agree. The list stats and the
// detail drawer both fall back to this when the batch has no header work center
// (a board-created batch has no header WC until its card is dragged), so they
// must agree on what "shared" means — drop nullish first, then require exactly
// one distinct name.
function deriveSharedWorkCenterName(
  names: (string | null | undefined)[]
): string | null {
  const distinct = new Set(names.filter((n): n is string => Boolean(n)));
  return distinct.size === 1 ? ([...distinct][0] as string) : null;
}

// Member count + summed quantity per batch, for the batches list. One query for
// the page's batch ids, tallied in TS (the storage-rules count pattern — no
// PostgREST aggregate embeds in this repo). Also derives the members' shared
// work-center name: a batch created from the board carries no header work
// center until it is dragged, but when every member sits on one work center
// that IS the batch's work center — the board itself falls back the same way.
export async function getJobOperationBatchMemberStats(
  client: SupabaseClient<Database>,
  companyId: string,
  batchIds: string[]
): Promise<{
  data: Record<
    string,
    {
      memberCount: number;
      totalQuantity: number;
      workCenterName: string | null;
    }
  >;
  error: unknown;
}> {
  if (batchIds.length === 0) return { data: {}, error: null };
  const result = await client
    .from("jobOperation")
    .select("jobOperationBatchId, operationQuantity, workCenter(name)")
    .in("jobOperationBatchId", batchIds)
    .eq("companyId", companyId);
  if (result.error) return { data: {}, error: result.error };
  const stats: Record<
    string,
    {
      memberCount: number;
      totalQuantity: number;
      workCenterName: string | null;
    }
  > = {};
  // Collect each batch's member work-center names, then derive the shared one
  // once (same rule the detail drawer uses via deriveSharedWorkCenterName).
  const memberWorkCenterNames: Record<string, (string | null)[]> = {};
  for (const op of result.data ?? []) {
    if (!op.jobOperationBatchId) continue;
    const entry = (stats[op.jobOperationBatchId] ??= {
      memberCount: 0,
      totalQuantity: 0,
      workCenterName: null
    });
    entry.memberCount += 1;
    entry.totalQuantity += op.operationQuantity ?? 0;
    (memberWorkCenterNames[op.jobOperationBatchId] ??= []).push(
      op.workCenter?.name ?? null
    );
  }
  for (const [batchId, entry] of Object.entries(stats)) {
    entry.workCenterName = deriveSharedWorkCenterName(
      memberWorkCenterNames[batchId] ?? []
    );
  }
  return { data: stats, error: null };
}

// One flattened member row per batch member, for the batches list's expandable
// sub-rows (mirrors the ECO change-notices table). Fields match what the sub-row
// and the detail drawer's member table show: job link, item, and quantity.
export type JobOperationBatchListMember = {
  id: string;
  jobId: string | null;
  jobReadableId: string | null;
  itemReadableId: string | null;
  itemName: string | null;
  thumbnailPath: string | null;
  operationQuantity: number;
  quantityComplete: number;
  quantityScrapped: number;
};

// Members for every batch on the page in ONE query, grouped by batch id in TS
// (same no-N+1 pattern as getJobOperationBatchMemberStats — collect ids, one
// .in(), tally). getJobOperationBatchWithMembers is single-batch and would be
// N+1 across the list, so the list uses this leaner grouped read instead.
export async function getJobOperationBatchMembers(
  client: SupabaseClient<Database>,
  companyId: string,
  batchIds: string[]
): Promise<{
  data: Record<string, JobOperationBatchListMember[]>;
  error: unknown;
}> {
  if (batchIds.length === 0) return { data: {}, error: null };
  const result = await client
    .from("jobOperation")
    .select(
      "id, jobOperationBatchId, operationQuantity, quantityComplete, quantityScrapped, job(id, jobId), jobMakeMethod(item(readableIdWithRevision, name, thumbnailPath))"
    )
    .in("jobOperationBatchId", batchIds)
    .eq("companyId", companyId);
  if (result.error) return { data: {}, error: result.error };
  const members: Record<string, JobOperationBatchListMember[]> = {};
  for (const op of result.data ?? []) {
    if (!op.jobOperationBatchId) continue;
    (members[op.jobOperationBatchId] ??= []).push({
      id: op.id,
      jobId: op.job?.id ?? null,
      jobReadableId: op.job?.jobId ?? null,
      itemReadableId: op.jobMakeMethod?.item?.readableIdWithRevision ?? null,
      itemName: op.jobMakeMethod?.item?.name ?? null,
      thumbnailPath: op.jobMakeMethod?.item?.thumbnailPath ?? null,
      operationQuantity: op.operationQuantity ?? 0,
      quantityComplete: op.quantityComplete ?? 0,
      quantityScrapped: op.quantityScrapped ?? 0
    });
  }
  // Sort each batch's members by job, then by item readable id, matching the
  // detail drawer and the printable batch list.
  for (const group of Object.values(members)) {
    group.sort((a, b) => {
      const byJob = (a.jobReadableId ?? "").localeCompare(
        b.jobReadableId ?? ""
      );
      if (byJob !== 0) return byJob;
      return (a.itemReadableId ?? "").localeCompare(b.itemReadableId ?? "");
    });
  }
  return { data: members, error: null };
}

// The MERGEABLE output lots a completed batch's members produced: each member's
// WIP tracked entity (tagged with its jobMakeMethod), narrowed to lots still
// Available with stock. Drives the drawer's "Merge output lots" action — >=2 of
// one item are mergeable, and a merged batch returns none (parents Consumed).
export async function getBatchOutputLots(
  client: SupabaseClient<Database>,
  batchId: string,
  companyId: string
) {
  const members = await client
    .from("jobOperation")
    .select("id, jobMakeMethodId")
    .eq("jobOperationBatchId", batchId)
    .eq("companyId", companyId);
  const makeMethodIds = [
    ...new Set(
      (members.data ?? [])
        .map((m) => m.jobMakeMethodId)
        .filter(Boolean) as string[]
    )
  ];
  if (makeMethodIds.length === 0) {
    return { data: [], error: members.error };
  }
  return client
    .from("trackedEntity")
    .select("id, readableId, itemId")
    .in("attributes->>Job Make Method", makeMethodIds)
    .eq("companyId", companyId)
    .eq("status", "Available")
    .gt("quantity", 0);
}

export async function getJobOperationBatchWithMembers(
  client: SupabaseClient<Database>,
  batchId: string,
  companyId: string
) {
  const batch = await client
    .from("jobOperationBatch")
    .select("*, process(name, batchType), workCenter(name), location(name)")
    .eq("id", batchId)
    .eq("companyId", companyId)
    .single();
  if (batch.error) return batch;
  const members = await client
    .from("jobOperation")
    .select(
      "id, description, operationQuantity, quantityComplete, quantityScrapped, status, setupTime, setupUnit, laborTime, laborUnit, machineTime, machineUnit, workCenter(name), job(id, jobId, customerId, salesOrderId, status), jobMakeMethod(item(readableIdWithRevision, name, thumbnailPath))"
    )
    .eq("jobOperationBatchId", batchId)
    .eq("companyId", companyId);
  // Header work center when assigned; else the members' shared one (a
  // board-created batch has no header WC until its card is dragged). Uses the
  // same derivation as the list stats so the two never disagree.
  const workCenterName =
    batch.data.workCenter?.name ??
    deriveSharedWorkCenterName(
      (members.data ?? []).map((m) => m.workCenter?.name)
    );
  // Sort by job, then by the member item's readable id, so the drawer's member
  // table matches the printable batch list's ordering.
  const sortedMembers = [...(members.data ?? [])].sort((a, b) => {
    const byJob = (a.job?.jobId ?? "").localeCompare(b.job?.jobId ?? "");
    if (byJob !== 0) return byJob;
    return (a.jobMakeMethod?.item?.readableIdWithRevision ?? "").localeCompare(
      b.jobMakeMethod?.item?.readableIdWithRevision ?? ""
    );
  });
  return {
    data: { ...batch.data, workCenterName, members: sortedMembers },
    error: members.error
  };
}

// The batch's production events: the live aggregate run while Active, and the
// per-member slices after completion (slices keep the jobOperationBatchId tag).
export async function getJobOperationBatchEvents(
  client: SupabaseClient<Database>,
  batchId: string,
  companyId: string
) {
  return client
    .from("productionEvent")
    .select(
      "id, type, startTime, endTime, duration, employeeId, jobOperationId"
    )
    .eq("jobOperationBatchId", batchId)
    .eq("companyId", companyId)
    .order("startTime", { ascending: true });
}

export async function getBatchableOperations(
  client: SupabaseClient<Database>,
  companyId: string,
  args: { locationId: string; processId: string }
) {
  const result = await client.rpc("get_batchable_operations", {
    location_id: args.locationId,
    process_id: args.processId
  });
  // The RPC is SECURITY INVOKER so RLS already scopes the read; filtering on
  // the returned companyId column is defense in depth against a caller passing
  // another tenant's location/process ids.
  if (result.data) {
    result.data = result.data.filter((row) => row.companyId === companyId);
  }
  return result;
}

export async function getBatchableProcesses(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("process")
    .select("id, name, batchable, batchType, batchRules")
    .eq("companyId", companyId)
    .eq("batchable", true)
    .eq("active", true)
    .order("name");
}

/** The batch only; `createBatch` also releases its jobs and tells the scheduler. */
export async function createJobOperationBatch(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    jobOperationIds: string[];
    locationId: string;
    workCenterId?: string | null;
    notes?: string | null;
    // Create & Release: insert the batch already 'Active' (on the floor);
    // omitted/false creates it 'Planned'.
    release?: boolean;
    mergeOutput?: boolean;
    outputLotNumber?: string | null;
    lotNumbers?: { jobOperationId: string; lotNumber: string }[];
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, ...input } = args;
  return invokePosting(
    { client, db, companyId, userId },
    "batch-operations",
    {
      type: "create",
      ...input
    },
    batchOperation,
    { as: batchOperationPermission }
  );
}

/**
 * Any `batch-operations` change, release included. Not published: a release
 * here skips the member jobs; `updateBatch` / `releaseBatches` /
 * `unreleaseBatch` are the operations.
 */
export async function updateJobOperationBatch(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    type: "add" | "remove" | "update" | "dissolve" | "release" | "unrelease";
    batchId: string;
    jobOperationIds?: string[];
    workCenterId?: string | null;
    companyId: string;
    userId: string;
  }
) {
  const { companyId, userId, ...input } = args;
  // add/remove need jobOperationIds; the operation re-validates the shape.
  return invokePosting(
    { client, db, companyId, userId },
    "batch-operations",
    input as z.input<typeof batchOperationsInput>,
    batchOperation,
    { as: batchOperationPermission }
  );
}

/**
 * Flip a batch to Active. Not published: it does not release the member jobs;
 * `releaseBatches` does both.
 */
export async function releaseJobOperationBatch(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { batchId: string; companyId: string; userId: string }
) {
  const { companyId, userId, batchId } = args;
  return invokePosting(
    { client, db, companyId, userId },
    "batch-operations",
    {
      type: "release",
      batchId
    },
    batchOperation,
    { as: batchOperationPermission }
  );
}

/** The flip only; `unreleaseBatch` also tells the scheduler. */
export async function unreleaseJobOperationBatch(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: { batchId: string; companyId: string; userId: string }
) {
  const { companyId, userId, batchId } = args;
  return invokePosting(
    { client, db, companyId, userId },
    "batch-operations",
    {
      type: "unrelease",
      batchId
    },
    batchOperation,
    { as: batchOperationPermission }
  );
}

// --- Assembly Instructions ---------------------------------------------

export async function getAssemblyInstruction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstruction")
    .select(
      "*, modelUpload(id, name, modelPath, glbPath, graphPath, componentCount, processingStatus, processingError), item(modelUploadId)"
    )
    .eq("id", id)
    .single();
}

export async function getAssemblyInstructions(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    search?: string;
    status?: (typeof assemblyInstructionStatuses)[number];
    itemId?: string;
    limit?: number;
    offset?: number;
  }
) {
  let query = client
    // "assemblyInstructions" (plural) is the version-collapsing view: one row
    // per version group (root = rootInstructionId ?? id), latest version shown,
    // all siblings rolled into a "versions" jsonb array. See the
    // 20260730153412_assembly-instructions-view migration.
    .from("assemblyInstructions")
    .select("*, modelUpload(id, name, componentCount, processingStatus)", {
      count: "exact"
    })
    .eq("companyId", args.companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.itemId) {
    query = query.eq("itemId", args.itemId);
  }
  if (args.limit) {
    query = query.limit(args.limit);
  }
  if (args.offset) {
    query = query.range(args.offset, args.offset + (args.limit ?? 25) - 1);
  }

  return query.order("updatedAt", { ascending: false, nullsFirst: false });
}

export async function getAssemblyInstructionsForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("assemblyInstruction")
    .select("id, name, version, status")
    .eq("companyId", companyId)
    .eq("itemId", itemId)
    .order("updatedAt", { ascending: false, nullsFirst: false });
}

/**
 * Resolves a made item's CAD model for assembly instructions. Items link to
 * their model via item.modelUploadId. Conversion to viewer artifacts (GLB +
 * graph) is lazy — `modelState` tells the caller whether the model is ready,
 * convertible on demand, or unusable.
 */
export async function getModelForItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  const item = await client
    .from("item")
    .select("id, name, modelUploadId")
    .eq("id", itemId)
    .eq("companyId", companyId)
    .single();
  if (item.error) {
    return { item: null, model: null, modelState: "none" as const };
  }

  if (!item.data.modelUploadId) {
    return { item: item.data, model: null, modelState: "none" as const };
  }

  const model = await client
    .from("modelUpload")
    .select(
      "id, name, componentCount, processingStatus, processingError, glbPath, graphPath, modelPath"
    )
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  return {
    item: item.data,
    model: model.data ?? null,
    modelState: getAssemblyModelState(model.data ?? null)
  };
}

export async function getAssemblyInstructionSteps(
  client: SupabaseClient<Database>,
  assemblyInstructionId: string
) {
  return client
    .from("assemblyInstructionStep")
    .select("*")
    .eq("assemblyInstructionId", assemblyInstructionId)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstruction(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    name: string;
    modelUploadId: string;
    itemId?: string | null;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyInstruction")
      .update({
        name: data.name,
        itemId: data.itemId ?? null,
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstruction")
    .insert({
      name: data.name,
      modelUploadId: data.modelUploadId,
      itemId: data.itemId ?? null,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function updateAssemblyInstructionStatus(
  client: SupabaseClient<Database>,
  id: string,
  data: {
    status: (typeof assemblyInstructionStatuses)[number];
    updatedBy: string;
  }
) {
  // Version is assigned when a new version is copied (see
  // copyAssemblyInstructionAsVersion), not bumped on publish. Activating a
  // version goes through activateAssemblyInstructionVersion; this remains for
  // any direct status write.
  return client
    .from("assemblyInstruction")
    .update({
      status: data.status,
      publishedAt:
        data.status === "Published" ? new Date().toISOString() : undefined,
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/**
 * Sibling versions of an instruction, for the header's version switcher. All
 * versions of one instruction share a group root: NULL rootInstructionId means
 * "I am the root", so the group root is `rootInstructionId ?? id` and siblings
 * are the rows whose id = root OR whose rootInstructionId = root.
 */
export async function getAssemblyInstructionVersions(
  client: SupabaseClient<Database>,
  instruction: {
    id: string;
    rootInstructionId?: string | null;
    companyId: string;
  }
) {
  const root = instruction.rootInstructionId ?? instruction.id;
  return client
    .from("assemblyInstruction")
    .select("id, name, version, status, rootInstructionId")
    .eq("companyId", instruction.companyId)
    .or(`id.eq.${root},rootInstructionId.eq.${root}`)
    .order("version", { ascending: false });
}

/**
 * Create a new editable Draft version as a perfect copy of an existing
 * instruction: a fresh assemblyInstruction row (new id, version = max+1,
 * status Draft) plus deep copies of every step (parentStepId remapped through
 * the self-referential tree) and each step's live child rows (materials,
 * slides, tools). Non-atomic multi-insert — a partial copy leaves a deletable
 * Draft, matching the procedure/make-method copy precedents.
 */
export async function copyAssemblyInstructionAsVersion(
  client: SupabaseClient<Database>,
  args: { copyFromId: string; companyId: string; userId: string }
) {
  const { copyFromId, companyId, userId } = args;

  const source = await client
    .from("assemblyInstruction")
    .select("*")
    .eq("id", copyFromId)
    .eq("companyId", companyId)
    .single();
  if (source.error) return source;

  const root = source.data.rootInstructionId ?? source.data.id;

  // Highest version across the group determines the next version number.
  const siblings = await client
    .from("assemblyInstruction")
    .select("version")
    .eq("companyId", companyId)
    .or(`id.eq.${root},rootInstructionId.eq.${root}`)
    .order("version", { ascending: false })
    .limit(1);
  const nextVersion =
    (siblings.data?.[0]?.version ?? source.data.version ?? 0) + 1;

  const insert = await client
    .from("assemblyInstruction")
    .insert({
      name: source.data.name,
      modelUploadId: source.data.modelUploadId,
      itemId: source.data.itemId,
      assemblyPlanJobId: source.data.assemblyPlanJobId,
      settings: source.data.settings,
      tags: source.data.tags,
      status: "Draft",
      version: nextVersion,
      rootInstructionId: root,
      companyId,
      createdBy: userId
    })
    .select("id")
    .single();
  if (insert.error) return insert;
  const newInstructionId = insert.data.id;

  // Copy steps, pre-generating ids so parentStepId can be remapped in one pass.
  const sourceSteps = await client
    .from("assemblyInstructionStep")
    .select("*")
    .eq("assemblyInstructionId", copyFromId)
    .order("sortOrder", { ascending: true });
  if (sourceSteps.error) return sourceSteps;

  const stepIdMap = new Map<string, string>();
  for (const step of sourceSteps.data ?? []) {
    stepIdMap.set(step.id, nanoid());
  }

  if ((sourceSteps.data?.length ?? 0) > 0) {
    const stepRows = sourceSteps.data.map((step) => {
      // Strip identity/audit columns; keep every authored field verbatim.
      // biome-ignore lint/correctness/noUnusedVariables: destructure omits identity/audit columns before re-insert
      const { id, createdAt, updatedAt, updatedBy, ...rest } = step;
      return {
        ...rest,
        id: stepIdMap.get(step.id)!,
        assemblyInstructionId: newInstructionId,
        parentStepId: step.parentStepId
          ? (stepIdMap.get(step.parentStepId) ?? null)
          : null,
        usedInStepId: step.usedInStepId
          ? (stepIdMap.get(step.usedInStepId) ?? null)
          : null,
        // Lineage across versions: a step copied from v1 roots at v1's step, and
        // a v3 copied from v2 still roots at v1 — the chain stays flat so
        // COALESCE("rootStepId", "id") identifies the group at any depth.
        rootStepId: step.rootStepId ?? step.id,
        companyId,
        createdBy: userId
      };
    });
    const insertSteps = await client
      .from("assemblyInstructionStep")
      .insert(stepRows);
    if (insertSteps.error) return insertSteps;
  }

  // Copy each step's live child rows, remapping stepId.
  const sourceStepIds = [...stepIdMap.keys()];
  if (sourceStepIds.length > 0) {
    const copyChildTable = async (
      table:
        | "assemblyInstructionStepMaterial"
        | "assemblyInstructionStepSlide"
        | "assemblyInstructionStepTool"
    ) => {
      const rows = await client
        .from(table)
        .select("*")
        .in("stepId", sourceStepIds);
      if (rows.error) return rows;
      if (!rows.data?.length) return rows;
      const inserts = rows.data.map((row: any) => {
        // biome-ignore lint/correctness/noUnusedVariables: destructure omits identity/audit columns before re-insert
        const { id, createdAt, updatedAt, updatedBy, ...rest } = row;
        return {
          ...rest,
          stepId: stepIdMap.get(row.stepId)!,
          companyId,
          createdBy: userId
        };
      });
      return client.from(table).insert(inserts);
    };

    for (const table of [
      "assemblyInstructionStepMaterial",
      "assemblyInstructionStepSlide",
      "assemblyInstructionStepTool"
    ] as const) {
      const copied = await copyChildTable(table);
      if (copied.error) return copied;
    }
  }

  return insert;
}

/**
 * Make a version the active (Published) one: archive whichever sibling is
 * currently Published, publish the target, and repoint in-flight work to it —
 * but only active job operations (status not Done/Canceled) on active jobs
 * (status not Completed/Closed/Cancelled). Method operations are intentionally
 * left untouched.
 */
export async function activateAssemblyInstructionVersion(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    userId: string;
    // Node Kysely handle for the per-operation re-sync. Built by the route
    // action (getDatabaseClient) and passed in — never constructed here; this
    // module is bundled for the browser (see the note above getJob).
    db: Kysely<KyselyDatabase>;
  }
) {
  const { id, companyId, userId, db } = args;

  const target = await client
    .from("assemblyInstruction")
    .select("id, rootInstructionId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (target.error) return target;

  const root = target.data.rootInstructionId ?? target.data.id;

  const group = await client
    .from("assemblyInstruction")
    .select("id, status")
    .eq("companyId", companyId)
    .or(`id.eq.${root},rootInstructionId.eq.${root}`);
  if (group.error) return group;

  const now = new Date().toISOString();

  // Archive the currently-active sibling(s).
  const previouslyActive = (group.data ?? []).filter(
    (v) => v.id !== id && v.status === "Published"
  );
  if (previouslyActive.length > 0) {
    const archive = await client
      .from("assemblyInstruction")
      .update({ status: "Archived", updatedBy: userId, updatedAt: now })
      .in(
        "id",
        previouslyActive.map((v) => v.id)
      );
    if (archive.error) return archive;
  }

  // Publish the target.
  const publish = await client
    .from("assemblyInstruction")
    .update({
      status: "Published",
      publishedAt: now,
      updatedBy: userId,
      updatedAt: now
    })
    .eq("id", id)
    .select("id")
    .single();
  if (publish.error) return publish;

  // Repoint in-flight work: active job operations on active jobs that point at
  // any other version in this group → the newly-active version.
  const otherVersionIds = (group.data ?? [])
    .map((v) => v.id)
    .filter((vId) => vId !== id);
  if (otherVersionIds.length > 0) {
    // Drive the lookup off jobOperation (bounded by this small sibling-version
    // set) rather than first materializing every unlocked job id — that list
    // can exceed the 1000-row cap and silently drop operations, leaving them
    // pointed at the now-archived version. An inner join on job applies the
    // locked-job filter server-side while keeping the row set bounded.
    const staleOps = await client
      .from("jobOperation")
      .select("id, job!inner(status)")
      .eq("companyId", companyId)
      .in("assemblyInstructionId", otherVersionIds)
      .not("status", "in", "(Done,Canceled)")
      .not("job.status", "in", `(${JOB_LOCKED_STATUSES.join(",")})`);
    if (staleOps.error) return staleOps;

    const staleOpIds = (staleOps.data ?? []).map((o) => o.id);
    if (staleOpIds.length > 0) {
      const repoint = await client
        .from("jobOperation")
        .update({ assemblyInstructionId: id })
        .in("id", staleOpIds);
      if (repoint.error) return repoint;

      // Migrate step markers v(old) -> v(new) by lineage group before syncing.
      // Without this the job's steps still point at the old version's step ids,
      // MES cannot match them (AssemblyView findIndex -> -1), and playback
      // silently degrades to a static model on every step.
      const [oldStepRows, newStepRows] = await Promise.all([
        client
          .from("assemblyInstructionStep")
          .select("id, rootStepId")
          .in("assemblyInstructionId", otherVersionIds)
          .eq("companyId", companyId),
        client
          .from("assemblyInstructionStep")
          .select("id, rootStepId")
          .eq("assemblyInstructionId", id)
          .eq("companyId", companyId)
      ]);
      if (oldStepRows.error) return oldStepRows;
      if (newStepRows.error) return newStepRows;

      const remap = planAssemblyStepMarkerRemap(
        oldStepRows.data ?? [],
        newStepRows.data ?? []
      );

      // One statement, one transaction: the repoint above has already committed,
      // so until every marker moves, these operations point at the new version
      // while their steps still name the old one — precisely the state MES reads
      // as "no playback". Migrating them row by row would expose that window on
      // every activation, and an error midway would leave the operation split
      // across two versions with no rollback and no way to re-run (the new
      // version is Published by then, so it is no longer a "stale" source).
      if (remap.size > 0) {
        const pairs = sql.join(
          [...remap].map(
            ([oldStepId, newStepId]) => sql`(${oldStepId}, ${newStepId})`
          )
        );
        await db.transaction().execute(async (trx) => {
          await sql`
            UPDATE "jobOperationStep" AS s
            SET "assemblyInstructionStepId" = r."newStepId"
            FROM (VALUES ${pairs}) AS r("oldStepId", "newStepId")
            WHERE s."assemblyInstructionStepId" = r."oldStepId"
              AND s."companyId" = ${companyId}
              AND s."operationId" = ANY(${staleOpIds})
          `.execute(trx);
        });
      }

      // Reconcile added/deleted steps. Marker-matched steps UPDATE in place, so
      // jobOperationStepRecord survives. Isolated per operation so one failure
      // cannot abort the activation.
      for (const operationId of staleOpIds) {
        try {
          await syncAssemblyInstructionToOperation(db, {
            assemblyInstructionId: id,
            operationId,
            companyId,
            userId
          });
        } catch (error) {
          // The remap already restored playback for surviving steps, so this
          // only leaves added/deleted steps unreconciled on one operation —
          // recoverable from the job. Logged so a systematic failure is visible.
          logger.error("Failed to re-sync assembly steps after activation", {
            assemblyInstructionId: id,
            operationId,
            companyId,
            error
          });
        }
      }
    }
  }

  return publish;
}

export async function deleteAssemblyInstruction(
  client: SupabaseClient<Database>,
  id: string
) {
  // Remember which model this instruction was authored against before we drop
  // it — the cached motion plan is keyed to the modelUpload, not the
  // instruction, so it survives delete/recreate and would otherwise resurrect a
  // stale plan for a fresh instruction (defeating any planner improvement).
  const instruction = await client
    .from("assemblyInstruction")
    .select("modelUploadId")
    .eq("id", id)
    .maybeSingle();

  const deletion = await client
    .from("assemblyInstruction")
    .delete()
    .eq("id", id);
  if (deletion.error) return deletion;

  const modelUploadId = instruction.data?.modelUploadId;
  if (modelUploadId) {
    await invalidateAssemblyPlanCache(client, modelUploadId);
  }

  return deletion;
}

/**
 * Best-effort: tell the assembler to drop its content-hash result-pointer cache
 * for a model, so a re-plan of unchanged bytes+options re-derives instead of
 * reusing a stale pointer. The DB/storage invalidation is the real gate; this is
 * belt-and-suspenders (the service cache also auto-invalidates on CODE_VERSION
 * and any option change). Skips silently when the service URL is unset, and
 * never throws — a failed notify must not block the DB invalidation.
 */
async function notifyAssemblerInvalidate(modelUploadId: string) {
  if (!ASSEMBLER_SERVICE_URL) return;
  try {
    await fetch(`${ASSEMBLER_SERVICE_URL}/v1/cache/invalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ASSEMBLER_SERVICE_API_KEY
          ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
          : {})
      },
      body: JSON.stringify({ modelUploadId }),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // swallow — best-effort
  }
}

/**
 * Drops the cached motion plan for a model so the next instruction re-plans from
 * scratch (with the current algorithm). Leaves the expensive conversion output
 * (glb/graph on the modelUpload) intact — conversion isn't what a planner change
 * affects. No-op while another instruction still authors against the same model
 * (one item → one modelUpload, potentially several instructions).
 */
async function invalidateAssemblyPlanCache(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  const others = await client
    .from("assemblyInstruction")
    .select("id")
    .eq("modelUploadId", modelUploadId)
    .limit(1);
  if (others.error || (others.data?.length ?? 0) > 0) return;

  const planJobs = await client
    .from("assemblyPlanJob")
    .select("id, companyId, planPath")
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan");

  // Remove the recorded planPath AND the deterministic per-job path: a job
  // that failed or was cancelled after the service uploaded plan.json never
  // got planPath set on its row, and would otherwise leave an orphan file.
  const planPaths = [
    ...new Set(
      (planJobs.data ?? []).flatMap((job) => [
        ...(job.planPath ? [job.planPath] : []),
        `${job.companyId}/models/${modelUploadId}/${job.id}/plan.json`
      ])
    )
  ];
  if (planPaths.length > 0) {
    // Best-effort artifact cleanup (removing a nonexistent path is a no-op);
    // deleting the rows below is what actually invalidates the cache
    // (getLatestAssemblyPlan then finds nothing).
    // Private object paths are prefixed with the owning company's id.
    const companyId = planPaths[0].split("/")[0];
    await storage(client).company(companyId).remove(planPaths);
  }

  await client
    .from("assemblyPlanJob")
    .delete()
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan");

  // Auto-detected groups (swarms) get materialized as `assemblyUnit` rows, which
  // FREEZE detection: `loadPlanUnits` feeds them back to the planner as caller
  // units, so a re-plan merges them as-is and never re-runs swarm detection.
  // They're derived cache — invalidating the plan must drop them too, else a
  // deleted-then-recreated instruction re-plans against the frozen unit and
  // resurrects the stale grouping (defeating any planner improvement). The guard
  // above already ensured no other instruction authors against this model, so
  // this is safe. User-authored units (sourceGroupId null) are kept.
  await client
    .from("assemblyUnit")
    .delete()
    .eq("modelUploadId", modelUploadId)
    .not("sourceGroupId", "is", null);

  await notifyAssemblerInvalidate(modelUploadId);
}

/**
 * Explicitly invalidates EVERY cached artifact for a model — plan rows +
 * plan.json files (for all instructions on the model) and the conversion
 * output (glb/graph files + paths) — and resets processingStatus so a fresh
 * convert can run. This is the user-facing escape hatch for stale caches
 * (e.g. after a geometry-service upgrade that changes nodeIds); routine
 * instruction deletion uses the narrower invalidateAssemblyPlanCache instead.
 *
 * Not published: `reconvertAssemblyModel` also converts the model again.
 */
export async function invalidateAssemblyModelCache(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  const planJobs = await client
    .from("assemblyPlanJob")
    .select("id, companyId, planPath")
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan");

  const paths = new Set<string>();
  for (const job of planJobs.data ?? []) {
    if (job.planPath) paths.add(job.planPath);
    paths.add(`${job.companyId}/models/${modelUploadId}/${job.id}/plan.json`);
  }

  const model = await client
    .from("modelUpload")
    .select("glbPath, graphPath")
    .eq("id", modelUploadId)
    .maybeSingle();
  if (model.data?.glbPath) paths.add(model.data.glbPath);
  if (model.data?.graphPath) paths.add(model.data.graphPath);

  if (paths.size > 0) {
    // Best-effort file cleanup; the row updates below are what invalidate.
    // Private object paths are prefixed with the owning company's id.
    const objectPaths = [...paths];
    const companyId = objectPaths[0].split("/")[0];
    await storage(client).company(companyId).remove(objectPaths);
  }

  await client
    .from("assemblyPlanJob")
    .delete()
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan");

  // Drop auto-materialized swarm units too (see invalidateAssemblyPlanCache) —
  // they freeze detection, so a full model-cache reset must re-derive them.
  await client
    .from("assemblyUnit")
    .delete()
    .eq("modelUploadId", modelUploadId)
    .not("sourceGroupId", "is", null);

  await notifyAssemblerInvalidate(modelUploadId);

  return client
    .from("modelUpload")
    .update({
      processingStatus: "Idle",
      processingError: null,
      glbPath: null,
      graphPath: null
    })
    .eq("id", modelUploadId);
}

type AssemblyStepFields = {
  title?: string | null;
  type?: Database["public"]["Enums"]["procedureStepType"];
  description?: Json;
  required?: boolean;
  unitOfMeasureCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  listValues?: string[] | null;
  componentNodeIds?: string[];
  motion?: z.infer<typeof motionSchema>;
  camera?: z.infer<typeof cameraSchema> | null;
  fastener?: z.infer<typeof fastenerSchema> | null;
  durationSeconds?: number | null;
};

/** A new step's columns, shared by both insert paths. */
function newAssemblyStepColumns(data: AssemblyStepFields) {
  return {
    title: data.title ?? null,
    type: data.type ?? "Task",
    description: data.description ?? {},
    instructionText:
      data.description !== undefined
        ? TiptapText(data.description).toString() || null
        : null,
    required: data.required ?? false,
    unitOfMeasureCode:
      data.type === "Measurement" ? (data.unitOfMeasureCode ?? null) : null,
    minValue: data.type === "Measurement" ? (data.minValue ?? null) : null,
    maxValue: data.type === "Measurement" ? (data.maxValue ?? null) : null,
    listValues: data.type === "List" ? (data.listValues ?? null) : null,
    componentNodeIds: data.componentNodeIds ?? [],
    motion: (data.motion ?? { type: "none" }) as Json,
    camera: (data.camera ?? null) as Json | null,
    fastener: (data.fastener ?? null) as Json | null,
    durationSeconds: data.durationSeconds ?? null
  };
}

export async function upsertAssemblyInstructionStep(
  client: SupabaseClient<Database>,
  data: AssemblyStepFields & {
    id?: string;
    assemblyInstructionId: string;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  // instructionText is a derived plain-text snapshot of the tiptap
  // description, consumed by the viewer overlay, MES playback, and search
  const derivedInstructionText =
    data.description !== undefined
      ? {
          instructionText: TiptapText(data.description).toString() || null
        }
      : {};

  // When a type is posted, clear the value fields that don't apply to it so
  // switching type never leaves stale constraints behind
  const typedFields = data.type
    ? {
        type: data.type,
        unitOfMeasureCode:
          data.type === "Measurement" ? (data.unitOfMeasureCode ?? null) : null,
        minValue: data.type === "Measurement" ? (data.minValue ?? null) : null,
        maxValue: data.type === "Measurement" ? (data.maxValue ?? null) : null,
        listValues: data.type === "List" ? (data.listValues ?? null) : null
      }
    : {};

  if (data.id) {
    return client
      .from("assemblyInstructionStep")
      .update({
        title: data.title ?? null,
        ...typedFields,
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...derivedInstructionText,
        ...(data.required !== undefined ? { required: data.required } : {}),
        ...(data.componentNodeIds
          ? { componentNodeIds: data.componentNodeIds }
          : {}),
        ...(data.motion ? { motion: data.motion as Json } : {}),
        ...(data.camera !== undefined
          ? { camera: data.camera as Json | null }
          : {}),
        ...(data.fastener !== undefined
          ? { fastener: data.fastener as Json | null }
          : {}),
        ...(data.durationSeconds !== undefined
          ? { durationSeconds: data.durationSeconds }
          : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStep")
    .insert({
      assemblyInstructionId: data.assemblyInstructionId,
      ...newAssemblyStepColumns(data),
      sortOrder: data.sortOrder ?? (await getNextStepSortOrder(client, data)),
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

/**
 * Partial update of a step's viewer-authored motion path and/or camera pose.
 * Kept separate from `upsertAssemblyInstructionStep` (which always rewrites
 * `title` and the typed-step fields) so the 3D editor can autosave a drag or a
 * "Set view" click without touching the rest of the step. `camera: null` clears
 * the pose (return to auto-framing); `orientation: null` makes the step keep the
 * previous step's build orientation; omitting a field leaves it untouched.
 *
 * The first hand-drawn edit keeps the motion it replaces in
 * `warnings.plannedMotion`; `reset` restores it and drops the marker. Both are
 * ONE UPDATE that reads `motion`/`warnings` from the row it writes, so a drag
 * save and a Reset reaching the server together cannot lose `plannedMotion`.
 */
export async function updateAssemblyStepMotion(
  db: Kysely<KyselyDatabase>,
  data: {
    id: string;
    motion?: z.infer<typeof motionSchema>;
    camera?: z.infer<typeof cameraSchema> | null;
    orientation?: z.infer<typeof orientationSchema> | null;
    /** Put back the motion the step had before its path was first drawn. */
    reset?: boolean;
    companyId: string;
    updatedBy: string;
  }
): Promise<
  { data: { id: string }; error: null } | { data: null; error: Error }
> {
  const flags = sql<Json>`CASE WHEN jsonb_typeof("warnings") = 'object' THEN "warnings" ELSE '{}'::jsonb END`;
  const motionPatch = data.reset
    ? {
        motion: sql<Json>`COALESCE(NULLIF(${flags} -> 'plannedMotion', 'null'::jsonb), '{"type":"none"}'::jsonb)`,
        warnings: sql<Json | null>`NULLIF(${flags} - 'plannedMotion', '{}'::jsonb)`
      }
    : data.motion !== undefined
      ? {
          motion: sql<Json>`${JSON.stringify(data.motion)}::jsonb`,
          // `"motion"` is the pre-UPDATE value: the motion the drawn path replaces.
          warnings: sql<Json | null>`CASE WHEN ${flags} ? 'plannedMotion' THEN "warnings" ELSE ${flags} || jsonb_build_object('plannedMotion', "motion") END`
        }
      : {};
  try {
    const row = await db
      .updateTable("assemblyInstructionStep")
      .set({
        ...motionPatch,
        ...(data.camera !== undefined
          ? {
              camera:
                data.camera === null
                  ? null
                  : sql<Json>`${JSON.stringify(data.camera)}::jsonb`
            }
          : {}),
        ...(data.orientation !== undefined
          ? {
              orientation:
                data.orientation === null
                  ? null
                  : sql<Json>`${JSON.stringify(data.orientation)}::jsonb`
            }
          : {}),
        updatedBy: data.updatedBy,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", data.id)
      .where("companyId", "=", data.companyId)
      .returning("id")
      .executeTakeFirst();
    if (!row) return { data: null, error: new Error("Step not found") };
    return { data: row, error: null };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err
          : new Error(getErrorMessage(err, "Failed to update motion"))
    };
  }
}

// Autosave target for the Details panel's Add/remove component controls: patches
// only the step's assigned components, leaving the title/typed fields and motion
// untouched.
/** Not published: `setAssemblyStepComponents` also adds the new components' materials. */
export async function updateAssemblyStepComponents(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    componentNodeIds: string[];
    updatedBy: string;
  }
) {
  return client
    .from("assemblyInstructionStep")
    .update({
      componentNodeIds: data.componentNodeIds,
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", data.id)
    .select("id")
    .single();
}

// Replaces a step's hidden list. The step's own components are stripped (and the
// list deduped) by the assembly_step_strip_own_hidden_components trigger.
export async function updateAssemblyStepHiddenComponents(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    assemblyInstructionId: string;
    hiddenComponentNodeIds: string[];
    updatedBy: string;
  }
) {
  return client
    .from("assemblyInstructionStep")
    .update({
      hiddenComponentNodeIds: data.hiddenComponentNodeIds,
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", data.id)
    .eq("assemblyInstructionId", data.assemblyInstructionId)
    .select("id")
    .single();
}

// Sub-assemblies: a header row (`isSubAssembly`) plus the steps whose
// `parentStepId` is the header, stored directly before it (play order). A
// header's `usedInStepId` is the later step that fits the finished unit.
// Every structural write loads the instruction's steps, applies the change in
// memory, checks `validateSubAssemblies` (the same rules the editor offers
// actions by) and writes the new order in one transaction.

type StepStructureRow = {
  id: string;
  sortOrder: number;
  componentNodeIds: string[];
  parentStepId: string | null;
  usedInStepId: string | null;
  isSubAssembly: boolean;
};

async function loadStepStructure(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  assemblyInstructionId: string
): Promise<StepStructureRow[]> {
  // Locking the instruction row serializes every structural write on it, so
  // each one validates against the order the previous one committed.
  const instruction = await db
    .selectFrom("assemblyInstruction")
    .select("status")
    .where("id", "=", assemblyInstructionId)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!instruction) throw new Error("Assembly instruction not found");
  if (instruction.status !== "Draft") {
    throw new Error("Only draft instructions can be edited");
  }

  return db
    .selectFrom("assemblyInstructionStep")
    .select([
      "id",
      "sortOrder",
      "componentNodeIds",
      "parentStepId",
      "usedInStepId",
      "isSubAssembly"
    ])
    .where("assemblyInstructionId", "=", assemblyInstructionId)
    .where("companyId", "=", companyId)
    .orderBy("sortOrder", "asc")
    .execute();
}

function assertValidStepStructure(steps: StepStructureRow[]) {
  const [violation] = validateSubAssemblies(steps);
  if (violation) throw new Error(violation.message);
}

/**
 * Write `next` (the instruction's steps in their new play order) as sortOrder
 * 1..n plus each row's sub-assembly links. Only rows that changed are touched.
 */
async function saveStepStructure(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    assemblyInstructionId: string;
    before: StepStructureRow[];
    next: StepStructureRow[];
  }
) {
  const beforeById = new Map(args.before.map((step) => [step.id, step]));
  const changed = args.next
    .map((step, index) => ({ ...step, sortOrder: index + 1 }))
    .filter((step) => {
      const was = beforeById.get(step.id);
      return (
        !was ||
        was.sortOrder !== step.sortOrder ||
        was.parentStepId !== step.parentStepId ||
        was.usedInStepId !== step.usedInStepId
      );
    });
  if (changed.length === 0) return;

  const values = sql.join(
    changed.map(
      (step) =>
        sql`(${step.id}::text, ${step.sortOrder}::double precision, ${step.parentStepId}::text, ${step.usedInStepId}::text)`
    )
  );
  const { rows } = await sql<{ id: string }>`
    UPDATE "assemblyInstructionStep" AS t
    SET "sortOrder" = v."sortOrder",
        "parentStepId" = v."parentStepId",
        "usedInStepId" = v."usedInStepId",
        "updatedBy" = ${args.userId},
        "updatedAt" = ${datetime.timestamp()}
    FROM (VALUES ${values}) AS v("id", "sortOrder", "parentStepId", "usedInStepId")
    WHERE t."id" = v."id"
      AND t."companyId" = ${args.companyId}
      AND t."assemblyInstructionId" = ${args.assemblyInstructionId}
    RETURNING t."id"
  `.execute(db);
  if (rows.length !== changed.length) {
    throw new Error("Some steps are not on this instruction");
  }
}

/**
 * Wrap a top-level step into a new sub-assembly; the step becomes its first step.
 */
export async function makeAssemblySubAssembly(
  db: Kysely<KyselyDatabase>,
  args: {
    assemblyInstructionId: string;
    stepId: string;
    companyId: string;
    userId: string;
  }
) {
  const { assemblyInstructionId, stepId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const before = await loadStepStructure(
      trx,
      companyId,
      assemblyInstructionId
    );
    const step = before.find((s) => s.id === stepId);
    if (!step) throw new Error("Step not found");
    if (step.isSubAssembly) {
      throw new Error("This step is already a sub-assembly");
    }
    if (step.parentStepId) {
      throw new Error("This step is already in a sub-assembly");
    }

    const header = await trx
      .insertInto("assemblyInstructionStep")
      .values({
        assemblyInstructionId,
        companyId,
        sortOrder: step.sortOrder,
        isSubAssembly: true,
        createdBy: userId
      })
      .returning(["id", "sortOrder"])
      .executeTakeFirstOrThrow();

    const headerRow: StepStructureRow = {
      id: header.id,
      sortOrder: header.sortOrder,
      componentNodeIds: [],
      parentStepId: null,
      usedInStepId: null,
      isSubAssembly: true
    };
    const next = before.flatMap((s) =>
      s.id === stepId ? [{ ...s, parentStepId: header.id }, headerRow] : [s]
    );
    assertValidStepStructure(next);
    await saveStepStructure(trx, {
      companyId,
      userId,
      assemblyInstructionId,
      before: [...before, headerRow],
      next
    });
    return header.id;
  });
}

/**
 * Add a step at the end of the instruction, or at the end of the sub-assembly
 * `parentStepId` names (directly before its header).
 */
export async function insertAssemblyInstructionStep(
  db: Kysely<KyselyDatabase>,
  args: AssemblyStepFields & {
    assemblyInstructionId: string;
    parentStepId?: string;
    companyId: string;
    userId: string;
  }
) {
  const { assemblyInstructionId, parentStepId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const before = await loadStepStructure(
      trx,
      companyId,
      assemblyInstructionId
    );
    if (
      parentStepId &&
      !before.find((s) => s.id === parentStepId)?.isSubAssembly
    ) {
      throw new Error("Sub-assembly not found");
    }

    const step = await trx
      .insertInto("assemblyInstructionStep")
      .values({
        assemblyInstructionId,
        companyId,
        ...newAssemblyStepColumns(args),
        sortOrder: before.length + 1,
        parentStepId: parentStepId ?? null,
        createdBy: userId
      })
      .returning(["id", "sortOrder", "componentNodeIds"])
      .executeTakeFirstOrThrow();

    const stepRow: StepStructureRow = {
      ...step,
      parentStepId: parentStepId ?? null,
      usedInStepId: null,
      isSubAssembly: false
    };
    const next = parentStepId
      ? before.flatMap((s) => (s.id === parentStepId ? [stepRow, s] : [s]))
      : [...before, stepRow];
    assertValidStepStructure(next);
    await saveStepStructure(trx, {
      companyId,
      userId,
      assemblyInstructionId,
      before: [...before, stepRow],
      next
    });
    return step.id;
  });
}

/**
 * Rename a sub-assembly and/or set the step that uses it (`null` = it joins the
 * main build). `undefined` leaves a field unchanged.
 */
export async function updateAssemblySubAssembly(
  db: Kysely<KyselyDatabase>,
  args: {
    assemblyInstructionId: string;
    headerId: string;
    title?: string;
    usedInStepId?: string | null;
    companyId: string;
    userId: string;
  }
) {
  const { assemblyInstructionId, headerId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const before = await loadStepStructure(
      trx,
      companyId,
      assemblyInstructionId
    );
    const header = before.find((s) => s.id === headerId);
    if (!header?.isSubAssembly) throw new Error("Sub-assembly not found");

    if (args.usedInStepId !== undefined) {
      assertValidStepStructure(
        before.map((s) =>
          s.id === headerId ? { ...s, usedInStepId: args.usedInStepId! } : s
        )
      );
    }

    await trx
      .updateTable("assemblyInstructionStep")
      .set({
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.usedInStepId !== undefined
          ? { usedInStepId: args.usedInStepId }
          : {}),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", headerId)
      .where("companyId", "=", companyId)
      .where("assemblyInstructionId", "=", assemblyInstructionId)
      .execute();
  });
}

/**
 * Remove the sub-assembly but keep its steps: they return to the top level in place.
 */
export async function ungroupAssemblySubAssembly(
  db: Kysely<KyselyDatabase>,
  args: {
    assemblyInstructionId: string;
    headerId: string;
    companyId: string;
    userId: string;
  }
) {
  const { assemblyInstructionId, headerId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const before = await loadStepStructure(
      trx,
      companyId,
      assemblyInstructionId
    );
    const header = before.find((s) => s.id === headerId);
    if (!header?.isSubAssembly) throw new Error("Sub-assembly not found");

    const next = before
      .filter((s) => s.id !== headerId)
      .map((s) =>
        s.parentStepId === headerId ? { ...s, parentStepId: null } : s
      );
    assertValidStepStructure(next);

    await trx
      .deleteFrom("assemblyInstructionStep")
      .where("id", "=", headerId)
      .where("companyId", "=", companyId)
      .where("assemblyInstructionId", "=", assemblyInstructionId)
      .execute();
    await saveStepStructure(trx, {
      companyId,
      userId,
      assemblyInstructionId,
      before,
      next
    });
  });
}

/**
 * Delete a sub-assembly together with its steps.
 */
export async function deleteAssemblySubAssembly(
  db: Kysely<KyselyDatabase>,
  args: {
    assemblyInstructionId: string;
    headerId: string;
    companyId: string;
    userId: string;
  }
) {
  const { assemblyInstructionId, headerId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    const before = await loadStepStructure(
      trx,
      companyId,
      assemblyInstructionId
    );
    const header = before.find((s) => s.id === headerId);
    if (!header?.isSubAssembly) throw new Error("Sub-assembly not found");

    const removed = new Set(
      before
        .filter((s) => s.id === headerId || s.parentStepId === headerId)
        .map((s) => s.id)
    );
    // Deleting a step that used another sub-assembly makes that one join the
    // main build (FK ON DELETE SET NULL); mirror it before validating.
    const next = before
      .filter((s) => !removed.has(s.id))
      .map((s) =>
        s.usedInStepId && removed.has(s.usedInStepId)
          ? { ...s, usedInStepId: null }
          : s
      );
    assertValidStepStructure(next);

    await trx
      .deleteFrom("assemblyInstructionStep")
      .where("id", "in", [...removed])
      .where("companyId", "=", companyId)
      .where("assemblyInstructionId", "=", assemblyInstructionId)
      .execute();
    await saveStepStructure(trx, {
      companyId,
      userId,
      assemblyInstructionId,
      before: before.map((s) =>
        s.usedInStepId && removed.has(s.usedInStepId)
          ? { ...s, usedInStepId: null }
          : s
      ),
      next
    });
  });
}

// Assign a set of component instances to a target step. `duplicate` unions them
// onto the target only (a component may live on several steps). `move` unions
// them onto the target AND strips them from every other step, so the component
// ends up on exactly the target. `remove` (no target) strips them from EVERY
// step, unassigning them entirely. One transaction: a half-applied move (added
// to target but not removed from the source, or vice versa) would be a real bug.
/** Not published: `reassignAssemblyComponents` also adds the target step's materials. */
export async function reassignAssemblyStepComponents(
  db: Kysely<KyselyDatabase>,
  data: {
    assemblyInstructionId: string;
    companyId: string;
    targetStepId?: string;
    componentNodeIds: string[];
    mode: "move" | "duplicate" | "remove";
    updatedBy: string;
  }
) {
  const moving = new Set(data.componentNodeIds);
  return db.transaction().execute(async (trx) => {
    const steps = await trx
      .selectFrom("assemblyInstructionStep")
      .select(["id", "componentNodeIds"])
      .where("assemblyInstructionId", "=", data.assemblyInstructionId)
      .where("companyId", "=", data.companyId)
      .execute();

    const now = new Date().toISOString();
    for (const step of steps) {
      const current = (step.componentNodeIds ?? []) as string[];
      let next: string[];
      if (data.mode !== "remove" && step.id === data.targetStepId) {
        const merged = new Set(current);
        for (const nodeId of moving) merged.add(nodeId);
        next = [...merged];
      } else if (data.mode === "move" || data.mode === "remove") {
        next = current.filter((nodeId) => !moving.has(nodeId));
      } else {
        continue; // duplicate: other steps are untouched
      }
      // Skip a no-op write (nothing added/removed for this step).
      if (
        next.length === current.length &&
        next.every((nodeId, index) => nodeId === current[index])
      ) {
        continue;
      }
      // A move that empties a source step (it had components, now none) leaves a
      // meaningless orphan — drop it. The target step is never emptied (it gains
      // parts), and an already-empty process step (current.length === 0) is left
      // alone.
      if (
        step.id !== data.targetStepId &&
        current.length > 0 &&
        next.length === 0
      ) {
        await trx
          .deleteFrom("assemblyInstructionStep")
          .where("id", "=", step.id)
          .where("companyId", "=", data.companyId)
          .execute();
        continue;
      }
      await trx
        .updateTable("assemblyInstructionStep")
        .set({
          componentNodeIds: next,
          updatedBy: data.updatedBy,
          updatedAt: now
        })
        .where("id", "=", step.id)
        .where("companyId", "=", data.companyId)
        .execute();
    }

    // Keep UNIT membership in step with STEP membership. The Components tab
    // groups by `assemblyUnit`, so moving a part into a step that installs a unit
    // (e.g. the PCB step) must also add it to that unit — otherwise it shows as a
    // loose leaf that never joins the group. `assemblyUnit` is model-scoped.
    const targetStep = steps.find((s) => s.id === data.targetStepId);
    const preMove = ((targetStep?.componentNodeIds ?? []) as string[]).filter(
      (nodeId) => !moving.has(nodeId)
    );
    const model = await trx
      .selectFrom("assemblyInstruction")
      .select("modelUploadId")
      .where("id", "=", data.assemblyInstructionId)
      .where("companyId", "=", data.companyId)
      .executeTakeFirst();
    if (model?.modelUploadId) {
      const units = await trx
        .selectFrom("assemblyUnit")
        .select(["id", "componentNodeIds"])
        .where("modelUploadId", "=", model.modelUploadId)
        .where("companyId", "=", data.companyId)
        .execute();

      // The unit the target step installs = the tightest unit whose members
      // cover the step's pre-move components. None ⇒ a loose step (leave units).
      let targetUnitId: string | null = null;
      if (preMove.length > 0) {
        let bestSize = Number.POSITIVE_INFINITY;
        for (const unit of units) {
          const members = new Set((unit.componentNodeIds ?? []) as string[]);
          if (
            preMove.every((nodeId) => members.has(nodeId)) &&
            members.size < bestSize
          ) {
            bestSize = members.size;
            targetUnitId = unit.id;
          }
        }
      }

      for (const unit of units) {
        const members = new Set((unit.componentNodeIds ?? []) as string[]);
        let changed = false;
        // move/remove: a component leaves every unit it was in (units stay
        // disjoint; a pure remove just unassigns it)…
        if (data.mode === "move" || data.mode === "remove") {
          for (const nodeId of moving)
            if (members.delete(nodeId)) changed = true;
        }
        // …and joins the unit its new step installs.
        if (unit.id === targetUnitId) {
          for (const nodeId of moving)
            if (!members.has(nodeId)) {
              members.add(nodeId);
              changed = true;
            }
        }
        if (changed) {
          await trx
            .updateTable("assemblyUnit")
            .set({
              componentNodeIds: [...members],
              updatedBy: data.updatedBy,
              updatedAt: now
            })
            .where("id", "=", unit.id)
            .where("companyId", "=", data.companyId)
            .execute();
        }
      }
    }
  });
}

async function getNextStepSortOrder(
  client: SupabaseClient<Database>,
  data: { assemblyInstructionId: string }
) {
  const lastStep = await client
    .from("assemblyInstructionStep")
    .select("sortOrder")
    .eq("assemblyInstructionId", data.assemblyInstructionId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (lastStep.data?.sortOrder ?? 0) + 1;
}

export async function updateAssemblyInstructionStepStatus(
  client: SupabaseClient<Database>,
  id: string,
  data: {
    status: (typeof assemblyStepStatuses)[number];
    updatedBy: string;
  }
) {
  return client
    .from("assemblyInstructionStep")
    .update({
      status: data.status,
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/**
 * Drag-sort of the step list: each step's new position and sub-assembly
 * (`parentStepId`, `null` = top level; omitted = unchanged). The result must
 * satisfy the sub-assembly rules or nothing is written.
 */
export async function updateAssemblyInstructionStepOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  assemblyInstructionId: string,
  updates: { id: string; sortOrder: number; parentStepId?: string | null }[]
) {
  return db.transaction().execute(async (trx) => {
    const before = await loadStepStructure(
      trx,
      companyId,
      assemblyInstructionId
    );
    const updateById = new Map(updates.map((update) => [update.id, update]));
    if (updateById.size !== updates.length) {
      throw new Error("A step appears twice in the new order");
    }
    if (updates.some((update) => !before.some((s) => s.id === update.id))) {
      throw new Error("Some steps are not on this instruction");
    }

    const next = before
      .map((step) => {
        const update = updateById.get(step.id);
        if (!update) return step;
        return {
          ...step,
          sortOrder: update.sortOrder,
          parentStepId:
            update.parentStepId === undefined
              ? step.parentStepId
              : update.parentStepId
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
    assertValidStepStructure(next);
    await saveStepStructure(trx, {
      companyId,
      userId,
      assemblyInstructionId,
      before,
      next
    });
  });
}

export async function deleteAssemblyInstructionStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstructionStep").delete().eq("id", id);
}

export async function getAssemblyInstructionStepSlides(
  client: SupabaseClient<Database>,
  stepIds: string[]
) {
  if (stepIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("assemblyInstructionStepSlide")
    .select("*")
    .in("stepId", stepIds)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstructionStepSlide(
  client: SupabaseClient<Database>,
  slide:
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        companyId: string;
        createdBy: string;
      })
    | (Omit<
        z.infer<typeof operationStepSlideValidator>,
        "id" | "annotations"
      > & {
        annotations?: z.infer<
          typeof operationStepSlideValidator
        >["annotations"];
        id: string;
        updatedBy: string;
        updatedAt: string;
      })
) {
  if ("createdBy" in slide) {
    return client
      .from("assemblyInstructionStepSlide")
      .insert(slide)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStepSlide")
    .update(sanitize(slide))
    .eq("id", slide.id)
    .select("id")
    .single();
}

export async function deleteAssemblyInstructionStepSlide(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstructionStepSlide").delete().eq("id", id);
}

export async function getAssemblyInstructionStepTools(
  client: SupabaseClient<Database>,
  stepIds: string[]
) {
  if (stepIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("assemblyInstructionStepTool")
    .select("*, item(id, name, readableIdWithRevision)")
    .in("stepId", stepIds)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstructionStepTool(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    stepId: string;
    itemId: string;
    quantity?: number;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyInstructionStepTool")
      .update({
        itemId: data.itemId,
        quantity: data.quantity ?? 1,
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStepTool")
    .insert({
      stepId: data.stepId,
      itemId: data.itemId,
      quantity: data.quantity ?? 1,
      sortOrder:
        data.sortOrder ?? (await getNextStepToolSortOrder(client, data)),
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

async function getNextStepToolSortOrder(
  client: SupabaseClient<Database>,
  data: { stepId: string }
) {
  const last = await client
    .from("assemblyInstructionStepTool")
    .select("sortOrder")
    .eq("stepId", data.stepId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (last.data?.sortOrder ?? 0) + 1;
}

export async function deleteAssemblyInstructionStepTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstructionStepTool").delete().eq("id", id);
}

export async function getAssemblyInstructionStepMaterials(
  client: SupabaseClient<Database>,
  stepIds: string[]
) {
  if (stepIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("assemblyInstructionStepMaterial")
    .select("*, item(id, name, readableIdWithRevision)")
    .in("stepId", stepIds)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstructionStepMaterial(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    stepId: string;
    itemId: string;
    quantity?: number | null;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyInstructionStepMaterial")
      .update({
        itemId: data.itemId,
        quantity: data.quantity ?? null,
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStepMaterial")
    .insert({
      stepId: data.stepId,
      itemId: data.itemId,
      quantity: data.quantity ?? null,
      sortOrder:
        data.sortOrder ?? (await getNextStepMaterialSortOrder(client, data)),
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

async function getNextStepMaterialSortOrder(
  client: SupabaseClient<Database>,
  data: { stepId: string }
) {
  const last = await client
    .from("assemblyInstructionStepMaterial")
    .select("sortOrder")
    .eq("stepId", data.stepId)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (last.data?.sortOrder ?? 0) + 1;
}

export async function updateAssemblyInstructionStepMaterialOrder(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  userId: string,
  assemblyInstructionId: string,
  updates: { id: string; sortOrder: number }[]
) {
  return updateSortOrder(db, {
    table: "assemblyInstructionStepMaterial",
    column: "sortOrder",
    companyId,
    userId,
    // A material hangs off a step, so it is scoped to the instruction
    // through that step.
    parent: {
      column: "stepId",
      via: {
        table: "assemblyInstructionStep",
        column: "assemblyInstructionId",
        id: assemblyInstructionId
      }
    },
    updates
  });
}

export async function deleteAssemblyInstructionStepMaterial(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstructionStepMaterial").delete().eq("id", id);
}

type AssemblyStepMaterialSeed = {
  stepId: string;
  itemId: string;
  quantity: number;
  sortOrder: number;
};

/**
 * The step-material rows implied by each step's components: groups a step's
 * componentNodeIds by geometry, resolves each group through the model's
 * component→BOM mappings, and returns rows for matches the step doesn't
 * already have. Quantity is the component's instance count within the step.
 */
function deriveAssemblyStepMaterialSeeds(args: {
  steps: { id: string; componentNodeIds: string[] | null }[];
  graphIndex: AssemblyGraphIndex;
  itemIdByGeometryHash: Map<string, string>;
  /** stepId → already-linked itemIds; never re-added, so manual edits win */
  existingItemIds?: Map<string, Set<string>>;
  /** stepId → sortOrder to start appending at */
  nextSortOrder?: Map<string, number>;
  /** Restrict to component groups containing one of these instances */
  onlyComponentNodeIds?: Set<string>;
}): AssemblyStepMaterialSeed[] {
  const only = args.onlyComponentNodeIds;
  const seeds: AssemblyStepMaterialSeed[] = [];
  for (const step of args.steps) {
    const groups = groupComponentNodeIds(
      step.componentNodeIds ?? [],
      args.graphIndex
    );
    const used = args.existingItemIds?.get(step.id);
    // Two geometries can map to the same BOM item — aggregate their counts
    const quantities = new Map<string, number>();
    for (const group of groups) {
      if (only && !group.nodeIds.some((nodeId) => only.has(nodeId))) {
        continue;
      }
      const itemId = args.itemIdByGeometryHash.get(group.key);
      if (!itemId || used?.has(itemId)) continue;
      quantities.set(itemId, (quantities.get(itemId) ?? 0) + group.count);
    }
    let sortOrder = args.nextSortOrder?.get(step.id) ?? 1;
    for (const [itemId, quantity] of quantities) {
      seeds.push({ stepId: step.id, itemId, quantity, sortOrder: sortOrder++ });
    }
  }
  return seeds;
}

function insertAssemblyStepMaterialSeeds(
  client: SupabaseClient<Database>,
  seeds: AssemblyStepMaterialSeed[],
  args: { companyId: string; userId: string }
) {
  // ignoreDuplicates makes concurrent syncs race-safe on (stepId, itemId)
  return client.from("assemblyInstructionStepMaterial").upsert(
    seeds.map((seed) => ({
      ...seed,
      companyId: args.companyId,
      createdBy: args.userId
    })),
    { onConflict: "stepId,itemId", ignoreDuplicates: true }
  );
}

/**
 * Adds the BOM items matched to each step's components (via
 * assemblyComponentMapping) as step materials. Additive and best-effort:
 * existing rows are never updated or removed — manual quantities and
 * deliberate deletions survive — and failures never block the caller.
 */
export async function syncAssemblyStepMaterialsFromMappings(
  client: SupabaseClient<Database>,
  args: {
    assemblyInstructionId: string;
    companyId: string;
    userId: string;
    /** Limit to these steps (default: every step of the instruction) */
    stepIds?: string[];
    /** Limit to these mappings (e.g. one just created) */
    geometryHashes?: string[];
    /** Limit to component groups containing one of these instances */
    onlyComponentNodeIds?: string[];
  }
): Promise<{ created: number }> {
  const instruction = await client
    .from("assemblyInstruction")
    .select("id, modelUploadId, modelUpload(graphPath)")
    .eq("id", args.assemblyInstructionId)
    .single();
  const modelUploadId = instruction.data?.modelUploadId;
  const graphPath = instruction.data?.modelUpload?.graphPath;
  if (instruction.error || !modelUploadId || !graphPath) {
    return { created: 0 };
  }

  const mappings = await getAssemblyComponentMappings(client, modelUploadId);
  const hashFilter = args.geometryHashes ? new Set(args.geometryHashes) : null;
  const itemIdByGeometryHash = new Map<string, string>();
  for (const mapping of mappings.data ?? []) {
    if (hashFilter && !hashFilter.has(mapping.geometryHash)) continue;
    itemIdByGeometryHash.set(mapping.geometryHash, mapping.itemId);
  }
  if (itemIdByGeometryHash.size === 0) return { created: 0 };

  let stepsQuery = client
    .from("assemblyInstructionStep")
    .select("id, componentNodeIds")
    .eq("assemblyInstructionId", args.assemblyInstructionId);
  if (args.stepIds?.length) {
    stepsQuery = stepsQuery.in("id", args.stepIds);
  }
  const steps = await stepsQuery;
  if (!steps.data?.length) return { created: 0 };

  const graphFile = await storage(client)
    .company(args.companyId)
    .download(graphPath);
  if (!graphFile.data) return { created: 0 };
  let graphIndex: AssemblyGraphIndex;
  try {
    graphIndex = indexAssemblyGraph(
      JSON.parse(await graphFile.data.text()) as AssemblyGraph
    );
  } catch {
    return { created: 0 };
  }

  const existing = await client
    .from("assemblyInstructionStepMaterial")
    .select("stepId, itemId, sortOrder")
    .in(
      "stepId",
      steps.data.map((step) => step.id)
    );
  const existingItemIds = new Map<string, Set<string>>();
  const nextSortOrder = new Map<string, number>();
  for (const row of existing.data ?? []) {
    const itemIds = existingItemIds.get(row.stepId) ?? new Set<string>();
    itemIds.add(row.itemId);
    existingItemIds.set(row.stepId, itemIds);
    nextSortOrder.set(
      row.stepId,
      Math.max(nextSortOrder.get(row.stepId) ?? 1, row.sortOrder + 1)
    );
  }

  const seeds = deriveAssemblyStepMaterialSeeds({
    steps: steps.data,
    graphIndex,
    itemIdByGeometryHash,
    existingItemIds,
    nextSortOrder,
    onlyComponentNodeIds: args.onlyComponentNodeIds
      ? new Set(args.onlyComponentNodeIds)
      : undefined
  });
  if (seeds.length === 0) return { created: 0 };

  const insert = await insertAssemblyStepMaterialSeeds(client, seeds, args);
  return { created: insert.error ? 0 : seeds.length };
}

export async function getAssemblyUnits(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  return client
    .from("assemblyUnit")
    .select("*")
    .eq("modelUploadId", modelUploadId)
    .order("name");
}

export async function upsertAssemblyUnit(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    modelUploadId: string;
    name: string;
    componentNodeIds: string[];
    itemId?: string | null;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyUnit")
      .update({
        name: data.name,
        componentNodeIds: data.componentNodeIds,
        itemId: data.itemId ?? null,
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyUnit")
    .insert({
      modelUploadId: data.modelUploadId,
      name: data.name,
      componentNodeIds: data.componentNodeIds,
      itemId: data.itemId ?? null,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function deleteAssemblyUnit(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyUnit").delete().eq("id", id);
}

/**
 * Latest successful motion plan for a model. The editor uses plan.json to
 * auto-fill step motions and to generate draft step sequences.
 */
export async function getLatestAssemblyPlan(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  return client
    .from("assemblyPlanJob")
    .select("id, planPath, stats, createdAt")
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan")
    .eq("status", "Success")
    .not("planPath", "is", null)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
}

/**
 * Latest plan job in any state — used to tell "planning is running" apart
 * from "planning failed" and to avoid enqueueing duplicate plan runs.
 */
export async function getLatestAssemblyPlanJob(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  return client
    .from("assemblyPlanJob")
    .select("id, status, error, planPath, createdAt")
    .eq("modelUploadId", modelUploadId)
    .eq("kind", "plan")
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
}

/**
 * Pre-creates the Queued plan job row BEFORE the `assembly-plan` event is
 * sent, so the very next loader read sees a live run (badge, disabled button,
 * polling). The worker adopts the row via the event's `planJobId` and flips
 * it to Processing; without this the row only exists after event pickup, and
 * the post-action revalidation lands in that gap — nothing polls, and the run
 * (and its finished motions) never surface without a manual reload.
 *
 * The job row only; `replanAssembly` and `generateAssemblySteps` start a plan.
 */
export async function createAssemblyPlanJob(
  client: SupabaseClient<Database>,
  args: { modelUploadId: string; companyId: string; userId: string }
) {
  return client
    .from("assemblyPlanJob")
    .insert({
      modelUploadId: args.modelUploadId,
      kind: "plan",
      status: "Queued",
      companyId: args.companyId,
      createdBy: args.userId
    })
    .select("id")
    .single();
}

/** Downloads and parses plan.json for a model's latest successful plan.

 * Plans written by an older planner *version* are treated as ABSENT: the
 * stored artifact is keyed to the model upload, so without this gate a
 * format-stale plan could silently resurrect old motions. (Deleting an
 * instruction now also invalidates the plan for its model — see
 * invalidateAssemblyPlanCache — but this gate still guards the shared-model
 * case and same-version format drift.) Absence flows into the existing
 * no-plan path, which triggers a fresh planner run and auto-generates steps
 * when it lands.
 */
export async function getAssemblyPlanJson(
  client: SupabaseClient<Database>,
  modelUploadId: string
): Promise<AssemblyPlan | null> {
  const job = await getLatestAssemblyPlan(client, modelUploadId);
  if (!job.data?.planPath) return null;

  // Private object paths are prefixed with the owning company's id.
  const planCompanyId = job.data.planPath.split("/")[0];
  const file = await storage(client)
    .company(planCompanyId)
    .download(job.data.planPath);
  if (!file.data) return null;

  try {
    const plan = JSON.parse(await file.data.text()) as AssemblyPlan;
    if ((plan.version ?? 1) < CURRENT_PLAN_VERSION) return null;
    return plan;
  } catch {
    return null;
  }
}

// --- Model component ↔ engineering BOM mappings --------------------------

/**
 * Mappings from distinct model components (geometry hashes) to BOM items.
 */
export async function getAssemblyComponentMappings(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  return client
    .from("assemblyComponentMapping")
    .select("*, item(id, name, readableIdWithRevision)")
    .eq("modelUploadId", modelUploadId);
}

/** Not published: `mapAssemblyComponent` also adds the item to the steps. */
export async function upsertAssemblyComponentMapping(
  client: SupabaseClient<Database>,
  data: {
    modelUploadId: string;
    geometryHash: string;
    itemId: string;
    confidence?: "high" | "low";
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("assemblyComponentMapping")
    .upsert(
      {
        modelUploadId: data.modelUploadId,
        geometryHash: data.geometryHash,
        itemId: data.itemId,
        confidence: data.confidence ?? "high",
        companyId: data.companyId,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
        updatedAt: new Date().toISOString()
      },
      { onConflict: "modelUploadId,geometryHash" }
    )
    .select("id")
    .single();
}

export async function deleteAssemblyComponentMapping(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyComponentMapping").delete().eq("id", id);
}

export type FlattenedBomMaterial = {
  itemId: string;
  name: string | null;
  readableIdWithRevision: string | null;
  /** Total quantity per one parent assembly (multiplied through levels) */
  quantity: number;
  methodType: string;
  depth: number;
};

/**
 * The engineering bill of materials for a made item, flattened through its
 * Make subassemblies (makeMethod → methodMaterial → materialMakeMethodId),
 * with quantities multiplied per level. Uses the Active make method, or
 * the first one when none is active.
 */
export async function getFlattenedBomMaterials(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
): Promise<FlattenedBomMaterial[]> {
  const makeMethods = await client
    .from("makeMethod")
    .select("id, status")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  if (makeMethods.error || !makeMethods.data?.length) return [];

  const active =
    makeMethods.data.find((method) => method.status === "Active") ??
    makeMethods.data[0];
  if (!active) return [];

  const results: FlattenedBomMaterial[] = [];
  const visited = new Set<string>();

  const walk = async (
    makeMethodId: string,
    multiplier: number,
    depth: number
  ): Promise<void> => {
    if (depth > 5 || visited.has(makeMethodId)) return;
    visited.add(makeMethodId);

    const materials = await client
      .from("methodMaterial")
      .select(
        "id, itemId, quantity, methodType, materialMakeMethodId, item(id, name, readableIdWithRevision)"
      )
      .eq("makeMethodId", makeMethodId)
      .order("order", { ascending: true });

    for (const material of materials.data ?? []) {
      if (!material.itemId) continue;
      const quantity = (material.quantity ?? 1) * multiplier;
      results.push({
        itemId: material.itemId,
        name: material.item?.name ?? null,
        readableIdWithRevision: material.item?.readableIdWithRevision ?? null,
        quantity,
        methodType: material.methodType,
        depth
      });
      if (material.materialMakeMethodId) {
        await walk(material.materialMakeMethodId, quantity, depth + 1);
      }
    }
  };

  await walk(active.id, 1, 0);
  return results;
}

export type AutoMatchResult = {
  mapped: number;
  totalComponents: number;
  unmatchedBomItems: string[];
};

/**
 * Suggests and persists component→BOM mappings for an instruction's model:
 * strong name matches first (greedy, best score wins), then unique
 * quantity matches (a component appearing N times matched to the only BOM line
 * with quantity N) as low-confidence fallbacks. Existing mappings are kept.
 *
 * Not published: `matchAssemblyBom` also backfills the steps' materials.
 */
export async function autoMatchAssemblyComponents(
  client: SupabaseClient<Database>,
  args: { assemblyInstructionId: string; companyId: string; userId: string }
): Promise<AutoMatchResult | { error: string }> {
  const instruction = await client
    .from("assemblyInstruction")
    .select("id, itemId, modelUploadId, modelUpload(graphPath)")
    .eq("id", args.assemblyInstructionId)
    .single();
  if (instruction.error || !instruction.data.modelUploadId) {
    return { error: "This instruction has no model" };
  }
  if (!instruction.data.itemId) {
    return { error: "Link the instruction to an item first" };
  }
  const graphPath = instruction.data.modelUpload?.graphPath;
  if (!graphPath) {
    return { error: "The model has not been processed" };
  }

  const graphFile = await storage(client)
    .company(args.companyId)
    .download(graphPath);
  if (!graphFile.data) {
    return { error: "Failed to load the model graph" };
  }
  let graph: AssemblyGraph;
  try {
    graph = JSON.parse(await graphFile.data.text()) as AssemblyGraph;
  } catch {
    return { error: "Failed to parse the model graph" };
  }

  // Distinct parts: hash → { name, count }
  const componentGroups = new Map<string, { name: string; count: number }>();
  const visit = (node: AssemblyGraph["root"]) => {
    if (!node.children.length) {
      const key = node.geometryHash ?? `name:${node.name}`;
      const group = componentGroups.get(key);
      if (group) group.count++;
      else componentGroups.set(key, { name: node.name, count: 1 });
    }
    for (const child of node.children) visit(child);
  };
  visit(graph.root);

  const bom = await getFlattenedBomMaterials(
    client,
    instruction.data.itemId,
    args.companyId
  );
  if (bom.length === 0) {
    return { error: "The item has no bill of materials" };
  }

  const existing = await getAssemblyComponentMappings(
    client,
    instruction.data.modelUploadId
  );
  const mappedHashes = new Set(
    (existing.data ?? []).map((mapping) => mapping.geometryHash)
  );
  const usedItemIds = new Set(
    (existing.data ?? []).map((mapping) => mapping.itemId)
  );

  type Suggestion = {
    geometryHash: string;
    itemId: string;
    score: number;
    confidence: "high" | "low";
  };
  const suggestions: Suggestion[] = [];

  // Name-based candidates, all pairs above threshold, greedy by score
  for (const [hash, group] of componentGroups) {
    if (mappedHashes.has(hash)) continue;
    for (const material of bom) {
      const score = nameSimilarity(group.name, material.name ?? "");
      if (score >= 0.45) {
        suggestions.push({
          geometryHash: hash,
          itemId: material.itemId,
          score,
          confidence: score >= 0.7 ? "high" : "low"
        });
      }
    }
  }
  suggestions.sort((a, b) => b.score - a.score);

  const matchedHashes = new Set<string>(mappedHashes);
  const matchedItems = new Set<string>(usedItemIds);
  const accepted: Suggestion[] = [];
  for (const suggestion of suggestions) {
    if (matchedHashes.has(suggestion.geometryHash)) continue;
    if (matchedItems.has(suggestion.itemId)) continue;
    matchedHashes.add(suggestion.geometryHash);
    matchedItems.add(suggestion.itemId);
    accepted.push(suggestion);
  }

  // Quantity fallback: a still-unmatched part whose instance count equals
  // exactly one still-unmatched BOM line's quantity. Index the unmatched groups
  // and BOM lines by count once (instead of rescanning both per group), and
  // prune the buckets as matches land so the "exactly one" checks stay O(1).
  const unmatchedGroupsByCount = new Map<number, string[]>();
  for (const [hash, group] of componentGroups) {
    if (matchedHashes.has(hash)) continue;
    const bucket = unmatchedGroupsByCount.get(group.count);
    if (bucket) bucket.push(hash);
    else unmatchedGroupsByCount.set(group.count, [hash]);
  }
  const unmatchedBomByCount = new Map<number, string[]>();
  for (const material of bom) {
    if (matchedItems.has(material.itemId)) continue;
    const count = Math.round(material.quantity);
    const bucket = unmatchedBomByCount.get(count);
    if (bucket) bucket.push(material.itemId);
    else unmatchedBomByCount.set(count, [material.itemId]);
  }
  for (const [hash, group] of componentGroups) {
    if (matchedHashes.has(hash)) continue;
    const groupBucket = unmatchedGroupsByCount.get(group.count) ?? [];
    const bomBucket = unmatchedBomByCount.get(group.count) ?? [];
    const candidateItemId = bomBucket[0];
    if (groupBucket.length === 1 && bomBucket.length === 1 && candidateItemId) {
      matchedHashes.add(hash);
      matchedItems.add(candidateItemId);
      unmatchedGroupsByCount.set(group.count, []);
      unmatchedBomByCount.set(group.count, []);
      accepted.push({
        geometryHash: hash,
        itemId: candidateItemId,
        score: 0,
        confidence: "low"
      });
    }
  }

  // One bulk upsert instead of a round-trip per accepted mapping — this runs on
  // the first-generation critical path. Same conflict target as the single-row
  // helper (upsertAssemblyComponentMapping).
  if (accepted.length > 0) {
    const now = new Date().toISOString();
    await client.from("assemblyComponentMapping").upsert(
      accepted.map((suggestion) => ({
        modelUploadId: instruction.data.modelUploadId,
        geometryHash: suggestion.geometryHash,
        itemId: suggestion.itemId,
        confidence: suggestion.confidence,
        companyId: args.companyId,
        createdBy: args.userId,
        updatedBy: args.userId,
        updatedAt: now
      })),
      { onConflict: "modelUploadId,geometryHash" }
    );
  }

  return {
    mapped: matchedHashes.size,
    totalComponents: componentGroups.size,
    unmatchedBomItems: bom
      .filter((material) => !matchedItems.has(material.itemId))
      .map(
        (material) =>
          material.readableIdWithRevision ?? material.name ?? material.itemId
      )
  };
}

type GenerateStepsResult =
  | { ok: true; created: number; unmappedComponentCount: number }
  | {
      ok: false;
      reason: "no-model" | "no-plan" | "steps-exist" | "steps-locked" | "error";
      modelUploadId?: string;
      message?: string;
    };

// Minimal tiptap document wrapping a plain-text instruction, for source steps that
// have text but no rich description.
function plainTextToTiptap(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  };
}

/**
 * Assembly → BOP sync: copy a Published instruction's steps into a BOP operation
 * as real method/job operation steps (the typed fields mirror by design), link
 * each step's BOM parts via the material↔step join table, attach the
 * instruction's 3D model as a model slide on every synced step, and point the
 * operation at the instruction. Re-runnable: rows carry an
 * `assemblyInstructionStepId` provenance marker, so a re-sync updates matched
 * steps in place (keeping their ids — slides, records, and links survive),
 * inserts new ones, and deletes synced steps whose source step is gone.
 * Hand-authored steps (NULL marker) are never touched. One transaction: a
 * half-synced BOP would be a real bug. Guards (Draft method / unlocked job,
 * permissions) belong to the route — Kysely bypasses RLS.
 */
/**
 * Maps a job step's marker from an OLD instruction version's step id to the
 * equivalent step id in the NEWLY-ACTIVATED version, by lineage group
 * (COALESCE(rootStepId, id) — the same idiom as rootInstructionId).
 *
 * A step that survives across versions keeps its identity even when reordered
 * or retitled, so the caller can UPDATE it in place and preserve the operator's
 * completion records. Steps with no counterpart in the new version are left
 * unmapped — the caller's re-sync then treats them as stale. Pure so the
 * remapping is unit-testable.
 *
 * `oldSteps` spans EVERY older sibling version, so several of them can share a
 * lineage root and collapse onto the same new step id. That is safe only
 * because a job operation's markers all come from a single version (both
 * writers — the step insert and planOrphanStepAdoption — only ever write ids
 * from the instruction being synced), so at most one of those entries can match
 * any given row. There is no unique constraint enforcing it.
 */
export function planAssemblyStepMarkerRemap(
  oldSteps: { id: string; rootStepId: string | null }[],
  newSteps: { id: string; rootStepId: string | null }[]
): Map<string, string> {
  const newIdByRoot = new Map<string, string>();
  for (const step of newSteps) {
    const root = step.rootStepId ?? step.id;
    // First writer wins: a well-formed version has one step per lineage group.
    if (!newIdByRoot.has(root)) newIdByRoot.set(root, step.id);
  }

  const remap = new Map<string, string>();
  for (const step of oldSteps) {
    const root = step.rootStepId ?? step.id;
    const newId = newIdByRoot.get(root);
    if (newId && newId !== step.id) remap.set(step.id, newId);
  }
  return remap;
}

/**
 * The name a synced job step is written with. `title` is nullable on the
 * instruction step but `name` is NOT NULL on the job step, so a null title
 * becomes a positional placeholder. Adoption below must compare against this
 * same value, not the raw title — otherwise a null-titled step's job step is
 * named "Step 3" and can never be matched back to its source.
 */
function assemblyStepName(title: string | null, index: number) {
  return title || `Step ${index + 1}`;
}

/**
 * Re-adopts job steps orphaned by the assemblyInstructionStepId ON DELETE SET
 * NULL cascade (deleting an instruction step nulls the marker on every live
 * job synced from it). Without this a re-sync treats them as hand-authored and
 * inserts duplicates beside them.
 *
 * Deliberately conservative: an orphan is claimed only when it matches a source
 * step on BOTH position and name AND no already-marked step claims that source
 * step. Genuinely hand-authored steps match no source step and are untouched;
 * ambiguous cases are left alone rather than guessed at.
 *
 * Position is where the sync wrote the step: after the operation's own steps
 * (the unmarked steps that share no name with a source step), in source order.
 * Steps synced before that numbering sit at the source step's own sortOrder.
 */
export function planOrphanStepAdoption(
  sourceSteps: { id: string; title: string | null; sortOrder: number | null }[],
  orphanSteps: { id: string; name: string | null; sortOrder: number | null }[],
  claimedSourceIds: Set<string>
): Map<string, string> {
  const adoption = new Map<string, string>();
  const takenOrphans = new Set<string>();

  const sourceNames = new Set(
    sourceSteps.map((source, index) => assemblyStepName(source.title, index))
  );
  const lastOwnSortOrder = Math.max(
    0,
    ...orphanSteps
      .filter((orphan) => orphan.name === null || !sourceNames.has(orphan.name))
      .map((orphan) => orphan.sortOrder ?? 0)
  );

  sourceSteps.forEach((source, index) => {
    if (claimedSourceIds.has(source.id)) return;
    const sourceName = assemblyStepName(source.title, index);
    const match = orphanSteps.find(
      (orphan) =>
        !takenOrphans.has(orphan.id) &&
        orphan.name === sourceName &&
        (orphan.sortOrder === lastOwnSortOrder + 1 + index ||
          orphan.sortOrder === source.sortOrder)
    );
    if (match) {
      adoption.set(match.id, source.id);
      takenOrphans.add(match.id);
    }
  });
  return adoption;
}

/**
 * Marker-based step reconciliation for the assembly→BoP sync. Given the current
 * source step ids and the operation's existing synced steps (each carrying the
 * `assemblyInstructionStepId` provenance marker), decide which source maps onto
 * an existing target (update) vs. is new (insert), and which existing synced
 * steps are stale — their source step was removed, so they must be deleted
 * (cascading their slides/links).
 *
 * The caller passes only marked steps: hand-authored steps (NULL marker) are
 * filtered out, and orphans re-adopted by planOrphanStepAdoption arrive here
 * already carrying the marker they were adopted onto. A null marker reaching
 * this function is therefore treated as stale. Pure so the reconciliation is
 * unit-testable.
 */
export function planAssemblyStepMarkerSync(
  sourceStepIds: string[],
  existingSynced: { id: string; assemblyInstructionStepId: string | null }[]
): { targetIdBySourceId: Map<string, string>; staleTargetIds: string[] } {
  const targetIdBySourceId = new Map<string, string>();
  for (const step of existingSynced) {
    if (step.assemblyInstructionStepId) {
      targetIdBySourceId.set(step.assemblyInstructionStepId, step.id);
    }
  }
  const sourceIdSet = new Set(sourceStepIds);
  const staleTargetIds = existingSynced
    .filter(
      (step) =>
        !step.assemblyInstructionStepId ||
        !sourceIdSet.has(step.assemblyInstructionStepId)
    )
    .map((step) => step.id);
  return { targetIdBySourceId, staleTargetIds };
}

/**
 * The re-sync ratchets a tool's operation-level quantity up to the max quantity
 * any source step asks for (operation-level rows are never lowered or deleted).
 */
export function maxToolQuantityByItem(
  sourceTools: { itemId: string; quantity: number | null }[]
): Map<string, number> {
  const max = new Map<string, number>();
  for (const tool of sourceTools) {
    max.set(
      tool.itemId,
      Math.max(max.get(tool.itemId) ?? 0, tool.quantity ?? 1)
    );
  }
  return max;
}

/**
 * Build the `jobOperationToolStep` link rows for a re-sync. Links are rebuilt
 * ONLY from the current source tools, so a tool removed from the instruction —
 * whose `jobOperationTool` row is intentionally never deleted — ends up with
 * zero links and therefore behaves as an operation-level tool (shown on every
 * step). That is the documented re-sync contract; this returns exactly the links
 * to (re)insert on the synced steps.
 */
export function buildAssemblyToolStepLinks(
  sourceSteps: { id: string }[],
  toolsByStep: Map<string, { itemId: string }[]>,
  toolRowIdByItemId: Map<string, string>,
  targetIdBySource: Map<string, string>
): { jobOperationToolId: string; jobOperationStepId: string }[] {
  const rows: { jobOperationToolId: string; jobOperationStepId: string }[] = [];
  for (const source of sourceSteps) {
    const targetStepId = targetIdBySource.get(source.id);
    if (!targetStepId) continue;
    for (const tool of toolsByStep.get(source.id) ?? []) {
      const jobOperationToolId = toolRowIdByItemId.get(tool.itemId);
      if (jobOperationToolId) {
        rows.push({ jobOperationToolId, jobOperationStepId: targetStepId });
      }
    }
  }
  return rows;
}

/** Not published: `syncAssemblyToOperation` also refuses a locked job. */
export async function syncAssemblyInstructionToOperation(
  db: Kysely<KyselyDatabase>,
  args: {
    assemblyInstructionId: string;
    operationId: string;
    companyId: string;
    userId: string;
  }
) {
  const { assemblyInstructionId, operationId, companyId, userId } = args;
  const stepTable = "jobOperationStep" as const;
  const slideTable = "jobOperationStepSlide" as const;

  return db.transaction().execute(async (trx) => {
    // The operation id comes from the caller and every write below is keyed on
    // it, so it must belong to this company — and, since the API reaches this
    // without the route's check, its job must not be locked.
    const operation = await trx
      .selectFrom("jobOperation")
      .innerJoin("job", (join) =>
        join
          .onRef("job.id", "=", "jobOperation.jobId")
          .onRef("job.companyId", "=", "jobOperation.companyId")
      )
      .select(["jobOperation.id", "job.status"])
      .where("jobOperation.id", "=", operationId)
      .where("jobOperation.companyId", "=", companyId)
      .executeTakeFirst();
    if (!operation) throw new Error("Operation not found");
    if (isJobLocked(operation.status)) {
      throw new Error("This job is locked — steps can't be synced to it");
    }

    const instruction = await trx
      .selectFrom("assemblyInstruction")
      .select(["id", "itemId", "modelUploadId"])
      .where("id", "=", assemblyInstructionId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!instruction) throw new Error("Assembly instruction not found");

    const sourceSteps = await trx
      .selectFrom("assemblyInstructionStep")
      .select([
        "id",
        "title",
        "type",
        "description",
        "instructionText",
        "required",
        "unitOfMeasureCode",
        "minValue",
        "maxValue",
        "listValues",
        "fileTypes",
        "sortOrder"
      ])
      .where("assemblyInstructionId", "=", instruction.id)
      .where("companyId", "=", companyId)
      // A sub-assembly (header) row is not a build action to record: it is
      // never a job step, and a job step synced from a row that has since
      // become a header is removed as stale below.
      .where("isSubAssembly", "=", false)
      .orderBy("sortOrder", "asc")
      .execute();
    if (sourceSteps.length === 0) {
      throw new Error("The assembly instruction has no steps to sync");
    }

    const sourceMaterials = await trx
      .selectFrom("assemblyInstructionStepMaterial")
      .select(["stepId", "itemId", "quantity"])
      .where("companyId", "=", companyId)
      .where(
        "stepId",
        "in",
        sourceSteps.map((step) => step.id)
      )
      .execute();
    const materialsByStep = new Map<
      string,
      { itemId: string; quantity: number | null }[]
    >();
    for (const material of sourceMaterials) {
      const list = materialsByStep.get(material.stepId) ?? [];
      list.push({ itemId: material.itemId, quantity: material.quantity });
      materialsByStep.set(material.stepId, list);
    }

    const sourceSlides = await trx
      .selectFrom("assemblyInstructionStepSlide")
      .select([
        "stepId",
        "imagePath",
        "modelUploadId",
        "caption",
        "sortOrder",
        "size",
        "annotations"
      ])
      .where("companyId", "=", companyId)
      .where(
        "stepId",
        "in",
        sourceSteps.map((step) => step.id)
      )
      .orderBy("sortOrder", "asc")
      .execute();
    const slidesByStep = new Map<string, typeof sourceSlides>();
    for (const slide of sourceSlides) {
      const list = slidesByStep.get(slide.stepId) ?? [];
      list.push(slide);
      slidesByStep.set(slide.stepId, list);
    }

    const sourceTools = await trx
      .selectFrom("assemblyInstructionStepTool")
      .select(["stepId", "itemId", "quantity"])
      .where("companyId", "=", companyId)
      .where(
        "stepId",
        "in",
        sourceSteps.map((step) => step.id)
      )
      .execute();
    const toolsByStep = new Map<
      string,
      { itemId: string; quantity: number }[]
    >();
    for (const tool of sourceTools) {
      const list = toolsByStep.get(tool.stepId) ?? [];
      list.push({ itemId: tool.itemId, quantity: tool.quantity ?? 1 });
      toolsByStep.set(tool.stepId, list);
    }

    // The target operation's own BOM lines, keyed by item — instruction step
    // materials are itemIds; the link table wants the material row on THIS
    // operation (a link to another operation's material never shows in the MES).
    const operationMaterials = await trx
      .selectFrom("jobMaterial")
      .select(["id", "itemId"])
      .where("jobOperationId", "=", operationId)
      .where("companyId", "=", companyId)
      .execute();
    const materialIdByItemId = new Map<string, string>();
    for (const material of operationMaterials) {
      if (material.itemId && !materialIdByItemId.has(material.itemId)) {
        materialIdByItemId.set(material.itemId, material.id);
      }
    }

    const existingSteps = await trx
      .selectFrom(stepTable)
      .select(["id", "assemblyInstructionStepId", "name", "sortOrder"])
      .where("operationId", "=", operationId)
      .where("companyId", "=", companyId)
      .execute();

    const existingSynced = existingSteps.filter(
      (step) => step.assemblyInstructionStepId !== null
    );

    // Re-adopt steps orphaned by the ON DELETE SET NULL cascade so a re-sync
    // heals them instead of inserting duplicates beside them.
    const adoption = planOrphanStepAdoption(
      sourceSteps.map((step) => ({
        id: step.id,
        title: step.title,
        sortOrder: step.sortOrder
      })),
      existingSteps
        .filter((step) => step.assemblyInstructionStepId === null)
        .map((step) => ({
          id: step.id,
          name: step.name,
          sortOrder: step.sortOrder
        })),
      new Set(
        existingSynced
          .map((step) => step.assemblyInstructionStepId)
          .filter((id): id is string => id !== null)
      )
    );

    for (const [orphanId, sourceStepId] of adoption) {
      await trx
        .updateTable(stepTable)
        .set({ assemblyInstructionStepId: sourceStepId })
        .where("id", "=", orphanId)
        .where("companyId", "=", companyId)
        .execute();
      const orphan = existingSteps.find((step) => step.id === orphanId);
      if (orphan) {
        existingSynced.push({
          ...orphan,
          assemblyInstructionStepId: sourceStepId
        });
      }
    }

    const { targetIdBySourceId, staleTargetIds } = planAssemblyStepMarkerSync(
      sourceSteps.map((step) => step.id),
      existingSynced
    );

    // The operation's own steps number from 1 as well: the instruction's
    // steps follow them, or the two interleave.
    const syncedIds = new Set(existingSynced.map((step) => step.id));
    const firstSortOrder =
      Math.max(
        0,
        ...existingSteps
          .filter((step) => !syncedIds.has(step.id))
          .map((step) => step.sortOrder ?? 0)
      ) + 1;

    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const syncedTargetIds: string[] = [];
    // source assembly step id → synced job step id, for slide/tool copying
    const targetIdBySource = new Map<string, string>();
    const linkPairs: {
      materialId: string;
      stepId: string;
      quantity: number | null;
    }[] = [];
    let partsUnmatched = 0;

    for (const [index, source] of sourceSteps.entries()) {
      const payload = {
        name: assemblyStepName(source.title, index),
        type: source.type ?? "Task",
        description:
          source.description ??
          (source.instructionText
            ? plainTextToTiptap(source.instructionText)
            : null),
        required: source.required ?? false,
        unitOfMeasureCode: source.unitOfMeasureCode,
        minValue: source.minValue,
        maxValue: source.maxValue,
        listValues: source.listValues,
        fileTypes: source.fileTypes,
        sortOrder: firstSortOrder + index
      };

      const existingId = targetIdBySourceId.get(source.id);
      let targetStepId: string;
      if (existingId) {
        await trx
          .updateTable(stepTable)
          .set({ ...payload, updatedBy: userId, updatedAt: now })
          .where("id", "=", existingId)
          .where("companyId", "=", companyId)
          .execute();
        targetStepId = existingId;
        updated++;
      } else {
        const inserted = await trx
          .insertInto(stepTable)
          .values({
            ...payload,
            operationId,
            assemblyInstructionStepId: source.id,
            companyId,
            createdBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        targetStepId = inserted.id;
        created++;
      }
      syncedTargetIds.push(targetStepId);
      targetIdBySource.set(source.id, targetStepId);

      for (const { itemId, quantity } of materialsByStep.get(source.id) ?? []) {
        const materialId = materialIdByItemId.get(itemId);
        if (materialId) {
          linkPairs.push({ materialId, stepId: targetStepId, quantity });
        } else {
          partsUnmatched++;
        }
      }
    }

    // Synced steps whose source step no longer exists — deleting cascades their
    // slides and material/tool step links (staleTargetIds computed above).
    if (staleTargetIds.length > 0) {
      await trx
        .deleteFrom(stepTable)
        .where("id", "in", staleTargetIds)
        .where("companyId", "=", companyId)
        .execute();
    }

    // Refresh part links on the synced steps only (hand-authored steps keep theirs).
    await trx
      .deleteFrom("jobMaterialStep")
      // No companyId column — scope through the step it links to.
      .where("jobOperationStepId", "in", (eb) =>
        eb
          .selectFrom("jobOperationStep")
          .select("id")
          .where("id", "in", syncedTargetIds)
          .where("companyId", "=", companyId)
      )
      .execute();
    if (linkPairs.length > 0) {
      await trx
        .insertInto("jobMaterialStep")
        .values(
          linkPairs.map((pair) => ({
            jobMaterialId: pair.materialId,
            jobOperationStepId: pair.stepId,
            quantity: pair.quantity
          }))
        )
        .execute();
    }

    // Refresh slides on the synced steps only (hand-authored steps keep theirs):
    // the instruction's 3D model leads as a model slide, followed by the step's
    // authored slides. Delete + recreate mirrors the jobMaterialStep refresh —
    // the assembly instruction is authoritative for what a synced step shows.
    await trx
      .deleteFrom(slideTable)
      .where("stepId", "in", syncedTargetIds)
      .where("companyId", "=", companyId)
      .execute();
    const slideRows: {
      stepId: string;
      imagePath: string | null;
      modelUploadId: string | null;
      caption: string | null;
      sortOrder: number;
      size: string;
      annotations: string;
      companyId: string;
      createdBy: string;
    }[] = [];
    for (const source of sourceSteps) {
      const targetStepId = targetIdBySource.get(source.id);
      if (!targetStepId) continue;
      const authored = slidesByStep.get(source.id) ?? [];
      if (
        instruction.modelUploadId &&
        !authored.some(
          (slide) => slide.modelUploadId === instruction.modelUploadId
        )
      ) {
        slideRows.push({
          stepId: targetStepId,
          imagePath: null,
          modelUploadId: instruction.modelUploadId,
          caption: null,
          sortOrder: 0,
          size: "medium",
          annotations: JSON.stringify([]),
          companyId,
          createdBy: userId
        });
      }
      for (const slide of authored) {
        slideRows.push({
          stepId: targetStepId,
          imagePath: slide.imagePath,
          modelUploadId: slide.modelUploadId,
          caption: slide.caption,
          sortOrder: slide.sortOrder ?? 1,
          size: slide.size ?? "medium",
          annotations: JSON.stringify(slide.annotations ?? []),
          companyId,
          createdBy: userId
        });
      }
    }
    if (slideRows.length > 0) {
      await trx.insertInto(slideTable).values(slideRows).execute();
    }

    // Tools: ensure a jobOperationTool row per distinct tool item, then refresh
    // the step links on the synced steps. Operation-level tool rows are never
    // deleted (no provenance column) and quantities only ratchet up, so
    // hand-added tools survive a re-sync.
    const existingTools = await trx
      .selectFrom("jobOperationTool")
      .select(["id", "toolId", "quantity"])
      .where("operationId", "=", operationId)
      .where("companyId", "=", companyId)
      .execute();
    const toolRowIdByItemId = new Map(
      existingTools.map((tool) => [tool.toolId, tool.id])
    );
    const maxQuantityByItemId = maxToolQuantityByItem(sourceTools);
    for (const [itemId, quantity] of maxQuantityByItemId) {
      const existingId = toolRowIdByItemId.get(itemId);
      if (!existingId) {
        const inserted = await trx
          .insertInto("jobOperationTool")
          .values({
            operationId,
            toolId: itemId,
            quantity,
            companyId,
            createdBy: userId
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        toolRowIdByItemId.set(itemId, inserted.id);
      } else {
        const existing = existingTools.find((tool) => tool.id === existingId);
        if ((existing?.quantity ?? 1) < quantity) {
          await trx
            .updateTable("jobOperationTool")
            .set({ quantity, updatedBy: userId, updatedAt: now })
            .where("id", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();
        }
      }
    }
    await trx
      .deleteFrom("jobOperationToolStep")
      // No companyId column — scope through the step it links to.
      .where("jobOperationStepId", "in", (eb) =>
        eb
          .selectFrom("jobOperationStep")
          .select("id")
          .where("id", "in", syncedTargetIds)
          .where("companyId", "=", companyId)
      )
      .execute();
    const toolLinkRows = buildAssemblyToolStepLinks(
      sourceSteps,
      toolsByStep,
      toolRowIdByItemId,
      targetIdBySource
    );
    if (toolLinkRows.length > 0) {
      await trx
        .insertInto("jobOperationToolStep")
        .values(toolLinkRows)
        .execute();
    }

    // Point the operation at its instruction (also how the re-sync UI knows
    // what this operation was synced from).
    await trx
      .updateTable("jobOperation")
      .set({
        assemblyInstructionId: instruction.id,
        updatedBy: userId,
        updatedAt: now
      })
      .where("id", "=", operationId)
      .where("companyId", "=", companyId)
      .execute();

    return {
      created,
      updated,
      deleted: staleTargetIds.length,
      partsLinked: linkPairs.length,
      partsUnmatched,
      slidesSynced: slideRows.length,
      toolsLinked: toolLinkRows.length
    };
  });
}

/**
 * Creates draft steps from the motion plan: walks the planned assembly
 * sequence, groups consecutive identical parts (same geometry, same motion
 * shape) into one step, and inserts them in order with status Review. Parts
 * the planner flagged (blockedBy: no collision-free path exists) are stored
 * with motion "none" plus a `warnings` payload — the viewer fades them in
 * rather than animating a fabricated colliding path. The author
 * validates/edits the drafts instead of authoring motions by hand.
 *
 * Not published: `generateAssemblySteps` also starts a missing plan.
 */
export async function generateAssemblyStepsFromPlan(
  client: SupabaseClient<Database>,
  args: {
    assemblyInstructionId: string;
    companyId: string;
    userId: string;
    /**
     * "regenerate" replaces the existing steps with fresh drafts from the
     * latest plan — refused while any step is manually authored
     * (planConfidence "manual") or already Done.
     */
    mode?: "generate" | "regenerate";
  }
): Promise<GenerateStepsResult> {
  // The route calls this with the service role (bypassRls) and a URL id, so
  // every read and write is scoped to the caller's company.
  const instruction = await client
    .from("assemblyInstruction")
    .select("id, modelUploadId, modelUpload(graphPath)")
    .eq("id", args.assemblyInstructionId)
    .eq("companyId", args.companyId)
    .single();
  if (instruction.error || !instruction.data.modelUploadId) {
    return { ok: false, reason: "no-model" };
  }
  const modelUploadId = instruction.data.modelUploadId;

  const existing = await client
    .from("assemblyInstructionStep")
    .select("id, planConfidence, status")
    .eq("assemblyInstructionId", args.assemblyInstructionId)
    .eq("companyId", args.companyId);
  if ((existing.data ?? []).length > 0) {
    if (args.mode !== "regenerate") {
      return { ok: false, reason: "steps-exist", modelUploadId };
    }
    const locked = (existing.data ?? []).filter(
      (step) => step.planConfidence === "manual" || step.status === "Done"
    );
    if (locked.length > 0) {
      return {
        ok: false,
        reason: "steps-locked",
        modelUploadId,
        message: `${locked.length} ${
          locked.length === 1 ? "step is" : "steps are"
        } manually authored or done — delete or reset them before regenerating`
      };
    }
    const removed = await client
      .from("assemblyInstructionStep")
      .delete()
      .eq("assemblyInstructionId", args.assemblyInstructionId)
      .eq("companyId", args.companyId);
    if (removed.error) {
      return { ok: false, reason: "error", message: removed.error.message };
    }
  }

  const plan = await getAssemblyPlanJson(client, modelUploadId);
  if (!plan) {
    return { ok: false, reason: "no-plan", modelUploadId };
  }

  // graph.json powers identical-part grouping (geometryHash) and fallback
  // motion synthesis for unplanned, unflagged parts
  let graphIndex: AssemblyGraphIndex | null = null;
  const graphPath = instruction.data.modelUpload?.graphPath;
  if (graphPath) {
    const graphFile = await storage(client)
      .company(args.companyId)
      .download(graphPath);
    if (graphFile.data) {
      try {
        const graph = JSON.parse(await graphFile.data.text()) as AssemblyGraph;
        graphIndex = indexAssemblyGraph(graph);
      } catch {
        // grouping degrades to per-part steps
      }
    }
  }

  const groups = buildAssemblyStepGroups(plan, graphIndex);
  if (groups.length === 0) {
    return { ok: false, reason: "error", message: "The plan has no parts" };
  }

  // Materialize planner-DETECTED groups (id "swarm:<host>" — e.g. a populated
  // PCB's detail swarm) as assemblyUnit rows so the Components tab shows them
  // like authored units, editable through the same UI. Caller-unit groups
  // already ARE rows. Best-effort: a failure here must not block step generation.
  //
  // This is a SYSTEM/derived-data write (reflecting the plan), not a user
  // creating a unit — so the generate route passes a bypassRls (service-role)
  // `client`. The assemblyUnit INSERT/DELETE RLS policies require
  // `production_create`/`production_delete`, but generate only authorizes
  // `production_update`; through a plain RLS client the write silently no-ops
  // (steps get built, units never do). Scoped to companyId, so it's tenant-safe.
  const detectedUnits = Object.entries(plan.groups ?? {})
    .filter(([groupId]) => groupId.startsWith("swarm:"))
    .map(([groupId, group]) => ({
      modelUploadId,
      name: group.name ?? "Detected group",
      componentNodeIds: group.componentNodeIds,
      sourceGroupId: groupId,
      companyId: args.companyId,
      createdBy: args.userId
    }));
  if (args.mode === "regenerate") {
    // Fresh regenerate: the auto-units were deliberately NOT deleted before the
    // plan (a delete-then-failed-re-plan would strand the model ungrouped).
    // Swap them HERE, atomically with the just-rebuilt steps — drop the old auto
    // rows and insert the freshly detected ones so new detection (absorption
    // etc.) wins. If detection now finds no swarm, they clear (the steps don't
    // group it either — consistent).
    const dropped = await client
      .from("assemblyUnit")
      .delete()
      .eq("modelUploadId", modelUploadId)
      .eq("companyId", args.companyId)
      .not("sourceGroupId", "is", null);
    if (dropped.error) {
      logger.error("Failed to clear detected assembly units", {
        error: dropped.error
      });
    }
    if (detectedUnits.length > 0) {
      const inserted = await client.from("assemblyUnit").insert(detectedUnits);
      if (inserted.error) {
        logger.error("Failed to materialize detected assembly units", {
          error: inserted.error
        });
      }
    }
  } else if (detectedUnits.length > 0) {
    // First generation: DO NOTHING on conflict — once materialized the row
    // belongs to the user (renames/member edits survive).
    const materialized = await client
      .from("assemblyUnit")
      .upsert(detectedUnits, {
        onConflict: "modelUploadId,sourceGroupId",
        ignoreDuplicates: true
      });
    if (materialized.error) {
      logger.error("Failed to materialize detected assembly units", {
        error: materialized.error
      });
    }
  }

  // Authored subassembly units name their steps; the rest derive a human title
  // from the components (same `describeStep` the viewer/explorer render), so the
  // title is real editable data instead of a render-time fallback.
  const units = await getAssemblyUnits(client, modelUploadId);
  const namedUnits = (units.data ?? []).map((unit) => ({
    name: unit.name,
    componentNodeIds: unit.componentNodeIds ?? []
  }));

  const rows = groups.map((group, index) => {
    const motion = motionSchema.safeParse(group.motion);
    return {
      assemblyInstructionId: args.assemblyInstructionId,
      sortOrder: index + 1,
      // A pre-grouped unit (e.g. a purchased PCB) titles its step with the
      // unit name; ungrouped steps derive their title from their parts.
      title:
        group.name ??
        describeStep(
          {
            title: null,
            componentNodeIds: group.componentNodeIds,
            fastener: null
          },
          graphIndex,
          namedUnits
        ) ??
        null,
      componentNodeIds: group.componentNodeIds,
      motion: (motion.success ? motion.data : { type: "none" }) as Json,
      // Planner-baked view direction (mesh-precise sight lines); the viewer
      // applies it with live framing — target, distance, frustum fit at the
      // real viewport aspect. Manual "Set view" poses replace this wholesale.
      camera: (group.viewDirection
        ? { source: "plan", direction: group.viewDirection }
        : null) as Json | null,
      warnings: ((): Json | null => {
        const w: Record<string, Json> = {};
        if (group.blockedBy.length > 0) {
          w.flagged = true;
          w.blockedBy = group.blockedBy;
        }
        if (group.needsSupport) {
          w.needsSupport = true;
        }
        return Object.keys(w).length > 0 ? (w as Json) : null;
      })(),
      // Parallel-buildable wave (steps sharing one have no ordering constraint);
      // null for cycle-affected steps. Informational — sortOrder still governs.
      buildWave: group.wave ?? null,
      planConfidence: group.confidence,
      status: "Review" as const,
      companyId: args.companyId,
      createdBy: args.userId
    };
  });

  const insert = await client
    .from("assemblyInstructionStep")
    .insert(rows)
    .select("id, componentNodeIds");
  if (insert.error) {
    return { ok: false, reason: "error", message: insert.error.message };
  }

  // Seed each step's materials from the model's component→BOM mappings —
  // best-effort; generation succeeds regardless.
  let unmappedComponentCount = 0;
  if (graphIndex && insert.data?.length) {
    let mappings = await getAssemblyComponentMappings(client, modelUploadId);
    // First generation usually has no mappings yet. Rather than silently seed
    // nothing (and leave the user to discover "Match BOM"), auto-match once so
    // steps come out with their materials populated. Best-effort: a missing BOM
    // or a match failure just leaves mappings empty and the warning below fires.
    if ((mappings.data ?? []).length === 0) {
      await autoMatchAssemblyComponents(client, {
        assemblyInstructionId: args.assemblyInstructionId,
        companyId: args.companyId,
        userId: args.userId
      });
      mappings = await getAssemblyComponentMappings(client, modelUploadId);
    }
    const itemIdByGeometryHash = new Map(
      (mappings.data ?? []).map((mapping) => [
        mapping.geometryHash,
        mapping.itemId
      ])
    );
    if (itemIdByGeometryHash.size > 0) {
      const seeds = deriveAssemblyStepMaterialSeeds({
        steps: insert.data,
        graphIndex,
        itemIdByGeometryHash
      });
      if (seeds.length > 0) {
        await insertAssemblyStepMaterialSeeds(client, seeds, args);
      }
    }
    // Surface how many distinct geometry groups still have no BOM item, so the
    // route can nudge the user to Match BOM instead of a silent gap.
    const allNodeIds = insert.data.flatMap(
      (step) => step.componentNodeIds ?? []
    );
    unmappedComponentCount = groupComponentNodeIds(
      allNodeIds,
      graphIndex
    ).filter((group) => !itemIdByGeometryHash.has(group.key)).length;
  }

  return { ok: true, created: rows.length, unmappedComponentCount };
}

// Purchase order lines for a job's materials, scoped by item + location (not
// jobId, since planning-generated POs aren't linked to the job). Flattened to
// the procurement-status shape used by the BoM tree and the Materials table.
export async function getJobMaterialPurchaseOrderLines(
  client: SupabaseClient<Database>,
  materials: Array<{ jobMaterialItemId: string | null }>,
  locationId: string
): Promise<JobMaterialPurchaseOrderLine[]> {
  const itemIds = Array.from(
    new Set(
      materials
        .map((material) => material.jobMaterialItemId)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (itemIds.length === 0) return [];

  const { data } = await client
    .from("purchaseOrderLine")
    .select("itemId, purchaseQuantity, quantityReceived, purchaseOrder(status)")
    .in("itemId", itemIds)
    .eq("locationId", locationId);

  return (data ?? []).map((line) => ({
    itemId: line.itemId,
    purchaseQuantity: line.purchaseQuantity,
    quantityReceived: line.quantityReceived,
    status:
      (
        line.purchaseOrder as {
          status: Database["public"]["Enums"]["purchaseOrderStatus"] | null;
        } | null
      )?.status ?? null
  }));
}

// Active jobs that produce these material items — the supply-side counterpart to
// getJobMaterialPurchaseOrderLines. A manufactured material is "covered" when an
// active job (its own itemId) is planned/in-flight at the same location.
export async function getJobMaterialSupplyJobLines(
  client: SupabaseClient<Database>,
  materials: Array<{ jobMaterialItemId: string | null }>,
  companyId: string,
  locationId: string
): Promise<JobMaterialSupplyJobLine[]> {
  const itemIds = Array.from(
    new Set(
      materials
        .map((material) => material.jobMaterialItemId)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (itemIds.length === 0) return [];

  const { data } = await client
    .from("job")
    .select("itemId, status")
    .in("itemId", itemIds)
    .in("status", ACTIVE_JOB_STATUSES)
    .eq("companyId", companyId)
    .eq("locationId", locationId);

  return (data ?? []).map((job) => ({
    itemId: job.itemId,
    status: job.status
  }));
}

// ── Planning actions (spec §P1) ────────────────────────────────────────────
// Persisted MRP action messages (Order/Make/Expedite/Defer/Cancel/Increase/
// Decrease). Written diff-write by generatePlanningActions (@carbon/planning);
// these are the app-side reads and worklist mutations.

// Item ids per request. `.in()` writes every id into the URL, and the gateway
// rejects a request line it cannot buffer (HTTP 431) — 100 ids is about 3 kB.
const PLANNING_ACTION_ITEM_CHUNK = 100;

/**
 * The open and dismissed planning actions of the given items at a location —
 * the rows behind a planning grid PAGE. The grid decides which items are on the
 * page (its RPC owns the Actions filter); this loads their actions in full, so
 * there is no cap to fall off the end of.
 *
 * The item, the purchase order behind a line and the job come back as embeds
 * of the same read. Looking them up afterwards by `.in("id", …)` put one id per
 * ACTION in the URL: a page of busy items (2,000+ actions) overran the gateway
 * and the whole read failed, leaving the grid with no actions at all.
 */
/** Which planning page owns an action — purchasing ("Buy") or production ("Make"). */
export type PlanningActionKind = "Buy" | "Make";

export async function getPlanningActions(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    locationId: string;
    kind: PlanningActionKind;
    itemIds: string[];
  }
) {
  const { companyId, locationId, kind, itemIds: pageItemIds } = args;

  if (pageItemIds.length === 0) {
    return { data: [], count: 0, error: null };
  }

  const chunks = await Promise.all(
    chunkArray(pageItemIds, PLANNING_ACTION_ITEM_CHUNK).map((itemIds) =>
      // Paged: a page of busy items can hold more actions than PostgREST's
      // max_rows, and a bare select would silently drop the tail.
      fetchAllRecords(() => {
        const query = client
          .from("planningAction")
          .select(
            "*, item(readableIdWithRevision, name), purchaseOrderLine(purchaseOrderId, promisedDate, purchaseOrder(purchaseOrderId, status, orderDate, purchaseOrderDelivery(receiptPromisedDate))), job(jobId, status)"
          )
          .eq("companyId", companyId)
          .eq("locationId", locationId)
          .neq("status", "Actioned")
          .in("itemId", itemIds);

        // Buy worklist = new purchase suggestions + change actions on PO lines;
        // Make worklist = new job suggestions + change actions on jobs.
        return (
          kind === "Buy"
            ? query.or("type.eq.Order,purchaseOrderLineId.not.is.null")
            : query.or("type.eq.Make,jobId.not.is.null")
        )
          .order("suggestedDate", { ascending: true })
          .order("id", { ascending: true });
      })
    )
  );

  // One failed chunk fails the read: a grid missing some parts' actions looks
  // exactly like a grid where those parts need nothing.
  const failed = chunks.find((chunk) => chunk.error);
  if (failed?.error) {
    return { data: null, count: 0, error: failed.error };
  }

  const enriched = chunks
    .flatMap((chunk) => chunk.data ?? [])
    .map(({ item, purchaseOrderLine, job, ...row }) => ({
      ...row,
      itemReadableId: item?.readableIdWithRevision ?? null,
      itemName: item?.name ?? null,
      // navigation target: the PARENT purchase order id — the stored value is
      // the LINE id and would 404 in path.to.purchaseOrder
      purchaseOrderId: purchaseOrderLine?.purchaseOrderId ?? null,
      purchaseOrderReadableId:
        purchaseOrderLine?.purchaseOrder?.purchaseOrderId ?? null,
      // why the row offers Review instead of Apply: shown as an icon beside
      // the document number, and read LIVE to choose Apply or Review — MRP's
      // `requiresManualAction` is as of the run, so a PO reopened since would
      // otherwise stay on Review until the next one
      purchaseOrderStatus: purchaseOrderLine?.purchaseOrder?.status ?? null,
      // a released PO can be reopened as a revision (see
      // canCreatePurchaseOrderRevision)
      purchaseOrderDate: purchaseOrderLine?.purchaseOrder?.orderDate ?? null,
      // the supplier's promise, which Apply's required date cannot move
      purchaseOrderLinePromisedDate:
        purchaseOrderLine?.promisedDate ??
        purchaseOrderLine?.purchaseOrder?.purchaseOrderDelivery
          ?.receiptPromisedDate ??
        null,
      jobReadableId: job?.jobId ?? null,
      jobStatus: job?.status ?? null
    }))
    // the chunks are each in order; the page as a whole is not
    .sort(
      (a, b) =>
        a.suggestedDate.localeCompare(b.suggestedDate) ||
        a.id.localeCompare(b.id)
    );

  return {
    data: enriched,
    count: enriched.length,
    error: null
  };
}

// The worklist writes below take an id LIST and go through Kysely, one
// statement each. Over PostgREST every id goes into the URL: a bulk Apply on a
// page of busy items sent hundreds, the gateway answered 431, and the whole
// batch failed before anything was claimed. A read over PostgREST also stops
// at max_rows (1000) and would report every id after that as "not found".
// One statement is also what makes the claim below a lock: every row of the
// batch flips in one transaction or none does.
type PlanningActionIdListResult<Row> =
  | { data: Row[]; error: null }
  | { data: null; error: { message: string } };

async function planningActionIdList<Row>(
  ids: string[],
  run: () => Promise<Row[]>
): Promise<PlanningActionIdListResult<Row>> {
  if (ids.length === 0) return { data: [], error: null };
  try {
    return { data: await run(), error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) }
    };
  }
}

/**
 * The worklist a page may write, the same split `getPlanningActions` reads:
 * Buy = new purchase suggestions and changes on PO lines, Make = new job
 * suggestions and changes on jobs. The writes below go through Kysely, past
 * row-level security, so without it a user with purchasing rights could
 * dismiss or reassign production's actions by posting their ids.
 */
function inPlanningWorklist(kind: PlanningActionKind) {
  return (eb: ExpressionBuilder<KyselyDatabase, "planningAction">) =>
    kind === "Buy"
      ? eb.or([
          eb("type", "=", "Order"),
          eb("purchaseOrderLineId", "is not", null)
        ])
      : eb.or([eb("type", "=", "Make"), eb("jobId", "is not", null)]);
}

export async function dismissPlanningActions(
  db: Kysely<KyselyDatabase>,
  args: {
    ids: string[];
    companyId: string;
    userId: string;
    kind: PlanningActionKind;
  }
) {
  // Open-only: Actioned is terminal, and a stale worklist id must never flip
  // an Actioned row to Dismissed (which would make it visible again and
  // eligible for the generator's Dismissed-reopen branch).
  return planningActionIdList(args.ids, () =>
    db
      .updateTable("planningAction")
      .set({
        status: "Dismissed",
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Open")
      .where(inPlanningWorklist(args.kind))
      .returning("id")
      .execute()
  );
}

/**
 * Conditional claim, not a blind update: only Open rows flip to Actioned, and
 * the claimed ids are returned. Callers applying a mutation MUST claim first
 * and treat an empty result as "someone else already applied this" — that
 * affected-row check is the concurrency lock for the whole apply path.
 */
export async function markPlanningActionsActioned(
  db: Kysely<KyselyDatabase>,
  args: { ids: string[]; companyId: string; userId: string }
) {
  return planningActionIdList(args.ids, () =>
    db
      .updateTable("planningAction")
      .set({
        status: "Actioned",
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Open")
      // The suggestion as it is at the claim — see claimPlanningActions.
      .returning(["id", "suggestedQuantity", "suggestedDate"])
      .execute()
  );
}

/**
 * Settle the new-supply suggestions a planning Order just raised. The page's
 * Order button creates PO lines (Buy) or jobs (Make) from the suggested
 * orders, which carry no action id; each one is the week of an Order / Make
 * action (both come from `computePlanningOrders`, and the natural key holds
 * one such action per item, location and week). Without this, the action
 * stayed Open beside the order that answered it until the next MRP run.
 * Dismissed is settled too: the need it suppressed has now been ordered.
 * Pairs are matched as pairs, so a bulk order never settles one item's week
 * because another item was ordered in it.
 */
export async function settleNewSupplyPlanningActions(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    locationId: string;
    userId: string;
    type: "Order" | "Make";
    ordered: { itemId: string; periodId: string }[];
  }
) {
  const byKey = new Map(
    args.ordered.map((pair) => [`${pair.itemId}\u0000${pair.periodId}`, pair])
  );
  const ordered = [...byKey.values()];
  return planningActionIdList([...byKey.keys()], () =>
    db
      .updateTable("planningAction")
      .set({
        status: "Actioned",
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("companyId", "=", args.companyId)
      .where("locationId", "=", args.locationId)
      .where("type", "=", args.type)
      .where("status", "in", ["Open", "Dismissed"])
      .where((eb) =>
        eb.or(
          ordered.map((pair) =>
            eb.and([
              eb("itemId", "=", pair.itemId),
              eb("periodId", "=", pair.periodId)
            ])
          )
        )
      )
      .returning("id")
      .execute()
  );
}

/** Compensation for a failed apply: release a claimed (Actioned) row back to Open. */
export async function reopenPlanningActions(
  client: SupabaseClient<Database>,
  args: { ids: string[]; companyId: string; userId: string }
) {
  return client
    .from("planningAction")
    .update({ status: "Open" as const, updatedBy: args.userId })
    .in("id", args.ids)
    .eq("companyId", args.companyId)
    .eq("status", "Actioned");
}

/**
 * Give up an apply's claim on one action: back to Open, so the planner can try
 * again. If an MRP run since the claim already wrote an Open row for the same
 * need, the reopen hits the natural-key unique index (23505); that new row
 * replaces this one, so the claimed row is deleted instead. Returns the error
 * the caller must report — never ignore it, or the action stays Actioned with
 * nothing applied.
 */
export async function releasePlanningActionClaim(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string }
): Promise<{ error: string | null }> {
  const reopened = await reopenPlanningActions(client, {
    ids: [args.id],
    companyId: args.companyId,
    userId: args.userId
  });
  if (!reopened.error) return { error: null };
  if (!isUniqueViolation(reopened.error)) {
    return { error: reopened.error.message };
  }

  const removed = await client
    .from("planningAction")
    .delete()
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .eq("status", "Actioned");
  return { error: removed.error?.message ?? null };
}

/**
 * The worklist's "Reopen" on a Dismissed row. Dismissed-only: `reopenPlanningActions`
 * above is the apply path's claim rollback (Actioned → Open) and must stay
 * separate so a stale worklist id can never un-claim a row another apply holds.
 */
export async function reopenDismissedPlanningActions(
  db: Kysely<KyselyDatabase>,
  args: {
    ids: string[];
    companyId: string;
    userId: string;
    kind: PlanningActionKind;
  }
) {
  return planningActionIdList(args.ids, () =>
    db
      .updateTable("planningAction")
      .set({
        status: "Open",
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Dismissed")
      .where(inPlanningWorklist(args.kind))
      .returning("id")
      .execute()
  );
}

/**
 * Assigning through this function (not the generic api/assign route) both sets
 * the assignee AND marks it human-overridden so the next MRP diff-write never
 * re-resolves it from the responsibleEmployee ladder. An applied (Actioned)
 * action is finished and keeps its owner. Like dismiss and reopen, it returns
 * the ids it changed: the route reports those, not the ids it was sent.
 */
export async function assignPlanningActions(
  db: Kysely<KyselyDatabase>,
  args: {
    ids: string[];
    companyId: string;
    assignee: string | null;
    userId: string;
    kind: PlanningActionKind;
  }
) {
  return planningActionIdList(args.ids, () =>
    db
      .updateTable("planningAction")
      .set({
        assignee: args.assignee || null,
        assigneeOverridden: true,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .where("status", "in", ["Open", "Dismissed"])
      .where(inPlanningWorklist(args.kind))
      .returning("id")
      .execute()
  );
}

export type ProductionPlanningDateAction = {
  planningActionId: string;
  jobId: string;
  /** the new due date, ISO */
  suggestedDate: string;
};

export type ProductionPlanningDateApplyResult = {
  /** changed and marked Actioned */
  applied: string[];
  /** marked Actioned by another apply since the page loaded; nothing changed */
  alreadyApplied: string[];
  /** the job left Draft / Planned since it was read: the action stays Open */
  refused: { id: string; jobId: string }[];
};

/**
 * Apply a batch of Expedite / Defer actions to their jobs in ONE transaction,
 * set-based: the claim, two reads (the jobs, and the jobs that share their
 * new due dates) and one UPDATE for every date and priority. It used to be a
 * job read, a sibling read, an update and a scheduler event per action.
 *
 * Priority follows `updateJob`'s rule (`nextJobPriority`): a moved job is
 * ranked among the jobs already on its new date. Several jobs moved to one
 * date in the same batch are placed one after the other, each seeing the ones
 * placed before it, as the sequential writes did.
 *
 * The Draft / Planned condition is part of the UPDATE: a job released after
 * it was read is left alone, its action goes back to Open, and the caller
 * sends the planner to the job. The caller tells the scheduler ONCE after the
 * batch — a "reorder" event re-stamps the whole company whatever its job id.
 */
export async function applyProductionPlanningDateActions(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    actions: ProductionPlanningDateAction[];
  }
): Promise<ProductionPlanningDateApplyResult> {
  const { companyId, userId, actions } = args;
  const result: ProductionPlanningDateApplyResult = {
    applied: [],
    alreadyApplied: [],
    refused: []
  };
  if (actions.length === 0) return result;
  const now = datetime.timestamp();

  await db.transaction().execute(async (trx) => {
    const claimed = await claimPlanningActions(trx, {
      ids: actions.map((a) => a.planningActionId),
      companyId,
      userId,
      now
    });
    // The date comes from the claim, not from the page's read (see
    // claimPlanningActions); the page's value is only the fallback for a row
    // that somehow carries none.
    const held = actions.flatMap((a) => {
      const claim = claimed.get(a.planningActionId);
      if (!claim) return [];
      return [{ ...a, suggestedDate: claim.suggestedDate ?? a.suggestedDate }];
    });
    for (const action of actions) {
      if (!claimed.has(action.planningActionId)) {
        result.alreadyApplied.push(action.planningActionId);
      }
    }
    if (held.length === 0) return;

    const jobIds = [...new Set(held.map((a) => a.jobId))];
    const jobs = await trx
      .selectFrom("job")
      .select(["id", "locationId", "deadlineType"])
      .where("id", "in", jobIds)
      .where("companyId", "=", companyId)
      .execute();
    const jobById = new Map(jobs.map((job) => [job.id, job]));

    // The jobs already on each target date, per location — the siblings a
    // moved job is ranked among. One read for every date in the batch.
    const targetDates = [...new Set(held.map((a) => a.suggestedDate))];
    const siblingRows = await trx
      .selectFrom("job")
      .select(["id", "locationId", "dueDate", "priority", "deadlineType"])
      .where("companyId", "=", companyId)
      .where("dueDate", "in", targetDates)
      .where("id", "not in", jobIds)
      .orderBy("priority", "asc")
      .execute();
    const siblingsByKey = new Map<
      string,
      { priority: number | null; deadlineType: DeadlineType }[]
    >();
    for (const row of siblingRows) {
      const key = `${row.locationId}\u001f${row.dueDate}`;
      const list = siblingsByKey.get(key) ?? [];
      list.push({ priority: row.priority, deadlineType: row.deadlineType });
      siblingsByKey.set(key, list);
    }

    const values: {
      jobId: string;
      dueDate: string;
      deadlineType: DeadlineType;
      priority: number;
    }[] = [];
    for (const action of held) {
      const job = jobById.get(action.jobId);
      if (!job) continue; // refused below: no row changed
      const deadlineType = deadlineTypeForPlanningDate(job.deadlineType);
      const key = `${job.locationId}\u001f${action.suggestedDate}`;
      const siblings = siblingsByKey.get(key) ?? [];
      const priority = nextJobPriority(siblings, deadlineType);
      siblings.push({ priority, deadlineType });
      siblings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      siblingsByKey.set(key, siblings);
      values.push({
        jobId: action.jobId,
        dueDate: action.suggestedDate,
        deadlineType,
        priority
      });
    }

    const changedJobs = new Set<string>();
    if (values.length > 0) {
      const rows = await sql<{ id: string }>`
        UPDATE "job" AS j
        SET "dueDate" = v."dueDate"::date,
            "deadlineType" = v."deadlineType"::"deadlineType",
            "priority" = v."priority"::numeric,
            "updatedBy" = ${userId},
            "updatedAt" = ${now}
        FROM (VALUES ${sql.join(
          values.map(
            (v) =>
              sql`(${v.jobId}, ${v.dueDate}, ${v.deadlineType}, ${v.priority})`
          )
        )}) AS v("id", "dueDate", "deadlineType", "priority")
        WHERE j."id" = v."id"
          AND j."companyId" = ${companyId}
          AND j."status" IN (${sql.join(
            PLANNING_EDITABLE_JOB_STATUSES.map((status) => sql`${status}`)
          )})
        RETURNING j."id"
      `.execute(trx);
      for (const row of rows.rows) changedJobs.add(row.id);
    }

    const refusedIds: string[] = [];
    for (const action of held) {
      if (changedJobs.has(action.jobId)) {
        result.applied.push(action.planningActionId);
      } else {
        refusedIds.push(action.planningActionId);
        result.refused.push({
          id: action.planningActionId,
          jobId: action.jobId
        });
      }
    }
    await releasePlanningActionClaims(trx, {
      ids: refusedIds,
      companyId,
      userId,
      now
    });
  });

  return result;
}

/** The actions an Apply was sent, in one read (an Apply used to read each). */
export async function getPlanningActionsByIds(
  db: Kysely<KyselyDatabase>,
  args: { ids: string[]; companyId: string }
) {
  return planningActionIdList(args.ids, () =>
    db
      .selectFrom("planningAction")
      .selectAll()
      .where("id", "in", args.ids)
      .where("companyId", "=", args.companyId)
      .execute()
  );
}

/**
 * Create a presigned upload URL for a job document. First step of the two-step
 * upload flow: PUT the file bytes to the returned `signedUrl`, then call
 * `documents_insertUploadedDocument` with the returned `path`,
 * `sourceDocument: "Job"`, and `sourceDocumentId: jobId`.
 *       (packages/files/AGENTS.md): a non-browser caller mints a staged
 *       upload URL, then insertUploadedDocument converts and lands it.
 */
export async function createJobDocumentUploadUrl(
  client: SupabaseClient<Database>,
  args: { companyId: string; jobId: string; name: string }
) {
  return createDocumentUploadUrl(client, {
    companyId: args.companyId,
    folder: "job",
    entityId: args.jobId,
    name: args.name
  });
}
/** The `shift` rows returned by getShiftsWithTimes (weekday flags + times). */
type ShiftRow = {
  startTime: string | null;
  endTime: string | null;
  monday: boolean | null;
  tuesday: boolean | null;
  wednesday: boolean | null;
  thursday: boolean | null;
  friday: boolean | null;
  saturday: boolean | null;
  sunday: boolean | null;
};

// dayOfWeek 0 = Sunday .. 6 = Saturday — the ladder's convention, matching the
// scheduler's own location-shift mapping (master-data-provider.expandShiftDays).
const WEEKDAY_FLAGS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

/**
 * Non-working intervals inside [windowStartMs, windowEndMs) for the forecast
 * board's shading — the complement of the plant's operating hours. Uses the
 * SAME availability ladder the scheduler uses (the location's shifts if any,
 * else the stock Mon–Fri 08:00–16:00 week in the plant timezone), so the bars
 * and the shaded background can never disagree. Location-level, not
 * per-work-center: one plant calendar behind every lane. Per-WC shifts /
 * `alwaysOn` are a deliberate follow-up (see #3b).
 */
export function getForecastNonWorkingIntervals(args: {
  timeZone: string;
  shifts: ShiftRow[];
  windowStartMs: number;
  windowEndMs: number;
}): { start: number; end: number }[] {
  const { timeZone, shifts, windowStartMs, windowEndMs } = args;

  const locationShiftRows: LadderShiftRow[] = [];
  for (const shift of shifts) {
    if (!shift.startTime || !shift.endTime) continue;
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const flag = WEEKDAY_FLAGS[dayOfWeek];
      if (!flag || !shift[flag]) continue;
      locationShiftRows.push({
        dayOfWeek,
        startTime: String(shift.startTime),
        endTime: String(shift.endTime),
        timezone: timeZone
      });
    }
  }

  const working = resolveLocationWindows({
    timezone: timeZone,
    locationShiftRows,
    rangeStart: windowStartMs,
    rangeEnd: windowEndMs
  });

  return subtractIntervals(
    [{ start: windowStartMs, end: windowEndMs }],
    working
  ).map((w) => ({ start: w.start, end: w.end }));
}
type CapacityOperation = {
  workCenterId: string | null;
  dueDate: string | null;
  setupTime?: number;
  setupUnit?: string;
  laborTime?: number;
  laborUnit?: string;
  machineTime?: number;
  machineUnit?: string;
  operationQuantity: number | null;
};

type CapacityReservation = {
  resourceId: string;
  startAt: string;
  endAt: string;
  workHours: number | null;
};

/** A location shift reduced to its per-day hours and which weekdays it runs. */
type CapacityShift = {
  id: string;
  /** shift hours per day (start→end duration, or the location default). */
  hours: number;
  /** 7 weekday flags, Sunday-first (index 0 = Sunday … 6 = Saturday). */
  runsOn: boolean[];
};

// Rung 3 of the ladder: no shifts anywhere → stock Mon–Fri, 8h/day. Mirrors the
// engine's stock week (08:00–16:00 = 8h) so machine and people capacity assume
// the same default day.
const FALLBACK_SHIFT_HOURS = 8;

/**
 * DAY-granularity mirror of the engine's machine-availability ladder, for the
 * Capacity view's Available series. The engine
 * (`packages/planning/src/scheduling/machine-availability.ts`)
 * owns the AUTHORITATIVE wall-clock ladder; this is DISPLAY math and resolves the
 * same rungs at day granularity.
 *
 * Per work center, per week date, resolved in order:
 *   1. `alwaysOn` → 24h (lights-out).
 *   2. explicit `workCenterShift` rows → Σ (shift hours whose weekday flag covers
 *      that date) over the work center's shifts.
 *   3. no WC rows but the location has shifts → the same Σ over the location's
 *      shifts.
 *   4. no shifts anywhere → 8h on Mon–Fri, 0 on the weekend.
 */
export function getWorkCenterCalendarHoursByDay(args: {
  workCenters: { id: string; alwaysOn: boolean }[];
  workCenterShifts: { workCenterId: string; shiftId: string }[];
  locationShifts: CapacityShift[];
  weekDates: string[];
}): Map<string, Map<string, number>> {
  const { workCenters, workCenterShifts, locationShifts, weekDates } = args;

  const shiftById = new Map(locationShifts.map((shift) => [shift.id, shift]));
  const shiftIdsByWorkCenter = new Map<string, string[]>();
  for (const link of workCenterShifts) {
    const list = shiftIdsByWorkCenter.get(link.workCenterId);
    if (list) list.push(link.shiftId);
    else shiftIdsByWorkCenter.set(link.workCenterId, [link.shiftId]);
  }

  // weekday index per week date — a plain calendar date, so timezone-independent
  const dowByDate = weekDates.map((day) =>
    getDayOfWeek(parseDate(day), "en-US")
  );

  const sumShiftHours = (shifts: CapacityShift[], dow: number) =>
    shifts.reduce(
      (sum, shift) => (shift.runsOn[dow] ? sum + shift.hours : sum),
      0
    );

  const result = new Map<string, Map<string, number>>();
  for (const workCenter of workCenters) {
    const wcShiftIds = shiftIdsByWorkCenter.get(workCenter.id) ?? [];
    const wcShifts = wcShiftIds.flatMap((id) => {
      const shift = shiftById.get(id);
      return shift ? [shift] : [];
    });
    const byDate = new Map<string, number>();
    weekDates.forEach((day, i) => {
      const dow = dowByDate[i] ?? 0;
      let hours: number;
      if (workCenter.alwaysOn) {
        hours = 24;
      } else if (wcShifts.length > 0) {
        hours = sumShiftHours(wcShifts, dow);
      } else if (locationShifts.length > 0) {
        hours = sumShiftHours(locationShifts, dow);
      } else {
        hours = dow === 0 || dow === 6 ? 0 : FALLBACK_SHIFT_HOURS;
      }
      byDate.set(day, hours);
    });
    result.set(workCenter.id, byDate);
  }
  return result;
}

/**
 * The Capacity view's week buckets.
 *
 * Demand = open job-operation hours by due date (overdue lands in `pastDue`,
 * like the classic capacity board's Past Weeks column). Scheduled = each
 * reservation's actual work content distributed across its wall-clock span —
 * a reservation holds the station for its full span (including idle
 * overnight stretches), so distributing `workHours` keeps a spanning op from
 * reading as 24h/day. Day boundaries come from the plant's calendar via
 * `CalendarDate.toDate(tz)` so DST weeks bucket correctly.
 */
export function buildPeopleCapacityBuckets(args: {
  weekDates: string[];
  timezone: string;
  operations: CapacityOperation[];
  reservations: CapacityReservation[];
  /** per-work-center calendar hours (the ladder above) — clamps null-workHours reservations. */
  calendarHoursByWorkCenter: Map<string, Map<string, number>>;
}): {
  demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  >;
  scheduledByWorkCenter: Record<string, Record<string, number>>;
} {
  const {
    weekDates,
    timezone,
    operations,
    reservations,
    calendarHoursByWorkCenter
  } = args;
  const weekStartDate = weekDates[0];

  const demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  > = {};
  for (const operation of operations) {
    if (!operation.workCenterId || !operation.dueDate) continue;
    const durations = makeDurations(operation);
    const hours =
      (durations.setupDuration +
        durations.laborDuration +
        durations.machineDuration) /
      HOUR_MS;
    if (hours <= 0) continue;
    const bucket = (demandByWorkCenter[operation.workCenterId] ??= {
      pastDue: 0,
      days: {}
    });
    if (operation.dueDate < weekStartDate) {
      bucket.pastDue += hours;
    } else {
      bucket.days[operation.dueDate] =
        (bucket.days[operation.dueDate] ?? 0) + hours;
    }
  }

  // day boundaries on the plant's calendar, computed once (not per reservation)
  const dayBounds = weekDates.map((day) => {
    const dayDate = parseDate(day);
    return {
      day,
      startMs: dayDate.toDate(timezone).getTime(),
      endMs: dayDate.add({ days: 1 }).toDate(timezone).getTime()
    };
  });

  const scheduledByWorkCenter: Record<string, Record<string, number>> = {};
  for (const reservation of reservations) {
    const startMs = new Date(reservation.startAt).getTime();
    const endMs = new Date(reservation.endAt).getTime();
    const spanMs = endMs - startMs;
    if (spanMs <= 0) continue;

    let workMs: number;
    if (reservation.workHours != null) {
      workMs = reservation.workHours * HOUR_MS;
    } else {
      // Legacy rows carry no measured work content, so the old code counted the
      // full wall-clock span — which reads as 24h/day for an op that idles
      // overnight. Clamp to the calendar hours actually available at this work
      // center over the days the reservation spans.
      const dayHours = calendarHoursByWorkCenter.get(reservation.resourceId);
      let calendarMsWithinSpan = 0;
      for (const { day, startMs: dayStartMs, endMs: dayEndMs } of dayBounds) {
        const overlapMs =
          Math.min(endMs, dayEndMs) - Math.max(startMs, dayStartMs);
        if (overlapMs > 0) {
          calendarMsWithinSpan += (dayHours?.get(day) ?? 0) * HOUR_MS;
        }
      }
      workMs = Math.min(spanMs, calendarMsWithinSpan);
    }

    for (const { day, startMs: dayStartMs, endMs: dayEndMs } of dayBounds) {
      const overlapMs =
        Math.min(endMs, dayEndMs) - Math.max(startMs, dayStartMs);
      if (overlapMs > 0) {
        const byDay = (scheduledByWorkCenter[reservation.resourceId] ??= {});
        byDay[day] =
          (byDay[day] ?? 0) + (overlapMs / spanMs) * (workMs / HOUR_MS);
      }
    }
  }

  return { demandByWorkCenter, scheduledByWorkCenter };
}
// The geometry (assembler) service backs model conversion and motion planning.
// When it's unreachable those actions can't run, so loaders probe its health and
// the UI soft-gates the assembler-dependent controls. Result cached so a
// navigation burst doesn't fan out one probe per route.
//
// The default deployment is a scale-to-zero Lambda: a cold /health takes ~2-5s
// to init, so the probe timeout must outlast a cold start (the old 2s abort
// read every cold service as down). Healthy sticks longer than unhealthy —
// a failed probe usually WARMED the service (the request went through; we just
// stopped waiting), so re-probe quickly instead of pinning "down" for 15s.
const ASSEMBLER_HEALTHY_TTL_MS = 60_000;

const ASSEMBLER_UNHEALTHY_TTL_MS = 5_000;

const ASSEMBLER_HEALTH_TIMEOUT_MS = 10_000;

let assemblerHealthCache: { healthy: boolean; expires: number } | null = null;

export async function isAssemblerServiceHealthy(): Promise<boolean> {
  if (!ASSEMBLER_SERVICE_URL) return false;

  const now = Date.now();
  if (assemblerHealthCache && assemblerHealthCache.expires > now) {
    return assemblerHealthCache.healthy;
  }

  let healthy = false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ASSEMBLER_HEALTH_TIMEOUT_MS
  );
  try {
    const response = await fetch(`${ASSEMBLER_SERVICE_URL}/health`, {
      method: "GET",
      signal: controller.signal
    });
    healthy = response.ok;
  } catch {
    healthy = false;
  } finally {
    clearTimeout(timeout);
  }

  assemblerHealthCache = {
    healthy,
    expires:
      now + (healthy ? ASSEMBLER_HEALTHY_TTL_MS : ASSEMBLER_UNHEALTHY_TTL_MS)
  };
  return healthy;
}

/**
 * Save the release dialog's supplier for outside operations whose process has
 * several, so `purchaseOrderFromJob` resolves it. Runs before the purchase
 * orders are created. Both ids come from the caller and drive an RLS-bypassing
 * write, so the operation must belong to one of `jobIds` and the supplier
 * process to the operation's own process.
 */
export async function stampSupplierChoices(
  ctx: ServiceContext,
  { jobIds, choices }: { jobIds: string[]; choices: Record<string, string> }
): Promise<CarbonError | null> {
  const entries = Object.entries(choices);
  if (entries.length === 0) return null;
  const companyId = ctx.company.id;
  const system = ctx.asSystem.supabase;

  const [operations, supplierProcesses] = await Promise.all([
    system
      .from("jobOperation")
      .select("id, processId")
      .in("jobId", jobIds)
      .eq("companyId", companyId)
      .in(
        "id",
        entries.map(([operationId]) => operationId)
      ),
    system
      .from("supplierProcess")
      .select("id, processId")
      .eq("companyId", companyId)
      .in(
        "id",
        entries.map(([, supplierProcessId]) => supplierProcessId)
      )
  ]);
  if (operations.error || supplierProcesses.error) {
    return ctx.error(
      "internal",
      "Failed to save the supplier choice",
      operations.error ?? supplierProcesses.error
    );
  }

  const processOfOperation = new Map(
    operations.data.map((op) => [op.id, op.processId])
  );
  const processOfSupplierProcess = new Map(
    supplierProcesses.data.map((sp) => [sp.id, sp.processId])
  );
  for (const [operationId, supplierProcessId] of entries) {
    const processId = processOfOperation.get(operationId);
    if (!processId) {
      return ctx.error(
        "validation",
        `Operation ${operationId} does not belong to these jobs`
      );
    }
    if (processOfSupplierProcess.get(supplierProcessId) !== processId) {
      return ctx.error(
        "validation",
        "Selected supplier does not belong to the operation's process"
      );
    }
  }

  const updates = await Promise.all(
    entries.map(([operationId, supplierProcessId]) =>
      system
        .from("jobOperation")
        .update({
          operationSupplierProcessId: supplierProcessId,
          updatedBy: ctx.auditUserId
        })
        .eq("id", operationId)
        .eq("companyId", companyId)
    )
  );
  const failed = updates.find((update) => update.error)?.error;
  return failed
    ? ctx.error("internal", "Failed to save the supplier choice", failed)
    : null;
}

export type JobStatus = (typeof jobStatus)[number];

/**
 * Move a job from one of `from` to `to`, as one guarded UPDATE: the job must be
 * in `from` when it is read and still when it is written.
 */
export async function moveJobStatus(
  ctx: ServiceContext,
  jobId: string,
  {
    from,
    to,
    refusal
  }: { from: readonly JobStatus[]; to: JobStatus; refusal: string }
) {
  const job = await ctx.asCaller.supabase
    .from("job")
    .select("status")
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (job.error)
    return ctx.error("internal", "Failed to read the job", job.error);
  if (!job.data) return ctx.error("notFound", "Job not found");
  if (!from.includes(job.data.status)) return ctx.error("rule", refusal);

  const update = await updateJobStatus(ctx.asCaller.supabase, {
    id: jobId,
    companyId: ctx.company.id,
    status: to,
    updatedBy: ctx.auditUserId,
    fromStatuses: [...from]
  });
  if (update.error) {
    return ctx.error("internal", "Failed to update job status", update.error);
  }
  if (!update.updated) {
    return ctx.error("conflict", "The job's status changed; reload the job");
  }
  return { jobId, status: to };
}

/** Post an ended event's time to the GL; a skip or failure is the reason, not an error. */
export async function postEndedEvent(
  ctx: ServiceContext,
  productionEventId: string
) {
  const posting = await invokePosting(
    {
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    "post-production-event",
    { productionEventId },
    postProductionEvent
  );
  if (posting.error) return posting.error.message || "unknown error";
  if (posting.data.success === false) {
    return posting.data.reason ?? "unknown reason";
  }
  return null;
}

type OwnedTable =
  | "item"
  | "location"
  | "customer"
  | "modelUpload"
  | "fixedAssetClass"
  | "fixedAsset"
  | "storageUnit"
  | "salesOrder"
  | "salesOrderLine"
  | "quote"
  | "quoteLine";

/**
 * `notFound` unless every id is a row of this company. Ids from a form prove
 * nothing about tenancy, and the writes after this run with the service role.
 * Read with the service role, since a production user may not hold the
 * other module's view and RLS would read their own row as absent.
 */
export async function requireOwnRecords(
  ctx: ServiceContext,
  records: [table: OwnedTable, id: string | null | undefined, label: string][]
): Promise<CarbonError | null> {
  const checks = await Promise.all(
    records
      .filter(([, id]) => id)
      .map(async ([table, id, label]) => {
        const row = await ctx.asSystem.supabase
          .from(table as "item")
          .select("id")
          .eq("id", id!)
          .eq("companyId", ctx.company.id)
          .maybeSingle();
        if (row.error) {
          return ctx.error(
            "internal",
            `Failed to verify the ${label}`,
            row.error
          );
        }
        return row.data
          ? null
          : ctx.error(
              "notFound",
              `The ${label} could not be found. It may have been deleted, or it belongs to another company.`
            );
      })
  );
  return checks.find((check) => check !== null) ?? null;
}

/**
 * The jobs, read as the caller, refusing the request when any is locked
 * (Completed, Closed or Cancelled). Ids of other companies are not returned.
 */
export async function readUnlockedJobs(ctx: ServiceContext, ids: string[]) {
  const jobs = await ctx.asCaller.supabase
    .from("job")
    .select(
      "id, status, quantity, fixedAssetClassId, fixedAssetId, dueDate, deadlineType, locationId"
    )
    .in("id", ids)
    .eq("companyId", ctx.company.id);
  if (jobs.error) {
    return ctx.error("internal", "Failed to read the jobs", jobs.error);
  }
  if (jobs.data.some((job) => isJobLocked(job.status))) {
    return ctx.error("rule", JOB_LOCKED_MESSAGE);
  }
  return jobs.data;
}

/**
 * Each job's due date when `count` jobs are spread from the first job's due
 * date to the last's: several jobs a day when there are more jobs than days,
 * several days a job otherwise. The last job is due on the last date.
 */
export function spreadDueDates(
  count: number,
  first: string | undefined,
  last: string | undefined
): (string | undefined)[] {
  if (!first || !last) return Array.from({ length: count }, () => first);
  const startDate = toCalendarDateTime(parseDateTime(first));
  const endDate = toCalendarDateTime(parseDateTime(last));
  const daysBetween = endDate.compare(startDate);
  const jobsPerDay = (count - 1) / daysBetween;
  const daysPerJob = daysBetween / (count - 1);

  let cumulativeJobs = 0;
  return Array.from({ length: count }, (_, i) => {
    if (i === count - 1) return last;
    if (jobsPerDay >= 1) {
      cumulativeJobs += 1;
      const dayOffset = Math.floor(cumulativeJobs / jobsPerDay);
      return startDate.add({ days: dayOffset }).toString();
    }
    const dayOffset = Math.floor(i * daysPerJob);
    return startDate.add({ days: dayOffset }).toString();
  });
}

/**
 * A job's configuration: an object, or the JSON a form posts. Anything else
 * (invalid JSON) is no configuration.
 */
export function parseConfiguration(
  value: unknown
): Record<string, unknown> | undefined {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * The job, read as the caller, for a write to it: `notFound` unless it is
 * this company's, `rule` when it is locked (Completed, Closed or Cancelled).
 */
export async function requireJob(ctx: ServiceContext, jobId: string) {
  const job = await ctx.asCaller.supabase
    .from("job")
    .select("id, status")
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (job.error)
    return ctx.error("internal", "Failed to read the job", job.error);
  if (!job.data) return ctx.error("notFound", "Job not found");
  if (isJobLocked(job.data.status)) {
    return ctx.error("rule", JOB_LOCKED_MESSAGE);
  }
  return job.data;
}

/**
 * Recalculate a job's requirements and operation dependencies (which also
 * reschedules its location). The first failure is returned.
 */
export async function recalculateJob(
  ctx: ServiceContext,
  jobId: string,
  { requirements = true }: { requirements?: boolean } = {}
): Promise<CarbonError | null> {
  const params = { companyId: ctx.company.id, userId: ctx.auditUserId };
  const [quantities, dependencies] = await Promise.all([
    requirements
      ? recalculateJobRequirements(ctx.asSystem.supabase, ctx.asSystem.pg, {
          id: jobId,
          ...params
        })
      : null,
    recalculateJobOperationDependencies(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        jobId,
        ...params
      }
    )
  ]);
  if (quantities?.error) {
    return ctx.error(
      "internal",
      "Failed to calculate job quantities",
      quantities.error
    );
  }
  if (dependencies?.error) {
    return ctx.error(
      "internal",
      "Failed to recalculate job operation dependencies",
      dependencies.error
    );
  }
  return null;
}

/** `notFound` unless the make method and operation given hang off this job. */
export async function requireJobChildren(
  ctx: ServiceContext,
  jobId: string,
  {
    jobMakeMethodId,
    jobOperationId
  }: { jobMakeMethodId?: string; jobOperationId?: string }
): Promise<CarbonError | null> {
  const system = ctx.asSystem.supabase;
  const [method, operation] = await Promise.all([
    jobMakeMethodId
      ? system
          .from("jobMakeMethod")
          .select("id")
          .eq("id", jobMakeMethodId)
          .eq("jobId", jobId)
          .eq("companyId", ctx.company.id)
          .maybeSingle()
      : null,
    jobOperationId
      ? system
          .from("jobOperation")
          .select("id")
          .eq("id", jobOperationId)
          .eq("jobId", jobId)
          .eq("companyId", ctx.company.id)
          .maybeSingle()
      : null
  ]);
  const failed = method?.error ?? operation?.error;
  if (failed) return ctx.error("internal", "Failed to read the job", failed);
  if (method && !method.data)
    return ctx.error("notFound", "Make method not found");
  if (operation && !operation.data) {
    return ctx.error("notFound", "Operation not found");
  }
  return null;
}

/** Recalculate one make method's requirements, and the job's dependencies. */
export async function recalculateMaterialMethod(
  ctx: ServiceContext,
  {
    jobId,
    jobMakeMethodId,
    dependencies
  }: { jobId: string; jobMakeMethodId: string; dependencies: boolean }
): Promise<CarbonError | null> {
  const params = { companyId: ctx.company.id, userId: ctx.auditUserId };
  const [requirements, dependencyResult] = await Promise.all([
    recalculateJobMakeMethodRequirements(
      ctx.asSystem.supabase,
      ctx.asSystem.pg,
      {
        id: jobMakeMethodId,
        ...params
      }
    ),
    dependencies
      ? recalculateJobOperationDependencies(
          ctx.asSystem.supabase,
          ctx.asSystem.pg,
          { jobId, ...params }
        )
      : null
  ]);
  if (requirements.error) {
    return ctx.error(
      "internal",
      "Failed to recalculate job make method requirements",
      requirements.error
    );
  }
  if (dependencyResult?.error) {
    return ctx.error(
      "internal",
      "Failed to recalculate job operation dependencies",
      dependencyResult.error
    );
  }
  return null;
}

// --- People board ---------------------------------------------------------

type BoardReferenceTable =
  | "department"
  | "employee"
  | "location"
  | "shift"
  | "workCenter";

/**
 * `notFound` unless every id given is this company's. Every board write puts
 * these ids into this company's rows through Kysely (no RLS), and their
 * single-column foreign keys accept another company's row. Empty values are
 * skipped, so optional fields stay optional.
 */
export async function requireBoardReferences(
  ctx: ServiceContext,
  refs: Partial<Record<BoardReferenceTable, (string | null | undefined)[]>>
): Promise<CarbonError | null> {
  const checks = await Promise.all(
    (Object.entries(refs) as [BoardReferenceTable, unknown[]][]).map(
      async ([table, values]) => {
        const ids = [
          ...new Set(
            values.filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0
            )
          )
        ];
        if (ids.length === 0) return true;
        // Every table in the union has `id` + `companyId`; the cast only
        // narrows the union so Kysely can type the builder.
        const rows = await ctx.asSystem.pg
          .selectFrom(table as "location")
          .select("id")
          .where("id", "in", ids)
          .where("companyId", "=", ctx.company.id)
          .execute();
        return rows.length === ids.length;
      }
    )
  );
  if (checks.every(Boolean)) return null;
  logger.error("People board reference is not in the caller's company", {
    companyId: ctx.company.id,
    refs
  });
  return ctx.error("notFound", "Not found");
}

/** Tell the scheduler once per work center; with none, once, unscoped. */
export async function notifyPeopleChange(
  ctx: ServiceContext,
  reason: string,
  workCenterIds: (string | null | undefined)[] = []
) {
  const ids = [...new Set(workCenterIds.filter(Boolean))] as string[];
  if (ids.length === 0) {
    await notifyScheduleInputsChanged(ctx.company.id, "people", reason);
    return;
  }
  for (const workCenterId of ids) {
    await notifyScheduleInputsChanged(
      ctx.company.id,
      "people",
      reason,
      workCenterId
    );
  }
}

/** The work centers a person is assigned at on a date, for the notice. */
export async function notifyForEmployeeDate(
  ctx: ServiceContext,
  employeeId: string,
  date: string,
  reason: string
) {
  const assignments = await ctx.asCaller.supabase
    .from("peopleAssignment")
    .select("workCenterId")
    .eq("companyId", ctx.company.id)
    .eq("employeeId", employeeId)
    .eq("date", date);
  await notifyPeopleChange(
    ctx,
    reason,
    (assignments.data ?? []).map((row) => row.workCenterId)
  );
}

/** A write that throws on failure, as an `internal` error with `message`. */
export async function catchInternal<T>(
  ctx: ServiceContext,
  message: string,
  write: () => Promise<T>
): Promise<T | CarbonError<"internal">> {
  try {
    return await write();
  } catch (err) {
    return ctx.error("internal", message, err);
  }
}

/** A Draft or Planned job of this company at `locationId`, for planning. */
export async function readPlanningJob(
  ctx: ServiceContext,
  jobId: string,
  locationId: string
) {
  const target = await ctx.asSystem.supabase
    .from("job")
    .select("id, status, locationId, salesOrderId, salesOrderLineId")
    .eq("id", jobId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (target.error || !target.data) {
    return ctx.error("notFound", "Job not found", target.error);
  }
  // The drawer lists one location's jobs.
  if (target.data.locationId !== locationId) {
    return ctx.error("conflict", "This job is for another location.");
  }
  return target.data;
}

/**
 * Report how many of the requested worklist rows changed; none is a conflict
 * (each one was applied or changed since the page loaded).
 */
export function changedPlanningActions(
  ctx: ServiceContext,
  result: { data: unknown[] | null; error: unknown },
  requested: number,
  verb: "dismiss" | "reopen" | "assign"
) {
  if (result.error) {
    return ctx.error(
      "internal",
      `Failed to ${verb} planning actions`,
      result.error
    );
  }
  const changed = result.data?.length ?? 0;
  if (changed === 0) {
    return ctx.error(
      "conflict",
      `Nothing to ${verb} — these actions changed since the page loaded`
    );
  }
  return { changed, requested };
}

// --- Assembly instructions -------------------------------------------------

/** The instruction's model id, `notFound` unless it is this company's. */
export async function readInstructionModel(ctx: ServiceContext, id: string) {
  const instruction = await ctx.asCaller.supabase
    .from("assemblyInstruction")
    .select(
      "modelUploadId, modelUpload(id, processingStatus, glbPath, graphPath, modelPath)"
    )
    .eq("id", id)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (instruction.error) {
    return ctx.error(
      "internal",
      "Failed to read the instruction",
      instruction.error
    );
  }
  if (!instruction.data) return ctx.error("notFound", "Instruction not found");
  if (!instruction.data.modelUploadId) {
    return ctx.error("rule", "This instruction has no model");
  }
  return {
    modelUploadId: instruction.data.modelUploadId,
    modelUpload: instruction.data.modelUpload
  };
}

/** The geometry service is down: no conversion or planning can start. */
export const geometryServiceDown = (ctx: ServiceContext, work: string) =>
  ctx.error(
    "unavailable",
    `The geometry service is unavailable — ${work} can't run right now.`
  );

/**
 * Start motion planning for a model: the job row first, so the page shows
 * the run on its next load (the worker adopts it via `planJobId`; it inserts
 * its own row when this insert fails), then the event.
 */
export async function startAssemblyPlan(
  ctx: ServiceContext,
  modelUploadId: string,
  options: { reMotionFor?: string; reDetectUnits?: boolean } = {}
) {
  // The service role: the INSERT needs production_create, and the operations
  // that start a plan require only update. Every caller read the model under
  // the company, and the row is written to it.
  const created = await createAssemblyPlanJob(ctx.asSystem.supabase, {
    modelUploadId,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  });
  await trigger("assembly-plan", {
    modelUploadId,
    companyId: ctx.company.id,
    userId: ctx.auditUserId,
    ...(created.data?.id ? { planJobId: created.data.id } : {}),
    ...options
  });
}

/** What resuming a paused job checks: its status, item and asset links. */
export async function getJobToResume(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  return client
    .from("job")
    .select(
      "status, quantity, salesOrderLineId, fixedAssetClassId, fixedAssetId, item(itemTrackingType, itemReplenishment(manufacturingBlocked))"
    )
    .eq("id", jobId)
    .eq("companyId", companyId)
    .maybeSingle();
}
export const closeJobInput = z.object({
  jobId: z.string()
});

/**
 * Closing a job writes off whatever is left in WIP for it as production
 * variance, so the job's WIP nets to zero. Nothing to do when the residual is
 * under a cent. The journal is Provisional before the company's accounting
 * cutover and Posted after it.
 */
export async function closeJob(
  ctx: ServiceContext,
  raw: z.input<typeof closeJobInput>
) {
  const { jobId } = closeJobInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );

  if (companyRecord.error) throw new Error("Failed to fetch company");

  const accountDefaults = await getDefaultPostingGroup(db, companyId);
  if (accountDefaults?.error || !accountDefaults?.data) {
    throw new Error("Error getting account defaults");
  }

  await db.transaction().execute(async (trx) => {
    // Provisional before the company's accounting cutover, Posted after it.
    // Read inside the transaction so the FOR SHARE lock holds until commit.
    const postingStatus = await journalPostingStatus(trx, companyId);

    const wipBalance = await trx
      .selectFrom("journalLine")
      .innerJoin("journal", "journal.id", "journalLine.journalId")
      .select((eb) => eb.fn.sum("journalLine.amount").as("balance"))
      .where(
        "journalLine.accountId",
        "=",
        accountDefaults.data!.workInProgressAccount
      )
      .where("journalLine.documentId", "=", jobId)
      .where("journal.companyId", "=", companyId)
      .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
      .executeTakeFirst();

    const remainingWip = Number(wipBalance?.balance ?? 0);

    if (Math.abs(remainingWip) < 0.01) return;

    const job = await trx
      .selectFrom("job")
      .where("id", "=", jobId)
      .where("companyId", "=", companyId)
      .select(["jobId", "itemId", "locationId"])
      .executeTakeFirstOrThrow();

    // Resolve the item dimensions so the WIP variance lines are attributable
    // to the finished good (mirrors the WIP lines posted during completion).
    const companyGroupId = companyRecord.data.companyGroupId;
    const dimensionMap = new Map<string, string>();
    if (companyGroupId) {
      const dimensions = await trx
        .selectFrom("dimension")
        .select(["id", "entityType"])
        .where("companyGroupId", "=", companyGroupId)
        .where("active", "=", true)
        .where("entityType", "in", ["ItemPostingGroup", "Item", "Location"])
        .execute();
      for (const dim of dimensions) {
        if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
      }
    }

    const finishedItemCost = job.itemId
      ? await trx
          .selectFrom("itemCost")
          .select(["itemPostingGroupId"])
          .where("itemId", "=", job.itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      : null;

    const journalLineReference = nanoid();

    const journalLineInserts = [
      {
        accountId: accountDefaults.data!.materialVarianceAccount,
        description: "Production Variance",
        // Signed: a positive residual debits variance / credits WIP; a
        // negative (over-credited) residual reverses — always zeroing WIP.
        amount: round(debit("expense", remainingWip)),
        quantity: 0,
        documentType: "Job Close" as const,
        documentId: jobId,
        documentLineReference: journalReference.to.job(jobId),
        journalLineReference,
        companyId
      },
      {
        accountId: accountDefaults.data!.workInProgressAccount,
        description: "WIP Account",
        amount: round(credit("asset", remainingWip)),
        quantity: 0,
        documentType: "Job Close" as const,
        documentId: jobId,
        documentLineReference: journalReference.to.job(jobId),
        journalLineReference,
        companyId
      }
    ];

    // A Provisional journal has no accounting period.
    const accountingPeriodId =
      postingStatus === "Posted"
        ? await getCurrentAccountingPeriod(companyId, trx, today)
        : null;

    const journalEntryId = await getNextSequence(
      trx,
      "journalEntry",
      companyId
    );

    const journalResult = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId,
        description: `Job Close Variance ${job.jobId}`,
        postingDate: today,
        companyId,
        sourceType: "Job Close",
        status: postingStatus,
        postedAt: datetime.timestamp(),
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLineResults = await trx
      .insertInto("journalLine")
      .values(
        journalLineInserts.map((line) => ({
          ...line,
          journalId: journalResult.id
        }))
      )
      .returning(["id"])
      .execute();

    if (dimensionMap.size > 0) {
      const dimensionInserts: {
        journalLineId: string;
        dimensionId: string;
        valueId: string;
        companyId: string;
      }[] = [];

      for (const jl of journalLineResults) {
        if (job.itemId && dimensionMap.has("Item")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("Item")!,
            valueId: job.itemId,
            companyId
          });
        }
        if (
          finishedItemCost?.itemPostingGroupId &&
          dimensionMap.has("ItemPostingGroup")
        ) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("ItemPostingGroup")!,
            valueId: finishedItemCost.itemPostingGroupId,
            companyId
          });
        }
        if (job.locationId && dimensionMap.has("Location")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("Location")!,
            valueId: job.locationId,
            companyId
          });
        }
      }

      if (dimensionInserts.length > 0) {
        await trx
          .insertInto("journalLineDimension")
          .values(dimensionInserts)
          .execute();
      }
    }
  });

  return { success: true };
}
export const assignSerialNumbersInput = z.object({
  jobId: z.string()
});

/**
 * Assigns configured serial numbers to a job's tracked entities at creation time.
 *
 * Run (best-effort) by `insertJob` only when the job's item has an
 * `itemSerialSequence`. For a Batch item it stamps one number on the single
 * whole-quantity seed entity; for a Serial item it splits the seed into N
 * quantity-1 entities and stamps one number on each. Numbers come from the
 * item's sequence (atomic counter) with %{...} date/week/location tokens.
 *
 * Idempotent: it no-ops when the seed is already numbered or already split.
 */
export const assignSerialNumbersPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof assignSerialNumbersInput>>;

export async function assignSerialNumbers(
  ctx: ServiceContext,
  raw: z.input<typeof assignSerialNumbersInput>
) {
  const { jobId } = assignSerialNumbersInput.parse(raw);
  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;

  return db.transaction().execute(async (trx) => {
    // 1. The job
    const job = await trx
      .selectFrom("job")
      .select(["id", "itemId", "quantity", "locationId"])
      .where("id", "=", jobId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!job) throw new NotFoundError(`Job ${jobId} not found`);

    // 2. Only serial/batch tracked items carry serial numbers
    const item = await trx
      .selectFrom("item")
      .select(["itemTrackingType"])
      .where("id", "=", job.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    const trackingType = item?.itemTrackingType;
    if (trackingType !== "Serial" && trackingType !== "Batch") {
      return { assigned: 0 };
    }

    // 3. The item's serial sequence (optional, at most one)
    const sequence = await trx
      .selectFrom("itemSerialSequence")
      .select(["prefix", "suffix", "next", "size", "step"])
      .where("itemId", "=", job.itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!sequence) return { assigned: 0 };

    // 4. Location context for the %{location} token (code, falling back to name)
    let locationCode: string | null = null;
    let locationName: string | null = null;
    if (job.locationId) {
      const location = await trx
        .selectFrom("location")
        .select(["code", "name"])
        .where("id", "=", job.locationId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      locationCode = location?.code ?? null;
      locationName = location?.name ?? null;
    }

    // 5. The root make-method seed entity for this job. The job-insert
    //    interceptor tags it with the Job id; sub-assembly seeds also carry a
    //    Job Material id, and split fragments carry a pointer key — the
    //    legacy "Split Entity ID" (old convention: departed original) or
    //    "Split From Entity ID" (new convention: split child). Exclude all
    //    so we only touch the root make method's seed.
    const seeds = await trx
      .selectFrom("trackedEntity")
      .selectAll()
      .where("companyId", "=", companyId)
      .where(attributesContain({ Job: jobId }))
      .where(sql<boolean>`attributes->>'Job Material' IS NULL`)
      .where(sql<boolean>`attributes->>'Split Entity ID' IS NULL`)
      .where(sql<boolean>`attributes->>'Split From Entity ID' IS NULL`)
      .orderBy("createdAt", "asc")
      // Lock the seed row for the duration of the transaction so concurrent
      // runs for the same job serialize here: the second waits, then sees
      // the readableId the first assigned and no-ops the idempotency guard
      // below instead of reserving a duplicate range and inserting duplicates.
      .forUpdate()
      .execute();

    // Idempotency: already split into many, or already numbered → do nothing.
    const seed = seeds[0];
    if (seeds.length !== 1 || !seed) return { assigned: 0 };
    if (seed.readableId) return { assigned: 0 };

    // 6. How many numbers to reserve. Serial → one per unit; Batch → one.
    const count =
      trackingType === "Batch" ? 1 : Math.round(Number(job.quantity));
    if (count < 1) return { assigned: 0 };

    // 7. Atomically reserve + format the next `count` serial numbers.
    const serials = await getNextSerialNumbers(trx, {
      itemId: job.itemId,
      companyId,
      count,
      locationCode,
      locationName
    });
    if (serials.length === 0) return { assigned: 0 };

    // 8. Assign. Batch keeps the single whole-quantity seed; Serial splits it
    //    into `count` quantity-1 entities, one number each (seed becomes #1).
    if (trackingType === "Batch") {
      await trx
        .updateTable("trackedEntity")
        .set({ readableId: serials[0] })
        .where("id", "=", seed.id)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      await trx
        .updateTable("trackedEntity")
        .set({ readableId: serials[0], quantity: 1 })
        .where("id", "=", seed.id)
        .where("companyId", "=", companyId)
        .execute();

      if (count > 1) {
        // Each row gets its OWN `createdAt`, one millisecond apart, in serial
        // order. Left to the column default they would all take the
        // transaction's `now()` and tie — and `createdAt` is the unit axis
        // every step record is indexed against (see
        // getTrackedEntitiesByMakeMethodId). Tied rows come back in physical
        // order, which an UPDATE changes, so recorded values slid onto other
        // serials. The seed keeps its earlier timestamp and stays unit 0.
        const rows = serials.slice(1).map((readableId, offset) => ({
          createdAt: sql<string>`now() + ${offset + 1}::int * interval '1 millisecond'`,
          sourceDocument: seed.sourceDocument,
          sourceDocumentId: seed.sourceDocumentId,
          sourceDocumentReadableId: seed.sourceDocumentReadableId,
          quantity: 1,
          status: seed.status,
          attributes: seed.attributes,
          itemId: seed.itemId ?? null,
          expirationDate: seed.expirationDate ?? null,
          readableId,
          companyId,
          createdBy: seed.createdBy
        }));
        await trx.insertInto("trackedEntity").values(rows).execute();
      }
    }

    return { assigned: count };
  });
}
const sandboxLogger = getLogger("erp", "configuration-rule");

/**
 * A stored configuration rule is the TypeScript body of `configure(params)`. It is
 * transpiled by `transpileRule` — the same one the configurator editor runs — and run in
 * QuickJS (`@carbon/database/configuration-rule`), never in this process's own engine.
 *
 * A rule that does not compile, throws, or exceeds a sandbox limit yields null, so one
 * broken rule never fails the whole method: a field keeps its default, and a bill of
 * materials or process keeps all of its lines.
 */
export async function importTypeScript(code: string): Promise<{
  configure: <T>(params: unknown) => Promise<T | null>;
}> {
  let javascript: string | null = null;
  try {
    javascript = transpileRule(code);
  } catch (error) {
    sandboxLogger.error("configuration rule does not compile", {
      error: String(error)
    });
  }

  return {
    configure: async <T>(params: unknown) => {
      if (javascript === null) return null;
      try {
        return (await runConfigurationRule(javascript, params)) as T | null;
      } catch (error) {
        sandboxLogger.error("configuration rule failed", {
          error: String(error)
        });
        return null;
      }
    }
  };
}
const getMethodLogger = getLogger("erp", "get-method");

/**
 * An operation-step `description` as a tiptap doc for a jsonb column. The
 * Supabase client returns a jsonb scalar string as a JS string, and re-inserting
 * a JS string makes node-pg send unquoted text that Postgres rejects: objects
 * pass through, strings are wrapped, and null/empty become {}.
 */
function toTiptapDoc(value: unknown): Json {
  if (value && typeof value === "object") return value as Json;
  if (typeof value === "string" && value.length > 0) {
    return TiptapText(value, { format: "text" }).toDocument() as Json;
  }
  return {};
}

// quoteLine's jsonb columns — run through toJsonColumns() in quoteToQuote's per-line copy.
const QUOTE_LINE_JSON_COLUMNS = [
  "additionalCharges",
  "configuration",
  "customFields",
  "externalNotes",
  "internalNotes",
  "priceTrace"
] as const satisfies readonly (keyof Database["public"]["Tables"]["quoteLine"]["Row"])[];

// Stored configurator rules are user-authored JS that may still return legacy "Inside"/"Outside" operationType values.
const normalizeOperationType = (value: unknown) =>
  (value === "Inside"
    ? "Process"
    : value === "Outside"
      ? "Outside Processing"
      : value) as Database["public"]["Enums"]["operationType"];

// Copy an operation step's reference slides (grandchild) when a method/job/quote is
// copied. Source slides are queried by their (old) step ids and remapped onto the freshly
// inserted step ids — a bulk insert preserves order, so insertedStepIds[i] ↔ sourceSteps[i].
// Guarded: a no-op when there are no slides, so it can never break step copying.
// See .ai/specs/2026-07-14-mes-execution-views.md §4.
async function copyStepSlides(
  trx: Transaction<KyselyDatabase>,
  sourceSteps: Array<{ id?: string | null }>,
  insertedStepIds: Array<{ id: string }>,
  sourceTable:
    | "methodOperationStepSlide"
    | "jobOperationStepSlide"
    | "quoteOperationStepSlide",
  targetTable:
    | "methodOperationStepSlide"
    | "jobOperationStepSlide"
    | "quoteOperationStepSlide",
  companyId: string,
  userId: string
) {
  const sourceStepIds = sourceSteps
    .map((s) => s.id)
    .filter((id): id is string => !!id);
  if (sourceStepIds.length === 0) return;

  // The three slide tables share these columns; one name stands for all.
  const srcSlides = await selectRows(
    trx,
    sourceTable as "methodOperationStepSlide",
    { stepId: sourceStepIds }
  );

  const inserts = srcSlides.flatMap((sl) => {
    const idx = sourceSteps.findIndex((s) => s.id === sl.stepId);
    const newStepId = insertedStepIds[idx]?.id;
    if (!newStepId) return [];
    return [
      {
        stepId: newStepId,
        imagePath: sl.imagePath,
        modelUploadId: sl.modelUploadId,
        caption: sl.caption,
        sortOrder: sl.sortOrder,
        size: sl.size,
        // A raw array reaches Postgres as an array literal: `[]` was stored as
        // the jsonb object `{}`, and a slide with pins failed the insert.
        annotations: toJson(sl.annotations ?? []),
        companyId,
        createdBy: userId
      }
    ];
  });

  if (inserts.length > 0) {
    await trx
      .insertInto(targetTable as any)
      .values(inserts as any)
      .execute();
  }
}

// Many-to-many step links (Phase 2): remap a parent's OLD operation-step ids onto the freshly
// inserted step ids via stepMap, dropping any that don't map. Empty in = the parent applies to
// the whole operation (no join rows, shown on every step in the MES).
function remapStepIds(
  oldIds: Array<string | null | undefined> | null | undefined,
  stepMap: Record<string, string>
): string[] {
  return (oldIds ?? []).flatMap((id) =>
    id && stepMap[id] ? [stepMap[id]] : []
  );
}

// Material twin of remapStepIds: get_method_tree aggregates methodMaterialStep as
// {id, quantity} objects (quantity NULL = the step uses the full BOM line quantity).
// Bare-string elements are tolerated for trees read before the aggregate changed.
function remapStepLinks(
  oldLinks:
    | Array<string | { id?: string | null; quantity?: number | null } | null>
    | null
    | undefined,
  stepMap: Record<string, string>
): { stepId: string; quantity: number | null }[] {
  return (oldLinks ?? []).flatMap((link) => {
    const id = typeof link === "string" ? link : link?.id;
    const quantity =
      typeof link === "object" && link !== null
        ? (link.quantity ?? null)
        : null;
    return id && stepMap[id]
      ? [
          {
            stepId: stepMap[id],
            quantity: quantity === null ? null : Number(quantity)
          }
        ]
      : [];
  });
}

// A BOM line whose quantity is explicitly 0 contributes nothing, so it is
// dropped whenever a method is instantiated or copied. `null`/`undefined` is
// NOT treated as zero — those fall back to a quantity of 1 elsewhere in this
// file, so only a real numeric 0 removes the line.
function isZeroQuantity(quantity: unknown): boolean {
  // Only a real numeric 0 removes the line. `getConfiguredValue` returns a
  // dynamically-configured value behind a type assertion, so `""`/`false`/`[]`
  // can reach here — `Number("")`/`Number(false)` are 0 and would wrongly drop
  // the line. A strict typeof check keeps those falling back to a quantity of 1.
  return typeof quantity === "number" && quantity === 0;
}

const partsValidator = z
  .object({
    billOfMaterial: z.boolean().default(true),
    billOfProcess: z.boolean().default(true),
    parameters: z.boolean().default(true),
    tools: z.boolean().default(true),
    steps: z.boolean().default(true),
    workInstructions: z.boolean().default(true)
    // prefault, not default: v4's .default() returns {} AS-IS on undefined input,
    // which would skip every inner default and disable all six part flags.
  })
  .prefault({});

export const getMethodInput = z.object({
  type: z.enum([
    "itemToItem",
    "itemToJob",
    "itemToJobMakeMethod",
    "itemToQuoteLine",
    "itemToQuoteMakeMethod",
    "jobMakeMethodToItem",
    "jobToItem",
    "jobToJob",
    "makeMethodToMakeMethod",
    "procedureToOperation",
    "quoteLineToItem",
    "quoteLineToJob",
    "quoteLineToQuoteLine",
    "quoteMakeMethodToItem",
    "quoteToQuote"
  ]),
  sourceId: z.string(),
  targetId: z.string(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  parts: partsValidator,
  // A specific source makeMethod version (itemToJob / itemToJobMakeMethod
  // only). Absent = the item's active method, as before.
  versionId: z.string().optional()
});

/** `newQuoteId` is set by quoteToQuote. */
export type GetMethodResult = { success: boolean; newQuoteId?: string };

export const getMethodPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof getMethodInput>>;

/** Copies a method (BOM + BOP) between items, quotes and jobs, per `type`. */
// Configuration rule fields name the rows they configure, joined by ":":
// `<column>:<lineId>` for a method line or operation field, and
// `billOfMaterial|billOfProcess:<makeMethodId>:<lineId | "undefined">` for a
// node's list. Copying a method gives every row a new id, so its rules are
// re-keyed through a map of old id → new id.

/** Whether a rule field names any of `ids`. */
export function ruleFieldReferences(field: string, ids: Set<string>) {
  return field.split(":").some((part) => ids.has(part));
}

/** The field re-keyed onto the copied rows, or null when it names none of them. */
export function remapRuleField(field: string, idMap: Map<string, string>) {
  const parts = field.split(":");
  if (!parts.some((part) => idMap.has(part))) return null;
  return parts.map((part) => idMap.get(part) ?? part).join(":");
}

// A method copy re-keys the rules of the copied rows onto their new ids (`idMap`:
// source line, operation and method ids → target ids; see configuration-rules.ts),
// and drops the target's rules for the rows it replaced. Otherwise a new version's
// lines carry no rules and the old rules point at deleted rows.
async function copyConfigurationRules(
  trx: Transaction<KyselyDatabase>,
  args: {
    sourceItemId: string;
    targetItemId: string;
    replacedIds: string[];
    idMap: Map<string, string>;
    companyId: string;
    userId: string;
  }
) {
  const { sourceItemId, targetItemId, idMap, companyId, userId } = args;
  const replaced = new Set(args.replacedIds);

  if (replaced.size > 0) {
    const targetRules = await trx
      .selectFrom("configurationRule")
      .select("field")
      .where("itemId", "=", targetItemId)
      .where("companyId", "=", companyId)
      .execute();
    const stale = targetRules
      .map((rule) => rule.field)
      .filter((field) => ruleFieldReferences(field, replaced));
    if (stale.length > 0) {
      await trx
        .deleteFrom("configurationRule")
        .where("itemId", "=", targetItemId)
        .where("companyId", "=", companyId)
        .where("field", "in", stale)
        .execute();
    }
  }

  if (idMap.size === 0) return;
  const sourceRules = await trx
    .selectFrom("configurationRule")
    .select(["field", "code"])
    .where("itemId", "=", sourceItemId)
    .where("companyId", "=", companyId)
    .execute();
  const copies = sourceRules.flatMap((rule) => {
    const field = remapRuleField(rule.field, idMap);
    return field
      ? [
          {
            itemId: targetItemId,
            field,
            code: rule.code,
            companyId,
            updatedBy: userId
          }
        ]
      : [];
  });
  if (copies.length === 0) return;
  await trx
    .insertInto("configurationRule")
    .values(copies)
    .onConflict((oc) =>
      oc.columns(["itemId", "field"]).doUpdateSet((eb) => ({
        code: eb.ref("excluded.code"),
        updatedBy: eb.ref("excluded.updatedBy")
      }))
    )
    .execute();
}

export async function getMethod(
  ctx: ServiceContext,
  raw: z.input<typeof getMethodInput>
) {
  const { type, sourceId, targetId, configuration, parts, versionId } =
    getMethodInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  getMethodLogger.info("get-method", {
    type,
    sourceId,
    targetId,
    companyId,
    userId,
    parts,
    configuration,
    versionId
  });

  switch (type) {
    case "itemToItem": {
      const [sourceMakeMethod, targetMakeMethod, targetItemReplenishment] =
        await inOrder([
          () =>
            single(db, "activeMakeMethods", { itemId: sourceId, companyId }),
          () =>
            single(db, "activeMakeMethods", { itemId: targetId, companyId }),
          () => single(db, "itemReplenishment", { itemId: targetId, companyId })
        ]);
      if (sourceMakeMethod.error || targetMakeMethod.error) {
        throw new Error("Failed to get make methods");
      }

      if (targetItemReplenishment.error) {
        throw new Error("Failed to get target item replenishment");
      }

      if (targetItemReplenishment.data?.requiresConfiguration) {
        throw new Error("Cannot override method of configured item");
      }

      if (
        sourceMakeMethod.data.id === null ||
        targetMakeMethod.data.id === null
      ) {
        throw new Error("Failed to get make methods");
      }

      const [sourceMaterials, sourceOperations] = await inOrder([
        () =>
          parts.billOfMaterial
            ? many(db, "methodMaterial", {
                makeMethodId: sourceMakeMethod.data.id,
                companyId
              })
            : Promise.resolve({ data: [], error: null }),
        () =>
          parts.billOfProcess
            ? many<
                "methodOperation",
                Tables["methodOperation"]["Row"] & {
                  methodOperationTool: Tables["methodOperationTool"]["Row"][];
                  methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
                  methodOperationStep: Tables["methodOperationStep"]["Row"][];
                }
              >(
                db,
                "methodOperation",
                { makeMethodId: sourceMakeMethod.data.id, companyId },
                {
                  embed: {
                    methodOperationTool: {
                      table: "methodOperationTool",
                      on: "operationId"
                    },
                    methodOperationParameter: {
                      table: "methodOperationParameter",
                      on: "operationId"
                    },
                    methodOperationStep: {
                      table: "methodOperationStep",
                      on: "operationId"
                    }
                  }
                }
              )
            : Promise.resolve({ data: [], error: null })
      ]);

      if (sourceMaterials.error || sourceOperations.error) {
        throw new Error("Failed to get source materials or operations");
      }

      await withTransaction(db, async (trx) => {
        // Delete existing materials and operations from target method
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("methodMaterial")
                .where("makeMethodId", "=", targetMakeMethod.data.id)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("methodOperation")
                .where("makeMethodId", "=", targetMakeMethod.data.id)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve()
        ]);

        // Operations first, so each copied BOM line can point at the copied
        // operation that consumes it, not at the source method's operation.
        const operationIdMap = new Map<string, string>();
        if (
          parts.billOfProcess &&
          sourceOperations.data &&
          sourceOperations.data.length > 0
        ) {
          const operationIds = await trx
            .insertInto("methodOperation")
            .values(
              sourceOperations.data.map(
                ({
                  methodOperationTool: _tools,
                  methodOperationParameter: _parameters,
                  methodOperationStep: _attributes,
                  ...operation
                }) => {
                  const insert = {
                    ...operation,
                    id: undefined, // Let the database generate a new ID
                    makeMethodId: targetMakeMethod.data.id!,
                    createdBy: userId
                  };
                  if (!parts.workInstructions) {
                    insert.workInstruction = {};
                  }
                  return insert;
                }
              )
            )
            .returning(["id"])
            .execute();
          sourceOperations.data.forEach((operation, index) => {
            const id = operationIds[index]?.id;
            if (operation.id && id) operationIdMap.set(operation.id, id);
          });

          for await (const [
            index,
            operation
          ] of sourceOperations.data.entries()) {
            const {
              methodOperationTool,
              methodOperationParameter,
              methodOperationStep,
              procedureId
            } = operation;
            const operationId = operationIds[index]!.id;

            if (
              parts.tools &&
              operationId &&
              Array.isArray(methodOperationTool) &&
              methodOperationTool.length > 0
            ) {
              await trx
                .insertInto("methodOperationTool")
                .values(
                  methodOperationTool.map((tool) => ({
                    toolId: tool.toolId,
                    quantity: tool.quantity,
                    operationId,
                    companyId,
                    createdBy: userId
                  }))
                )
                .execute();
            }

            if (!procedureId) {
              if (
                parts.parameters &&
                Array.isArray(methodOperationParameter) &&
                methodOperationParameter.length > 0
              ) {
                await trx
                  .insertInto("methodOperationParameter")
                  .values(
                    methodOperationParameter.map((param) => ({
                      operationId: operationId!,
                      key: param.key,
                      value: param.value,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .execute();
              }

              if (
                parts.steps &&
                // Assembly ops inherit steps from the linked instruction —
                // never copy (possibly stale) template steps alongside it.
                !operation.assemblyInstructionId &&
                Array.isArray(methodOperationStep) &&
                methodOperationStep.length > 0
              ) {
                const insertedSteps = await trx
                  .insertInto("methodOperationStep")
                  .values(
                    methodOperationStep.map(({ id: _id, ...attribute }) => ({
                      ...attribute,
                      description: toTiptapDoc(attribute.description),
                      operationId: operationId!,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .returning(["id"])
                  .execute();

                await copyStepSlides(
                  trx,
                  methodOperationStep,
                  insertedSteps,
                  "methodOperationStepSlide",
                  "methodOperationStepSlide",
                  companyId,
                  userId
                );
              }
            }
          }
        }
        // Copy materials from source to target, dropping any zero-quantity
        // BOM lines.
        const materialsToCopy = (
          (sourceMaterials.data ??
            []) as Database["public"]["Tables"]["methodMaterial"]["Row"][]
        ).filter((material) => !isZeroQuantity(material.quantity));
        if (parts.billOfMaterial && materialsToCopy.length > 0) {
          await trx
            .insertInto("methodMaterial")
            .values(
              materialsToCopy.map((material) => ({
                ...material,
                productionQuantity: undefined,
                id: undefined, // Let the database generate a new ID
                makeMethodId: targetMakeMethod.data.id!,
                // Without the bill of process the source's operations were not
                // copied, so no operation on the target is known to consume it.
                methodOperationId: material.methodOperationId
                  ? (operationIdMap.get(material.methodOperationId) ?? null)
                  : null,
                createdBy: userId
              }))
            )
            .execute();
        }
      });

      break;
    }
    case "itemToJob": {
      const jobId = targetId;
      if (!jobId) {
        throw new Error("Invalid targetId");
      }
      const itemId = sourceId;
      const isConfigured = !!configuration;
      // Assembly ops whose steps were materialized from an instruction —
      // their material ↔ step links are flushed after the traversal has
      // inserted every node's jobMaterial rows.
      const assemblyOperationsToLink: Array<{
        operationId: string;
        assemblyInstructionId: string;
      }> = [];

      // These lookups go over the direct connection, one after another on
      // purpose: each is a few milliseconds, and running them at once would
      // take five of the process's sixteen pooled connections per call.
      //
      // A chosen version overrides the default active-method lookup; it is
      // re-read under itemId + companyId so a foreign or mismatched
      // makeMethod id can never be exploded.
      const makeMethod = versionId
        ? await db
            .selectFrom("makeMethod")
            .select(["id", "version"])
            .where("id", "=", versionId)
            .where("itemId", "=", itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : await db
            .selectFrom("activeMakeMethods")
            .select(["id", "version"])
            .where("itemId", "=", itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();
      if (!makeMethod?.id) {
        throw new Error("Failed to get make method");
      }
      const makeMethodId = makeMethod.id;

      const jobMakeMethods = await db
        .selectFrom("jobMakeMethod")
        .select(["id"])
        .where("jobId", "=", jobId)
        .where("parentMaterialId", "is", null)
        .where("companyId", "=", companyId)
        .execute();
      // Exactly one root make method, as `.single()` required before.
      const jobMakeMethod = jobMakeMethods[0];
      if (!jobMakeMethod || jobMakeMethods.length > 1) {
        throw new Error("Failed to get job make method");
      }

      const workCenters = await db
        .selectFrom("workCenters")
        .selectAll()
        .where("companyId", "=", companyId)
        .execute();
      const supplierProcesses = await db
        .selectFrom("supplierProcess")
        .selectAll()
        .where("companyId", "=", companyId)
        .execute();
      const jobRow = await db
        .selectFrom("job")
        .select(["locationId", "quantity", "startDate", "dueDate"])
        .where("id", "=", jobId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!jobRow) {
        throw new Error("Failed to get job");
      }
      const job = jobRow;

      // Way 1 — supersession swap at job creation. Build "old item -> effective
      // successor (x conversion factor)" for this company, gated by the job's
      // build date, using the SAME shared logic as MRP so the job's materials
      // match what planning already redirected. Applied to Buy/Pick lines in the
      // mapper below.
      const supersessionContext = await loadSupersessionRedirect(
        db,
        companyId,
        job
      );
      const supersessionRedirect = supersessionContext.redirect;

      const hydratedConfiguration = await hydrateConfiguration(
        db,
        configuration,
        itemId,
        companyId
      );

      const methodTrees = await getMethodTree(db, makeMethodId);
      const configurationRules = isConfigured
        ? await selectRows(db, "configurationRule", { itemId, companyId })
        : [];

      const methodTree = methodTrees.data?.[0] as MethodTreeItem;
      if (!methodTree) throw new NotFoundError("Method tree not found");

      // The traversal below runs on a single transaction connection, so any
      // per-node or per-material query is O(tree) sequential roundtrips — on
      // a large BOM that exceeds the caller's request timeout. Prefetch each
      // lookup table once per tree instead.
      //
      // Trees arrive INCREMENTALLY, which is why this is a lazy layer rather
      // than one up-front walk: the main method tree here, plus one per
      // made-component supersession swap — swapMadeSubAssembly loads the
      // SUCCESSOR's tree and re-enters traverseMethod on it, and that tree's
      // nodes appear in no walk of this one. Every lookup therefore goes
      // through ensurePrefetched, which is idempotent and extends the maps
      // for ids it has not read yet. Without it an unwalked tree resolves to
      // `?? 0` / `?? []`: a whole sub-assembly with no operations and a
      // permanently wrong 0 scrap percentage (jobMaterial.itemScrapPercentage
      // is NOT NULL, and recalculate only re-derives from itemReplenishment
      // when the stored value is NULL, so nothing downstream can repair it).
      const scrapPercentageByItemId = new Map<string, number>();
      const defaultStorageUnitByItemId = new Map<string, string>();
      const jobLocationId = job.locationId;
      let fullestBinAllowed: boolean | undefined;
      async function withFullestBin(reader: typeof db) {
        fullestBinAllowed ??= !(
          await getStrictBackflushSettings(reader, companyId, jobLocationId)
        ).strict;
        return fullestBinAllowed;
      }

      const operationsByMakeMethodId = new Map<string, MethodOperationRow[]>();

      // "Already read for this id" — deliberately distinct from a map miss,
      // which legitimately means "read, no row" (an item with no
      // itemReplenishment, a make method with no operations). Without these
      // sets a sparse item would be re-queried on every visit, which is the
      // N+1 this prefetch exists to remove.
      const prefetchedItemIds = new Set<string>();
      const prefetchedMakeMethodIds = new Set<string>();
      // Identity-based: getMethodTree structuredClones every node per call,
      // so two trees never share node objects. Also stops corrupt/cyclic
      // tree data from looping the walk.
      const seenTreeNodes = new Set<MethodTreeItem>();

      // `reader` is `db` before the transaction opens and `trx` inside it.
      // On a one-connection pool a `db` query issued while the transaction is
      // open would block until the request timeout. itemReplenishment / itemLedger / pickMethod need no embeds,
      // so they go over the direct Postgres connection — bind parameters, no
      // PostgREST URL-length cap (see .ai/lessons.md).
      async function ensureItemsPrefetched(
        reader: typeof db,
        itemIds: string[]
      ) {
        const missing = [...new Set(itemIds)].filter(
          (id) => id && !prefetchedItemIds.has(id)
        );
        if (missing.length === 0) return;

        const replenishmentRows = await reader
          .selectFrom("itemReplenishment")
          .select(["itemId", "scrapPercentage"])
          .where("itemId", "in", missing)
          .where("companyId", "=", companyId)
          .execute();
        for (const row of replenishmentRows) {
          scrapPercentageByItemId.set(
            row.itemId,
            Number(row.scrapPercentage ?? 0)
          );
        }

        // Default storage units at the job's location — two set-based
        // queries instead of up to two per material (getStorageUnitId):
        // pickMethod default wins, else the bin with the highest on-hand
        // quantity — never the fullest bin under strict backflush.
        if (jobLocationId) {
          const ledgerTotals = !(await withFullestBin(reader))
            ? []
            : await reader
                .selectFrom("itemLedger")
                .where("locationId", "=", jobLocationId)
                .where("companyId", "=", companyId)
                .where("itemId", "in", missing)
                .where("storageUnitId", "is not", null)
                .groupBy(["itemId", "storageUnitId"])
                .select([
                  "itemId",
                  "storageUnitId",
                  (eb) => eb.fn.sum("quantity").as("totalQuantity")
                ])
                .having((eb) => eb.fn.sum("quantity"), ">", 0)
                .execute();

          const bestQuantityByItemId = new Map<string, number>();
          for (const row of ledgerTotals) {
            const quantity = Number(row.totalQuantity);
            if (
              row.storageUnitId &&
              quantity > (bestQuantityByItemId.get(row.itemId) ?? 0)
            ) {
              bestQuantityByItemId.set(row.itemId, quantity);
              defaultStorageUnitByItemId.set(row.itemId, row.storageUnitId);
            }
          }

          const pickMethods = await reader
            .selectFrom("pickMethod")
            .select(["itemId", "defaultStorageUnitId"])
            .where("locationId", "=", jobLocationId)
            .where("companyId", "=", companyId)
            .where("itemId", "in", missing)
            .where("defaultStorageUnitId", "is not", null)
            .execute();

          for (const pickMethod of pickMethods) {
            if (pickMethod.defaultStorageUnitId) {
              defaultStorageUnitByItemId.set(
                pickMethod.itemId,
                pickMethod.defaultStorageUnitId
              );
            }
          }
        }

        // Marked covered only AFTER the rows land, so an id can never read as
        // "already fetched, no row" while its read is still in flight.
        for (const id of missing) prefetchedItemIds.add(id);
      }

      // One read over the direct connection: no URL length to chunk for and
      // no row cap to page around.
      async function ensureMakeMethodsPrefetched(
        reader: typeof db,
        makeMethodIds: string[]
      ) {
        const missing = [...new Set(makeMethodIds)].filter(
          (id) => id && !prefetchedMakeMethodIds.has(id)
        );
        if (missing.length === 0) return;

        for (const op of await readMethodOperations(
          reader,
          missing,
          companyId
        )) {
          const list = operationsByMakeMethodId.get(op.makeMethodId);
          if (list) {
            list.push(op);
          } else {
            operationsByMakeMethodId.set(op.makeMethodId, [op]);
          }
        }
        for (const id of missing) prefetchedMakeMethodIds.add(id);
      }

      // Walk the nodes of `root` that no pass has walked yet and read their
      // lookups in one batch. An already-covered tree returns at its root.
      async function ensurePrefetched(reader: typeof db, root: MethodTreeItem) {
        const nodes: MethodTreeItem[] = [];
        const collect = (n: MethodTreeItem) => {
          if (seenTreeNodes.has(n)) return;
          seenTreeNodes.add(n);
          nodes.push(n);
          n.children.forEach(collect);
        };
        collect(root);
        if (nodes.length === 0) return;

        // A Buy/Pick line is swapped to its successor below, so the successor's
        // scrap percentage and default bin are needed even though no tree node
        // names it. Derived from THIS tree's nodes, not from the whole company's
        // redirect map: that map is every itemSupersession row in the tenant, and
        // feeding all of its targets here made the three reads scale with the
        // company's supersession count instead of the BOM — the same request-
        // timeout class this prefetch exists to remove (and, unchunked, a
        // bind-parameter overflow past ~65k ids). Successor trees loaded by
        // swapMadeSubAssembly re-enter through here, so each covers its own
        // redirect targets by induction.
        //
        // Deliberately NOT exhaustive: a configuration rule can replace a line's
        // itemId with an item no tree node names, and that item may be superseded
        // in turn. Those land on the per-material ensureItemsPrefetched below,
        // which is the safety net for every post-configuration id — this is a
        // batching hint, not the correctness boundary.
        const redirectTargets: string[] = [];
        for (const n of nodes) {
          const to = supersessionRedirect.get(n.data.itemId)?.to;
          if (to) redirectTargets.push(to);
        }

        await ensureItemsPrefetched(reader, [
          ...nodes.map((n) => n.data.itemId),
          ...redirectTargets
        ]);
        await ensureMakeMethodsPrefetched(
          reader,
          nodes.map((n) => n.data.materialMakeMethodId)
        );
      }

      await ensurePrefetched(db, methodTree);

      const getLaborAndOverheadRates = getRatesFromWorkCenters(workCenters);
      const getOutsideOperationRates =
        getRatesFromSupplierProcesses(supplierProcesses);

      // Get configuration code by field
      const configurationCodeByField = configurationRules.reduce<
        Record<string, string>
      >((acc, rule) => {
        acc[rule.field] = rule.code;
        return acc;
      }, {});

      await withTransaction(db, async (trx) => {
        const insertedJobMaterialIds: string[] = [];
        if (isConfigured) {
          await trx
            .updateTable("job")
            .set({
              configuration: JSON.stringify(configuration),
              updatedAt: datetime.timestamp(),
              updatedBy: userId
            })
            .where("id", "=", jobId)
            .where("companyId", "=", companyId)
            .execute();
        }

        // Delete existing jobMakeMethod, jobMakeMethodOperation, jobMakeMethodMaterial
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMakeMethod")
                .where((eb) =>
                  eb.and([
                    eb("jobId", "=", jobId),
                    eb("parentMaterialId", "is not", null)
                  ])
                )
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMaterial")
                .where("jobId", "=", jobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("jobMaterial")
                .set({ jobOperationId: null })
                .where("jobId", "=", jobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("jobOperation")
                .where("jobId", "=", jobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          trx
            .updateTable("jobMakeMethod")
            .set({ version: makeMethod.version ?? 1 })
            .where("id", "=", jobMakeMethod.id)
            .where("companyId", "=", companyId)
            .execute()
        ]);

        // Default storage units are read by ensureItemsPrefetched above, per
        // tree, so a supersession successor's materials get a bin too.

        async function getConfiguredValue<T>({
          id,
          field,
          defaultValue
        }: {
          id: string;
          field: string;
          defaultValue: T;
        }): Promise<T> {
          if (!configurationCodeByField) return defaultValue;
          const fieldKey = getFieldKey(field, id);

          if (configurationCodeByField?.[fieldKey]) {
            try {
              const mod = await importTypeScript(
                configurationCodeByField[fieldKey]
              );
              const result = await mod.configure(hydratedConfiguration);
              return (result ?? defaultValue) as T;
            } catch (err) {
              getMethodLogger.error("configuration field resolver failed", {
                error: String((err as Error)?.stack ?? err)
              });
              return defaultValue;
            }
          }

          return defaultValue;
        }

        // traverse method tree and create:
        // - jobMakeMethod
        // - jobMakeMethodOperation
        // - jobMakeMethodMaterial
        const deferredJobMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
          [];
        const deferredJobMaterialSteps: Database["public"]["Tables"]["jobMaterialStep"]["Insert"][] =
          [];

        async function traverseMethod(
          node: MethodTreeItem,
          parentJobMakeMethodId: string | null,
          parentEstimatedQuantity: number
        ) {
          // The tree handed to us is not necessarily the one prefetched up
          // front: a made-component supersession swap re-enters here on the
          // SUCCESSOR's tree (swapMadeSubAssembly). Covering it at the entry
          // point is what stops the `?? 0` / `?? []` fallbacks below from
          // silently zeroing a whole sub-assembly, for this caller and any
          // future one. `trx`, never `db` — the pool has one connection and
          // the transaction is holding it.
          await ensurePrefetched(trx, node);

          // For root node, targetQuantity equals the job quantity (parentEstimatedQuantity passed in)
          // For children, targetQuantity = parentEstimatedQuantity * quantityPerParent
          const targetQuantity = node.data.isRoot
            ? parentEstimatedQuantity
            : parentEstimatedQuantity * (node.data.quantity ?? 1);

          // Get scrap percentage for this node's item
          const nodeScrapPercentage =
            scrapPercentageByItemId.get(node.data.itemId) ?? 0;

          // Calculate quantities:
          // - For Make parts: estimatedQuantity = targetQuantity (good quantity, NOT including scrap)
          // - For Buy/Pick parts: estimatedQuantity = target + scrap (what we need to procure)
          // - scrapQuantity = targetQuantity * scrapRate (the extra needed for scrap)
          // - totalForChildren = target + scrap (passed to children for cascade)
          const nodeScrapQuantity = scrapAllowance(
            targetQuantity,
            nodeScrapPercentage
          );
          const totalWithScrap = targetQuantity + nodeScrapQuantity;

          // For Make: estimatedQuantity is the good quantity (without scrap)
          // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
          // operationQuantity is the total (including scrap); fractional
          // targets flow through — the scrap allowance is already whole
          const operationQuantity = totalWithScrap;
          // Pass total (including scrap) to children so cascade works correctly
          const totalQuantityForChildren = totalWithScrap;

          const nodeLevelConfigurationKey = `${
            node.data.materialMakeMethodId
          }:${node.data.isRoot ? "undefined" : node.data.methodMaterialId}`;

          let methodOperationsToJobOperations: Record<string, string> = {};
          // method step id -> new job step id, for copying the part ↔ step link (Phase 2)
          const methodStepsToJobSteps: Record<string, string> = {};

          // For child nodes, always include operations regardless of parts flags
          if (!node.data.isRoot || parts.billOfProcess) {
            const relatedOperations = {
              data:
                operationsByMakeMethodId.get(node.data.materialMakeMethodId) ??
                []
            };

            let jobOperationsInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
              [];
            // The method operation each insert came from, kept index-aligned
            // with jobOperationsInserts. The inserted ids come back in the
            // order they were inserted, and that order matches neither the
            // length nor the sequence of relatedOperations.data: a blank
            // configured processId skips a row below, and a billOfProcess
            // configuration reorders and filters them. Pairing the returned
            // ids against the source array instead of this one attaches an
            // operation's tools, parameters and steps to the wrong job
            // operation — or reads past the end of the array and throws.
            let sourceOperations: typeof relatedOperations.data = [];
            for await (const op of relatedOperations?.data ?? []) {
              const [
                processId,
                procedureId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                operationOrder,
                operationType
              ] = await Promise.all([
                getConfiguredValue({
                  id: op.id,
                  field: "processId",
                  defaultValue: op.processId
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "procedureId",
                  defaultValue: op.procedureId
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "workCenterId",
                  defaultValue: op.workCenterId
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "description",
                  defaultValue: op.description
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupTime",
                  defaultValue: op.setupTime
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupUnit",
                  defaultValue: op.setupUnit
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborTime",
                  defaultValue: op.laborTime
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborUnit",
                  defaultValue: op.laborUnit
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineTime",
                  defaultValue: op.machineTime
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineUnit",
                  defaultValue: op.machineUnit
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationOrder",
                  defaultValue: op.operationOrder
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationType",
                  defaultValue: op.operationType
                })
              ]);

              if (processId === "") continue;

              sourceOperations.push(op);
              jobOperationsInserts.push({
                jobId,
                jobMakeMethodId: parentJobMakeMethodId!,
                processId,
                procedureId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                ...getLaborAndOverheadRates(processId, op.workCenterId),
                order: op.order,
                operationOrder,
                operationType: normalizeOperationType(operationType),
                // Carry the Assembly → BOP sync link so the MES can drive the
                // animated instruction player on jobs made from a synced method.
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                operationSupplierProcessId: op.operationSupplierProcessId,
                ...getOutsideOperationRates(
                  processId,
                  op.operationSupplierProcessId
                ),
                workInstruction: toJson(
                  !node.data.isRoot || parts.workInstructions
                    ? op.workInstruction
                    : {}
                ),
                targetQuantity,
                operationQuantity,
                companyId,
                createdBy: userId,
                customFields: {}
              });
            }

            const bopConfigurationKey = `billOfProcess:${nodeLevelConfigurationKey}`;
            let bopConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bopConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bopConfigurationKey]
              );
              bopConfiguration = await mod.configure(hydratedConfiguration);
            }

            if (bopConfiguration) {
              // Reorder and filter both arrays together so an insert and the
              // method operation it came from stay at the same index.
              // findIndex keeps the original `.find` semantics: with duplicate
              // descriptions the first match wins.
              const configuredInserts: typeof jobOperationsInserts = [];
              const configuredSources: typeof sourceOperations = [];
              bopConfiguration.forEach((description, index) => {
                const position = jobOperationsInserts.findIndex(
                  (operation) => operation.description === description
                );
                if (position !== -1) {
                  configuredInserts.push({
                    ...jobOperationsInserts[position]!,
                    order: index + 1
                  });
                  configuredSources.push(sourceOperations[position]!);
                }
              });
              jobOperationsInserts = configuredInserts;
              sourceOperations = configuredSources;
            }

            if (jobOperationsInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("jobOperation")
                .values(jobOperationsInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of sourceOperations.entries()) {
                const operationId = operationIds[index]?.id;

                if (operationId) {
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId
                  } = operation;

                  // Tool ids already inserted by the assembly-instruction
                  // copy — the method tool copy below must skip these or the
                  // job gets the same tool twice (once step-linked, once
                  // unlinked → the MES shows it on every step AND its step).
                  let assemblyToolIds: Set<string> = new Set();

                  if (procedureId) {
                    await insertProcedureDataForJobOperation(trx, {
                      operationId,
                      procedureId,
                      companyId,
                      userId
                    });
                  } else {
                    if (
                      (!node.data.isRoot || parts.parameters) &&
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      const parameters = await Promise.all(
                        methodOperationParameter.map(async (param) => ({
                          operationId,
                          key: param.key,
                          value: await getConfiguredValue({
                            id: operation.id,
                            field: `parameter:${param.id}:value`,
                            defaultValue: param.value
                          }),
                          companyId,
                          createdBy: userId
                        }))
                      );

                      await trx
                        .insertInto("jobOperationParameter")
                        .values(parameters)
                        .execute();
                    }

                    if (operation.assemblyInstructionId) {
                      // Assembly ops inherit their steps from the linked
                      // instruction (the method only carries the pointer);
                      // material ↔ step links are flushed after the
                      // jobMaterial rows exist.
                      assemblyToolIds = await insertAssemblyDataForJobOperation(
                        trx,
                        {
                          operationId,
                          assemblyInstructionId:
                            operation.assemblyInstructionId,
                          companyId,
                          userId
                        }
                      );
                      assemblyOperationsToLink.push({
                        operationId,
                        assemblyInstructionId: operation.assemblyInstructionId
                      });
                    } else if (
                      (!node.data.isRoot || parts.steps) &&
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      const attributes = await Promise.all(
                        methodOperationStep.map(
                          async ({ id: _id, ...attribute }) => ({
                            ...attribute,
                            description: toTiptapDoc(attribute.description),
                            operationId,
                            minValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${_id}:minValue`,
                              defaultValue: attribute.minValue
                            }),
                            maxValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${_id}:maxValue`,
                              defaultValue: attribute.maxValue
                            }),
                            companyId,
                            createdBy: userId
                          })
                        )
                      );

                      const insertedSteps = await trx
                        .insertInto("jobOperationStep")
                        .values(attributes)
                        .returning(["id"])
                        .execute();

                      // Bulk insert preserves order, so insertedSteps[i] ↔
                      // methodOperationStep[i]: record each method step -> new job step so
                      // materials can carry the part ↔ step link onto the job (Phase 2).
                      (methodOperationStep as Array<{ id?: string }>).forEach(
                        (s, i) => {
                          const newStepId = insertedSteps[i]?.id;
                          if (s?.id && newStepId)
                            methodStepsToJobSteps[s.id] = newStepId;
                        }
                      );
                      await copyStepSlides(
                        trx,
                        methodOperationStep,
                        insertedSteps,
                        "methodOperationStepSlide",
                        "jobOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }

                  // Tools after steps (Phase 2): the method-step -> job-step map is now
                  // populated, so a tool scoped to steps carries those links onto the job via
                  // jobOperationToolStep. Mirrors the material part ↔ step copy above. Tools
                  // the assembly-instruction copy already inserted are skipped (see above).
                  const toolsToCopy = (
                    Array.isArray(methodOperationTool)
                      ? methodOperationTool
                      : []
                  ).filter(
                    (tool: { toolId: string }) =>
                      !assemblyToolIds.has(tool.toolId)
                  );
                  if (
                    (!node.data.isRoot || parts.tools) &&
                    toolsToCopy.length > 0
                  ) {
                    const insertedTools = await trx
                      .insertInto("jobOperationTool")
                      .values(
                        toolsToCopy.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    // Tool ↔ step links (Phase 2, many-to-many). Bulk insert preserves order,
                    // so insertedTools[i] ↔ toolsToCopy[i]. A tool with no links applies
                    // to the whole operation (shown on every step in the MES).
                    const toolStepRows = toolsToCopy.flatMap((tool, i) => {
                      const jobOperationToolId = insertedTools[i]?.id;
                      if (!jobOperationToolId) return [];
                      const oldStepIds = (
                        (tool.methodOperationToolStep ?? []) as Array<{
                          methodOperationStepId: string | null;
                        }>
                      ).map((l) => l.methodOperationStepId);
                      return remapStepIds(
                        oldStepIds,
                        methodStepsToJobSteps
                      ).map((jobOperationStepId) => ({
                        jobOperationToolId,
                        jobOperationStepId
                      }));
                    });
                    if (toolStepRows.length > 0) {
                      await trx
                        .insertInto("jobOperationToolStep")
                        .values(toolStepRows)
                        .execute();
                    }
                  }
                }
              }

              methodOperationsToJobOperations = sourceOperations.reduce<
                Record<string, string>
              >((acc, op, index) => {
                const operationId = operationIds[index]?.id;
                if (operationId) {
                  acc[op.id!] = operationId;
                }
                return acc;
              }, {});
            }
          } // end if (parts.billOfProcess)

          if (parts.billOfMaterial) {
            const locationId = job.locationId;

            const mapMethodMaterialToJobMaterial = async (
              child: MethodTreeItem
            ) => {
              let [
                itemId,
                description,
                quantity,
                methodType,
                unitOfMeasureCode
              ] = await Promise.all([
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "itemId",
                  defaultValue: child.data.itemId
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "description",
                  defaultValue: child.data.description
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "quantity",
                  defaultValue: child.data.quantity
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "methodType",
                  defaultValue: child.data.methodType
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "unitOfMeasureCode",
                  defaultValue: child.data.unitOfMeasureCode
                })
              ]);

              if (itemId === "") return null;
              // A configured (or authored) quantity of 0 removes the line from
              // the BOM. Made sub-assemblies drop out of `configuredChildren`
              // below with the row, so their sub-tree is never exploded either.
              if (isZeroQuantity(quantity)) return null;

              let itemType = child.data.itemType;
              let unitCost = child.data.unitCost;
              let requiresSerialTracking =
                child.data.itemTrackingType === "Serial";
              let requiresBatchTracking =
                child.data.itemTrackingType === "Batch";

              // Supersession swap (Buy/Pick lines only). A Make-to-Order line
              // would need its successor's own sub-method re-exploded (a later
              // layer), so we leave those on the old part. The re-derive block
              // just below refreshes the successor's item fields automatically.
              let substitutedFromItemId: string | null = null;
              let substitutionFactor: number | null = null;
              // Captured before the swap so the revert below can undo it whole.
              const quantityBeforeSupersession = quantity;
              const methodTypeBeforeSupersession = methodType;
              // Post-configuration, pre-supersession. A configuration rule may
              // already have moved this line off the BOM's item, and that choice
              // has to survive a failed successor lookup — see the fallback chain
              // below.
              const configuredItemId = itemId;
              if (methodType !== "Make to Order") {
                const redirect = supersessionRedirect.get(itemId);
                if (redirect) {
                  substitutedFromItemId = itemId;
                  substitutionFactor = redirect.factor;
                  itemId = redirect.to;
                  quantity = quantity * redirect.factor;
                }
              } else {
                const pulledFrom = resolveMadeLinePull(
                  itemId,
                  quantity,
                  supersessionContext
                );
                if (pulledFrom) {
                  methodType = "Pull from Inventory";
                  if (pulledFrom.itemId !== itemId) {
                    substitutedFromItemId = itemId;
                    substitutionFactor = pulledFrom.factor;
                    itemId = pulledFrom.itemId;
                    quantity = quantity * pulledFrom.factor;
                  }
                }
              }

              // Fall back in order of preference: the successor, then whatever a
              // configuration rule chose, then the BOM's own item. Reverting
              // straight to `child.data.itemId` discarded the configuration
              // rule's decision, which the supersession never overrode — it only
              // redirected the item that rule had already picked.
              //
              // Each candidate is READ before it is accepted, so `itemId` and the
              // fields derived from it can never disagree. `child.data.itemId`
              // needs no read: its fields are the defaults already in scope.
              // What this row WOULD be for if every lookup succeeds.
              const intendedItemId = itemId;
              for (const candidate of [
                ...new Set([itemId, configuredItemId, child.data.itemId])
              ]) {
                itemId = candidate;
                if (candidate === child.data.itemId) break;
                const item = await readItemWithCost(trx, candidate, companyId);
                if (item) {
                  itemType = item.type;
                  unitCost = item.itemCost[0]?.unitCost ?? child.data.unitCost;
                  if (description === child.data.description) {
                    description = item.name;
                  }
                  requiresSerialTracking = item.itemTrackingType === "Serial";
                  requiresBatchTracking = item.itemTrackingType === "Batch";
                  break;
                }
              }

              if (itemId !== intendedItemId) {
                // The swap could not be completed, so undo it WHOLLY. Reverting
                // only `itemId` left the row on a different item while KEEPING
                // the successor's factor-scaled quantity and a
                // `substitutedFromItemId` that no longer described it — a
                // plausible-looking but wrong quantity nothing downstream can
                // detect or repair.
                quantity = quantityBeforeSupersession;
                methodType = methodTypeBeforeSupersession;
                substitutedFromItemId = null;
                substitutionFactor = null;
              }

              // `itemId` here is post-configuration and post-supersession, so
              // it can be an item no tree node named — a configuration rule may
              // return any item id. Cover it before reading, or its scrap
              // percentage silently resolves to 0 and sticks.
              await ensureItemsPrefetched(trx, [itemId]);

              // Get scrap percentage for this item
              const itemScrapPercentage =
                scrapPercentageByItemId.get(itemId) ?? 0;

              // Calculate scrap quantities for this material
              // targetQuantity for this child = parent's total (including scrap) * quantity per parent
              const childTargetQuantity = totalQuantityForChildren * quantity;
              // scrapQuantity = portion attributable to scrap
              const childScrapQuantity = scrapAllowance(
                childTargetQuantity,
                itemScrapPercentage
              );
              const childTotalWithScrap =
                childTargetQuantity + childScrapQuantity;
              // For Make: estimatedQuantity is the good quantity (without scrap)
              // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
              const childEstimatedQuantity =
                methodType === "Make to Order"
                  ? childTargetQuantity
                  : childTotalWithScrap;

              return {
                jobId,
                jobMakeMethodId: parentJobMakeMethodId!,
                jobOperationId:
                  methodOperationsToJobOperations[child.data.operationId],
                // Transient (Phase 2, many-to-many): the part ↔ step links (with their
                // per-step quantity), remapped onto the job's steps. Stripped before
                // insert; used to build jobMaterialStep rows.
                __stepLinks: remapStepLinks(
                  (
                    child.data as {
                      methodOperationStepIds?: Array<
                        | string
                        | { id?: string | null; quantity?: number | null }
                      > | null;
                    }
                  ).methodOperationStepIds,
                  methodStepsToJobSteps
                ),
                itemId,
                itemType,
                kit: methodType === "Make to Order" && child.data.kit,
                methodType,
                order: child.data.order,
                description,
                quantity,
                scrapQuantity: childScrapQuantity,
                estimatedQuantity: childEstimatedQuantity,
                storageUnitId: locationId
                  ? // The bin explicitly set on the BOM line stays keyed on the
                    // line, but the default bin belongs to the item this row is
                    // actually for — `itemId`, after any supersession or
                    // configuration swap. Keyed on child.data.itemId a swapped
                    // line took the predecessor's bin, or none when only the
                    // successor had one.
                    // @ts-ignore
                    (child.data.storageUnitIds?.[locationId] as string) ||
                    defaultStorageUnitByItemId.get(itemId)
                  : undefined,
                requiresSerialTracking,
                requiresBatchTracking,
                unitOfMeasureCode,
                unitCost: unitCost ?? 0,
                itemScrapPercentage,
                substitutedFromItemId,
                substitutionFactor,
                companyId,
                createdBy: userId,
                customFields: {}
              };
            };

            const jobMaterialResults = await Promise.all(
              node.children.map(mapMethodMaterialToJobMaterial)
            );
            const validJobMaterialIndices = jobMaterialResults.reduce<number[]>(
              (acc, m, i) => {
                if (m !== null) acc.push(i);
                return acc;
              },
              []
            );
            let materialsWithConfiguredFields = jobMaterialResults.filter(
              (m): m is NonNullable<typeof m> => m !== null
            );
            let configuredChildren = validJobMaterialIndices.map(
              (i) => node.children[i]!
            );

            const bomConfigurationKey = `billOfMaterial:${nodeLevelConfigurationKey}`;
            let bomConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bomConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bomConfigurationKey]
              );
              bomConfiguration = await mod.configure(hydratedConfiguration);
            }

            if (bomConfiguration) {
              const pairByReadableId = new Map<
                string,
                {
                  material: (typeof materialsWithConfiguredFields)[number];
                  child: MethodTreeItem;
                }
              >();
              configuredChildren.forEach((child, i) => {
                const material = materialsWithConfiguredFields[i];
                if (!material) return;
                const data = child!.data as {
                  itemReadableId?: string | null;
                  readableIdWithRevision?: string | null;
                };
                for (const key of [
                  data.readableIdWithRevision,
                  data.itemReadableId
                ]) {
                  if (key && !pairByReadableId.has(key)) {
                    pairByReadableId.set(key, { material, child });
                  }
                }
              });
              const pairs = bomConfiguration.flatMap((readableId, index) => {
                const pair = pairByReadableId.get(readableId);
                return pair
                  ? [
                      {
                        material: { ...pair.material, order: index + 1 },
                        child: pair.child
                      }
                    ]
                  : [];
              });
              materialsWithConfiguredFields = pairs.map(
                (pair) => pair.material
              );
              configuredChildren = pairs.map((pair) => pair.child);
            }

            const madeMaterials = materialsWithConfiguredFields.filter(
              (material) => material.methodType === "Make to Order"
            );

            const pickedOrBoughtMaterials =
              materialsWithConfiguredFields.filter(
                (material) => material.methodType !== "Make to Order"
              );

            const madeChildren = configuredChildren.filter(
              (_, i) =>
                materialsWithConfiguredFields[i]?.methodType === "Make to Order"
            );

            if (madeMaterials.length > 0) {
              const madeMaterialsWithIds = madeMaterials.map((m) => ({
                ...m,
                id: nanoid()
              }));
              insertedJobMaterialIds.push(
                ...madeMaterialsWithIds.map((m) => m.id)
              );

              await trx
                .insertInto("jobMaterial")
                .values(
                  madeMaterialsWithIds.map((m) => {
                    const { __stepLinks, ...rest } = m as typeof m & {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    };
                    return rest;
                  })
                )
                .execute();

              // Part ↔ step links (Phase 2, many-to-many): the transient __stepLinks carried
              // the remapped job step ids + per-step quantity; write them to jobMaterialStep
              // now that the material id exists. No links = whole operation (shown on every
              // step in the MES).
              const madeStepRows = madeMaterialsWithIds.flatMap((m) =>
                (
                  (
                    m as {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    }
                  ).__stepLinks ?? []
                ).map((link) => ({
                  jobMaterialId: m.id,
                  jobOperationStepId: link.stepId,
                  quantity: link.quantity
                }))
              );
              if (madeStepRows.length > 0) {
                await trx
                  .insertInto("jobMaterialStep")
                  .values(madeStepRows)
                  .execute();
              }

              const newMakeMethodIds = madeChildren.map(() => nanoid());
              await renameMakeMethods(trx, {
                table: "jobMakeMethod",
                companyId,
                rows: madeChildren.map((_, index) => ({
                  parentMaterialId: madeMaterialsWithIds[index]!.id,
                  id: newMakeMethodIds[index]!
                }))
              });

              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialsWithIds[index]!.id;
                const newMakeMethodId = newMakeMethodIds[index]!;

                // Get the total quantity (estimated + scrap) for this child material
                // This is what we pass to children for the cascade
                const material = madeMaterials[index];
                const childTotalForCascade =
                  (material?.estimatedQuantity ?? 0) +
                  (material?.scrapQuantity ?? 0);

                // Made sub-assembly supersession: if this made component has an
                // effective successor that is ITSELF a made item, point the job
                // material at the successor and explode the SUCCESSOR's method
                // (not the old part's). A Make -> Buy successor is a structural
                // flip we leave on the old part (handled/flagged elsewhere).
                // A configuration rule may have moved this line onto another
                // made item; the sub-assembly under it is then that item's.
                const made = await configuredMadeChild(
                  trx,
                  companyId,
                  child,
                  material?.itemId
                );
                if (!made) continue;

                const madeSwapHandled = await swapMadeSubAssembly({
                  trx,
                  companyId,
                  child: made,
                  material,
                  materialId,
                  locationId: job.locationId ?? "",
                  supersessionRedirect,
                  newMakeMethodId,
                  traverseMethod
                });

                // prevent an infinite loop
                if (!madeSwapHandled && made.data.itemId !== itemId) {
                  await traverseMethod(
                    made,
                    newMakeMethodId,
                    childTotalForCascade || 1
                  );
                }
              }
            }

            if (pickedOrBoughtMaterials.length > 0) {
              // Assign ids up front so part ↔ step links (Phase 2, many-to-many) can reference
              // each row; strip the transient __stepLinks before inserting the material.
              const pickedWithIds = pickedOrBoughtMaterials.map((m) => ({
                ...m,
                id: (m as { id?: string }).id ?? nanoid()
              }));
              insertedJobMaterialIds.push(...pickedWithIds.map((m) => m.id));
              // Inserted once, after the walk: nothing below reads these rows,
              // and their insert triggers only validate.
              deferredJobMaterials.push(
                ...pickedWithIds.map((m) => {
                  const { __stepLinks, ...rest } = m as typeof m & {
                    __stepLinks?: {
                      stepId: string;
                      quantity: number | null;
                    }[];
                  };
                  return rest;
                })
              );

              const pickedStepRows = pickedWithIds.flatMap((m) =>
                (
                  (
                    m as {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    }
                  ).__stepLinks ?? []
                ).map((link) => ({
                  jobMaterialId: m.id,
                  jobOperationStepId: link.stepId,
                  quantity: link.quantity
                }))
              );
              deferredJobMaterialSteps.push(...pickedStepRows);
            }
          } // end if (parts.billOfMaterial)
        }

        // Start traversal with job quantity as the root's target/parent estimated quantity
        await traverseMethod(methodTree, jobMakeMethod.id, job.quantity ?? 1);
        await insertDeferredJobMaterials(
          trx,
          deferredJobMaterials,
          deferredJobMaterialSteps
        );

        await linkAssemblyStepMaterialsForJobOperations(
          trx,
          assemblyOperationsToLink,
          companyId
        );

        await settleConsumeFirstLines({
          trx,
          companyId,
          jobId: jobId,
          jobMaterialIds: insertedJobMaterialIds,
          locationId: job.locationId,
          asOfDate: jobBuildDate(job)
        });
      });

      break;
    }
    case "itemToJobMakeMethod": {
      const jobMakeMethodId = targetId;

      if (!jobMakeMethodId) {
        throw new Error("Invalid targetId");
      }
      const itemId = sourceId;
      const isConfigured = !!configuration;
      // Assembly ops whose steps were materialized from an instruction —
      // material ↔ step links flush after the traversal inserts the
      // jobMaterial rows.
      const assemblyOperationsToLink: Array<{
        operationId: string;
        assemblyInstructionId: string;
      }> = [];

      // A chosen version overrides the default active-method lookup; it is
      // re-read under itemId + companyId so a foreign or mismatched
      // makeMethod id can never be exploded.
      const makeMethod = versionId
        ? await single(db, "makeMethod", { id: versionId, itemId, companyId })
        : await single(db, "activeMakeMethods", { itemId, companyId });
      const jobMakeMethod = await single(db, "jobMakeMethod", {
        id: jobMakeMethodId,
        companyId
      });
      const workCenters = await many(db, "workCenters", { companyId });
      const supplierProcesses = await many(db, "supplierProcess", {
        companyId
      });

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (jobMakeMethod.error || !jobMakeMethod.data) {
        throw new Error("Failed to get job make method");
      }

      // FIXME: hydrated here but never applied — this make-method path does
      // not run configuration rules (itemToJob does). Applying them is a
      // behavior change for its own PR.
      // biome-ignore lint/correctness/noUnusedVariables: see FIXME above
      const hydratedConfiguration = await hydrateConfiguration(
        db,
        configuration,
        itemId,
        companyId
      );

      // Get parent estimated quantity context
      let parentEstimatedQuantity = 1;
      if (jobMakeMethod.data.parentMaterialId) {
        // This is a sub-item - get the parent material's estimated quantity
        const parentMaterial = await single(db, "jobMaterial", {
          id: jobMakeMethod.data.parentMaterialId,
          companyId
        });
        parentEstimatedQuantity = parentMaterial.data?.estimatedQuantity ?? 1;
      } else {
        // This is the root - get job's quantity
        const rootJob = await single(db, "job", {
          id: jobMakeMethod.data.jobId,
          companyId
        });
        parentEstimatedQuantity = rootJob.data?.quantity ?? 1;
      }

      const job = await single(db, "job", {
        id: jobMakeMethod.data.jobId,
        companyId
      });
      const methodTrees = await getMethodTree(db, makeMethod.data.id!);
      const configurationRules = isConfigured
        ? await many(db, "configurationRule", { itemId, companyId })
        : { data: [] as Tables["configurationRule"]["Row"][] };

      if (methodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const methodTree = methodTrees.data?.[0] as MethodTreeItem;
      if (!methodTree) throw new NotFoundError("Method tree not found");

      // Loaded ONCE per request, before the transaction — as itemToJob does.
      // This read pages the company's whole itemSupersession table, and it used
      // to sit inside traverseMethod, so a BOM of N nodes issued N full-table
      // reads sequentially inside the transaction holding the pool's single
      // connection. The map depends only on the company and the job's build
      // date, both fixed for the request, so per-node reload bought nothing.
      const supersessionContext = await loadSupersessionRedirect(
        db,
        companyId,
        job.data
      );
      const supersessionRedirect = supersessionContext.redirect;
      const itemDefaults = createItemDefaults(companyId, job.data?.locationId);

      const getLaborAndOverheadRates = getRatesFromWorkCenters(
        workCenters?.data
      );
      const getOutsideOperationRates = getRatesFromSupplierProcesses(
        supplierProcesses?.data
      );

      // Get configuration code by field
      // biome-ignore lint/correctness/noUnusedVariables: unapplied configuration, see FIXME above
      const configurationCodeByField = configurationRules.data?.reduce<
        Record<string, string>
      >((acc, rule) => {
        acc[rule.field] = rule.code;
        return acc;
      }, {});

      await withTransaction(db, async (trx) => {
        await itemDefaults.load(
          trx,
          treeItemIds(methodTree, supersessionRedirect)
        );
        const insertedJobMaterialIds: string[] = [];
        // Delete existing jobMakeMethodOperation, jobMakeMethodMaterial
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMaterial")
                .where("jobMakeMethodId", "=", jobMakeMethodId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("jobMaterial")
                .set({ jobOperationId: null })
                .where("jobMakeMethodId", "=", jobMakeMethodId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("jobOperation")
                .where("jobMakeMethodId", "=", jobMakeMethodId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          trx
            .updateTable("jobMakeMethod")
            .set({ version: makeMethod.data.version ?? 1 })
            .where("id", "=", jobMakeMethodId)
            .where("companyId", "=", companyId)
            .execute()
        ]);

        // traverse method tree and create:
        // - jobMakeMethod
        // - jobMakeMethodOperation
        // - jobMakeMethodMaterial
        const deferredJobMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
          [];
        const deferredJobMaterialSteps: Database["public"]["Tables"]["jobMaterialStep"]["Insert"][] =
          [];

        async function traverseMethod(
          node: MethodTreeItem,
          parentJobMakeMethodId: string | null,
          nodeParentEstimatedQuantity: number
        ) {
          // Calculate target and estimated quantities for this node
          const targetQuantity = node.data.isRoot
            ? nodeParentEstimatedQuantity
            : nodeParentEstimatedQuantity * (node.data.quantity ?? 1);

          // Get scrap percentage for this node's item
          const nodeScrapPercentage = await itemDefaults.scrapPercentage(
            trx,
            node.data.itemId
          );

          // Calculate quantities:
          // - For Make parts: estimatedQuantity = targetQuantity (good quantity, NOT including scrap)
          // - For Buy/Pick parts: estimatedQuantity = target + scrap (what we need to procure)
          const nodeScrapQuantity = scrapAllowance(
            targetQuantity,
            nodeScrapPercentage
          );
          const totalWithScrap = targetQuantity + nodeScrapQuantity;
          // operationQuantity is the total (including scrap); fractional
          // targets flow through — the scrap allowance is already whole
          const operationQuantity = totalWithScrap;
          const totalQuantityForChildren = totalWithScrap;

          const relatedOperations = {
            data: await readMethodOperations(
              trx,
              [node.data.materialMakeMethodId],
              companyId
            )
          };

          const jobOperationsInserts =
            relatedOperations?.data?.map((op) => ({
              jobId: jobMakeMethod.data?.jobId!,
              jobMakeMethodId: parentJobMakeMethodId!,
              processId: op.processId,
              procedureId: op.procedureId,
              workCenterId: op.workCenterId,
              description: op.description,
              setupTime: op.setupTime,
              setupUnit: op.setupUnit,
              laborTime: op.laborTime,
              laborUnit: op.laborUnit,
              machineTime: op.machineTime,
              machineUnit: op.machineUnit,
              ...getLaborAndOverheadRates(op.processId, op.workCenterId),
              order: op.order,
              operationOrder: op.operationOrder,
              operationType: op.operationType,
              // Carry the Assembly → BOP sync link so the MES can drive the
              // animated instruction player on jobs made from a synced method.
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              operationUnitCost: op.operationUnitCost ?? 0,
              operationSupplierProcessId: op.operationSupplierProcessId,
              ...getOutsideOperationRates(
                op.processId,
                op.operationSupplierProcessId
              ),
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              targetQuantity,
              operationQuantity,
              companyId,
              createdBy: userId,
              customFields: {}
            })) ?? [];

          let methodOperationsToJobOperations: Record<string, string> = {};
          // method step id -> new job step id, for copying the part ↔ step link (Phase 2)
          const methodStepsToJobSteps: Record<string, string> = {};

          if (parts.billOfProcess) {
            if (jobOperationsInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("jobOperation")
                .values(jobOperationsInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                relatedOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;

                if (operationId) {
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId
                  } = operation;

                  // Tool ids already inserted by the assembly-instruction
                  // copy — the method tool copy below must skip these or the
                  // job gets the same tool twice (once step-linked, once
                  // unlinked → the MES shows it on every step AND its step).
                  let assemblyToolIds: Set<string> = new Set();

                  if (procedureId) {
                    await insertProcedureDataForJobOperation(trx, {
                      operationId,
                      procedureId,
                      companyId,
                      userId
                    });
                  } else {
                    if (
                      parts.parameters &&
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("jobOperationParameter")
                        .values(
                          methodOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (operation.assemblyInstructionId) {
                      // Assembly ops inherit their steps from the linked
                      // instruction (the method only carries the pointer);
                      // material ↔ step links are flushed after the
                      // jobMaterial rows exist.
                      assemblyToolIds = await insertAssemblyDataForJobOperation(
                        trx,
                        {
                          operationId,
                          assemblyInstructionId:
                            operation.assemblyInstructionId,
                          companyId,
                          userId
                        }
                      );
                      assemblyOperationsToLink.push({
                        operationId,
                        assemblyInstructionId: operation.assemblyInstructionId
                      });
                    } else if (
                      parts.steps &&
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("jobOperationStep")
                        .values(
                          methodOperationStep.map(
                            ({ id: _id, ...attribute }) => ({
                              ...attribute,
                              description: toTiptapDoc(attribute.description),
                              operationId,
                              companyId,
                              createdBy: userId
                            })
                          )
                        )
                        .returning(["id"])
                        .execute();

                      // Bulk insert preserves order, so insertedSteps[i] ↔
                      // methodOperationStep[i]: record each method step -> new job step so
                      // materials can carry the part ↔ step link onto the job (Phase 2).
                      (methodOperationStep as Array<{ id?: string }>).forEach(
                        (s, i) => {
                          const newStepId = insertedSteps[i]?.id;
                          if (s?.id && newStepId)
                            methodStepsToJobSteps[s.id] = newStepId;
                        }
                      );
                      await copyStepSlides(
                        trx,
                        methodOperationStep,
                        insertedSteps,
                        "methodOperationStepSlide",
                        "jobOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }

                  // Tools after steps (Phase 2): the method-step -> job-step map is now
                  // populated, so a tool scoped to steps carries those links onto the job via
                  // jobOperationToolStep. Mirrors the material part ↔ step copy above. Tools
                  // the assembly-instruction copy already inserted are skipped (see above).
                  const toolsToCopy = (
                    Array.isArray(methodOperationTool)
                      ? methodOperationTool
                      : []
                  ).filter(
                    (tool: { toolId: string }) =>
                      !assemblyToolIds.has(tool.toolId)
                  );
                  if (parts.tools && toolsToCopy.length > 0) {
                    const insertedTools = await trx
                      .insertInto("jobOperationTool")
                      .values(
                        toolsToCopy.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    // Tool ↔ step links (Phase 2, many-to-many). Bulk insert preserves order,
                    // so insertedTools[i] ↔ toolsToCopy[i]. A tool with no links applies
                    // to the whole operation (shown on every step in the MES).
                    const toolStepRows = toolsToCopy.flatMap((tool, i) => {
                      const jobOperationToolId = insertedTools[i]?.id;
                      if (!jobOperationToolId) return [];
                      const oldStepIds = (
                        (tool.methodOperationToolStep ?? []) as Array<{
                          methodOperationStepId: string | null;
                        }>
                      ).map((l) => l.methodOperationStepId);
                      return remapStepIds(
                        oldStepIds,
                        methodStepsToJobSteps
                      ).map((jobOperationStepId) => ({
                        jobOperationToolId,
                        jobOperationStepId
                      }));
                    });
                    if (toolStepRows.length > 0) {
                      await trx
                        .insertInto("jobOperationToolStep")
                        .values(toolStepRows)
                        .execute();
                    }
                  }
                }
              }

              methodOperationsToJobOperations =
                relatedOperations.data?.reduce<Record<string, string>>(
                  (acc, op, index) => {
                    if (operationIds[index]!.id) {
                      acc[op.id!] = operationIds[index]!.id!;
                    }
                    return acc;
                  },
                  {}
                ) ?? {};
            }
          } // end if (parts.billOfProcess)

          if (parts.billOfMaterial) {
            const mapMethodMaterialToJobMaterial = async (
              child: MethodTreeItem
            ) => {
              // Resolve the supersession FIRST, so every field below derives
              // from the item this row ENDS UP being for. This used to run as a
              // second pass over the finished rows, which meant each new derived
              // field silently inherited the predecessor's value unless someone
              // remembered to add it to that pass's patch list — the scrap rate
              // was read here from the OLD item and never revisited, so a swapped
              // line costed the predecessor's scrap forever (the column is NOT
              // NULL, and recalculate only re-derives from NULL). Swapping up
              // front is what itemToJob already does, and it makes the whole
              // class of bug unreachable rather than fixing one instance of it.
              // Buy/Pick only — resolveJobMaterialSupersession returns null for
              // Make to Order, which swapMadeSubAssembly handles during its own
              // explosion.
              const pulledFrom =
                child.data.methodType === "Make to Order"
                  ? resolveMadeLinePull(
                      child.data.itemId,
                      child.data.quantity ?? 1,
                      supersessionContext
                    )
                  : null;
              const methodType = pulledFrom
                ? "Pull from Inventory"
                : child.data.methodType;
              const supersession =
                pulledFrom && pulledFrom.itemId === child.data.itemId
                  ? null
                  : await resolveJobMaterialSupersession(
                      trx,
                      companyId,
                      pulledFrom
                        ? new Map([
                            [
                              child.data.itemId,
                              {
                                to: pulledFrom.itemId,
                                factor: pulledFrom.factor
                              }
                            ]
                          ])
                        : supersessionRedirect,
                      { itemId: child.data.itemId, methodType }
                    );
              const itemId = supersession?.itemId ?? child.data.itemId;
              // 1 old part = `factor` successors. The line's methodType and unit
              // of measure are deliberately preserved; the factor translates the
              // quantity.
              const quantityPerParent =
                (child.data.quantity ?? 1) * (supersession?.factor ?? 1);

              // Get scrap percentage for this item
              const itemScrapPercentage = await itemDefaults.scrapPercentage(
                trx,
                itemId
              );

              // Calculate scrap quantities for this material
              // Use totalQuantityForChildren (parent's total including scrap) for child calculations
              const childTargetQuantity =
                totalQuantityForChildren * quantityPerParent;
              const childScrapQuantity = scrapAllowance(
                childTargetQuantity,
                itemScrapPercentage
              );
              const childTotalWithScrap =
                childTargetQuantity + childScrapQuantity;
              // For Make: estimatedQuantity is the good quantity (without scrap)
              // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
              const childEstimatedQuantity =
                methodType === "Make to Order"
                  ? childTargetQuantity
                  : childTotalWithScrap;

              return {
                jobId: jobMakeMethod.data?.jobId!,
                jobMakeMethodId: parentJobMakeMethodId!,
                jobOperationId:
                  methodOperationsToJobOperations[child.data.operationId],
                // Transient (Phase 2, many-to-many): the part ↔ step links (with their
                // per-step quantity), remapped onto the job's steps. Stripped before
                // insert; used to build jobMaterialStep rows.
                __stepLinks: remapStepLinks(
                  (
                    child.data as {
                      methodOperationStepIds?: Array<
                        | string
                        | { id?: string | null; quantity?: number | null }
                      > | null;
                    }
                  ).methodOperationStepIds,
                  methodStepsToJobSteps
                ),
                itemId,
                kit: methodType === "Make to Order" && child.data.kit,
                itemType: supersession?.itemType ?? child.data.itemType,
                methodType,
                order: child.data.order,
                description:
                  supersession?.description ?? child.data.description,
                quantity: quantityPerParent,
                scrapQuantity: childScrapQuantity,
                estimatedQuantity: childEstimatedQuantity,
                requiresBatchTracking:
                  supersession?.requiresBatchTracking ??
                  child.data.itemTrackingType === "Batch",
                requiresSerialTracking:
                  supersession?.requiresSerialTracking ??
                  child.data.itemTrackingType === "Serial",
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                // Branch on WHETHER a swap happened, not just on the successor
                // having a cost. `supersession?.unitCost ?? child.data.unitCost`
                // valued a successor row at the RETIRED part's cost whenever the
                // successor had no itemCost row — a plausible number for the
                // wrong item. 0 is at least visibly missing.
                unitCost: supersession
                  ? (supersession.unitCost ?? 0)
                  : (child.data.unitCost ?? 0),
                itemScrapPercentage,
                substitutedFromItemId:
                  supersession?.substitutedFromItemId ?? null,
                substitutionFactor: supersession?.factor ?? null,
                // The bin belongs to the item this row is actually for — the
                // post-swap `itemId`. An explicit bin on the BOM line still wins.
                storageUnitId: await itemDefaults.storageUnitId(
                  trx,
                  itemId,
                  // @ts-ignore: storageUnitIds is a dynamic field
                  child.data.storageUnitIds?.[job.data.locationId] ?? undefined
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              };
            };

            const madeMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
              [];
            const madeChildren: MethodTreeItem[] = [];
            const pickedOrBoughtMaterials: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
              [];

            for await (const child of node.children) {
              if (isZeroQuantity(child.data.quantity)) continue;
              const material = await mapMethodMaterialToJobMaterial(child);
              if (material.methodType === "Make to Order") {
                madeMaterials.push(material);
                madeChildren.push(child);
              } else {
                pickedOrBoughtMaterials.push(material);
              }
            }

            // The supersession swap happens inside mapMethodMaterialToJobMaterial,
            // before any field derives from the item — there is deliberately no
            // second pass here. Made materials are left for their own
            // sub-explosion (swapMadeSubAssembly).

            if (madeMaterials.length > 0) {
              const madeMaterialsWithIds = madeMaterials.map((m) => ({
                ...m,
                id: nanoid()
              }));
              insertedJobMaterialIds.push(
                ...madeMaterialsWithIds.map((m) => m.id)
              );

              await trx
                .insertInto("jobMaterial")
                .values(
                  madeMaterialsWithIds.map((m) => {
                    const { __stepLinks, ...rest } = m as typeof m & {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    };
                    return rest;
                  })
                )
                .execute();

              // Part ↔ step links (Phase 2, many-to-many): the transient __stepLinks carried
              // the remapped job step ids + per-step quantity; write them to jobMaterialStep
              // now that the material id exists. No links = whole operation (shown on every
              // step in the MES).
              const madeStepRows = madeMaterialsWithIds.flatMap((m) =>
                (
                  (
                    m as {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    }
                  ).__stepLinks ?? []
                ).map((link) => ({
                  jobMaterialId: m.id,
                  jobOperationStepId: link.stepId,
                  quantity: link.quantity
                }))
              );
              if (madeStepRows.length > 0) {
                await trx
                  .insertInto("jobMaterialStep")
                  .values(madeStepRows)
                  .execute();
              }

              const newMakeMethodIds = madeChildren.map(() => nanoid());
              await renameMakeMethods(trx, {
                table: "jobMakeMethod",
                companyId,
                rows: madeChildren.map((_, index) => ({
                  parentMaterialId: madeMaterialsWithIds[index]!.id,
                  id: newMakeMethodIds[index]!
                }))
              });

              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialsWithIds[index]!.id;
                const newMakeMethodId = newMakeMethodIds[index]!;

                // Get the total quantity (estimated + scrap) for this child material
                // This is what we pass to children for the cascade
                const material = madeMaterials[index];
                const childTotalForCascade =
                  (material?.estimatedQuantity ?? 0) +
                  (material?.scrapQuantity ?? 0);

                // Made sub-assembly supersession (see itemToJob for rationale):
                // if a made component has an effective successor that is itself
                // made, point the job material at the successor and explode the
                // SUCCESSOR's method instead of the old part's.
                // A configuration rule may have moved this line onto another
                // made item; the sub-assembly under it is then that item's.
                const made = await configuredMadeChild(
                  trx,
                  companyId,
                  child,
                  material?.itemId
                );
                if (!made) continue;

                const madeSwapHandled = await swapMadeSubAssembly({
                  trx,
                  companyId,
                  child: made,
                  material,
                  materialId,
                  locationId: job.data?.locationId ?? "",
                  supersessionRedirect,
                  newMakeMethodId,
                  traverseMethod
                });

                // prevent an infinite loop
                if (!madeSwapHandled && made.data.itemId !== itemId) {
                  await traverseMethod(
                    made,
                    newMakeMethodId,
                    childTotalForCascade || 1
                  );
                }
              }
            }

            if (pickedOrBoughtMaterials.length > 0) {
              // Assign ids up front so part ↔ step links (Phase 2, many-to-many) can reference
              // each row; strip the transient __stepLinks before inserting the material.
              const pickedWithIds = pickedOrBoughtMaterials.map((m) => ({
                ...m,
                id: (m as { id?: string }).id ?? nanoid()
              }));
              insertedJobMaterialIds.push(...pickedWithIds.map((m) => m.id));
              // Inserted once, after the walk: nothing below reads these rows,
              // and their insert triggers only validate.
              deferredJobMaterials.push(
                ...pickedWithIds.map((m) => {
                  const { __stepLinks, ...rest } = m as typeof m & {
                    __stepLinks?: {
                      stepId: string;
                      quantity: number | null;
                    }[];
                  };
                  return rest;
                })
              );

              const pickedStepRows = pickedWithIds.flatMap((m) =>
                (
                  (
                    m as {
                      __stepLinks?: {
                        stepId: string;
                        quantity: number | null;
                      }[];
                    }
                  ).__stepLinks ?? []
                ).map((link) => ({
                  jobMaterialId: m.id,
                  jobOperationStepId: link.stepId,
                  quantity: link.quantity
                }))
              );
              deferredJobMaterialSteps.push(...pickedStepRows);
            }
          } // end if (parts.billOfMaterial)
        }

        // Start traversal with the parent's estimated quantity
        await traverseMethod(
          methodTree,
          jobMakeMethod.data.id,
          parentEstimatedQuantity
        );
        await insertDeferredJobMaterials(
          trx,
          deferredJobMaterials,
          deferredJobMaterialSteps
        );

        await linkAssemblyStepMaterialsForJobOperations(
          trx,
          assemblyOperationsToLink,
          companyId
        );

        await settleConsumeFirstLines({
          trx,
          companyId,
          jobId: jobMakeMethod.data.jobId,
          jobMaterialIds: insertedJobMaterialIds,
          locationId: job.data?.locationId,
          asOfDate: jobBuildDate(job.data)
        });
      });
      break;
    }
    case "itemToQuoteLine": {
      const [quoteId = "", quoteLineId = ""] = (targetId as string).split(":");
      if (!quoteId || !quoteLineId) {
        throw new Error("Invalid targetId");
      }
      const itemId = sourceId;
      const isConfigured = !!configuration;

      const [
        makeMethod,
        quoteMakeMethod,
        workCenters,
        supplierProcesses,
        configurationRules,
        quote,
        ownedQuoteLine
      ] = await inOrder([
        () => single(db, "activeMakeMethods", { itemId, companyId }),
        () =>
          maybeSingle(db, "quoteMakeMethod", {
            quoteLineId,
            parentMaterialId: isNull,
            companyId
          }),
        () => many(db, "workCenters", { companyId }),
        () => many(db, "supplierProcess", { companyId }),
        () =>
          isConfigured
            ? many(db, "configurationRule", { itemId, companyId })
            : Promise.resolve({ data: null, error: null }),
        () => single(db, "quote", { id: quoteId, companyId }),
        () =>
          maybeSingle(db, "quoteLine", {
            id: quoteLineId,
            quoteId,
            companyId
          })
      ]);

      // The permission check proved the CALLER may act in companyId; it proves
      // nothing about the quote line in the body. The quoteMakeMethod lookup
      // is scoped, but a miss INSERTS one and then rewrites the line's
      // materials and operations by quoteLineId alone.
      if (ownedQuoteLine.error) {
        throw new Error("Failed to get quote line");
      }
      if (!ownedQuoteLine.data) {
        throw new NotFoundError("Quote line not found");
      }

      const configurationCodeByField = configurationRules?.data?.reduce<
        Record<string, string>
      >((acc, rule) => {
        acc[rule.field] = rule.code;
        return acc;
      }, {});

      const quoteLocationId = quote.data?.locationId;

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (quoteMakeMethod.error) {
        throw new Error("Failed to get quote make method");
      }

      if (!quoteMakeMethod.data) {
        await db
          .insertInto("quoteMakeMethod")
          .values({
            quoteId,
            quoteLineId,
            itemId,
            companyId,
            createdBy: userId
          })
          .execute();
        // Read back in the shape the rest of this flow uses.
        const inserted = await single(db, "quoteMakeMethod", {
          quoteLineId,
          parentMaterialId: isNull,
          companyId
        });

        if (inserted.error || !inserted.data) {
          throw new Error("Failed to create quote make method");
        }
        quoteMakeMethod.data = inserted.data;
      }

      if (workCenters.error) {
        throw new Error("Failed to get related work centers");
      }

      const hydratedConfiguration = await hydrateConfiguration(
        db,
        configuration,
        itemId,
        companyId
      );

      const [methodTrees] = await inOrder([
        () => getMethodTree(db, makeMethod.data.id!)
      ]);

      if (methodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const methodTree = methodTrees.data?.[0] as MethodTreeItem;
      if (!methodTree) throw new NotFoundError("Method tree not found");

      const getLaborAndOverheadRates = getRatesFromWorkCenters(
        workCenters?.data
      );
      const getOutsideOperationRates = getRatesFromSupplierProcesses(
        supplierProcesses?.data
      );

      await withTransaction(db, async (trx) => {
        if (isConfigured) {
          await trx
            .updateTable("quoteLine")
            .set({
              configuration: JSON.stringify(configuration),
              updatedAt: datetime.timestamp(),
              updatedBy: userId
            })
            .where("id", "=", quoteLineId)
            .where("companyId", "=", companyId)
            .execute();
        }

        // Delete existing quoteMakeMethod, quoteMakeMethodOperation, quoteMakeMethodMaterial
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("quoteMakeMethod")
                .where((eb) =>
                  eb.and([
                    eb("quoteLineId", "=", quoteLineId),
                    eb("parentMaterialId", "is not", null)
                  ])
                )
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfMaterial
            ? trx
                .deleteFrom("quoteMaterial")
                .where("quoteLineId", "=", quoteLineId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("quoteMaterial")
                .set({ quoteOperationId: null })
                .where("quoteLineId", "=", quoteLineId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("quoteOperation")
                .where("quoteLineId", "=", quoteLineId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          trx
            .updateTable("quoteMakeMethod")
            .set({ version: makeMethod.data.version ?? 1 })
            .where("id", "=", quoteMakeMethod.data!.id!)
            .where("companyId", "=", companyId)
            .execute()
        ]);

        async function getConfiguredValue<
          T extends number | string | boolean | null
        >({
          id,
          field,
          defaultValue
        }: {
          id: string;
          field: string;
          defaultValue: T;
        }): Promise<T> {
          if (!configurationCodeByField) return defaultValue;

          const fieldKey = getFieldKey(field, id);

          if (configurationCodeByField[fieldKey]) {
            try {
              const code = configurationCodeByField[fieldKey];
              const mod = await importTypeScript(code);
              const result = await mod.configure(hydratedConfiguration);

              return (result ?? defaultValue) as T;
            } catch (err) {
              getMethodLogger.error("configuration field resolver failed", {
                error: String((err as Error)?.stack ?? err)
              });
              return defaultValue;
            }
          }

          return defaultValue;
        }

        // traverse method tree and create:
        // - quoteMakeMethod
        // - quoteMakeMethodOperation
        // - quoteMakeMethodMaterial
        async function traverseMethod(
          node: MethodTreeItem,
          parentQuoteMakeMethodId: string | null
        ) {
          getMethodLogger.debug("[traverseMethod]", {
            isRoot: node.data.isRoot,
            itemId: node.data.itemId,
            methodType: node.data.methodType,
            materialMakeMethodId: node.data.materialMakeMethodId,
            childCount: node.children.length,
            childMethodTypes: node.children.map((c) => ({
              itemId: c.data.itemId,
              methodType: c.data.methodType
            })),
            parentQuoteMakeMethodId
          });

          let methodOperationsToQuoteOperations: Record<string, string> = {};

          const nodeLevelConfigurationKey = `${
            node.data.materialMakeMethodId
          }:${node.data.isRoot ? "undefined" : node.data.methodMaterialId}`;

          // For child nodes, always include operations regardless of parts flags
          if (!node.data.isRoot || parts.billOfProcess) {
            const relatedOperations = {
              data: treeOperations.get(node.data.materialMakeMethodId) ?? []
            };

            let quoteOperationsInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
              [];
            // Index-aligned with quoteOperationsInserts, as in itemToJob:
            // a blank configured processId skips a row and a billOfProcess
            // configuration reorders and filters them, so the returned ids
            // cannot be paired against relatedOperations.data.
            let sourceOperations: typeof relatedOperations.data = [];
            for await (const op of relatedOperations?.data ?? []) {
              const [
                processId,
                procedureId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                operationOrder,
                operationType
              ] = await Promise.all([
                getConfiguredValue({
                  id: op.id,
                  field: "processId",
                  defaultValue: op.processId
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "procedureId",
                  defaultValue: op.procedureId
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "workCenterId",
                  defaultValue: op.workCenterId
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "description",
                  defaultValue: op.description
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupTime",
                  defaultValue: op.setupTime
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "setupUnit",
                  defaultValue: op.setupUnit
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborTime",
                  defaultValue: op.laborTime
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "laborUnit",
                  defaultValue: op.laborUnit
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineTime",
                  defaultValue: op.machineTime
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "machineUnit",
                  defaultValue: op.machineUnit
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationOrder",
                  defaultValue: op.operationOrder
                }),
                getConfiguredValue({
                  id: op.id,
                  field: "operationType",
                  defaultValue: op.operationType
                })
              ]);

              if (processId === "") continue;

              const operationRates = getLaborAndOverheadRates(
                processId,
                op.workCenterId
              );
              getMethodLogger.debug("traverseMethod", {
                processId,
                ...operationRates
              });

              sourceOperations.push(op);
              quoteOperationsInserts.push({
                quoteId,
                quoteLineId,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                processId,
                procedureId,
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                workCenterId,
                description,
                setupTime,
                setupUnit,
                laborTime,
                laborUnit,
                machineTime,
                machineUnit,
                ...getLaborAndOverheadRates(processId, op.workCenterId),
                order: op.order,
                operationOrder,
                operationType: normalizeOperationType(operationType),
                operationSupplierProcessId: op.operationSupplierProcessId,
                operationUnitCost: op.operationUnitCost ?? 0,
                ...getOutsideOperationRates(
                  processId,
                  op.operationSupplierProcessId
                ),
                operationMinimumCost: op.operationMinimumCost ?? 0,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  !node.data.isRoot || parts.workInstructions
                    ? op.workInstruction
                    : {}
                ),
                companyId,
                createdBy: userId,
                customFields: {}
              });
            }

            const bopConfigurationKey = `billOfProcess:${nodeLevelConfigurationKey}`;
            let bopConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bopConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bopConfigurationKey]
              );
              bopConfiguration = await mod.configure(hydratedConfiguration);
            }

            if (bopConfiguration) {
              const configuredInserts: typeof quoteOperationsInserts = [];
              const configuredSources: typeof sourceOperations = [];
              bopConfiguration.forEach((description, index) => {
                const position = quoteOperationsInserts.findIndex(
                  (operation) => operation.description === description
                );
                if (position !== -1) {
                  configuredInserts.push({
                    ...quoteOperationsInserts[position]!,
                    order: index + 1
                  });
                  configuredSources.push(sourceOperations[position]!);
                }
              });
              quoteOperationsInserts = configuredInserts;
              sourceOperations = configuredSources;
            }

            if (quoteOperationsInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationsInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of sourceOperations.entries()) {
                const operationId = operationIds[index]?.id;

                if (operationId) {
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId
                  } = operation;

                  if (
                    (!node.data.isRoot || parts.tools) &&
                    Array.isArray(methodOperationTool) &&
                    methodOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
                      .values(
                        methodOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (!procedureId) {
                    if (
                      (!node.data.isRoot || parts.parameters) &&
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      const parameters = await Promise.all(
                        methodOperationParameter.map(async (param) => ({
                          operationId,
                          key: param.key,
                          value: await getConfiguredValue({
                            id: operation.id,
                            field: `parameter:${param.id}:value`,
                            defaultValue: param.value
                          }),
                          companyId,
                          createdBy: userId
                        }))
                      );

                      await trx
                        .insertInto("quoteOperationParameter")
                        .values(parameters)
                        .execute();
                    }

                    if (
                      (!node.data.isRoot || parts.steps) &&
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      const attributes = await Promise.all(
                        methodOperationStep.map(
                          async ({
                            id,
                            // quoteOperationStep has no provenance marker
                            assemblyInstructionStepId:
                              _assemblyInstructionStepId,
                            ...attribute
                          }) => ({
                            ...attribute,
                            description: toTiptapDoc(attribute.description),
                            operationId,
                            minValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${id}:minValue`,
                              defaultValue: attribute.minValue
                            }),
                            maxValue: await getConfiguredValue({
                              id: operation.id,
                              field: `attribute:${id}:maxValue`,
                              defaultValue: attribute.maxValue
                            }),
                            companyId,
                            createdBy: userId
                          })
                        )
                      );

                      const insertedSteps = await trx
                        .insertInto("quoteOperationStep")
                        .values(attributes)
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        methodOperationStep,
                        insertedSteps,
                        "methodOperationStepSlide",
                        "quoteOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }

              methodOperationsToQuoteOperations = sourceOperations.reduce<
                Record<string, string>
              >((acc, op, index) => {
                const operationId = operationIds[index]?.id;
                if (operationId) {
                  acc[op.id!] = operationId;
                }
                return acc;
              }, {});
            }
          } // end if (parts.billOfProcess)

          if (parts.billOfMaterial) {
            const mapMethodMaterialToQuoteMaterial = async (
              child: MethodTreeItem
            ) => {
              let [
                itemId,
                description,
                quantity,
                methodType,
                unitOfMeasureCode
              ] = await Promise.all([
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "itemId",
                  defaultValue: child.data.itemId
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "description",
                  defaultValue: child.data.description
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "quantity",
                  defaultValue: child.data.quantity
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "methodType",
                  defaultValue: child.data.methodType
                }),
                getConfiguredValue({
                  id: child.data.methodMaterialId,
                  field: "unitOfMeasureCode",
                  defaultValue: child.data.unitOfMeasureCode
                })
              ]);

              if (itemId === "") return null;
              // A configured (or authored) quantity of 0 removes the line from
              // the BOM (and its sub-tree, via configuredChildren below).
              if (isZeroQuantity(quantity)) return null;

              let itemType = child.data.itemType;
              let unitCost = child.data.unitCost;

              // TODO: if the methodType is Make and the default value is not Make, we need to do itemToQuoteMakeMethod for that material

              if (itemId !== child.data.itemId) {
                const item = await single<
                  "item",
                  Tables["item"]["Row"] & {
                    itemCost: Tables["itemCost"]["Row"][];
                  }
                >(
                  trx,
                  "item",
                  { id: itemId, companyId },
                  {
                    embed: { itemCost: { table: "itemCost", on: "itemId" } }
                  }
                );
                if (item.data) {
                  itemType = item.data.type;
                  unitCost =
                    item.data.itemCost[0]?.unitCost ?? child.data.unitCost;
                  if (description === child.data.description) {
                    description = item.data.name;
                  }
                } else {
                  itemId = child.data.itemId;
                }
              }

              return {
                quoteId,
                quoteLineId,
                quoteMakeMethodId: parentQuoteMakeMethodId!,
                quoteOperationId:
                  methodOperationsToQuoteOperations[child.data.operationId],
                order: child.data.order,
                itemId,
                itemType,
                kit: child.data.kit,
                methodType,
                description,
                quantity,
                storageUnitId: quoteLocationId
                  ? // @ts-ignore: storageUnitIds is a dynamic object with location keys
                    (child.data.storageUnitIds?.[quoteLocationId] as string) ||
                    null
                  : null,
                unitOfMeasureCode,
                unitCost: unitCost ?? 0,
                companyId,
                createdBy: userId,
                customFields: {}
              };
            };

            const quoteMaterialResults = await Promise.all(
              node.children.map(mapMethodMaterialToQuoteMaterial)
            );
            const validQuoteMaterialIndices = quoteMaterialResults.reduce<
              number[]
            >((acc, m, i) => {
              if (m !== null) acc.push(i);
              return acc;
            }, []);
            let materialsWithConfiguredFields = quoteMaterialResults.filter(
              (m): m is NonNullable<typeof m> => m !== null
            );
            const configuredChildren = validQuoteMaterialIndices.map(
              (i) => node.children[i]!
            );

            const bomConfigurationKey = `billOfMaterial:${nodeLevelConfigurationKey}`;
            let bomConfiguration: string[] | null = null;

            if (configurationCodeByField?.[bomConfigurationKey]) {
              const mod = await importTypeScript(
                configurationCodeByField[bomConfigurationKey]
              );
              bomConfiguration = await mod.configure(hydratedConfiguration);
            }

            if (bomConfiguration) {
              // @ts-expect-error - we can't assign undefined to materialsWithConfiguredFields but we filter them in the next step
              materialsWithConfiguredFields = bomConfiguration
                .map((readableIdWithRevision, index) => {
                  const material = materialsWithConfiguredFields.find(
                    (material) => material.itemId === itemId
                  );
                  if (material) {
                    return {
                      ...material,
                      order: index + 1
                    };
                  }
                })
                .filter(Boolean);
            }

            const madeMaterials = materialsWithConfiguredFields.filter(
              (material) => material.methodType === "Make to Order"
            );

            const pickedOrBoughtMaterials =
              materialsWithConfiguredFields.filter(
                (material) => material.methodType !== "Make to Order"
              );

            const madeChildren = configuredChildren.filter(
              (child) => child!.data.methodType === "Make to Order"
            );

            getMethodLogger.debug("[traverseMethod] materials", {
              totalChildren: materialsWithConfiguredFields.length,
              madeMaterialsCount: madeMaterials.length,
              madeChildrenCount: madeChildren.length,
              pickedOrBoughtCount: pickedOrBoughtMaterials.length
            });

            if (madeMaterials.length > 0) {
              const madeMaterialsWithIds = madeMaterials.map((m) => ({
                ...m,
                id: nanoid()
              }));

              await trx
                .insertInto("quoteMaterial")
                .values(madeMaterialsWithIds)
                .execute();

              const newMakeMethodIds = madeChildren.map(() => nanoid());
              await renameMakeMethods(trx, {
                table: "quoteMakeMethod",
                companyId,
                rows: madeChildren.map((_, index) => ({
                  parentMaterialId: madeMaterialsWithIds[index]!.id,
                  id: newMakeMethodIds[index]!
                }))
              });

              for (const [index, child] of madeChildren.entries()) {
                const materialId = madeMaterialsWithIds[index]!.id;
                const newMakeMethodId = newMakeMethodIds[index]!;

                getMethodLogger.debug(
                  "[traverseMethod] processing made child",
                  {
                    index,
                    materialId,
                    newMakeMethodId,
                    childItemId: child!.data.itemId,
                    parentItemId: itemId,
                    willRecurse: child!.data.itemId !== itemId
                  }
                );

                // A configuration rule may have moved this line onto another
                // made item; the sub-assembly under it is then that item's.
                const made = await configuredMadeChild(
                  trx,
                  companyId,
                  child!,
                  madeMaterialsWithIds[index]!.itemId
                );
                if (!made) continue;
                if (made !== child) {
                  for (const [id, ops] of await readOperationsForTree(
                    trx,
                    made
                  ))
                    treeOperations.set(id, ops);
                }

                // prevent an infinite loop
                if (made.data.itemId !== itemId) {
                  await traverseMethod(made, newMakeMethodId);
                }
              }
            }

            deferredQuoteMaterials.push(...pickedOrBoughtMaterials);
          } // end if (parts.billOfMaterial)
        }

        function logTree(node: MethodTreeItem, depth = 0) {
          getMethodLogger.debug(
            "  ".repeat(depth) +
              `[tree] ${node.data.itemId} (${node.data.methodType}, isRoot=${node.data.isRoot}, children=${node.children.length})`
          );
          for (const child of node.children) {
            logTree(child, depth + 1);
          }
        }
        logTree(methodTree);

        const treeOperations = await readOperationsForTree(trx, methodTree);
        const deferredQuoteMaterials: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
          [];
        await traverseMethod(methodTree, quoteMakeMethod.data!.id);
        for (const chunk of chunked(deferredQuoteMaterials)) {
          await trx.insertInto("quoteMaterial").values(chunk).execute();
        }
      });

      await calculateQuoteLinePrices(
        db,
        quoteId,
        quoteLineId,
        companyId,
        userId
      );

      break;
    }
    case "itemToQuoteMakeMethod": {
      const quoteMakeMethodId = targetId;

      if (!quoteMakeMethodId) {
        throw new Error("Invalid targetId");
      }
      const itemId = sourceId;
      const isConfigured = !!configuration;

      const [makeMethod, quoteMakeMethod, workCenters, supplierProcesses] =
        await inOrder([
          () => single(db, "activeMakeMethods", { itemId, companyId }),
          () =>
            single(db, "quoteMakeMethod", {
              id: quoteMakeMethodId,
              companyId
            }),
          () => many(db, "workCenters", { companyId }),
          () => many(db, "supplierProcess", { companyId })
        ]);

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (quoteMakeMethod.error || !quoteMakeMethod.data) {
        throw new Error("Failed to get quote make method");
      }

      const hydratedConfiguration = await hydrateConfiguration(
        db,
        configuration,
        itemId,
        companyId
      );

      const [methodTrees, configurationRules] = await inOrder([
        () => getMethodTree(db, makeMethod.data.id!),
        () =>
          isConfigured
            ? many(db, "configurationRule", { itemId, companyId })
            : Promise.resolve({
                data: [] as Tables["configurationRule"]["Row"][]
              })
      ]);

      if (methodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const methodTree = methodTrees.data?.[0] as MethodTreeItem;
      if (!methodTree) throw new NotFoundError("Method tree not found");

      const getLaborAndOverheadRates = getRatesFromWorkCenters(
        workCenters?.data
      );
      const getOutsideOperationRates = getRatesFromSupplierProcesses(
        supplierProcesses?.data
      );

      // Get configuration code by field
      const configurationCodeByField = configurationRules.data?.reduce<
        Record<string, string>
      >((acc, rule) => {
        acc[rule.field] = rule.code;
        return acc;
      }, {});

      await withTransaction(db, async (trx) => {
        // Delete existing quoteMakeMethodOperation, quoteMakeMethodMaterial
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("quoteMaterial")
                .where("quoteMakeMethodId", "=", quoteMakeMethodId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("quoteMaterial")
                .set({ quoteOperationId: null })
                .where("quoteMakeMethodId", "=", quoteMakeMethodId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("quoteOperation")
                .where("quoteMakeMethodId", "=", quoteMakeMethodId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          trx
            .updateTable("quoteMakeMethod")
            .set({ version: makeMethod.data.version ?? 1 })
            .where("id", "=", quoteMakeMethodId)
            .where("companyId", "=", companyId)
            .execute()
        ]);

        function getFieldKey(field: string, id: string) {
          return `${field}:${id}`;
        }

        // FIXME: never called — configuration rules are not applied on this
        // make-method path.
        // biome-ignore lint/correctness/noUnusedVariables: see FIXME above
        async function getConfiguredValue<T>({
          id,
          field,
          defaultValue
        }: {
          id: string;
          field: string;
          defaultValue: T;
        }): Promise<T> {
          if (!configurationCodeByField) return defaultValue;
          const fieldKey = getFieldKey(field, id);

          if (configurationCodeByField?.[fieldKey]) {
            try {
              const mod = await importTypeScript(
                configurationCodeByField[fieldKey]
              );
              const result = await mod.configure(hydratedConfiguration);
              return (result ?? defaultValue) as T;
            } catch (err) {
              getMethodLogger.error("configuration field resolver failed", {
                error: String((err as Error)?.stack ?? err)
              });
              return defaultValue;
            }
          }

          return defaultValue;
        }

        // traverse method tree and create:
        // - quoteMakeMethod
        // - quoteMakeMethodOperation
        // - quoteMakeMethodMaterial
        async function traverseMethod(
          node: MethodTreeItem,
          parentQuoteMakeMethodId: string | null
        ) {
          const relatedOperations = {
            data: treeOperations.get(node.data.materialMakeMethodId) ?? []
          };

          const quoteOperationInserts =
            relatedOperations?.data?.map((op) => ({
              quoteId: quoteMakeMethod.data?.quoteId!,
              quoteLineId: quoteMakeMethod.data?.quoteLineId!,
              quoteMakeMethodId: parentQuoteMakeMethodId!,
              processId: op.processId,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              workCenterId: op.workCenterId,
              description: op.description,
              setupTime: op.setupTime,
              setupUnit: op.setupUnit,
              laborTime: op.laborTime,
              laborUnit: op.laborUnit,
              machineTime: op.machineTime,
              machineUnit: op.machineUnit,
              ...getLaborAndOverheadRates(op.processId, op.workCenterId),
              order: op.order,
              operationOrder: op.operationOrder,
              operationType: op.operationType,
              operationUnitCost: op.operationUnitCost ?? 0,
              operationSupplierProcessId: op.operationSupplierProcessId,
              ...getOutsideOperationRates(
                op.processId,
                op.operationSupplierProcessId
              ),
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              companyId,
              createdBy: userId,
              customFields: {}
            })) ?? [];

          let methodOperationsToQuoteOperations: Record<string, string> = {};

          if (parts.billOfProcess) {
            if (quoteOperationInserts?.length > 0) {
              const operationIds = await trx
                .insertInto("quoteOperation")
                .values(quoteOperationInserts)
                .returning(["id"])
                .execute();

              for (const [index, operation] of (
                relatedOperations.data ?? []
              ).entries()) {
                const operationId = operationIds[index]!.id;

                if (operationId) {
                  const {
                    methodOperationTool,
                    methodOperationParameter,
                    methodOperationStep,
                    procedureId
                  } = operation;

                  if (
                    parts.tools &&
                    Array.isArray(methodOperationTool) &&
                    methodOperationTool.length > 0
                  ) {
                    await trx
                      .insertInto("quoteOperationTool")
                      .values(
                        methodOperationTool.map((tool) => ({
                          toolId: tool.toolId,
                          quantity: tool.quantity,
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (!procedureId) {
                    if (
                      parts.parameters &&
                      Array.isArray(methodOperationParameter) &&
                      methodOperationParameter.length > 0
                    ) {
                      await trx
                        .insertInto("quoteOperationParameter")
                        .values(
                          methodOperationParameter.map((param) => ({
                            operationId,
                            key: param.key,
                            value: param.value,
                            companyId,
                            createdBy: userId
                          }))
                        )
                        .execute();
                    }

                    if (
                      parts.steps &&
                      // Assembly ops inherit steps from the linked instruction —
                      // never copy (possibly stale) template steps alongside it.
                      !operation.assemblyInstructionId &&
                      Array.isArray(methodOperationStep) &&
                      methodOperationStep.length > 0
                    ) {
                      const insertedSteps = await trx
                        .insertInto("quoteOperationStep")
                        .values(
                          methodOperationStep.map(
                            ({
                              id: _id,
                              // quoteOperationStep has no provenance marker
                              assemblyInstructionStepId:
                                _assemblyInstructionStepId,
                              ...attribute
                            }) => ({
                              ...attribute,
                              description: toTiptapDoc(attribute.description),
                              operationId,
                              companyId,
                              createdBy: userId
                            })
                          )
                        )
                        .returning(["id"])
                        .execute();

                      await copyStepSlides(
                        trx,
                        methodOperationStep,
                        insertedSteps,
                        "methodOperationStepSlide",
                        "quoteOperationStepSlide",
                        companyId,
                        userId
                      );
                    }
                  }
                }
              }

              methodOperationsToQuoteOperations =
                relatedOperations.data?.reduce<Record<string, string>>(
                  (acc, op, index) => {
                    if (operationIds[index]!.id) {
                      acc[op.id!] = operationIds[index]!.id!;
                    }
                    return acc;
                  },
                  {}
                ) ?? {};
            }
          } // end if (parts.billOfProcess)

          if (parts.billOfMaterial) {
            const mapMethodMaterialToQuoteMaterial = (
              child: MethodTreeItem
            ) => ({
              quoteId: quoteMakeMethod.data?.quoteId!,
              quoteLineId: quoteMakeMethod.data?.quoteLineId!,
              quoteMakeMethodId: parentQuoteMakeMethodId!,
              quoteOperationId:
                methodOperationsToQuoteOperations[child.data.operationId],
              itemId: child.data.itemId,
              itemType: child.data.itemType,
              kit: child.data.kit,
              methodType: child.data.methodType,
              order: child.data.order,
              description: child.data.description,
              quantity: child.data.quantity,
              storageUnitId: (child.data as any).storageUnitId || null, // @ts-ignore: storageUnitId field exists in database but types may not be updated
              unitOfMeasureCode: child.data.unitOfMeasureCode,
              unitCost: child.data.unitCost ?? 0,
              companyId,
              createdBy: userId,
              customFields: {}
            });

            // A zero-quantity BOM line is removed from the method. Filtering the
            // children (not the mapped rows) keeps `madeChildren`/`madeMaterials`
            // index-aligned and stops a made line's sub-tree from being exploded.
            const madeChildren = node.children.filter(
              (child) =>
                child.data.methodType === "Make to Order" &&
                !isZeroQuantity(child.data.quantity)
            );
            const unmadeChildren = node.children.filter(
              (child) =>
                child.data.methodType !== "Make to Order" &&
                !isZeroQuantity(child.data.quantity)
            );

            const madeMaterials = madeChildren.map(
              mapMethodMaterialToQuoteMaterial
            );
            const pickedOrBoughtMaterials = unmadeChildren.map(
              mapMethodMaterialToQuoteMaterial
            );
            if (madeMaterials.length > 0) {
              const madeMaterialsWithIds = madeMaterials.map((m) => ({
                ...m,
                id: nanoid()
              }));

              await trx
                .insertInto("quoteMaterial")
                .values(madeMaterialsWithIds)
                .execute();

              const newMakeMethodIds = madeChildren.map(() => nanoid());
              await renameMakeMethods(trx, {
                table: "quoteMakeMethod",
                companyId,
                rows: madeChildren.map((_, index) => ({
                  parentMaterialId: madeMaterialsWithIds[index]!.id,
                  id: newMakeMethodIds[index]!
                }))
              });

              for (const [index, child] of madeChildren.entries()) {
                const newMakeMethodId = newMakeMethodIds[index]!;

                // A configuration rule may have moved this line onto another
                // made item; the sub-assembly under it is then that item's.
                const made = await configuredMadeChild(
                  trx,
                  companyId,
                  child,
                  madeMaterialsWithIds[index]!.itemId
                );
                if (!made) continue;
                if (made !== child) {
                  for (const [id, ops] of await readOperationsForTree(
                    trx,
                    made
                  ))
                    treeOperations.set(id, ops);
                }

                // prevent an infinite loop
                if (made.data.itemId !== itemId) {
                  await traverseMethod(made, newMakeMethodId);
                }
              }
            }

            deferredQuoteMaterials.push(...pickedOrBoughtMaterials);
          } // end if (parts.billOfMaterial)
        }

        const treeOperations = await readOperationsForTree(trx, methodTree);
        const deferredQuoteMaterials: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
          [];
        await traverseMethod(methodTree, quoteMakeMethod.data.id);
        for (const chunk of chunked(deferredQuoteMaterials)) {
          await trx.insertInto("quoteMaterial").values(chunk).execute();
        }
      });
      break;
    }
    case "jobMakeMethodToItem": {
      const jobMakeMethodId = sourceId;
      const makeMethodId = targetId;

      const [makeMethod, jobMakeMethod] = await inOrder([
        () => single(db, "makeMethod", { id: makeMethodId, companyId }),
        () => single(db, "jobMakeMethod", { id: jobMakeMethodId, companyId })
      ]);

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (jobMakeMethod.error) {
        throw new Error("Failed to get job make method");
      }

      const itemId = makeMethod.data?.itemId;

      const [job, jobOperations, itemReplenishment] = await inOrder([
        () => single(db, "job", { id: jobMakeMethod.data.jobId, companyId }),
        () =>
          many<
            "jobOperationsWithMakeMethods",
            Views["jobOperationsWithMakeMethods"]["Row"] & {
              jobOperationTool: Tables["jobOperationTool"]["Row"][];
              jobOperationParameter: Tables["jobOperationParameter"]["Row"][];
              jobOperationStep: Tables["jobOperationStep"]["Row"][];
            }
          >(
            db,
            "jobOperationsWithMakeMethods",
            { jobId: jobMakeMethod.data.jobId, companyId },
            {
              embed: {
                jobOperationTool: {
                  table: "jobOperationTool",
                  on: "operationId"
                },
                jobOperationParameter: {
                  table: "jobOperationParameter",
                  on: "operationId"
                },
                jobOperationStep: {
                  table: "jobOperationStep",
                  on: "operationId"
                }
              }
            }
          ),
        () => single(db, "itemReplenishment", { itemId, companyId })
      ]);

      if (jobOperations.error) {
        throw new Error("Failed to get job operations");
      }

      if (itemReplenishment.error) {
        throw new Error("Failed to get item replenishment");
      }

      if (itemReplenishment.data?.requiresConfiguration) {
        throw new Error("Cannot override method of configured item");
      }

      const [jobMethodTrees] = await inOrder([
        () =>
          getJobMethodTree(
            db,
            jobMakeMethodId,
            jobMakeMethod.data.parentMaterialId
          )
      ]);

      if (jobMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      if (jobMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
      if (!jobMethodTree) throw new NotFoundError("Job method tree not found");

      const madeItemIds: string[] = [];

      traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
        if (node.data.itemId && node.data.methodType === "Make to Order") {
          madeItemIds.push(node.data.itemId);
        }
      });

      const makeMethods = await many(db, "makeMethod", {
        itemId: madeItemIds
      });
      if (makeMethods.error) {
        throw new Error("Failed to get make methods");
      }

      const makeMethodByItemId: Record<string, string> = {};
      makeMethods.data?.forEach((m) => {
        makeMethodByItemId[m.itemId] = m.id;
      });

      await withTransaction(db, async (trx) => {
        let makeMethodsToDelete: string[] = [];
        const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
          [];
        const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
          [];

        traverseJobMethod(jobMethodTree!, (node: JobMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make to Order") {
            makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
          }

          node.children.forEach((child) => {
            // A zero-quantity BOM line is dropped from the saved method.
            if (isZeroQuantity(child.data.quantity)) return;
            materialInserts.push({
              makeMethodId: makeMethodByItemId[node.data.itemId]!,
              materialMakeMethodId: makeMethodByItemId[child.data.itemId],
              itemId: child.data.itemId,
              itemType: child.data.itemType,
              kit: child.data.kit,
              methodType: child.data.methodType,
              order: child.data.order,
              quantity: child.data.quantity,
              unitOfMeasureCode: child.data.unitOfMeasureCode,
              storageUnitIds: job.data?.locationId
                ? {
                    [job.data.locationId]: child.data.storageUnitId || null
                  }
                : {},
              companyId,
              createdBy: userId,
              customFields: {}
            });
          });
        });

        if (makeMethodsToDelete.length > 0) {
          makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
            mm === makeMethodByItemId[jobMakeMethod.data.itemId]
              ? makeMethod.data.id
              : mm
          );
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("methodOperation")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);
        }

        if (parts.billOfMaterial && materialInserts.length > 0) {
          await trx
            .insertInto("methodMaterial")
            .values(
              materialInserts.map((insert) => ({
                ...insert,
                productionQuantity: undefined,
                makeMethodId:
                  insert.makeMethodId ===
                  makeMethodByItemId[jobMakeMethod.data.itemId]
                    ? makeMethod.data.id
                    : insert.makeMethodId,
                itemId:
                  insert.itemId === jobMakeMethod.data.itemId
                    ? itemId
                    : insert.itemId
              }))
            )
            .execute();
        }

        if (parts.billOfProcess) {
          jobOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              operationType: op.operationType ?? "Process",
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              companyId,
              createdBy: userId,
              customFields: {}
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId
                }))
              )
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              jobOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  jobOperationTool,
                  jobOperationParameter,
                  jobOperationStep,
                  procedureId
                } = operation;

                if (
                  parts.tools &&
                  Array.isArray(jobOperationTool) &&
                  jobOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      jobOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (!procedureId) {
                  if (
                    parts.parameters &&
                    Array.isArray(jobOperationParameter) &&
                    jobOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        jobOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    parts.steps &&
                    // Assembly ops and inspection ops inherit their steps from
                    // the linked instruction/document — never copy materialized
                    // steps back onto a template.
                    !operation.assemblyInstructionId &&
                    !operation.inspectionDocumentId &&
                    Array.isArray(jobOperationStep) &&
                    jobOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("jobOperationStep")
                      .values(
                        jobOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
                          description: toTiptapDoc(attribute.description),
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      jobOperationStep,
                      insertedSteps,
                      "jobOperationStepSlide",
                      "jobOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          }
        } // end if (parts.billOfProcess)
      });

      break;
    }
    case "jobToItem": {
      const jobId = sourceId;
      if (!jobId) {
        throw new Error("Invalid sourceId");
      }
      const makeMethodId = targetId;

      const [makeMethod, jobMakeMethod, jobOperations, job] = await inOrder([
        () => single(db, "makeMethod", { id: makeMethodId, companyId }),
        () =>
          single(db, "jobMakeMethod", {
            jobId,
            parentMaterialId: isNull,
            companyId
          }),
        () =>
          many<
            "jobOperationsWithMakeMethods",
            Views["jobOperationsWithMakeMethods"]["Row"] & {
              jobOperationTool: Tables["jobOperationTool"]["Row"][];
              jobOperationParameter: Tables["jobOperationParameter"]["Row"][];
              jobOperationStep: Tables["jobOperationStep"]["Row"][];
            }
          >(
            db,
            "jobOperationsWithMakeMethods",
            { jobId, companyId },
            {
              embed: {
                jobOperationTool: {
                  table: "jobOperationTool",
                  on: "operationId"
                },
                jobOperationParameter: {
                  table: "jobOperationParameter",
                  on: "operationId"
                },
                jobOperationStep: {
                  table: "jobOperationStep",
                  on: "operationId"
                }
              }
            }
          ),
        () => single(db, "job", { id: jobId, companyId })
      ]);

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (jobMakeMethod.error) {
        throw new Error("Failed to get job make method");
      }

      if (jobOperations.error) {
        throw new Error("Failed to get job operations");
      }

      const itemId = makeMethod.data?.itemId;

      const [jobMethodTrees, itemReplenishment] = await inOrder([
        () => getJobMethodTree(db, jobMakeMethod.data.id),
        () => single(db, "itemReplenishment", { itemId, companyId })
      ]);

      if (itemReplenishment.error) {
        throw new Error("Failed to get item replenishment");
      }

      if (itemReplenishment.data?.requiresConfiguration) {
        throw new Error("Cannot override method of configured item");
      }

      if (jobMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
      if (!jobMethodTree) throw new NotFoundError("Method tree not found");

      const madeItemIds: string[] = [];

      traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
        if (node.data.itemId && node.data.methodType === "Make to Order") {
          madeItemIds.push(node.data.itemId);
        }
      });

      const makeMethods = await many(db, "activeMakeMethods", {
        itemId: madeItemIds,
        companyId
      });
      if (makeMethods.error) {
        throw new Error("Failed to get make methods");
      }

      const makeMethodByItemId: Record<string, string> = {};
      makeMethods.data?.forEach((m) => {
        if (m.itemId) {
          // @ts-expect-error - itemId is not null
          makeMethodByItemId[m.itemId!] = m.id;
        }
      });

      await withTransaction(db, async (trx) => {
        let makeMethodsToDelete: string[] = [];
        const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
          [];
        const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
          [];

        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make to Order") {
            makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
          }

          node.children.forEach((child) => {
            // A zero-quantity BOM line is dropped from the saved method.
            if (isZeroQuantity(child.data.quantity)) return;
            materialInserts.push({
              makeMethodId: makeMethodByItemId[node.data.itemId]!,
              materialMakeMethodId: makeMethodByItemId[child.data.itemId],
              itemId: child.data.itemId,
              itemType: child.data.itemType,
              kit: child.data.kit,
              methodType: child.data.methodType,
              order: child.data.order,
              quantity: child.data.quantity,
              unitOfMeasureCode: child.data.unitOfMeasureCode,
              storageUnitIds: job.data?.locationId
                ? {
                    [job.data.locationId]: child.data.storageUnitId || null
                  }
                : {},
              companyId,
              createdBy: userId,
              customFields: {}
            });
          });
        });

        if (makeMethodsToDelete.length > 0) {
          makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
            mm === makeMethodByItemId[jobMakeMethod.data.itemId]
              ? makeMethod.data.id
              : mm
          );
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("methodOperation")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);
        }

        if (parts.billOfMaterial && materialInserts.length > 0) {
          await trx
            .insertInto("methodMaterial")
            .values(
              materialInserts.map((insert) => ({
                ...insert,
                productionQuantity: undefined,
                makeMethodId:
                  insert.makeMethodId ===
                  makeMethodByItemId[jobMakeMethod.data.itemId]
                    ? makeMethod.data.id
                    : insert.makeMethodId,
                itemId:
                  insert.itemId === jobMakeMethod.data.itemId
                    ? itemId
                    : insert.itemId
              }))
            )
            .execute();
        }

        if (parts.billOfProcess) {
          jobOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              // workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              operationType: op.operationType ?? "Process",
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              operationSupplierProcessId: op.operationSupplierProcessId,
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              companyId,
              createdBy: userId,
              customFields: {}
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[jobMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId
                }))
              )
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              jobOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  jobOperationTool,
                  jobOperationParameter,
                  jobOperationStep,
                  procedureId
                } = operation;

                if (
                  parts.tools &&
                  Array.isArray(jobOperationTool) &&
                  jobOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      jobOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (!procedureId) {
                  if (
                    parts.parameters &&
                    Array.isArray(jobOperationParameter) &&
                    jobOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        jobOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    parts.steps &&
                    // Assembly ops and inspection ops inherit their steps from
                    // the linked instruction/document — never copy materialized
                    // steps back onto a template.
                    !operation.assemblyInstructionId &&
                    !operation.inspectionDocumentId &&
                    Array.isArray(jobOperationStep) &&
                    jobOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("methodOperationStep")
                      .values(
                        jobOperationStep.map((step) => ({
                          operationId,
                          name: step.name,
                          type: step.type,
                          description: toTiptapDoc(step.description),
                          required: step.required,
                          sortOrder: step.sortOrder,
                          unitOfMeasureCode: step.unitOfMeasureCode,
                          minValue: step.minValue,
                          maxValue: step.maxValue,
                          listValues: step.listValues,
                          fileTypes: step.fileTypes,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      jobOperationStep,
                      insertedSteps,
                      "jobOperationStepSlide",
                      "methodOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          }
        } // end if (parts.billOfProcess)
      });

      break;
    }
    case "jobToJob": {
      const sourceJobId = sourceId;
      const targetJobId = targetId;
      if (!sourceJobId || !targetJobId) {
        throw new Error("Invalid sourceId or targetId");
      }
      if (sourceJobId === targetJobId) {
        throw new Error("Cannot copy a job method onto itself");
      }

      // Assembly ops whose steps were materialized from an instruction —
      // material ↔ step links flush after the jobMaterial rows exist.
      const assemblyOperationsToLink: Array<{
        operationId: string;
        assemblyInstructionId: string;
      }> = [];

      // The embeds defeat the generated response types (as elsewhere in this
      // file), so the paged rows are typed explicitly.
      type SourceJobMaterialRow =
        Database["public"]["Tables"]["jobMaterial"]["Row"] & {
          jobMaterialStep: {
            jobOperationStepId: string | null;
            quantity: number | null;
          }[];
        };
      type SourceJobOperationRow =
        Database["public"]["Tables"]["jobOperation"]["Row"] & {
          jobOperationTool: (Database["public"]["Tables"]["jobOperationTool"]["Row"] & {
            jobOperationToolStep: { jobOperationStepId: string | null }[];
          })[];
          jobOperationParameter: Database["public"]["Tables"]["jobOperationParameter"]["Row"][];
          jobOperationStep: Database["public"]["Tables"]["jobOperationStep"]["Row"][];
        };

      // Paged: a bare select stops at PostgREST's 1000-row cap and would
      // silently copy a subset of a large job. The secondary `.order("id")`
      // makes paging stable across batches. Started here (not awaited) so the
      // reads below run concurrently with them.
      const targetJob = await single(db, "job", {
        id: targetJobId,
        companyId
      });
      const sourceJob = await single(db, "job", {
        id: sourceJobId,
        companyId
      });
      const targetJobMakeMethod = await single(db, "jobMakeMethod", {
        jobId: targetJobId,
        parentMaterialId: isNull,
        companyId
      });
      const sourceJobMakeMethod = await single(db, "jobMakeMethod", {
        jobId: sourceJobId,
        parentMaterialId: isNull,
        companyId
      });
      const sourceMaterials = await many<"jobMaterial", SourceJobMaterialRow>(
        db,
        "jobMaterial",
        { jobId: sourceJobId, companyId },
        {
          orderBy: ["id"],
          embed: {
            jobMaterialStep: { table: "jobMaterialStep", on: "jobMaterialId" }
          }
        }
      );
      const sourceOperations = await many<
        "jobOperation",
        SourceJobOperationRow
      >(
        db,
        "jobOperation",
        { jobId: sourceJobId, companyId },
        {
          orderBy: ["order", "id"],
          embed: {
            jobOperationTool: {
              table: "jobOperationTool",
              on: "operationId",
              embed: {
                jobOperationToolStep: {
                  table: "jobOperationToolStep",
                  on: "jobOperationToolId"
                }
              }
            },
            jobOperationParameter: {
              table: "jobOperationParameter",
              on: "operationId"
            },
            jobOperationStep: { table: "jobOperationStep", on: "operationId" }
          }
        }
      );

      if (targetJob.error) {
        throw new Error("Failed to get job");
      }
      if (sourceJob.error) {
        throw new Error("Failed to get source job");
      }
      if (targetJobMakeMethod.error || !targetJobMakeMethod.data) {
        throw new Error("Failed to get job make method");
      }
      if (sourceJobMakeMethod.error || !sourceJobMakeMethod.data) {
        throw new Error("Failed to get source job make method");
      }
      if (sourceMaterials.error) {
        throw new Error("Failed to get source job materials");
      }
      if (sourceOperations.error) {
        throw new Error("Failed to get source job operations");
      }

      const jobMethodTrees = await getJobMethodTree(
        db,
        sourceJobMakeMethod.data.id
      );
      if (jobMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }
      const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
      if (!jobMethodTree) throw new NotFoundError("Method tree not found");

      // A process-only copy of a multi-level job cannot work: the sub-assembly
      // make methods only come into existence on the bill-of-material path, so
      // their operations would reference make methods that were never created
      // (jobOperation_jobMakeMethodId_fkey). Refuse with an authored message
      // instead of rolling back on the FK.
      if (!parts.billOfMaterial && parts.billOfProcess) {
        let hasSubAssemblies = false;
        traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
          for (const child of node.children) {
            if (child.data.jobMaterialMakeMethodId) {
              hasSubAssemblies = true;
            }
          }
        });
        if (hasSubAssemblies) {
          throw new Error(
            "Copying only the bill of process from a job with sub-assemblies is not supported — include the bill of material as well"
          );
        }
      }

      // Loaded ONCE per request, before the transaction — as every *-ToJob
      // path does. The source job's rows were swapped live at ITS creation;
      // this re-resolves as-of the TARGET job's build date, so a supersession
      // that became effective since then still redirects the copy.
      const { redirect: supersessionRedirect } = await loadSupersessionRedirect(
        db,
        companyId,
        targetJob.data
      );
      const itemDefaults = createItemDefaults(
        companyId,
        targetJob.data.locationId
      );

      let selfConsumedItem: string | null = null;
      traverseJobMethod(jobMethodTree, (node: JobMethodTreeItem) => {
        for (const child of node.children) {
          const resolvedItemId =
            child.data.methodType !== "Make to Order"
              ? (supersessionRedirect.get(child.data.itemId)?.to ??
                child.data.itemId)
              : child.data.itemId;
          if (resolvedItemId === targetJob.data.itemId) {
            selfConsumedItem = child.data.itemReadableId ?? resolvedItemId;
          }
        }
      });
      if (selfConsumedItem) {
        throw new Error(
          `The source job's method consumes ${selfConsumedItem}, which is the item this job produces — a job cannot consume its own output`
        );
      }

      const sourceMaterialRows = sourceMaterials.data ?? [];
      const sourceOperationRows = sourceOperations.data ?? [];

      const sourceMaterialById = new Map(
        sourceMaterialRows.map((m) => [m.id, m])
      );

      const sourceMaterialIdToJobMaterialId: Record<string, string> = {};
      const sourceMakeMethodIdToJobMakeMethodId: Record<string, string> = {};
      // Track estimated quantities for each SOURCE make method to set on operations
      const sourceMakeMethodIdToQuantities: Record<
        string,
        {
          targetQuantity: number;
          estimatedQuantity: number;
          totalWithScrap: number;
        }
      > = {};
      // Old job step id -> new job step id, for material/tool ↔ step links.
      const sourceStepsToJobSteps: Record<string, string> = {};
      const sourceOperationIdToJobOperationId: Record<string, string> = {};

      await withTransaction(db, async (trx) => {
        await itemDefaults.load(
          trx,
          treeItemIds(jobMethodTree, supersessionRedirect)
        );
        // Delete existing jobMakeMethods, jobMaterials, and jobOperations for the target job
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMakeMethod")
                .where((eb) =>
                  eb.and([
                    eb("jobId", "=", targetJobId),
                    eb("parentMaterialId", "is not", null)
                  ])
                )
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMaterial")
                .where("jobId", "=", targetJobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("jobMaterial")
                .set({ jobOperationId: null })
                .where("jobId", "=", targetJobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("jobOperation")
                .where("jobId", "=", targetJobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve()
        ]);

        const insertedJobMaterialIds: string[] = [];
        await traverseJobMethodAsync(
          jobMethodTree,
          async (node: JobMethodTreeItem) => {
            const jobMaterialInserts: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
              [];
            const jobMakeMethodInserts: Database["public"]["Tables"]["jobMakeMethod"]["Insert"][] =
              [];

            // Get the total quantity for this node (parent level) to pass to children
            // This is estimated + scrap for Make parts (what children use for their target calculation)
            let nodeTotalForChildren: number;
            if (node.data.isRoot) {
              // Root: target = TARGET job quantity — the source job's own
              // quantity is irrelevant; the tree carries per-parent quantities.
              const rootScrapPercentage = await itemDefaults.scrapPercentage(
                trx,
                node.data.itemId
              );
              const rootTarget = targetJob.data?.quantity ?? 1;
              // Scrap applies to every method type (mirrors itemToJob)
              const rootScrapQuantity = scrapAllowance(
                rootTarget,
                rootScrapPercentage
              );
              const rootTotalWithScrap = rootTarget + rootScrapQuantity;
              const rootEstimatedQuantity =
                node.data.methodType === "Make to Order"
                  ? rootTarget
                  : rootTotalWithScrap;

              nodeTotalForChildren = rootTotalWithScrap;

              sourceMakeMethodIdToQuantities[sourceJobMakeMethod.data.id] = {
                targetQuantity: rootTarget,
                estimatedQuantity: rootEstimatedQuantity,
                totalWithScrap: rootTotalWithScrap
              };
            } else {
              // Non-root: get from stored quantities using parent's source jobMakeMethodId
              const parentSourceMakeMethodId =
                node.data.jobMaterialMakeMethodId;
              const parentQuantities =
                sourceMakeMethodIdToQuantities[parentSourceMakeMethodId ?? ""];
              // Children receive parent's total (estimated + scrap) for cascade
              nodeTotalForChildren = parentQuantities?.totalWithScrap ?? 1;
            }

            for await (const child of node.children) {
              // A zero-quantity Buy/Pick line is dropped from the copied job.
              // A made sub-assembly is left intact even at quantity 0: its
              // operations are copied by make method below and would reference
              // a make method that never got created if the row were removed.
              if (
                isZeroQuantity(child.data.quantity) &&
                child.data.methodType !== "Make to Order"
              ) {
                continue;
              }
              const sourceMaterial = sourceMaterialById.get(child.id);
              const newMaterialId = nanoid();
              sourceMaterialIdToJobMaterialId[child.id] = newMaterialId;

              // Resolve the supersession FIRST — see the note in
              // itemToJobMakeMethod's mapper. Every field below derives from
              // the post-swap item, so a field added later follows
              // automatically. Buy/Pick only — made sub-assemblies keep the
              // source job's structure (their successors' methods would have
              // to be re-exploded from the item side).
              const supersession = await resolveJobMaterialSupersession(
                trx,
                companyId,
                supersessionRedirect,
                {
                  itemId: child.data.itemId,
                  methodType: child.data.methodType
                }
              );
              const itemId = supersession?.itemId ?? child.data.itemId;
              const quantityPerParent =
                (child.data.quantity ?? 1) * (supersession?.factor ?? 1);

              // Get scrap percentage for this item
              const itemScrapPercentage = await itemDefaults.scrapPercentage(
                trx,
                itemId
              );

              // Calculate scrap quantities for this child material
              // Target = parent's total (including scrap) * quantity per parent
              const childTargetQuantity =
                nodeTotalForChildren * quantityPerParent;
              // Scrap applies to every method type (mirrors itemToJob)
              const childScrapQuantity = scrapAllowance(
                childTargetQuantity,
                itemScrapPercentage
              );
              const childTotalWithScrap =
                childTargetQuantity + childScrapQuantity;
              // For Make: estimatedQuantity is good quantity (without scrap)
              // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
              const childEstimatedQuantity =
                child.data.methodType === "Make to Order"
                  ? childTargetQuantity
                  : childTotalWithScrap;

              // Store quantities for this child's make method (if it has one)
              if (child.data.jobMaterialMakeMethodId) {
                sourceMakeMethodIdToQuantities[
                  child.data.jobMaterialMakeMethodId
                ] = {
                  targetQuantity: childTargetQuantity,
                  estimatedQuantity: childEstimatedQuantity,
                  totalWithScrap: childTotalWithScrap
                };
              }

              jobMaterialInserts.push({
                id: newMaterialId,
                jobId: targetJobId,
                itemId,
                itemType: supersession?.itemType ?? child.data.itemType,
                kit: child.data.kit,
                methodType: child.data.methodType,
                order: child.data.order,
                description:
                  supersession?.description ?? child.data.description,
                jobMakeMethodId:
                  child.data.jobMakeMethodId === sourceJobMakeMethod.data.id
                    ? targetJobMakeMethod.data.id
                    : sourceMakeMethodIdToJobMakeMethodId[
                        child.data.jobMakeMethodId
                      ]!,
                quantity: quantityPerParent,
                scrapQuantity: childScrapQuantity,
                estimatedQuantity: childEstimatedQuantity,
                itemScrapPercentage,
                substitutedFromItemId:
                  supersession?.substitutedFromItemId ?? null,
                substitutionFactor: supersession?.factor ?? null,
                // ALWAYS set, never conditionally spread — see the note in
                // quoteLineToJob: Kysely builds ONE column list per multi-row
                // insert, and `unitCost` is NOT NULL DEFAULT 0.
                unitCost: supersession
                  ? (supersession.unitCost ?? 0)
                  : (sourceMaterial?.unitCost ?? child.data.unitCost ?? 0),
                // The bin belongs to the post-swap item; an explicit bin on
                // the source job's line still wins.
                storageUnitId: await itemDefaults.storageUnitId(
                  trx,
                  itemId,
                  child.data.storageUnitId ?? undefined
                ),
                requiresBatchTracking:
                  supersession?.requiresBatchTracking ??
                  sourceMaterial?.requiresBatchTracking ??
                  false,
                requiresSerialTracking:
                  supersession?.requiresSerialTracking ??
                  sourceMaterial?.requiresSerialTracking ??
                  false,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                companyId,
                createdBy: userId,
                customFields: {}
              });

              if (child.data.jobMaterialMakeMethodId) {
                const newMakeMethodId = nanoid();
                sourceMakeMethodIdToJobMakeMethodId[
                  child.data.jobMaterialMakeMethodId
                ] = newMakeMethodId;
                jobMakeMethodInserts.push({
                  id: newMakeMethodId,
                  jobId: targetJobId,
                  parentMaterialId: sourceMaterialIdToJobMaterialId[child.id],
                  itemId: child.data.itemId,
                  quantityPerParent: child.data.quantity,
                  companyId,
                  createdBy: userId
                });
              }
            }

            if (parts.billOfMaterial && jobMaterialInserts.length > 0) {
              // The supersession swap happens where each row is built, before
              // any field derives from the item — there is deliberately no
              // second pass here.
              await trx
                .insertInto("jobMaterial")
                .values(jobMaterialInserts)
                .execute();
              insertedJobMaterialIds.push(
                ...jobMaterialInserts.flatMap((m) => (m.id ? [m.id] : []))
              );
            }

            if (parts.billOfMaterial && jobMakeMethodInserts.length > 0) {
              await renameMakeMethods(trx, {
                table: "jobMakeMethod",
                companyId,
                scope: { column: "jobId", value: targetJobId },
                rows: jobMakeMethodInserts.map((insert) => ({
                  parentMaterialId: insert.parentMaterialId!,
                  id: insert.id!,
                  quantityPerParent: insert.quantityPerParent
                }))
              });
            }
          }
        );

        if (parts.billOfProcess) {
          const jobOperationInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
            sourceOperationRows.map((op) => {
              // Get quantities for this operation's SOURCE make method
              const opQuantities =
                sourceMakeMethodIdToQuantities[op.jobMakeMethodId ?? ""];
              // The traversal stores quantities for every make method in the
              // tree, so a miss means the operation references an orphaned
              // make method. Fail the conversion (rolls back the transaction)
              // instead of silently inserting a zero-quantity operation with
              // a NULL jobMakeMethodId.
              if (!opQuantities) {
                throw new Error(
                  `No quantities found for source job make method ${op.jobMakeMethodId} referenced by operation ${op.id} — the job method tree and its operations are out of sync`
                );
              }
              return {
                jobId: targetJobId,
                jobMakeMethodId:
                  op.jobMakeMethodId === sourceJobMakeMethod.data.id
                    ? targetJobMakeMethod.data.id
                    : sourceMakeMethodIdToJobMakeMethodId[op.jobMakeMethodId!],
                processId: op.processId,
                procedureId: op.procedureId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                // Carry the Assembly → BOP sync link so the MES can drive the
                // animated instruction player on the copied job.
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                operationSupplierProcessId: op.operationSupplierProcessId,
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                targetQuantity: opQuantities.targetQuantity,
                // Fractional targets flow through; the scrap allowance is already whole
                operationQuantity: opQuantities.totalWithScrap,
                companyId,
                createdBy: userId,
                customFields: {}
              };
            });

          if (jobOperationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("jobOperation")
              .values(jobOperationInserts)
              .returning(["id"])
              .execute();

            for (const [index, operation] of sourceOperationRows.entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                sourceOperationIdToJobOperationId[operation.id] = operationId;

                const {
                  jobOperationTool,
                  jobOperationParameter,
                  jobOperationStep,
                  procedureId
                } = operation;

                // Tool ids the assembly-instruction copy inserts itself, so
                // the source job's copies of the same tools are skipped below.
                let assemblyToolIds = new Set<string>();

                if (procedureId) {
                  await insertProcedureDataForJobOperation(trx, {
                    operationId,
                    procedureId,
                    companyId,
                    userId
                  });
                } else {
                  if (
                    parts.parameters &&
                    Array.isArray(jobOperationParameter) &&
                    jobOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationParameter")
                      .values(
                        jobOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (operation.assemblyInstructionId) {
                    // Assembly ops inherit their steps from the linked
                    // instruction (fresh from the live definition, as every
                    // *-ToJob path does); material ↔ step links are flushed
                    // after the jobMaterial rows exist.
                    assemblyToolIds = await insertAssemblyDataForJobOperation(
                      trx,
                      {
                        operationId,
                        assemblyInstructionId: operation.assemblyInstructionId,
                        companyId,
                        userId
                      }
                    );
                    assemblyOperationsToLink.push({
                      operationId,
                      assemblyInstructionId: operation.assemblyInstructionId
                    });
                  } else if (
                    parts.steps &&
                    Array.isArray(jobOperationStep) &&
                    jobOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("jobOperationStep")
                      .values(
                        jobOperationStep.map((step) => ({
                          operationId,
                          name: step.name,
                          type: step.type,
                          description: toTiptapDoc(step.description),
                          required: step.required,
                          sortOrder: step.sortOrder,
                          unitOfMeasureCode: step.unitOfMeasureCode,
                          minValue: step.minValue,
                          maxValue: step.maxValue,
                          listValues: step.listValues,
                          fileTypes: step.fileTypes,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    // Bulk insert preserves order, so insertedSteps[i] ↔
                    // jobOperationStep[i]: record old step -> new step so
                    // material/tool ↔ step links can be remapped below.
                    jobOperationStep.forEach((s, i) => {
                      const newStepId = insertedSteps[i]?.id;
                      if (s?.id && newStepId) {
                        sourceStepsToJobSteps[s.id] = newStepId;
                      }
                    });

                    await copyStepSlides(
                      trx,
                      jobOperationStep,
                      insertedSteps,
                      "jobOperationStepSlide",
                      "jobOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }

                // Tools after steps: the old-step -> new-step map is now
                // populated, so a tool scoped to steps carries those links via
                // jobOperationToolStep. Tools the assembly-instruction copy
                // already inserted are skipped (see above).
                const toolsToCopy = (
                  Array.isArray(jobOperationTool) ? jobOperationTool : []
                ).filter((tool) => !assemblyToolIds.has(tool.toolId));
                if (parts.tools && toolsToCopy.length > 0) {
                  const insertedTools = await trx
                    .insertInto("jobOperationTool")
                    .values(
                      toolsToCopy.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .returning(["id"])
                    .execute();

                  // Tool ↔ step links. Bulk insert preserves order, so
                  // insertedTools[i] ↔ toolsToCopy[i]. A tool with no links
                  // applies to the whole operation.
                  const toolStepRows = toolsToCopy.flatMap((tool, i) => {
                    const jobOperationToolId = insertedTools[i]?.id;
                    if (!jobOperationToolId) return [];
                    const oldStepIds = (
                      (tool.jobOperationToolStep ?? []) as Array<{
                        jobOperationStepId: string | null;
                      }>
                    ).map((l) => l.jobOperationStepId);
                    return remapStepIds(oldStepIds, sourceStepsToJobSteps).map(
                      (jobOperationStepId) => ({
                        jobOperationToolId,
                        jobOperationStepId
                      })
                    );
                  });
                  if (toolStepRows.length > 0) {
                    await trx
                      .insertInto("jobOperationToolStep")
                      .values(toolStepRows)
                      .execute();
                  }
                }
              }
            }
          }
        } // end if (parts.billOfProcess)

        // The links between materials and operations/steps can only be
        // rebuilt when BOTH sides were copied in this run — otherwise one end
        // of each link points at rows this copy never created.
        if (parts.billOfMaterial && parts.billOfProcess) {
          // Material ↔ operation links (jobMaterial.jobOperationId): the
          // materials were inserted during the traversal, before the
          // operations existed, so the link is applied as a second pass —
          // batched as one UPDATE per operation rather than one per material.
          const materialIdsByOperationId = new Map<string, string[]>();
          for (const sourceMaterial of sourceMaterialRows) {
            const newMaterialId =
              sourceMaterialIdToJobMaterialId[sourceMaterial.id];
            const newOperationId = sourceMaterial.jobOperationId
              ? sourceOperationIdToJobOperationId[sourceMaterial.jobOperationId]
              : undefined;
            if (newMaterialId && newOperationId) {
              const ids = materialIdsByOperationId.get(newOperationId) ?? [];
              ids.push(newMaterialId);
              materialIdsByOperationId.set(newOperationId, ids);
            }
          }
          const operationByMaterial = [...materialIdsByOperationId].flatMap(
            ([operationId, materialIds]) =>
              materialIds.map(
                (materialId) => sql`(${materialId}::text, ${operationId}::text)`
              )
          );
          for (const chunk of chunked(operationByMaterial)) {
            await sql`
                UPDATE "jobMaterial" AS t
                SET "jobOperationId" = v."operationId"
                FROM (VALUES ${sql.join(chunk)}) AS v("materialId", "operationId")
                WHERE t."id" = v."materialId" AND t."companyId" = ${companyId}
              `.execute(trx);
          }

          // Material ↔ step links (jobMaterialStep), remapped onto the new
          // material and step ids. Links to procedure/assembly-materialized
          // steps drop out of the map (assembly links are rebuilt from the
          // instruction by linkAssemblyStepMaterialsForJobOperations below).
          const materialStepRows = sourceMaterialRows.flatMap(
            (sourceMaterial) => {
              const newMaterialId =
                sourceMaterialIdToJobMaterialId[sourceMaterial.id];
              if (!newMaterialId) return [];
              return (sourceMaterial.jobMaterialStep ?? []).flatMap((link) => {
                const newStepId = link.jobOperationStepId
                  ? sourceStepsToJobSteps[link.jobOperationStepId]
                  : undefined;
                return newStepId
                  ? [
                      {
                        jobMaterialId: newMaterialId,
                        jobOperationStepId: newStepId,
                        quantity: link.quantity
                      }
                    ]
                  : [];
              });
            }
          );
          if (materialStepRows.length > 0) {
            await trx
              .insertInto("jobMaterialStep")
              .values(materialStepRows)
              .execute();
          }
        }

        // Materials were inserted before operations in this direction, so the
        // assembly material ↔ step links can flush immediately.
        await linkAssemblyStepMaterialsForJobOperations(
          trx,
          assemblyOperationsToLink,
          companyId
        );

        await settleConsumeFirstLines({
          trx,
          companyId,
          jobId: targetJobId,
          jobMaterialIds: insertedJobMaterialIds,
          locationId: targetJob.data?.locationId,
          asOfDate: jobBuildDate(targetJob.data)
        });
      });

      break;
    }
    case "makeMethodToMakeMethod": {
      const [sourceMakeMethod, targetMakeMethod] = await inOrder([
        () => single(db, "makeMethod", { id: sourceId, companyId }),
        () => single(db, "makeMethod", { id: targetId, companyId })
      ]);
      if (sourceMakeMethod.error || targetMakeMethod.error) {
        throw new Error("Failed to get make methods");
      }

      const [sourceMaterials, sourceOperations] = await inOrder([
        () =>
          parts.billOfMaterial
            ? many(db, "methodMaterial", {
                makeMethodId: sourceMakeMethod.data.id,
                companyId
              })
            : Promise.resolve({ data: [], error: null }),
        () =>
          parts.billOfProcess
            ? many<
                "methodOperation",
                Tables["methodOperation"]["Row"] & {
                  methodOperationTool: Tables["methodOperationTool"]["Row"][];
                  methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
                  methodOperationStep: Tables["methodOperationStep"]["Row"][];
                }
              >(
                db,
                "methodOperation",
                { makeMethodId: sourceMakeMethod.data.id, companyId },
                {
                  embed: {
                    methodOperationTool: {
                      table: "methodOperationTool",
                      on: "operationId"
                    },
                    methodOperationParameter: {
                      table: "methodOperationParameter",
                      on: "operationId"
                    },
                    methodOperationStep: {
                      table: "methodOperationStep",
                      on: "operationId"
                    }
                  }
                }
              )
            : Promise.resolve({ data: [], error: null })
      ]);

      if (sourceMaterials.error || sourceOperations.error) {
        throw new Error("Failed to get source materials or operations");
      }

      // A new version inserts its header in a transaction and copies inside
      // it, so a failed copy leaves no empty version behind.
      await withTransaction(db, async (trx) => {
        // The lines about to be replaced, whose configuration rules go with them.
        const [targetMaterialIds, targetOperationIds] = await Promise.all([
          trx
            .selectFrom("methodMaterial")
            .select("id")
            .where("makeMethodId", "=", targetMakeMethod.data.id)
            .where("companyId", "=", companyId)
            .execute()
            .then((rows) => rows.map((row) => row.id)),
          trx
            .selectFrom("methodOperation")
            .select("id")
            .where("makeMethodId", "=", targetMakeMethod.data.id)
            .where("companyId", "=", companyId)
            .execute()
            .then((rows) => rows.map((row) => row.id))
        ]);

        // Delete existing materials and operations from target method
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("methodMaterial")
                .where("makeMethodId", "=", targetMakeMethod.data.id)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("methodOperation")
                .where("makeMethodId", "=", targetMakeMethod.data.id)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve()
        ]);

        // Operations first, so each copied BOM line can point at the copied
        // operation that consumes it, not at the source method's operation.
        const operationIdMap = new Map<string, string>();
        if (
          parts.billOfProcess &&
          sourceOperations.data &&
          sourceOperations.data.length > 0
        ) {
          const operationIds = await trx
            .insertInto("methodOperation")
            .values(
              sourceOperations.data.map(
                ({
                  methodOperationTool: _tools,
                  methodOperationParameter: _parameters,
                  methodOperationStep: _attributes,
                  ...operation
                }) => {
                  const insert = {
                    ...operation,
                    id: undefined, // Let the database generate a new ID
                    makeMethodId: targetMakeMethod.data.id,
                    createdBy: userId
                  };
                  if (!parts.workInstructions) {
                    insert.workInstruction = {};
                  }
                  return insert;
                }
              )
            )
            .returning(["id"])
            .execute();
          sourceOperations.data.forEach((operation, index) => {
            const id = operationIds[index]?.id;
            if (operation.id && id) operationIdMap.set(operation.id, id);
          });

          for await (const [
            index,
            operation
          ] of sourceOperations.data.entries()) {
            const {
              methodOperationTool,
              methodOperationParameter,
              methodOperationStep,
              procedureId
            } = operation;
            const operationId = operationIds[index]!.id;

            if (
              parts.tools &&
              operationId &&
              Array.isArray(methodOperationTool) &&
              methodOperationTool.length > 0
            ) {
              await trx
                .insertInto("methodOperationTool")
                .values(
                  methodOperationTool.map((tool) => ({
                    toolId: tool.toolId,
                    quantity: tool.quantity,
                    operationId,
                    companyId,
                    createdBy: userId
                  }))
                )
                .execute();
            }

            if (!procedureId) {
              if (
                parts.parameters &&
                Array.isArray(methodOperationParameter) &&
                methodOperationParameter.length > 0
              ) {
                await trx
                  .insertInto("methodOperationParameter")
                  .values(
                    methodOperationParameter.map((param) => ({
                      operationId: operationId!,
                      key: param.key,
                      value: param.value,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .execute();
              }

              if (
                parts.steps &&
                // Assembly ops inherit steps from the linked instruction —
                // never copy (possibly stale) template steps alongside it.
                !operation.assemblyInstructionId &&
                Array.isArray(methodOperationStep) &&
                methodOperationStep.length > 0
              ) {
                const insertedSteps = await trx
                  .insertInto("methodOperationStep")
                  .values(
                    methodOperationStep.map(({ id: _id, ...attribute }) => ({
                      ...attribute,
                      description: toTiptapDoc(attribute.description),
                      operationId: operationId!,
                      companyId,
                      createdBy: userId
                    }))
                  )
                  .returning(["id"])
                  .execute();

                await copyStepSlides(
                  trx,
                  methodOperationStep,
                  insertedSteps,
                  "methodOperationStepSlide",
                  "methodOperationStepSlide",
                  companyId,
                  userId
                );
              }
            }
          }
        }
        // Copy materials from source to target, dropping any zero-quantity
        // BOM lines.
        const materialsToCopy = (
          (sourceMaterials.data ??
            []) as Database["public"]["Tables"]["methodMaterial"]["Row"][]
        ).filter((material) => !isZeroQuantity(material.quantity));
        const materialIdMap = new Map<string, string>();
        if (parts.billOfMaterial && materialsToCopy.length > 0) {
          const materialIds = await trx
            .insertInto("methodMaterial")
            .values(
              materialsToCopy.map((material) => ({
                ...material,
                productionQuantity: undefined,
                id: undefined, // Let the database generate a new ID
                makeMethodId: targetMakeMethod.data.id,
                // Without the bill of process the source's operations were not
                // copied, so no operation on the target is known to consume it.
                methodOperationId: material.methodOperationId
                  ? (operationIdMap.get(material.methodOperationId) ?? null)
                  : null,
                createdBy: userId
              }))
            )
            .returning(["id"])
            .execute();
          materialsToCopy.forEach((material, index) => {
            const id = materialIds[index]?.id;
            if (id) materialIdMap.set(material.id, id);
          });
        }

        // Configuration rules are keyed by method line and operation ids:
        // follow the copied lines, and drop the rules of the lines replaced.
        await copyConfigurationRules(trx, {
          sourceItemId: sourceMakeMethod.data.itemId,
          targetItemId: targetMakeMethod.data.itemId,
          replacedIds: [
            ...(parts.billOfMaterial ? targetMaterialIds : []),
            ...(parts.billOfProcess ? targetOperationIds : [])
          ],
          idMap: new Map([
            [sourceMakeMethod.data.id, targetMakeMethod.data.id],
            ...materialIdMap,
            ...operationIdMap
          ]),
          companyId,
          userId
        });
      });
      break;
    }
    case "procedureToOperation": {
      const procedureId = sourceId;
      const operationId = targetId;
      if (!procedureId) {
        throw new Error("Invalid sourceId");
      }

      if (!operationId) {
        throw new Error("Invalid targetId");
      }

      const [procedure, operation] = await inOrder([
        () =>
          single<
            "procedure",
            Tables["procedure"]["Row"] & {
              procedureStep: Tables["procedureStep"]["Row"][];
              procedureParameter: Tables["procedureParameter"]["Row"][];
            }
          >(
            db,
            "procedure",
            { id: procedureId, companyId },
            {
              embed: {
                procedureStep: { table: "procedureStep", on: "procedureId" },
                procedureParameter: {
                  table: "procedureParameter",
                  on: "procedureId"
                }
              }
            }
          ),
        () =>
          single<
            "jobOperation",
            Tables["jobOperation"]["Row"] & {
              jobOperationStep: Tables["jobOperationStep"]["Row"][];
            }
          >(
            db,
            "jobOperation",
            { id: operationId, companyId },
            {
              embed: {
                jobOperationStep: {
                  table: "jobOperationStep",
                  on: "operationId"
                }
              }
            }
          )
      ]);

      if (procedure.error) {
        throw new Error("Failed to get procedure");
      }

      if (operation.error) {
        throw new Error("Failed to get operation");
      }

      const existingSteps = operation.data?.jobOperationStep ?? [];

      await withTransaction(db, async (trx) => {
        // Update or delete existing attributes
        for (const existingStep of existingSteps) {
          const matchingProcedureStep = procedure.data.procedureStep.find(
            (pa) =>
              pa.name === existingStep.name && pa.type === existingStep.type
          );

          if (matchingProcedureStep) {
            // Update matching attribute
            await trx
              .updateTable("jobOperationStep")
              .set({
                description: matchingProcedureStep.description,
                minValue: matchingProcedureStep.minValue,
                maxValue: matchingProcedureStep.maxValue,
                updatedAt: datetime.timestamp(),
                updatedBy: userId
              })
              .where("id", "=", existingStep.id)
              .where("companyId", "=", companyId)
              .execute();
          } else {
            // Delete non-matching attribute
            await trx
              .deleteFrom("jobOperationStep")
              .where("id", "=", existingStep.id)
              .where("companyId", "=", companyId)
              .execute();
          }
        }

        // Delete all existing parameters
        await trx
          .deleteFrom("jobOperationParameter")
          .where("operationId", "=", operationId)
          .where("companyId", "=", companyId)
          .execute();

        // Add new attributes that don't exist yet
        const newSteps = procedure.data.procedureStep.filter(
          (pa) =>
            !existingSteps.some(
              (ea) => ea.name === pa.name && ea.type === pa.type
            )
        );

        if (newSteps.length > 0) {
          await trx
            .insertInto("jobOperationStep")
            .values(
              newSteps.map((attr) => ({
                operationId: operationId,
                name: attr.name,
                type: attr.type,
                description: toTiptapDoc(attr.description),
                minValue: attr.minValue,
                maxValue: attr.maxValue,
                companyId,
                createdBy: userId,
                updatedBy: userId
              }))
            )
            .execute();
        }

        // Add all parameters from procedure
        if (procedure.data.procedureParameter.length > 0) {
          await trx
            .insertInto("jobOperationParameter")
            .values(
              procedure.data.procedureParameter.map((param) => ({
                operationId: operationId,
                companyId,
                key: param.key,
                value: param.value,
                createdBy: userId,
                updatedBy: userId
              }))
            )
            .execute();
        }

        // update work instruction
        await trx
          .updateTable("jobOperation")
          .set({
            workInstruction: toJson(procedure.data.content),
            procedureId: procedureId
          })
          .where("id", "=", operationId)
          .where("companyId", "=", companyId)
          .execute();
      });
      break;
    }
    case "quoteLineToItem": {
      const [quoteId, quoteLineId] = (sourceId as string).split(":");
      if (!quoteId || !quoteLineId) {
        throw new Error("Invalid sourceId");
      }
      const makeMethodId = targetId;

      const [makeMethod, quoteMakeMethod, quoteOperations] = await inOrder([
        () => single(db, "makeMethod", { id: makeMethodId, companyId }),
        () =>
          single(db, "quoteMakeMethod", {
            quoteLineId,
            parentMaterialId: isNull,
            companyId
          }),
        () =>
          many<
            "quoteOperationsWithMakeMethods",
            Views["quoteOperationsWithMakeMethods"]["Row"] & {
              quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
              quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
              quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
            }
          >(
            db,
            "quoteOperationsWithMakeMethods",
            { quoteLineId, companyId },
            {
              embed: {
                quoteOperationTool: {
                  table: "quoteOperationTool",
                  on: "operationId"
                },
                quoteOperationParameter: {
                  table: "quoteOperationParameter",
                  on: "operationId"
                },
                quoteOperationStep: {
                  table: "quoteOperationStep",
                  on: "operationId"
                }
              }
            }
          )
      ]);

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (quoteMakeMethod.error) {
        throw new Error("Failed to get quote make method");
      }

      if (quoteOperations.error) {
        throw new Error("Failed to get quote operations");
      }

      const itemId = makeMethod.data?.itemId;

      const [quote, quoteMethodTrees, itemReplenishment] = await inOrder([
        () => single(db, "quote", { id: quoteId, companyId }),
        () => getQuoteMethodTree(db, quoteMakeMethod.data.id),
        () => single(db, "itemReplenishment", { itemId, companyId })
      ]);

      if (quoteMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      if (itemReplenishment.error) {
        throw new Error("Failed to get item replenishment");
      }

      if (itemReplenishment.data?.requiresConfiguration) {
        throw new Error("Cannot override method of configured item");
      }

      const quoteMethodTree = quoteMethodTrees.data?.[0] as QuoteMethodTreeItem;
      if (!quoteMethodTree) throw new NotFoundError("Method tree not found");

      const madeItemIds: string[] = [];

      await traverseQuoteMethod(
        quoteMethodTree,
        (node: QuoteMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make to Order") {
            madeItemIds.push(node.data.itemId);
          }
        }
      );

      const makeMethods = await many(db, "activeMakeMethods", {
        itemId: madeItemIds,
        companyId
      });
      if (makeMethods.error) {
        throw new Error("Failed to get make methods");
      }

      const makeMethodByItemId: Record<string, string> = {};
      makeMethods.data?.forEach((m) => {
        if (m.itemId) {
          // @ts-expect-error - itemId is not null
          makeMethodByItemId[m.itemId!] = m.id;
        }
      });

      await withTransaction(db, async (trx) => {
        let makeMethodsToDelete: string[] = [];
        const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
          [];
        const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
          [];

        await traverseQuoteMethod(
          quoteMethodTree,
          (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make to Order") {
              makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
            }

            node.children.forEach((child) => {
              // A zero-quantity BOM line is dropped from the saved method.
              if (isZeroQuantity(child.data.quantity)) return;
              materialInserts.push({
                makeMethodId: makeMethodByItemId[node.data.itemId]!,
                materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                itemId: child.data.itemId,
                itemType: child.data.itemType,
                kit: child.data.kit,
                methodType: child.data.methodType,
                order: child.data.order,
                quantity: child.data.quantity,
                storageUnitIds: quote.data?.locationId
                  ? // @ts-ignore: storageUnitIds is a dynamic object with location keys
                    {
                      [quote.data.locationId]: child.data.storageUnitId || null
                    }
                  : {},
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });
          }
        );

        if (makeMethodsToDelete.length > 0) {
          makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
            mm === makeMethodByItemId[quoteMakeMethod.data.itemId]
              ? makeMethod.data.id
              : mm
          );
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("methodOperation")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);
        }

        if (parts.billOfMaterial && materialInserts.length > 0) {
          await trx
            .insertInto("methodMaterial")
            .values(
              materialInserts.map((insert) => ({
                ...insert,
                productionQuantity: undefined,
                makeMethodId:
                  insert.makeMethodId ===
                  makeMethodByItemId[quoteMakeMethod.data.itemId]
                    ? makeMethod.data.id
                    : insert.makeMethodId,
                itemId:
                  insert.itemId === quoteMakeMethod.data.itemId
                    ? itemId
                    : insert.itemId
              }))
            )
            .execute();
        }

        if (parts.billOfProcess) {
          quoteOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              operationType: op.operationType ?? "Process",
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              companyId,
              createdBy: userId,
              customFields: {}
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId
                }))
              )
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              quoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                  procedureId
                } = operation;

                if (
                  parts.tools &&
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (!procedureId) {
                  if (
                    parts.parameters &&
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    parts.steps &&
                    // Assembly ops inherit steps from the linked instruction —
                    // never copy (possibly stale) quote steps alongside it.
                    !operation.assemblyInstructionId &&
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("methodOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
                          description: toTiptapDoc(attribute.description),
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      quoteOperationStep,
                      insertedSteps,
                      "quoteOperationStepSlide",
                      "methodOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          }
        } // end if (parts.billOfProcess)
      });

      break;
    }
    case "quoteMakeMethodToItem": {
      const quoteMakeMethodId = sourceId;
      const makeMethodId = targetId;

      const [makeMethod, quoteMakeMethod] = await inOrder([
        () => single(db, "makeMethod", { id: makeMethodId, companyId }),
        () =>
          single(db, "quoteMakeMethod", { id: quoteMakeMethodId, companyId })
      ]);

      if (makeMethod.error) {
        throw new Error("Failed to get make method");
      }

      if (quoteMakeMethod.error) {
        throw new Error("Failed to get quote make method");
      }

      const itemId = makeMethod.data?.itemId;

      const [quoteOperations, itemReplenishment] = await inOrder([
        () =>
          many<
            "quoteOperationsWithMakeMethods",
            Views["quoteOperationsWithMakeMethods"]["Row"] & {
              quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
              quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
              quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
            }
          >(
            db,
            "quoteOperationsWithMakeMethods",
            { quoteLineId: quoteMakeMethod.data.quoteLineId, companyId },
            {
              embed: {
                quoteOperationTool: {
                  table: "quoteOperationTool",
                  on: "operationId"
                },
                quoteOperationParameter: {
                  table: "quoteOperationParameter",
                  on: "operationId"
                },
                quoteOperationStep: {
                  table: "quoteOperationStep",
                  on: "operationId"
                }
              }
            }
          ),
        () => single(db, "itemReplenishment", { itemId, companyId })
      ]);

      if (quoteOperations.error) {
        throw new Error("Failed to get quote operations");
      }

      if (itemReplenishment.error) {
        throw new Error("Failed to get item replenishment");
      }

      if (itemReplenishment.data?.requiresConfiguration) {
        throw new Error("Cannot override method of configured item");
      }

      const [quoteMethodTrees] = await inOrder([
        () =>
          getQuoteMethodTree(
            db,
            quoteMakeMethodId,
            quoteMakeMethod.data.parentMaterialId
          )
      ]);

      if (quoteMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      if (quoteMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const quoteMethodTree = quoteMethodTrees.data?.[0] as QuoteMethodTreeItem;
      if (!quoteMethodTree)
        throw new NotFoundError("Job method tree not found");

      const madeItemIds: string[] = [];

      // Awaited: the walk is async, and without it only the root had been
      // visited when the make methods below were read, so a sub-assembly
      // inside this one had no make method to save its materials under.
      await traverseQuoteMethod(
        quoteMethodTree,
        (node: QuoteMethodTreeItem) => {
          if (node.data.itemId && node.data.methodType === "Make to Order") {
            madeItemIds.push(node.data.itemId);
          }
        }
      );

      const makeMethods = await many(db, "activeMakeMethods", {
        itemId: madeItemIds,
        companyId
      });
      if (makeMethods.error) {
        throw new Error("Failed to get make methods");
      }

      const makeMethodByItemId: Record<string, string> = {};
      makeMethods.data?.forEach((m) => {
        if (m.itemId) {
          // @ts-expect-error - itemId is not null
          makeMethodByItemId[m.itemId!] = m.id;
        }
      });

      await withTransaction(db, async (trx) => {
        let makeMethodsToDelete: string[] = [];
        const materialInserts: Database["public"]["Tables"]["methodMaterial"]["Insert"][] =
          [];
        const operationInserts: Database["public"]["Tables"]["methodOperation"]["Insert"][] =
          [];

        await traverseQuoteMethod(
          quoteMethodTree!,
          (node: QuoteMethodTreeItem) => {
            if (node.data.itemId && node.data.methodType === "Make to Order") {
              makeMethodsToDelete.push(makeMethodByItemId[node.data.itemId]!);
            }

            node.children.forEach((child) => {
              // A zero-quantity BOM line is dropped from the saved method.
              if (isZeroQuantity(child.data.quantity)) return;
              materialInserts.push({
                makeMethodId: makeMethodByItemId[node.data.itemId]!,
                materialMakeMethodId: makeMethodByItemId[child.data.itemId],
                itemId: child.data.itemId,
                kit: child.data.kit,
                itemType: child.data.itemType,
                methodType: child.data.methodType,
                order: child.data.order,
                quantity: child.data.quantity,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                companyId,
                createdBy: userId,
                customFields: {}
              });
            });
          }
        );

        if (makeMethodsToDelete.length > 0) {
          makeMethodsToDelete = makeMethodsToDelete.map((mm) =>
            mm === makeMethodByItemId[quoteMakeMethod.data.itemId]
              ? makeMethod.data.id
              : mm
          );
          await Promise.all([
            parts.billOfMaterial
              ? trx
                  .deleteFrom("methodMaterial")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve(),
            parts.billOfProcess
              ? trx
                  .deleteFrom("methodOperation")
                  .where("makeMethodId", "in", makeMethodsToDelete)
                  .where("companyId", "=", companyId)
                  .execute()
              : Promise.resolve()
          ]);
        }

        if (parts.billOfMaterial && materialInserts.length > 0) {
          await trx
            .insertInto("methodMaterial")
            .values(
              materialInserts.map((insert) => ({
                ...insert,
                productionQuantity: undefined,
                makeMethodId:
                  insert.makeMethodId ===
                  makeMethodByItemId[quoteMakeMethod.data.itemId]
                    ? makeMethod.data.id
                    : insert.makeMethodId,
                itemId:
                  insert.itemId === quoteMakeMethod.data.itemId
                    ? itemId
                    : insert.itemId
              }))
            )
            .execute();
        }

        if (parts.billOfProcess) {
          quoteOperations.data?.forEach((op) => {
            operationInserts.push({
              makeMethodId: op.makeMethodId!,
              processId: op.processId!,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              workCenterId: op.workCenterId,
              description: op.description ?? "",
              setupTime: op.setupTime ?? 0,
              setupUnit: op.setupUnit ?? "Total Minutes",
              laborTime: op.laborTime ?? 0,
              laborUnit: op.laborUnit ?? "Minutes/Piece",
              machineTime: op.machineTime ?? 0,
              machineUnit: op.machineUnit ?? "Minutes/Piece",
              order: op.order ?? 1,
              operationOrder: op.operationOrder ?? "After Previous",
              operationType: op.operationType ?? "Process",
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              companyId,
              createdBy: userId,
              customFields: {}
            });
          });

          if (operationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("methodOperation")
              .values(
                operationInserts.map((insert) => ({
                  ...insert,
                  makeMethodId:
                    insert.makeMethodId ===
                    makeMethodByItemId[quoteMakeMethod.data.itemId]
                      ? makeMethod.data.id
                      : insert.makeMethodId
                }))
              )
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              quoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                  procedureId
                } = operation;

                if (
                  parts.tools &&
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("methodOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (!procedureId) {
                  if (
                    parts.parameters &&
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("methodOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (
                    parts.steps &&
                    // Assembly ops inherit steps from the linked instruction —
                    // never copy (possibly stale) quote steps alongside it.
                    !operation.assemblyInstructionId &&
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("methodOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
                          description: toTiptapDoc(attribute.description),
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      quoteOperationStep,
                      insertedSteps,
                      "quoteOperationStepSlide",
                      "methodOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          }
        } // end if (parts.billOfProcess)
      });

      break;
    }
    case "quoteLineToJob": {
      const jobId = targetId;
      if (!jobId) {
        throw new Error("Invalid targetId");
      }

      const [quoteId, quoteLineId] = (sourceId as string).split(":");
      if (!quoteId || !quoteLineId) {
        throw new Error("Invalid sourceId");
      }
      // Assembly ops whose steps were materialized from an instruction —
      // material ↔ step links flush after the jobMaterial rows exist.
      const assemblyOperationsToLink: Array<{
        operationId: string;
        assemblyInstructionId: string;
      }> = [];

      const job = await single(db, "job", { id: jobId, companyId });
      const jobMakeMethod = await single(db, "jobMakeMethod", {
        jobId,
        parentMaterialId: isNull,
        companyId
      });
      const quoteMakeMethod = await single(db, "quoteMakeMethod", {
        parentMaterialId: isNull,
        quoteLineId,
        companyId
      });
      const quoteMaterials = await many(db, "quoteMaterial", {
        quoteLineId,
        companyId
      });
      const quoteOperations = await many<
        "quoteOperation",
        QuoteOperationWithDetails
      >(
        db,
        "quoteOperation",
        { quoteLineId, companyId },
        { embed: quoteOperationDetails }
      );

      if (job.error) {
        throw new Error("Failed to get job");
      }

      if (jobMakeMethod.error || !jobMakeMethod.data) {
        throw new Error("Failed to get job make method");
      }

      if (
        quoteMakeMethod.error ||
        quoteMaterials.error ||
        quoteOperations.error
      ) {
        if (quoteMakeMethod.error) {
          getMethodLogger.error("quoteMakeMethodError", {
            error: quoteMakeMethod.error
          });
        }
        if (quoteMaterials.error) {
          getMethodLogger.error("quoteMaterialsError", {
            error: quoteMaterials.error
          });
        }
        if (quoteOperations.error) {
          getMethodLogger.error("quoteOperationsError", {
            error: quoteOperations.error
          });
        }
        throw new Error("Failed to fetch quote data");
      }

      const quoteMethodTrees = await getQuoteMethodTree(
        db,
        quoteMakeMethod.data.id
      );

      if (quoteMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const quoteMethodTree = quoteMethodTrees.data?.[0] as QuoteMethodTreeItem;
      if (!quoteMethodTree) throw new NotFoundError("Method tree not found");

      // Loaded ONCE per request, before the transaction — as itemToJob does.
      // This read pages the company's whole itemSupersession table, and it used
      // to sit inside the per-node traverseQuoteMethod callback, so a BOM of N
      // nodes issued N full-table reads sequentially inside the transaction
      // holding the pool's single connection. The map depends only on the
      // company and the job's build date, both fixed for the request.
      const { redirect: supersessionRedirect } = await loadSupersessionRedirect(
        db,
        companyId,
        job.data
      );
      const itemDefaults = createItemDefaults(companyId, job.data.locationId);

      const quoteMaterialIdToJobMaterialId: Record<string, string> = {};
      const quoteMakeMethodIdToJobMakeMethodId: Record<string, string> = {};
      // Track estimated quantities for each make method to set on operations
      const quoteMakeMethodIdToQuantities: Record<
        string,
        {
          targetQuantity: number;
          estimatedQuantity: number;
          totalWithScrap: number;
        }
      > = {};

      await withTransaction(db, async (trx) => {
        await itemDefaults.load(
          trx,
          treeItemIds(quoteMethodTree, supersessionRedirect)
        );
        // Delete existing jobMakeMethods, jobMaterials, and jobOperations for this job
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMakeMethod")
                .where((eb) =>
                  eb.and([
                    eb("jobId", "=", jobId),
                    eb("parentMaterialId", "is not", null)
                  ])
                )
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfMaterial
            ? trx
                .deleteFrom("jobMaterial")
                .where("jobId", "=", jobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("jobMaterial")
                .set({ jobOperationId: null })
                .where("jobId", "=", jobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("jobOperation")
                .where("jobId", "=", jobId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve()
        ]);

        const insertedJobMaterialIds: string[] = [];
        await traverseQuoteMethod(
          quoteMethodTree,
          async (node: QuoteMethodTreeItem) => {
            const jobMaterialInserts: Database["public"]["Tables"]["jobMaterial"]["Insert"][] =
              [];
            const jobMakeMethodInserts: Database["public"]["Tables"]["jobMakeMethod"]["Insert"][] =
              [];

            // Get the total quantity for this node (parent level) to pass to children
            // This is estimated + scrap for Make parts (what children use for their target calculation)
            let nodeTotalForChildren: number;
            if (node.data.isRoot) {
              // Root: target = job quantity, calculate scrap and total
              const rootScrapPercentage = await itemDefaults.scrapPercentage(
                trx,
                node.data.itemId
              );
              const rootTarget = job.data?.quantity ?? 1;
              // Scrap applies to every method type (mirrors itemToJob)
              const rootScrapQuantity = scrapAllowance(
                rootTarget,
                rootScrapPercentage
              );
              const rootTotalWithScrap = rootTarget + rootScrapQuantity;
              // For Make: estimatedQuantity is good quantity (without scrap)
              // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
              const rootEstimatedQuantity =
                node.data.methodType === "Make to Order"
                  ? rootTarget
                  : rootTotalWithScrap;

              nodeTotalForChildren = rootTotalWithScrap;

              // Store root quantities
              quoteMakeMethodIdToQuantities[quoteMakeMethod.data.id] = {
                targetQuantity: rootTarget,
                estimatedQuantity: rootEstimatedQuantity,
                totalWithScrap: rootTotalWithScrap
              };
            } else {
              // Non-root: get from stored quantities using parent's quoteMakeMethodId
              const parentQuoteMakeMethodId =
                node.data.quoteMaterialMakeMethodId;
              const parentQuantities =
                quoteMakeMethodIdToQuantities[parentQuoteMakeMethodId ?? ""];
              // Children receive parent's total (estimated + scrap) for cascade
              nodeTotalForChildren = parentQuantities?.totalWithScrap ?? 1;
            }

            for await (const child of node.children) {
              // A zero-quantity Buy/Pick line is dropped from the created job.
              // A made sub-assembly is left intact even at quantity 0: its
              // operations are copied by make method below and would reference
              // a make method that never got created if the row were removed.
              if (
                isZeroQuantity(child.data.quantity) &&
                child.data.methodType !== "Make to Order"
              ) {
                continue;
              }
              const newMaterialId = nanoid();
              quoteMaterialIdToJobMaterialId[child.id] = newMaterialId;

              // Resolve the supersession FIRST — see the note in
              // itemToJobMakeMethod's mapper. Deriving the scrap rate, bin and
              // quantities from the pre-swap item and patching the row
              // afterwards is what left swapped lines costing the
              // predecessor's scrap; swapping up front means every field here,
              // and any field added later, is computed for the item the row
              // ends up being for. Buy/Pick only — made sub-assemblies are not
              // swapped on the quote path at all (their successors' methods
              // would have to be re-exploded from the item side).
              const supersession = await resolveJobMaterialSupersession(
                trx,
                companyId,
                supersessionRedirect,
                {
                  itemId: child.data.itemId,
                  methodType: child.data.methodType
                }
              );
              const itemId = supersession?.itemId ?? child.data.itemId;
              const quantityPerParent =
                (child.data.quantity ?? 1) * (supersession?.factor ?? 1);

              // Get scrap percentage for this item
              const itemScrapPercentage = await itemDefaults.scrapPercentage(
                trx,
                itemId
              );

              // Calculate scrap quantities for this child material
              // Target = parent's total (including scrap) * quantity per parent
              const childTargetQuantity =
                nodeTotalForChildren * quantityPerParent;
              // Scrap applies to every method type (mirrors itemToJob)
              const childScrapQuantity = scrapAllowance(
                childTargetQuantity,
                itemScrapPercentage
              );
              const childTotalWithScrap =
                childTargetQuantity + childScrapQuantity;
              // For Make: estimatedQuantity is good quantity (without scrap)
              // For Buy/Pick: estimatedQuantity includes scrap since that's what we procure
              const childEstimatedQuantity =
                child.data.methodType === "Make to Order"
                  ? childTargetQuantity
                  : childTotalWithScrap;

              // Store quantities for this child's make method (if it has one)
              if (child.data.quoteMaterialMakeMethodId) {
                quoteMakeMethodIdToQuantities[
                  child.data.quoteMaterialMakeMethodId
                ] = {
                  targetQuantity: childTargetQuantity,
                  estimatedQuantity: childEstimatedQuantity,
                  totalWithScrap: childTotalWithScrap
                };
              }

              jobMaterialInserts.push({
                id: newMaterialId,
                jobId,
                itemId,
                itemType: supersession?.itemType ?? child.data.itemType,
                kit: child.data.kit,
                methodType: child.data.methodType,
                order: child.data.order,
                description:
                  supersession?.description ?? child.data.description,
                jobMakeMethodId:
                  child.data.quoteMakeMethodId === quoteMakeMethod.data.id
                    ? jobMakeMethod.data.id
                    : quoteMakeMethodIdToJobMakeMethodId[
                        child.data.quoteMakeMethodId
                      ]!,
                quantity: quantityPerParent,
                scrapQuantity: childScrapQuantity,
                estimatedQuantity: childEstimatedQuantity,
                itemScrapPercentage,
                substitutedFromItemId:
                  supersession?.substitutedFromItemId ?? null,
                substitutionFactor: supersession?.factor ?? null,
                // ALWAYS set, never conditionally spread. Kysely builds ONE
                // column list for a multi-row insert, so the moment a single
                // swapped row carries `unitCost` the column joins the statement
                // and every row that omitted the key is written NULL — and
                // `jobMaterial.unitCost` is NOT NULL DEFAULT 0, so the whole
                // insert fails. Omitting a key only reaches the default when NO
                // row in the batch has it.
                //
                // Branch on whether a swap happened, matching the other two
                // flows: a swapped row must not inherit the predecessor's cost,
                // and an unswapped one keeps the quote line's own. This path
                // never set the column before, so unswapped rows silently took
                // the 0 default even though the quote tree carries a cost.
                unitCost: supersession
                  ? (supersession.unitCost ?? 0)
                  : (child.data.unitCost ?? 0),
                // The bin belongs to the post-swap item; an explicit bin on the
                // quote line still wins.
                storageUnitId: await itemDefaults.storageUnitId(
                  trx,
                  itemId,
                  child.data.storageUnitId
                ),
                requiresBatchTracking:
                  supersession?.requiresBatchTracking ??
                  child.data.itemTrackingType === "Batch",
                requiresSerialTracking:
                  supersession?.requiresSerialTracking ??
                  child.data.itemTrackingType === "Serial",
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                companyId,
                createdBy: userId,
                customFields: {}
              });

              if (child.data.quoteMaterialMakeMethodId) {
                const newMakeMethodId = nanoid();
                quoteMakeMethodIdToJobMakeMethodId[
                  child.data.quoteMaterialMakeMethodId
                ] = newMakeMethodId;
                jobMakeMethodInserts.push({
                  id: newMakeMethodId,
                  jobId,
                  parentMaterialId: quoteMaterialIdToJobMaterialId[child.id],
                  itemId: child.data.itemId,
                  quantityPerParent: child.data.quantity,
                  companyId,
                  createdBy: userId
                });
              }
            }

            if (parts.billOfMaterial && jobMaterialInserts.length > 0) {
              // The supersession swap happens where each row is built, before
              // any field derives from the item — there is deliberately no
              // second pass here.
              await trx
                .insertInto("jobMaterial")
                .values(jobMaterialInserts)
                .execute();
              insertedJobMaterialIds.push(
                ...jobMaterialInserts.flatMap((m) => (m.id ? [m.id] : []))
              );
            }

            if (parts.billOfMaterial && jobMakeMethodInserts.length > 0) {
              await renameMakeMethods(trx, {
                table: "jobMakeMethod",
                companyId,
                scope: { column: "jobId", value: jobId },
                rows: jobMakeMethodInserts.map((insert) => ({
                  parentMaterialId: insert.parentMaterialId!,
                  id: insert.id!,
                  quantityPerParent: insert.quantityPerParent
                }))
              });
            }
          }
        );

        if (parts.billOfProcess) {
          const jobOperationInserts: Database["public"]["Tables"]["jobOperation"]["Insert"][] =
            quoteOperations.data.map((op) => {
              // Get quantities for this operation's make method
              const opQuantities =
                quoteMakeMethodIdToQuantities[op.quoteMakeMethodId ?? ""];
              // The traversal stores quantities for every make method in the
              // tree, so a miss means the operation references an orphaned
              // make method. Fail the conversion (rolls back the transaction)
              // instead of silently inserting a zero-quantity operation with
              // a NULL jobMakeMethodId.
              if (!opQuantities) {
                throw new Error(
                  `No quantities found for quote make method ${op.quoteMakeMethodId} referenced by operation ${op.id} — the quote method tree and its operations are out of sync`
                );
              }
              return {
                jobId,
                jobMakeMethodId:
                  op.quoteMakeMethodId === quoteMakeMethod.data.id
                    ? jobMakeMethod.data.id
                    : quoteMakeMethodIdToJobMakeMethodId[op.quoteMakeMethodId!],
                processId: op.processId,
                procedureId: op.procedureId,
                workCenterId: op.workCenterId,
                description: op.description,
                setupTime: op.setupTime,
                setupUnit: op.setupUnit,
                laborTime: op.laborTime,
                laborUnit: op.laborUnit,
                machineTime: op.machineTime,
                machineUnit: op.machineUnit,
                order: op.order,
                operationOrder: op.operationOrder,
                operationType: op.operationType,
                // Carry the Assembly → BOP sync link so the MES can drive the
                // animated instruction player on jobs made from a synced method.
                assemblyInstructionId: op.assemblyInstructionId,
                inspectionDocumentId: op.inspectionDocumentId,
                operationSupplierProcessId: op.operationSupplierProcessId,
                operationMinimumCost: op.operationMinimumCost ?? 0,
                operationLeadTime: op.operationLeadTime ?? 0,
                operationUnitCost: op.operationUnitCost ?? 0,
                tags: op.tags ?? [],
                workInstruction: toJson(
                  parts.workInstructions ? op.workInstruction : {}
                ),
                targetQuantity: opQuantities.targetQuantity,
                // Fractional targets flow through; the scrap allowance is already whole
                operationQuantity: opQuantities.totalWithScrap,
                companyId,
                createdBy: userId,
                customFields: {}
              };
            });

          if (jobOperationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("jobOperation")
              .values(jobOperationInserts)
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              quoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep,
                  procedureId
                } = operation;
                // abilities are not copied on this path (no quoteOperationAbility table)

                if (
                  parts.tools &&
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("jobOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (procedureId) {
                  await insertProcedureDataForJobOperation(trx, {
                    operationId,
                    procedureId,
                    companyId,
                    userId
                  });
                } else {
                  if (
                    parts.parameters &&
                    Array.isArray(quoteOperationParameter) &&
                    quoteOperationParameter.length > 0
                  ) {
                    await trx
                      .insertInto("jobOperationParameter")
                      .values(
                        quoteOperationParameter.map((param) => ({
                          operationId,
                          key: param.key,
                          value: param.value,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .execute();
                  }

                  if (operation.assemblyInstructionId) {
                    // Assembly ops inherit their steps from the linked
                    // instruction (the quote only carries the pointer);
                    // material ↔ step links are flushed after the jobMaterial
                    // rows exist.
                    await insertAssemblyDataForJobOperation(trx, {
                      operationId,
                      assemblyInstructionId: operation.assemblyInstructionId,
                      companyId,
                      userId
                    });
                    assemblyOperationsToLink.push({
                      operationId,
                      assemblyInstructionId: operation.assemblyInstructionId
                    });
                  } else if (
                    parts.steps &&
                    Array.isArray(quoteOperationStep) &&
                    quoteOperationStep.length > 0
                  ) {
                    const insertedSteps = await trx
                      .insertInto("jobOperationStep")
                      .values(
                        quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                          ...attribute,
                          description: toTiptapDoc(attribute.description),
                          operationId,
                          companyId,
                          createdBy: userId
                        }))
                      )
                      .returning(["id"])
                      .execute();

                    await copyStepSlides(
                      trx,
                      quoteOperationStep,
                      insertedSteps,
                      "quoteOperationStepSlide",
                      "jobOperationStepSlide",
                      companyId,
                      userId
                    );
                  }
                }
              }
            }
          }
        } // end if (parts.billOfProcess)

        // Materials were inserted before operations in this direction, so the
        // assembly material ↔ step links can flush immediately.
        await linkAssemblyStepMaterialsForJobOperations(
          trx,
          assemblyOperationsToLink,
          companyId
        );

        await settleConsumeFirstLines({
          trx,
          companyId,
          jobId: jobId,
          jobMaterialIds: insertedJobMaterialIds,
          locationId: job.data?.locationId,
          asOfDate: jobBuildDate(job.data)
        });
      });

      break;
    }
    case "quoteLineToQuoteLine": {
      const [, sourceQuoteLineId] = (sourceId as string).split(":");
      const [targetQuoteId, targetQuoteLineId] = (targetId as string).split(
        ":"
      );
      if (!sourceQuoteLineId || !targetQuoteId || !targetQuoteLineId) {
        throw new Error("Invalid sourceId or targetId");
      }

      const [
        targetQuoteMakeMethod,
        sourceQuoteMakeMethod,
        sourceQuoteMaterials,
        sourceQuoteOperations
      ] = await inOrder([
        () =>
          single(db, "quoteMakeMethod", {
            quoteLineId: targetQuoteLineId,
            parentMaterialId: isNull,
            companyId
          }),
        () =>
          single(db, "quoteMakeMethod", {
            parentMaterialId: isNull,
            quoteLineId: sourceQuoteLineId,
            companyId
          }),
        () =>
          many(db, "quoteMaterial", {
            quoteLineId: sourceQuoteLineId,
            companyId
          }),
        () =>
          many<
            "quoteOperation",
            Tables["quoteOperation"]["Row"] & {
              quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
              quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
              quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
            }
          >(
            db,
            "quoteOperation",
            { quoteLineId: sourceQuoteLineId, companyId },
            {
              embed: {
                quoteOperationTool: {
                  table: "quoteOperationTool",
                  on: "operationId"
                },
                quoteOperationParameter: {
                  table: "quoteOperationParameter",
                  on: "operationId"
                },
                quoteOperationStep: {
                  table: "quoteOperationStep",
                  on: "operationId"
                }
              }
            }
          )
      ]);

      if (targetQuoteMakeMethod.error || !targetQuoteMakeMethod.data) {
        getMethodLogger.error("Failed to get target quote make method", {
          error: targetQuoteMakeMethod.error
        });
        throw new Error("Failed to get target quote make method");
      }
      // targetQuoteId is written onto new rows and priced below; bind it to
      // the verified target line rather than trusting the body.
      if (targetQuoteMakeMethod.data.quoteId !== targetQuoteId) {
        throw new NotFoundError("Quote line not found");
      }

      if (
        sourceQuoteMakeMethod.error ||
        sourceQuoteMaterials.error ||
        sourceQuoteOperations.error
      ) {
        throw new Error("Failed to source quote data");
      }

      const [quoteMethodTrees] = await inOrder([
        () => getQuoteMethodTree(db, sourceQuoteMakeMethod.data.id)
      ]);

      if (quoteMethodTrees.error) {
        throw new Error("Failed to get method tree");
      }

      const quoteMethodTree = quoteMethodTrees.data?.[0] as QuoteMethodTreeItem;
      if (!quoteMethodTree) throw new NotFoundError("Method tree not found");

      const quoteMaterialIdToQuoteMaterialId: Record<string, string> = {};
      const quoteMakeMethodIdToQuoteMakeMethodId: Record<string, string> = {};

      await withTransaction(db, async (trx) => {
        // Delete existing quoteMakeMethods, quoteMaterials, and quoteOperations for this quote line
        await Promise.all([
          parts.billOfMaterial
            ? trx
                .deleteFrom("quoteMakeMethod")
                .where((eb) =>
                  eb.and([
                    eb("quoteLineId", "=", targetQuoteLineId),
                    eb("parentMaterialId", "is not", null)
                  ])
                )
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfMaterial
            ? trx
                .deleteFrom("quoteMaterial")
                .where("quoteLineId", "=", targetQuoteLineId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          // Prevent cascade deletion of materials when only replacing operations
          !parts.billOfMaterial && parts.billOfProcess
            ? trx
                .updateTable("quoteMaterial")
                .set({ quoteOperationId: null })
                .where("quoteLineId", "=", targetQuoteLineId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve(),
          parts.billOfProcess
            ? trx
                .deleteFrom("quoteOperation")
                .where("quoteLineId", "=", targetQuoteLineId)
                .where("companyId", "=", companyId)
                .execute()
            : Promise.resolve()
        ]);

        await traverseQuoteMethod(
          quoteMethodTree,
          async (node: QuoteMethodTreeItem) => {
            const quoteMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
              [];
            const quoteMakeMethodInserts: Database["public"]["Tables"]["quoteMakeMethod"]["Insert"][] =
              [];

            for await (const child of node.children) {
              // A zero-quantity Buy/Pick line is dropped from the copied quote.
              // A made sub-assembly is left intact even at quantity 0: its
              // operations are copied by make method below and would reference
              // a make method that never got created if the row were removed.
              if (
                isZeroQuantity(child.data.quantity) &&
                child.data.methodType !== "Make to Order"
              ) {
                continue;
              }
              const newMaterialId = nanoid();
              quoteMaterialIdToQuoteMaterialId[child.id] = newMaterialId;

              quoteMaterialInserts.push({
                id: newMaterialId,
                quoteId: targetQuoteId,
                quoteLineId: targetQuoteLineId,
                itemId: child.data.itemId,
                kit: child.data.kit,
                itemType: child.data.itemType,
                methodType: child.data.methodType,
                order: child.data.order,
                description: child.data.description,
                quoteMakeMethodId:
                  child.data.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                    ? targetQuoteMakeMethod.data.id
                    : quoteMakeMethodIdToQuoteMakeMethodId[
                        child.data.quoteMakeMethodId
                      ]!,
                quantity: child.data.quantity,
                storageUnitId: child.data.storageUnitId,
                unitOfMeasureCode: child.data.unitOfMeasureCode,
                unitCost: child.data.unitCost ?? 0, // TODO: get real unit cost
                unitCostSource: child.data.unitCostSource ?? "system",
                companyId,
                createdBy: userId,
                customFields: {}
              });

              if (child.data.quoteMaterialMakeMethodId) {
                const newMakeMethodId = nanoid();
                quoteMakeMethodIdToQuoteMakeMethodId[
                  child.data.quoteMaterialMakeMethodId
                ] = newMakeMethodId;
                quoteMakeMethodInserts.push({
                  id: newMakeMethodId,
                  quoteId: targetQuoteId,
                  quoteLineId: targetQuoteLineId,
                  parentMaterialId: quoteMaterialIdToQuoteMaterialId[child.id],
                  itemId: child.data.itemId,
                  quantityPerParent: child.data.quantity,
                  companyId,
                  createdBy: userId
                });
              }
            }

            if (parts.billOfMaterial && quoteMaterialInserts.length > 0) {
              await trx
                .insertInto("quoteMaterial")
                .values(quoteMaterialInserts)
                .execute();
            }

            if (parts.billOfMaterial && quoteMakeMethodInserts.length > 0) {
              await renameMakeMethods(trx, {
                table: "quoteMakeMethod",
                companyId,
                scope: { column: "quoteLineId", value: targetQuoteLineId },
                rows: quoteMakeMethodInserts.map((insert) => ({
                  parentMaterialId: insert.parentMaterialId!,
                  id: insert.id!,
                  quantityPerParent: insert.quantityPerParent
                }))
              });
            }
          }
        );

        if (parts.billOfProcess) {
          const quoteOperationInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
            sourceQuoteOperations.data.map((op) => ({
              quoteId: targetQuoteId,
              quoteLineId: targetQuoteLineId,
              quoteMakeMethodId:
                op.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                  ? targetQuoteMakeMethod.data.id
                  : quoteMakeMethodIdToQuoteMakeMethodId[op.quoteMakeMethodId!],
              processId: op.processId,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              workCenterId: op.workCenterId,
              description: op.description,
              setupTime: op.setupTime,
              setupUnit: op.setupUnit,
              laborTime: op.laborTime,
              laborUnit: op.laborUnit,
              laborRate: op.laborRate,
              machineTime: op.machineTime,
              machineUnit: op.machineUnit,
              machineRate: op.machineRate,
              order: op.order,
              operationOrder: op.operationOrder,
              operationType: op.operationType,
              operationSupplierProcessId: op.operationSupplierProcessId,
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              overheadRate: op.overheadRate,
              tags: op.tags ?? [],
              workInstruction: toJson(
                parts.workInstructions ? op.workInstruction : {}
              ),
              companyId,
              createdBy: userId,
              customFields: {}
            }));

          if (quoteOperationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("quoteOperation")
              .values(quoteOperationInserts)
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              sourceQuoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep
                } = operation;

                if (
                  parts.tools &&
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (
                  parts.parameters &&
                  Array.isArray(quoteOperationParameter) &&
                  quoteOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationParameter")
                    .values(
                      quoteOperationParameter.map((param) => ({
                        operationId,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (
                  parts.steps &&
                  Array.isArray(quoteOperationStep) &&
                  quoteOperationStep.length > 0
                ) {
                  const insertedSteps = await trx
                    .insertInto("quoteOperationStep")
                    .values(
                      quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
                        description: toTiptapDoc(attribute.description),
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .returning(["id"])
                    .execute();

                  await copyStepSlides(
                    trx,
                    quoteOperationStep,
                    insertedSteps,
                    "quoteOperationStepSlide",
                    "quoteOperationStepSlide",
                    companyId,
                    userId
                  );
                }
              }
            }
          }
        } // end if (parts.billOfProcess)
      });

      await calculateQuoteLinePrices(
        db,
        targetQuoteId,
        targetQuoteLineId,
        companyId,
        userId
      );

      break;
    }

    case "quoteToQuote": {
      const sourceQuoteId = sourceId;
      const asRevision = !!targetId;
      let newQuoteId = "";

      const oldLineToNewLineMap: Record<string, string> = {};

      const [
        sourceQuote,
        sourceQuotePayment,
        sourceQuoteShipment,
        sourceQuoteLines
      ] = await inOrder([
        () => single(db, "quote", { id: sourceQuoteId, companyId }),
        () => single(db, "quotePayment", { id: sourceQuoteId, companyId }),
        () => single(db, "quoteShipment", { id: sourceQuoteId, companyId }),
        () => many(db, "quoteLine", { quoteId: sourceQuoteId, companyId })
      ]);

      if (sourceQuote.error) {
        throw new Error("Failed to get source quote");
      }

      if (sourceQuotePayment.error) {
        throw new Error("Failed to get source quote payment");
      }

      if (sourceQuoteShipment.error) {
        throw new Error("Failed to get source quote shipment");
      }

      const sourceQuoteLinePricing = await many(db, "quoteLinePrice", {
        quoteLineId: sourceQuoteLines.data?.map((l) => l.id) ?? []
      });

      if (sourceQuoteLinePricing.error) {
        throw new Error("Failed to get source quote line pricing");
      }

      await withTransaction(db, async (trx) => {
        let quoteId: string;
        let revisionId = 0;
        if (asRevision) {
          quoteId = sourceQuote.data?.quoteId ?? "";
          revisionId = await getNextRevisionSequence(
            trx,
            "quote",
            "quoteId",
            quoteId,
            companyId
          );
        } else {
          quoteId = await getNextSequence(trx, "quote", companyId);
        }

        // Each revision needs its own link row (the share page resolves a
        // quote by externalLinkId), but documentId is unique per document —
        // qualify it with the revision so a revision of Q000001 doesn't
        // collide with the original's link.
        //
        // A conflict here can only mean an ORPHAN: revisions are numbered
        // max(revisionId) + 1, so this documentId can't belong to a live
        // quote — the previous holder was deleted and deleteQuote leaves the
        // link row behind. Reuse it rather than failing the whole copy.
        const linkDocumentId =
          revisionId > 0 ? `${quoteId}-${revisionId}` : quoteId;
        const externalLinkId = await trx
          .insertInto("externalLink")
          .values({
            documentId: linkDocumentId,
            documentType: "Quote",
            companyId
          })
          .onConflict((oc) =>
            oc
              .columns(["documentId", "documentType", "companyId"])
              .doUpdateSet({ documentId: linkDocumentId })
          )
          .returning(["id"])
          .executeTakeFirstOrThrow();

        let opportunityId: string | undefined = undefined;
        if (asRevision) {
          opportunityId = sourceQuote.data?.opportunityId ?? undefined;
        } else {
          const opportunity = await trx
            .insertInto("opportunity")
            .values({
              companyId,
              customerId: sourceQuote.data?.customerId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          opportunityId = opportunity.id;
        }

        const quote = await trx
          .insertInto("quote")
          .values([
            {
              quoteId,
              revisionId,
              customerId: sourceQuote.data?.customerId,
              customerContactId: sourceQuote.data?.customerContactId,
              customerLocationId: sourceQuote.data?.customerLocationId,
              customerReference: sourceQuote.data?.customerReference,
              locationId: sourceQuote.data?.locationId,
              expirationDate: datetime
                .today(await getCompanyTimeZone(trx, companyId))
                .add({ days: 30 })
                .toString(),
              salesPersonId: sourceQuote.data?.salesPersonId ?? userId,
              status: "Draft",
              externalNotes: toJson(sourceQuote.data?.externalNotes),
              internalNotes: toJson(sourceQuote.data?.internalNotes),
              currencyCode: sourceQuote.data?.currencyCode,
              exchangeRate: sourceQuote.data?.exchangeRate,
              exchangeRateUpdatedAt: datetime.timestamp(),
              externalLinkId: externalLinkId.id,
              opportunityId,
              companyId,
              createdBy: userId
            }
          ])
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (!quote.id) {
          throw new Error("Failed to insert quote");
        }

        newQuoteId = quote.id;

        // Insert quotePayment
        await trx
          .insertInto("quotePayment")
          .values({
            id: quote.id,
            invoiceCustomerId: sourceQuotePayment.data?.invoiceCustomerId,
            invoiceCustomerContactId:
              sourceQuotePayment.data?.invoiceCustomerContactId,
            invoiceCustomerLocationId:
              sourceQuotePayment.data?.invoiceCustomerLocationId,
            paymentTermId: sourceQuotePayment.data?.paymentTermId,
            companyId,
            updatedBy: userId
          })
          .execute();

        // Insert quoteShipment
        await trx
          .insertInto("quoteShipment")
          .values({
            id: quote.id,
            locationId: sourceQuoteShipment.data?.locationId,
            shippingMethodId: sourceQuoteShipment.data?.shippingMethodId,
            shippingTermId: sourceQuoteShipment.data?.shippingTermId,
            shippingCost: sourceQuoteShipment.data?.shippingCost,
            receiptRequestedDate:
              sourceQuoteShipment.data?.receiptRequestedDate,
            companyId,
            updatedBy: userId
          })
          .execute();

        for await (const { id, ...line } of sourceQuoteLines.data ?? []) {
          const newLine = await trx
            .insertInto("quoteLine")
            .values({
              ...line,
              ...toJsonColumns(line, QUOTE_LINE_JSON_COLUMNS),
              quoteId: quote.id,
              companyId
            })
            .returning(["id"])
            .executeTakeFirstOrThrow();

          if (!newLine.id) {
            throw new Error("Failed to insert quote line");
          }

          if (line.methodType === "Make to Order") {
            // we only need further processing on make lines
            oldLineToNewLineMap[id] = newLine.id;
          }

          const sourceQuotePricingForLine =
            sourceQuoteLinePricing.data?.filter((l) => l.quoteLineId === id) ??
            [];

          if (sourceQuotePricingForLine.length > 0) {
            await trx
              .insertInto("quoteLinePrice")
              .values(
                sourceQuotePricingForLine.map((l) => ({
                  quoteId: newQuoteId!,
                  quoteLineId: newLine.id!,
                  companyId,
                  leadTime: l.leadTime ?? 0,
                  discountPercent: l.discountPercent ?? 0,
                  quantity: l.quantity ?? 0,
                  unitPrice: l.unitPrice ?? 0,
                  shippingCost: l.shippingCost ?? 0,
                  // Never 0: a zero rate is not a valid snapshot (DB CHECK
                  // "exchangeRate" > 0) and zeroes every converted* generated
                  // column. A legacy null line rate falls back to the SOURCE
                  // QUOTE's own stamped header rate; 1 only when the source
                  // header predates stamping too (base-consistent with its
                  // line snapshots' old default).
                  exchangeRate:
                    l.exchangeRate ?? sourceQuote.data?.exchangeRate ?? 1,
                  categoryMarkups: JSON.stringify(l.categoryMarkups ?? {}),
                  // Copied prices keep their provenance so a manual price
                  // stays protected on the new quote/revision, and the
                  // trace that explains it.
                  priceSource: l.priceSource ?? "system",
                  priceTrace: toJson(l.priceTrace),
                  createdBy: userId
                }))
              )
              .execute();
          }
        }
      });

      await withTransaction(db, async (trx) => {
        for await (const [oldLineId, newLineId] of Object.entries(
          oldLineToNewLineMap
        )) {
          const [
            targetQuoteMakeMethod,
            sourceQuoteMakeMethod,
            sourceQuoteMaterials,
            sourceQuoteOperations
          ] = await Promise.all([
            single(trx, "quoteMakeMethod", {
              parentMaterialId: isNull,
              quoteLineId: newLineId,
              companyId
            }),
            single(trx, "quoteMakeMethod", {
              parentMaterialId: isNull,
              quoteLineId: oldLineId,
              companyId
            }),
            many(trx, "quoteMaterial", { quoteLineId: oldLineId, companyId }),
            many<
              "quoteOperation",
              Tables["quoteOperation"]["Row"] & {
                quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
                quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
                quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
              }
            >(
              trx,
              "quoteOperation",
              { quoteLineId: oldLineId, companyId },
              {
                embed: {
                  quoteOperationTool: {
                    table: "quoteOperationTool",
                    on: "operationId"
                  },
                  quoteOperationParameter: {
                    table: "quoteOperationParameter",
                    on: "operationId"
                  },
                  quoteOperationStep: {
                    table: "quoteOperationStep",
                    on: "operationId"
                  }
                }
              }
            )
          ]);

          if (targetQuoteMakeMethod.error) {
            getMethodLogger.error("Failed to get target quote make method", {
              error: targetQuoteMakeMethod.error
            });
            throw new Error("Failed to get target quote make method");
          }

          if (
            sourceQuoteMakeMethod.error ||
            sourceQuoteMaterials.error ||
            sourceQuoteOperations.error
          ) {
            throw new Error("Failed to source quote data");
          }

          const [quoteMethodTrees] = await Promise.all([
            getQuoteMethodTree(trx, sourceQuoteMakeMethod.data.id)
          ]);

          if (quoteMethodTrees.error) {
            throw new Error("Failed to get method tree");
          }

          const quoteMethodTree = quoteMethodTrees
            .data?.[0] as QuoteMethodTreeItem;
          if (!quoteMethodTree)
            throw new NotFoundError("Method tree not found");

          const quoteMaterialIdToQuoteMaterialId: Record<string, string> = {};
          const quoteMakeMethodIdToQuoteMakeMethodId: Record<string, string> =
            {};

          await traverseQuoteMethod(
            quoteMethodTree,
            async (node: QuoteMethodTreeItem) => {
              const quoteMaterialInserts: Database["public"]["Tables"]["quoteMaterial"]["Insert"][] =
                [];
              const quoteMakeMethodInserts: Database["public"]["Tables"]["quoteMakeMethod"]["Insert"][] =
                [];

              for await (const child of node.children) {
                // A zero-quantity Buy/Pick line is dropped from the new quote.
                // A made sub-assembly is left intact even at quantity 0: its
                // operations are copied by make method below and would reference
                // a make method that never got created if the row were removed.
                if (
                  isZeroQuantity(child.data.quantity) &&
                  child.data.methodType !== "Make to Order"
                ) {
                  continue;
                }
                const newMaterialId = nanoid();
                quoteMaterialIdToQuoteMaterialId[child.id] = newMaterialId;

                quoteMaterialInserts.push({
                  id: newMaterialId,
                  quoteId: newQuoteId,
                  quoteLineId: newLineId,
                  itemId: child.data.itemId,
                  kit: child.data.kit,
                  itemType: child.data.itemType,
                  methodType: child.data.methodType,
                  order: child.data.order,
                  description: child.data.description,
                  quoteMakeMethodId:
                    child.data.quoteMakeMethodId ===
                    sourceQuoteMakeMethod.data.id
                      ? targetQuoteMakeMethod.data.id
                      : quoteMakeMethodIdToQuoteMakeMethodId[
                          child.data.quoteMakeMethodId
                        ]!,
                  quantity: child.data.quantity,
                  storageUnitId: child.data.storageUnitId,
                  unitCost: child.data.unitCost ?? 0, // TODO: get real unit cost
                  unitCostSource: child.data.unitCostSource ?? "system",
                  unitOfMeasureCode: child.data.unitOfMeasureCode,
                  companyId,
                  createdBy: userId,
                  customFields: {}
                });

                if (child.data.quoteMaterialMakeMethodId) {
                  const newMakeMethodId = nanoid();
                  quoteMakeMethodIdToQuoteMakeMethodId[
                    child.data.quoteMaterialMakeMethodId
                  ] = newMakeMethodId;
                  quoteMakeMethodInserts.push({
                    id: newMakeMethodId,
                    quoteId: newQuoteId,
                    quoteLineId: newLineId,
                    parentMaterialId:
                      quoteMaterialIdToQuoteMaterialId[child.id],
                    itemId: child.data.itemId,
                    quantityPerParent: child.data.quantity,
                    companyId,
                    createdBy: userId
                  });
                }
              }

              if (quoteMaterialInserts.length > 0) {
                await trx
                  .insertInto("quoteMaterial")
                  .values(quoteMaterialInserts)
                  .execute();
              }

              if (quoteMakeMethodInserts.length > 0) {
                await renameMakeMethods(trx, {
                  table: "quoteMakeMethod",
                  companyId,
                  scope: { column: "quoteLineId", value: newLineId },
                  rows: quoteMakeMethodInserts.map((insert) => ({
                    parentMaterialId: insert.parentMaterialId!,
                    id: insert.id!,
                    quantityPerParent: insert.quantityPerParent
                  }))
                });
              }
            }
          );

          const quoteOperationInserts: Database["public"]["Tables"]["quoteOperation"]["Insert"][] =
            sourceQuoteOperations.data.map((op) => ({
              quoteId: newQuoteId,
              quoteLineId: newLineId,
              quoteMakeMethodId:
                op.quoteMakeMethodId === sourceQuoteMakeMethod.data.id
                  ? targetQuoteMakeMethod.data.id
                  : quoteMakeMethodIdToQuoteMakeMethodId[op.quoteMakeMethodId!],
              processId: op.processId,
              procedureId: op.procedureId,
              assemblyInstructionId: op.assemblyInstructionId,
              inspectionDocumentId: op.inspectionDocumentId,
              workCenterId: op.workCenterId,
              description: op.description,
              setupTime: op.setupTime,
              setupUnit: op.setupUnit,
              laborTime: op.laborTime,
              laborUnit: op.laborUnit,
              laborRate: op.laborRate,
              machineTime: op.machineTime,
              machineUnit: op.machineUnit,
              machineRate: op.machineRate,
              order: op.order,
              operationOrder: op.operationOrder,
              operationType: op.operationType,
              operationSupplierProcessId: op.operationSupplierProcessId,
              operationMinimumCost: op.operationMinimumCost ?? 0,
              operationLeadTime: op.operationLeadTime ?? 0,
              operationUnitCost: op.operationUnitCost ?? 0,
              overheadRate: op.overheadRate,
              tags: op.tags ?? [],
              workInstruction: toJson(op.workInstruction),
              companyId,
              createdBy: userId,
              customFields: {}
            }));

          if (quoteOperationInserts.length > 0) {
            const operationIds = await trx
              .insertInto("quoteOperation")
              .values(quoteOperationInserts)
              .returning(["id"])
              .execute();

            for (const [index, operation] of (
              sourceQuoteOperations.data ?? []
            ).entries()) {
              const operationId = operationIds[index]!.id;
              if (operationId) {
                const {
                  quoteOperationTool,
                  quoteOperationParameter,
                  quoteOperationStep
                } = operation;

                if (
                  Array.isArray(quoteOperationTool) &&
                  quoteOperationTool.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationTool")
                    .values(
                      quoteOperationTool.map((tool) => ({
                        toolId: tool.toolId,
                        quantity: tool.quantity,
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (
                  Array.isArray(quoteOperationParameter) &&
                  quoteOperationParameter.length > 0
                ) {
                  await trx
                    .insertInto("quoteOperationParameter")
                    .values(
                      quoteOperationParameter.map((param) => ({
                        operationId,
                        key: param.key,
                        value: param.value,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .execute();
                }

                if (
                  Array.isArray(quoteOperationStep) &&
                  quoteOperationStep.length > 0
                ) {
                  const insertedSteps = await trx
                    .insertInto("quoteOperationStep")
                    .values(
                      quoteOperationStep.map(({ id: _id, ...attribute }) => ({
                        ...attribute,
                        description: toTiptapDoc(attribute.description),
                        operationId,
                        companyId,
                        createdBy: userId
                      }))
                    )
                    .returning(["id"])
                    .execute();

                  await copyStepSlides(
                    trx,
                    quoteOperationStep,
                    insertedSteps,
                    "quoteOperationStepSlide",
                    "quoteOperationStepSlide",
                    companyId,
                    userId
                  );
                }
              }
            }
          }
        }
      });
      if (newQuoteId) {
        return { success: true, newQuoteId } as GetMethodResult;
      }
      break;
    }
    default:
      throw new Error(`Invalid type  ${type}`);
  }

  return { success: true };
}

type Method =
  Database["public"]["Functions"]["get_method_tree"]["Returns"][number];

type MethodTreeItem = {
  id: string;
  data: Method;
  children: MethodTreeItem[];
};

/** A make method's tree, read on the caller's connection (`db`, or `trx`). */
export async function getMethodTree(
  db: Kysely<KyselyDatabase>,
  makeMethodId: string
): Promise<{ data: MethodTreeItem[]; error: null }> {
  const { rows } = await sql<Method>`
    SELECT * FROM get_method_tree(${makeMethodId})
  `.execute(db);
  return { data: getMethodTreeArrayToTree(rows), error: null };
}

// Build date for a job's supersession / effectivity decisions: prefer the planned
// start, fall back to the due date, then to today. Used wherever the method tree is
// instantiated so swaps and BOM-line effectivity are evaluated as-of the same day.
function jobBuildDate(
  job: { startDate?: string | null; dueDate?: string | null } | null | undefined
): string {
  return (
    job?.startDate ?? job?.dueDate ?? new Date().toISOString().slice(0, 10)
  );
}

// Load every supersession for the company and collapse it into the redirect map
// (chain-collapsed, mode-gated, conversion-factored) as-of the job's build date.
// Every *-ToJob path needs the same map, so this is the single load point.
async function loadSupersessionRedirect(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  job:
    | {
        locationId?: string | null;
        startDate?: string | null;
        dueDate?: string | null;
      }
    | null
    | undefined
): Promise<SupersessionContext> {
  // Read over the direct connection: no row cap to page around (PostgREST stops
  // at 1000 rows, which is why this used to page), and a fraction of the
  // latency. MRP reads the same table in full, so both redirect every rule.
  //
  // A failure throws, like every other read in this function. An empty map is
  // indistinguishable from "this company supersedes nothing", so swallowing an
  // error would build a real work order out of retired parts and report
  // success.
  let rows: SupersessionRow[] = await db
    .selectFrom("itemSupersession")
    .select([
      "itemId",
      "supersessionMode",
      "successorItemId",
      "successorEffectivityDate",
      "conversionFactor"
    ])
    .where("companyId", "=", companyId)
    .orderBy("itemId")
    .execute();

  const consumeFirstItemIds = rows
    .filter((r) => r.supersessionMode === "Consume First")
    .map((r) => r.itemId);
  const consumeFirstOnHand = new Map<string, number>();
  if (consumeFirstItemIds.length > 0 && job?.locationId) {
    const stock = await db
      .selectFrom("itemStockQuantities")
      .select(["itemId", "quantityOnHand"])
      .where("companyId", "=", companyId)
      .where("locationId", "=", job.locationId)
      .where("itemId", "in", consumeFirstItemIds)
      .execute();
    const items = await db
      .selectFrom("item")
      .select(["id", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", consumeFirstItemIds)
      .execute();
    const onHandByItem = new Map<string, number>();
    for (const r of stock) {
      onHandByItem.set(
        r.itemId,
        (onHandByItem.get(r.itemId) ?? 0) + Number(r.quantityOnHand ?? 0)
      );
    }
    const madeItemIds = new Set(
      items
        .filter(
          (i) =>
            effectiveReplenishment(i.replenishmentSystem ?? undefined) ===
            "Make"
        )
        .map((i) => i.id)
    );
    for (const id of madeItemIds) {
      consumeFirstOnHand.set(id, onHandByItem.get(id) ?? 0);
    }
    rows = withoutStockedConsumeFirst(
      rows,
      new Set(
        [...onHandByItem]
          .filter(([id, onHand]) => onHand > 0 && !madeItemIds.has(id))
          .map(([id]) => id)
      )
    );
  }

  const redirect = buildSupersessionRedirectMap(rows, jobBuildDate(job));
  const consumeFirstHops = buildConsumeFirstHops(rows, jobBuildDate(job));
  for (const id of [...consumeFirstOnHand.keys()]) {
    if (!redirect.has(id)) consumeFirstOnHand.delete(id);
  }
  const boughtSuccessors = new Set<string>();
  const successorIds = [...new Set([...redirect.values()].map((r) => r.to))];
  if (successorIds.length > 0) {
    const successors = await db
      .selectFrom("item")
      .select(["id", "replenishmentSystem"])
      .where("companyId", "=", companyId)
      .where("id", "in", successorIds)
      .execute();
    for (const i of successors) {
      if (
        effectiveReplenishment(i.replenishmentSystem ?? undefined) !== "Make"
      ) {
        boughtSuccessors.add(i.id);
      }
    }
  }
  return { redirect, consumeFirstOnHand, consumeFirstHops, boughtSuccessors };
}

// EVERY jobMaterial field that is a function of WHICH ITEM the row is for, in
// one place. A supersession swap has to restate all of them, and the way that
// goes wrong is a hand-written field list that drifts: `itemScrapPercentage` was
// simply absent from the swap's `.set({...})`, so a swapped line costed the
// predecessor's scrap forever. Returning them as an object the caller SPREADS
// means a field added here reaches the swap without a second edit — the list
// cannot fall out of sync with itself.
//
// Quantities are deliberately NOT here: they depend on the parent's cascade and
// the method type, which this function has no view of. It returns the scrap RATE
// and lets the caller derive the allowance.
async function itemDerivedJobMaterialFields(opts: {
  trx: Transaction<KyselyDatabase>;
  companyId: string;
  itemId: string;
  locationId: string;
  /** An explicit bin on the BOM line still wins over the item's default. */
  lineStorageUnitId?: string;
}) {
  const { trx, companyId, itemId, locationId, lineStorageUnitId } = opts;
  const { strict } = await getStrictBackflushSettings(
    trx,
    companyId,
    locationId
  );

  const [item, replenishment, storageUnitId] = await Promise.all([
    readItemWithCost(trx, itemId, companyId),
    trx
      .selectFrom("itemReplenishment")
      .select("scrapPercentage")
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId)
      .executeTakeFirst(),
    getStorageUnitId(trx, itemId, locationId, lineStorageUnitId, !strict)
  ]);

  if (!item) return null;

  return {
    itemId,
    itemType: item.type,
    description: item.name,
    unitCost: item.itemCost?.[0]?.unitCost ?? 0,
    requiresSerialTracking: item.itemTrackingType === "Serial",
    requiresBatchTracking: item.itemTrackingType === "Batch",
    itemScrapPercentage: Number(replenishment?.scrapPercentage ?? 0),
    storageUnitId
  };
}

// Made-component supersession at job creation: if a made child has an effective
// successor that is ITSELF a made item, repoint the job material at the successor
// and explode the SUCCESSOR's method (date-pruned) instead of the old part's,
// scaling the cascade by the conversion factor. A Make -> Buy successor is a
// structural flip we leave on the old part (handled elsewhere). Returns true when
// the swap was applied, so the caller can skip the default traversal.
/**
 * The tree a made line explodes into. A configuration rule can move a Make to
 * Order line onto another item (a 14 ft body where the BOM names the 12 ft
 * one); the line is then that item's, and so is the sub-assembly under it.
 * Exploding `child` as it stood built the BOM item's sub-assembly under the
 * configured item. The line's own fields (quantity, operation, order, the
 * row's ids) stay the BOM line's; the item and its method become the
 * configured item's. Undefined when the configured item has no make method:
 * there is nothing of its own to explode, and the BOM item's would be wrong.
 */
async function configuredMadeChild(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  child: MethodTreeItem,
  itemId: string | null | undefined
): Promise<MethodTreeItem | undefined> {
  if (!itemId || itemId === child.data.itemId) return child;
  const method = await trx
    .selectFrom("activeMakeMethods")
    .select(["id"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!method?.id) return undefined;
  const root = (await getMethodTree(trx, method.id)).data?.[0];
  if (!root) return undefined;
  return {
    id: child.id,
    data: {
      ...child.data,
      itemId: root.data.itemId,
      itemReadableId: root.data.itemReadableId,
      itemTrackingType: root.data.itemTrackingType,
      itemType: root.data.itemType,
      materialMakeMethodId: root.data.materialMakeMethodId,
      replenishmentSystem: root.data.replenishmentSystem,
      revision: root.data.revision,
      unitCost: root.data.unitCost,
      version: root.data.version
    },
    children: root.children
  };
}

async function swapMadeSubAssembly(opts: {
  trx: Transaction<KyselyDatabase>;
  companyId: string;
  child: MethodTreeItem;
  material:
    | {
        quantity?: number | null;
        estimatedQuantity?: number | null;
        scrapQuantity?: number | null;
      }
    | undefined;
  materialId: string;
  /** The job's location — the successor's default bin is resolved against it. */
  locationId: string;
  supersessionRedirect: Map<string, { to: string; factor: number }>;
  newMakeMethodId: string;
  traverseMethod: (
    node: MethodTreeItem,
    parentJobMakeMethodId: string | null,
    parentEstimatedQuantity: number
  ) => Promise<unknown>;
}): Promise<boolean> {
  const {
    trx,
    companyId,
    child,
    material,
    materialId,
    locationId,
    supersessionRedirect,
    newMakeMethodId,
    traverseMethod
  } = opts;

  const madeRedirect = supersessionRedirect.get(child.data.itemId);
  if (!madeRedirect) return false;

  const successorMakeMethod = await trx
    .selectFrom("activeMakeMethods")
    .select(["id"])
    .where("itemId", "=", madeRedirect.to)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!successorMakeMethod?.id) return false;

  // Every item-dependent field, restated for the successor in ONE step. Spread,
  // never hand-listed: this row is being repointed at a different item, so all
  // of them change together, and a field added to the helper arrives here
  // automatically. `itemScrapPercentage` going missing from a hand-written list
  // is exactly how a swapped line ended up costing the predecessor's scrap.
  const itemFields = await itemDerivedJobMaterialFields({
    trx,
    companyId,
    itemId: madeRedirect.to,
    locationId,
    // @ts-ignore: storageUnitIds is a dynamic field
    lineStorageUnitId: child.data.storageUnitIds?.[locationId] ?? undefined
  });
  if (!itemFields) return false;

  // Quantities are the caller's business, not the helper's — they depend on the
  // cascade and the method type. Make to Order: estimatedQuantity is the GOOD
  // quantity, scrap excluded, and target + scrap is what children explode
  // against. Deriving both from the SAME scrap rate is what stops the row and
  // its sub-tree disagreeing.
  const targetQuantity =
    (material?.estimatedQuantity ?? 0) * madeRedirect.factor;
  const scrapQuantity = scrapAllowance(
    targetQuantity,
    itemFields.itemScrapPercentage
  );
  const totalWithScrap = targetQuantity + scrapQuantity;

  await trx
    .updateTable("jobMaterial")
    .set({
      ...itemFields,
      quantity: (material?.quantity ?? 0) * madeRedirect.factor,
      estimatedQuantity: targetQuantity,
      scrapQuantity,
      substitutedFromItemId: child.data.itemId,
      substitutionFactor: madeRedirect.factor
    })
    .where("id", "=", materialId)
    .where("companyId", "=", companyId)
    .execute();

  const successorTree = await getMethodTree(trx, successorMakeMethod.id);
  const successorRoot = successorTree.data?.[0];
  if (successorRoot) {
    // The SAME total the row above was written with — not the predecessor's,
    // rescaled. `|| 1` mirrors the unswapped path's fallback exactly; the old
    // `(childTotalForCascade || 1) * factor` yielded `factor` for a zero total
    // where the unswapped path yields 1.
    await traverseMethod(successorRoot, newMakeMethodId, totalWithScrap || 1);
  }
  return true;
}

async function settleConsumeFirstLines(opts: {
  trx: Transaction<KyselyDatabase>;
  companyId: string;
  jobId: string;
  jobMaterialIds: string[];
  locationId: string | null | undefined;
  asOfDate: string;
}) {
  const { trx, companyId, jobId, jobMaterialIds, locationId, asOfDate } = opts;
  if (!locationId || jobMaterialIds.length === 0) return;

  const rules = await trx
    .selectFrom("itemSupersession")
    .select([
      "itemId",
      "successorItemId",
      "successorEffectivityDate",
      "conversionFactor"
    ])
    .where("companyId", "=", companyId)
    .where("supersessionMode", "=", "Consume First")
    .where("successorItemId", "is not", null)
    .orderBy("itemId")
    .execute();
  const consumeFirstRules = buildConsumeFirstRules(rules, asOfDate);
  const { successorByPredecessor, predecessorsBySuccessor } = consumeFirstRules;
  if (successorByPredecessor.size === 0) return;

  const materials = await trx
    .selectFrom("jobMaterial")
    .select([
      "id",
      "itemId",
      "quantity",
      "estimatedQuantity",
      "scrapQuantity",
      "substitutedFromItemId",
      "substitutionFactor"
    ])
    .where("jobId", "=", jobId)
    .where("companyId", "=", companyId)
    .where("id", "in", jobMaterialIds)
    .where("methodType", "!=", "Make to Order")
    .where((eb) =>
      eb.or([eb("quantityIssued", "is", null), eb("quantityIssued", "<=", 0)])
    )
    .where("itemId", "in", [
      ...new Set([
        ...successorByPredecessor.keys(),
        ...predecessorsBySuccessor.keys()
      ])
    ])
    .execute();
  if (materials.length === 0) return;

  const predecessorIds = new Set<string>();
  for (const m of materials) {
    for (const id of consumeFirstStockItems(m, consumeFirstRules)) {
      predecessorIds.add(id);
    }
  }
  const stock = await trx
    .selectFrom("itemStockQuantities")
    .select(["itemId", "quantityOnHand"])
    .where("companyId", "=", companyId)
    .where("locationId", "=", locationId)
    .where("itemId", "in", [...predecessorIds])
    .execute();
  const onHandByItem = new Map<string, number>();
  for (const row of stock) {
    onHandByItem.set(
      row.itemId,
      (onHandByItem.get(row.itemId) ?? 0) + Number(row.quantityOnHand ?? 0)
    );
  }

  const swapLine = async (
    m: (typeof materials)[number],
    toItemId: string,
    factor: number,
    provenance: {
      substitutedFromItemId: string | null;
      substitutionFactor: number | null;
    }
  ) => {
    const fields = await itemDerivedJobMaterialFields({
      trx,
      companyId,
      itemId: toItemId,
      locationId
    });
    if (!fields) return;
    const quantities = pullBackQuantities(
      m,
      factor,
      fields.itemScrapPercentage
    );
    await trx
      .updateTable("jobMaterial")
      .set({
        ...fields,
        ...quantities,
        ...provenance
      })
      .where("id", "=", m.id)
      .where("companyId", "=", companyId)
      .execute();
  };

  materials.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of materials) {
    const settlement = settleConsumeFirstLine(
      m,
      consumeFirstRules,
      onHandByItem
    );
    reserveConsumeFirstStock(m, settlement, consumeFirstRules, onHandByItem);
    if (!settlement) continue;
    await swapLine(
      m,
      settlement.toItemId,
      settlement.factor,
      settlement.kind === "revert"
        ? { substitutedFromItemId: null, substitutionFactor: null }
        : {
            substitutedFromItemId: m.itemId,
            substitutionFactor: settlement.factor
          }
    );
  }
}

// Shared by every *-ToJob path. For a Buy/Pick job-material row whose item has an
// effective supersession successor (per the redirect map), returns the successor's
// item fields so the row points at the right part with consistent tracking / type /
// cost. Make-to-Order lines are never swapped here (the successor's own sub-method
// would need re-exploding — a later layer), so the caller passes only Buy/Pick rows
// or this returns null for them. The line's unit of measure and methodType are
// intentionally preserved — the conversion factor translates the quantity.
async function resolveJobMaterialSupersession(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  redirect: Map<string, { to: string; factor: number }>,
  line: { itemId: string; methodType: string }
): Promise<{
  itemId: string;
  factor: number;
  substitutedFromItemId: string;
  itemType: string;
  description: string;
  unitCost: number | null;
  requiresSerialTracking: boolean;
  requiresBatchTracking: boolean;
} | null> {
  if (line.methodType === "Make to Order") return null;
  const r = redirect.get(line.itemId);
  if (!r) return null;
  const successor = await readItemWithCost(db, r.to, companyId);
  if (!successor) return null;
  return {
    itemId: r.to,
    factor: r.factor,
    substitutedFromItemId: line.itemId,
    itemType: successor.type,
    description: successor.name,
    unitCost: successor.itemCost?.[0]?.unitCost ?? null,
    requiresSerialTracking: successor.itemTrackingType === "Serial",
    requiresBatchTracking: successor.itemTrackingType === "Batch"
  };
}

function getMethodTreeArrayToTree(items: Method[]): MethodTreeItem[] {
  function traverseAndRenameIds(node: MethodTreeItem) {
    const clone = structuredClone(node);
    clone.id = nanoid(20);
    clone.children = clone.children.map((n) => traverseAndRenameIds(n));
    return clone;
  }

  const rootItems: MethodTreeItem[] = [];
  const lookup: { [id: string]: MethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-ignore - we add data on the next line
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId]!["data"] = item;

    const treeItem = lookup[itemId]!;

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore - we don't add data here
        lookup[parentId] = { id: parentId, children: [] };
      }

      lookup[parentId]!["children"].push(treeItem);
    }
  }

  return rootItems.map((item) => traverseAndRenameIds(item));
}

type Tables = Database["public"]["Tables"];

type Views = Database["public"]["Views"];

/** A method operation with its tools (and their step links), parameters and steps. */
type MethodOperationRow = Tables["methodOperation"]["Row"] & {
  methodOperationTool: (Tables["methodOperationTool"]["Row"] & {
    methodOperationToolStep: Tables["methodOperationToolStep"]["Row"][];
  })[];
  methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
  methodOperationStep: Tables["methodOperationStep"]["Row"][];
};

// makeMethodId is globally unique (makeMethod's PK is "id" alone), so the
// companyId filter cannot drop a legitimate row — it only closes a
// cross-tenant read.
function readMethodOperations(
  db: Kysely<KyselyDatabase>,
  makeMethodIds: string[],
  companyId: string
) {
  return selectRows<"methodOperation", MethodOperationRow>(
    db,
    "methodOperation",
    { makeMethodId: makeMethodIds, companyId },
    {
      orderBy: ["order", "id"],
      embed: {
        methodOperationTool: {
          table: "methodOperationTool",
          on: "operationId",
          embed: {
            methodOperationToolStep: {
              table: "methodOperationToolStep",
              on: "methodOperationToolId"
            }
          }
        },
        methodOperationParameter: {
          table: "methodOperationParameter",
          on: "operationId"
        },
        methodOperationStep: { table: "methodOperationStep", on: "operationId" }
      }
    }
  );
}

/** A quote operation with its tools, parameters and steps. */
type QuoteOperationWithDetails = Tables["quoteOperation"]["Row"] & {
  quoteOperationTool: Tables["quoteOperationTool"]["Row"][];
  quoteOperationParameter: Tables["quoteOperationParameter"]["Row"][];
  quoteOperationStep: Tables["quoteOperationStep"]["Row"][];
};

const quoteOperationDetails = {
  quoteOperationTool: { table: "quoteOperationTool", on: "operationId" },
  quoteOperationParameter: {
    table: "quoteOperationParameter",
    on: "operationId"
  },
  quoteOperationStep: { table: "quoteOperationStep", on: "operationId" }
} as const;

/** Every item a method tree names, plus the successor each would be swapped for. */
function treeItemIds(
  root: { data: { itemId: string }; children: unknown[] },
  redirect?: Map<string, { to: string }>
): string[] {
  const ids: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: { data: { itemId: string }; children: unknown[] }) => {
    if (seen.has(node)) return;
    seen.add(node);
    ids.push(node.data.itemId);
    const successor = redirect?.get(node.data.itemId)?.to;
    if (successor) ids.push(successor);
    for (const child of node.children) walk(child as typeof node);
  };
  walk(root);
  return ids;
}

/**
 * An item's scrap percentage and its default bin at one location, read for
 * many items at once and remembered for the request. The copy flows asked for
 * these one material at a time inside their transaction — three statements
 * per material, 110 of the 164 a 40-line job copy sent.
 *
 * `load` the tree's items up front; an item it did not cover (a successor a
 * swap lands on) is read when first asked for, so nothing resolves to a
 * silent 0 or a missing bin.
 */
function createItemDefaults(
  companyId: string,
  locationId: string | null | undefined
) {
  const scrapByItemId = new Map<string, number>();
  const binByItemId = new Map<string, string>();
  const loaded = new Set<string>();
  let fullestBinAllowed: boolean | undefined;

  async function load(
    reader: Kysely<KyselyDatabase>,
    itemIds: (string | null | undefined)[]
  ) {
    const missing = [...new Set(itemIds)].filter(
      (id): id is string => !!id && !loaded.has(id)
    );
    if (missing.length === 0) return;

    const replenishments = await reader
      .selectFrom("itemReplenishment")
      .select(["itemId", "scrapPercentage"])
      .where("itemId", "in", missing)
      .where("companyId", "=", companyId)
      .execute();
    for (const row of replenishments) {
      scrapByItemId.set(row.itemId, Number(row.scrapPercentage ?? 0));
    }

    // The pick method's default bin wins, else the bin holding the most (never
    // under strict backflush).
    if (locationId) {
      fullestBinAllowed ??= !(
        await getStrictBackflushSettings(reader, companyId, locationId)
      ).strict;
      const ledgerTotals = !fullestBinAllowed
        ? []
        : await reader
            .selectFrom("itemLedger")
            .where("locationId", "=", locationId)
            .where("companyId", "=", companyId)
            .where("itemId", "in", missing)
            .where("storageUnitId", "is not", null)
            .groupBy(["itemId", "storageUnitId"])
            .select([
              "itemId",
              "storageUnitId",
              (eb) => eb.fn.sum("quantity").as("totalQuantity")
            ])
            .having((eb) => eb.fn.sum("quantity"), ">", 0)
            .orderBy("itemId")
            .orderBy("totalQuantity", "desc")
            .orderBy("storageUnitId")
            .execute();
      for (const row of ledgerTotals) {
        // Ordered by quantity: the first row for an item is its fullest bin.
        if (row.storageUnitId && !binByItemId.has(row.itemId)) {
          binByItemId.set(row.itemId, row.storageUnitId);
        }
      }

      const pickMethods = await reader
        .selectFrom("pickMethod")
        .select(["itemId", "defaultStorageUnitId"])
        .where("locationId", "=", locationId)
        .where("companyId", "=", companyId)
        .where("itemId", "in", missing)
        .where("defaultStorageUnitId", "is not", null)
        .execute();
      for (const pickMethod of pickMethods) {
        if (pickMethod.defaultStorageUnitId) {
          binByItemId.set(pickMethod.itemId, pickMethod.defaultStorageUnitId);
        }
      }
    }

    // Marked only after the rows land, so an item never reads as "loaded, no
    // row" while its read is still in flight.
    for (const id of missing) loaded.add(id);
  }

  return {
    load,
    async scrapPercentage(reader: Kysely<KyselyDatabase>, itemId: string) {
      await load(reader, [itemId]);
      return scrapByItemId.get(itemId) ?? 0;
    },
    /** An explicit bin on the line wins over the item's default. */
    async storageUnitId(
      reader: Kysely<KyselyDatabase>,
      itemId: string,
      lineStorageUnitId?: string | null
    ) {
      if (lineStorageUnitId) return lineStorageUnitId;
      await load(reader, [itemId]);
      return binByItemId.get(itemId);
    }
  };
}

/** An item with its cost row, as the job-material mappers read it. */
function readItemWithCost(
  db: Kysely<KyselyDatabase>,
  itemId: string,
  companyId: string
) {
  return selectRow<
    "item",
    Tables["item"]["Row"] & { itemCost: Tables["itemCost"]["Row"][] }
  >(
    db,
    "item",
    { id: itemId, companyId },
    { embed: { itemCost: { table: "itemCost", on: "itemId" } } }
  );
}

function getFieldKey(field: string, id: string) {
  return `${field}:${id}`;
}

type ProcedureForJob = {
  content: unknown;
  steps: Record<string, unknown>[];
  parameters: Record<string, unknown>[];
};

// One read per procedure per transaction, however many operations use it.
const procedureCacheByTransaction = new WeakMap<
  object,
  Map<string, Promise<ProcedureForJob | undefined>>
>();

function readProcedureForJob(
  trx: Transaction<KyselyDatabase>,
  procedureId: string,
  companyId: string
) {
  let cache = procedureCacheByTransaction.get(trx);
  if (!cache) {
    cache = new Map();
    procedureCacheByTransaction.set(trx, cache);
  }
  let procedure = cache.get(procedureId);
  if (!procedure) {
    procedure = sql<ProcedureForJob>`
      SELECT p."content",
        (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
           FROM "procedureStep" s WHERE s."procedureId" = p."id") AS "steps",
        (SELECT coalesce(jsonb_agg(to_jsonb(pp)), '[]'::jsonb)
           FROM "procedureParameter" pp WHERE pp."procedureId" = p."id") AS "parameters"
      FROM "procedure" p
      WHERE p."id" = ${procedureId} AND p."companyId" = ${companyId}
    `
      .execute(trx)
      .then((result) => result.rows[0]);
    cache.set(procedureId, procedure);
  }
  return procedure;
}

async function insertProcedureDataForJobOperation(
  trx: Transaction<KyselyDatabase>,
  args: {
    operationId: string;
    procedureId: string;
    companyId: string;
    userId: string;
  }
) {
  const { operationId, procedureId, companyId, userId } = args;
  const procedure = await readProcedureForJob(trx, procedureId, companyId);
  if (!procedure) return;

  const copy = (row: Record<string, unknown>) => {
    const {
      id: _id,
      procedureId: _procedureId,
      createdAt: _createdAt,
      ...rest
    } = row;
    return { ...rest, operationId, companyId, createdBy: userId };
  };
  const steps = procedure.steps.map((step) => ({
    ...copy(step),
    description: toTiptapDoc(step.description as never)
  }));
  const parameters = procedure.parameters.map(copy);

  // The steps, parameters and work instruction go in one statement: each
  // data-modifying CTE runs once, whether or not the outer UPDATE reads it.
  let write: QueryCreator<KyselyDatabase> = trx;
  if (steps.length > 0) {
    write = write.with("steps", (db) =>
      db.insertInto("jobOperationStep").values(steps as never)
    ) as unknown as QueryCreator<KyselyDatabase>;
  }
  if (parameters.length > 0) {
    write = write.with("parameters", (db) =>
      db.insertInto("jobOperationParameter").values(parameters as never)
    ) as unknown as QueryCreator<KyselyDatabase>;
  }
  await write
    .updateTable("jobOperation")
    .set({ workInstruction: toJson(procedure.content ?? {}) })
    .where("id", "=", operationId)
    .where("companyId", "=", companyId)
    .execute();
}

type TreeOperation = Tables["methodOperation"]["Row"] & {
  methodOperationTool: Tables["methodOperationTool"]["Row"][];
  methodOperationParameter: Tables["methodOperationParameter"]["Row"][];
  methodOperationStep: Tables["methodOperationStep"]["Row"][];
};

/** Every node's method operations, read in one query instead of one per node. */
async function readOperationsForTree(
  trx: Transaction<KyselyDatabase>,
  root: MethodTreeItem
) {
  const makeMethodIds = new Set<string>();
  const walk = (node: MethodTreeItem) => {
    if (node.data.materialMakeMethodId)
      makeMethodIds.add(node.data.materialMakeMethodId);
    node.children.forEach(walk);
  };
  walk(root);
  const operations = await many<"methodOperation", TreeOperation>(
    trx,
    "methodOperation",
    { makeMethodId: [...makeMethodIds] },
    {
      embed: {
        methodOperationTool: {
          table: "methodOperationTool",
          on: "operationId"
        },
        methodOperationParameter: {
          table: "methodOperationParameter",
          on: "operationId"
        },
        methodOperationStep: { table: "methodOperationStep", on: "operationId" }
      }
    }
  );
  const byMakeMethodId = new Map<string, TreeOperation[]>();
  for (const operation of operations.data) {
    const list = byMakeMethodId.get(operation.makeMethodId);
    if (list) list.push(operation);
    else byMakeMethodId.set(operation.makeMethodId, [operation]);
  }
  return byMakeMethodId;
}

async function insertDeferredJobMaterials(
  trx: Transaction<KyselyDatabase>,
  materials: Database["public"]["Tables"]["jobMaterial"]["Insert"][],
  steps: Database["public"]["Tables"]["jobMaterialStep"]["Insert"][]
) {
  // Chunked: a whole tree in one statement can pass Postgres' 65535 bind
  // parameters.
  for (const chunk of chunked(materials)) {
    await trx.insertInto("jobMaterial").values(chunk).execute();
  }
  for (const chunk of chunked(steps)) {
    await trx.insertInto("jobMaterialStep").values(chunk).execute();
  }
}

/**
 * Gives the make-method rows that the jobMaterial / quoteMaterial insert
 * trigger created their planned ids, for every made material of an insert in
 * ONE statement.
 */
async function renameMakeMethods(
  trx: Transaction<KyselyDatabase>,
  args: {
    table: "jobMakeMethod" | "quoteMakeMethod";
    companyId: string;
    /** Narrows the match to one job or quote line, as the loops this replaced did. */
    scope?: { column: "jobId" | "quoteLineId"; value: string };
    /** Left unchanged where undefined, as `.set()` would. */
    rows: {
      parentMaterialId: string;
      id: string;
      quantityPerParent?: number | null;
    }[];
  }
) {
  const { table, companyId, scope } = args;
  for (const rows of chunked(args.rows)) {
    await renameMakeMethodChunk(trx, { table, companyId, scope, rows });
  }
}

async function renameMakeMethodChunk(
  trx: Transaction<KyselyDatabase>,
  args: Parameters<typeof renameMakeMethods>[1]
) {
  const { table, companyId, scope, rows } = args;
  const values = sql.join(
    rows.map(
      (row) =>
        sql`(${row.parentMaterialId}::text, ${row.id}::text, ${row.quantityPerParent ?? null}::numeric, ${row.quantityPerParent !== undefined}::boolean)`
    )
  );
  await sql`
    UPDATE ${sql.table(table)} AS t
    SET "id" = v."id",
      "quantityPerParent" = CASE WHEN v."setQuantity" THEN v."quantityPerParent" ELSE t."quantityPerParent" END
    FROM (VALUES ${values}) AS v("parentMaterialId", "id", "quantityPerParent", "setQuantity")
    WHERE t."parentMaterialId" = v."parentMaterialId"
      AND t."companyId" = ${companyId}
      ${scope ? sql`AND t.${sql.ref(scope.column)} = ${scope.value}` : sql``}
  `.execute(trx);
}

// Assembly analog of insertProcedureDataForJobOperation: an Assembly operation
// inherits its steps from the linked assembly instruction at job-creation time
// (the method/quote only carry the pointer). Mirrors the payload of
// syncAssemblyInstructionToOperation (production.service.ts) — including the
// assemblyInstructionStepId provenance marker, so the job-side re-sync
// reconciles these rows instead of duplicating them — and attaches the
// instruction's 3D model as a model slide on every step.
// Material ↔ step links are flushed separately by
// linkAssemblyStepMaterialsForJobOperations AFTER the direction's jobMaterial
// rows exist (operations are inserted before materials in every direction).
async function insertAssemblyDataForJobOperation(
  trx: Transaction<KyselyDatabase>,
  args: {
    operationId: string;
    assemblyInstructionId: string;
    companyId: string;
    userId: string;
  }
) {
  const { operationId, assemblyInstructionId, companyId, userId } = args;
  const instruction = await selectRow<
    "assemblyInstruction",
    Tables["assemblyInstruction"]["Row"] & {
      assemblyInstructionStep: Tables["assemblyInstructionStep"]["Row"][];
    }
  >(
    trx,
    "assemblyInstruction",
    { id: assemblyInstructionId, companyId },
    {
      embed: {
        assemblyInstructionStep: {
          table: "assemblyInstructionStep",
          on: "assemblyInstructionId"
        }
      }
    }
  );

  if (!instruction) return new Set<string>();

  // A sub-assembly (header) row is not a build action, so it never becomes a
  // job step; its member steps are copied in play order like any other.
  const sourceSteps = (instruction.assemblyInstructionStep ?? [])
    .filter((step) => !step.isSubAssembly)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (sourceSteps.length === 0) return new Set<string>();

  const sourceStepIds = sourceSteps.map((step) => step.id);
  const sourceSlides = await selectRows(
    trx,
    "assemblyInstructionStepSlide",
    { stepId: sourceStepIds, companyId },
    { orderBy: ["sortOrder"] }
  );
  const sourceTools = await selectRows(trx, "assemblyInstructionStepTool", {
    stepId: sourceStepIds,
    companyId
  });
  const slidesByStep = new Map<string, typeof sourceSlides>();
  for (const slide of sourceSlides) {
    const list = slidesByStep.get(slide.stepId) ?? [];
    list.push(slide);
    slidesByStep.set(slide.stepId, list);
  }
  const toolsByStep = new Map<string, { itemId: string; quantity: number }[]>();
  for (const tool of sourceTools) {
    const list = toolsByStep.get(tool.stepId) ?? [];
    list.push({ itemId: tool.itemId, quantity: tool.quantity ?? 1 });
    toolsByStep.set(tool.stepId, list);
  }

  // The operation's own steps (its procedure's, inserted before this) number
  // from 1 as well: the instruction's steps follow them, or the two interleave.
  const ownSteps = await trx
    .selectFrom("jobOperationStep")
    .select((eb) => eb.fn.max("sortOrder").as("lastSortOrder"))
    .where("operationId", "=", operationId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const firstSortOrder = Number(ownSteps?.lastSortOrder ?? 0) + 1;

  // Correlate inserted job steps back to their source steps via the provenance
  // column, not row order.
  const insertedSteps = await trx
    .insertInto("jobOperationStep")
    .values(
      sourceSteps.map((source, index) => ({
        operationId,
        name: source.title || `Step ${index + 1}`,
        type: source.type ?? "Task",
        description: toTiptapDoc(source.description ?? source.instructionText),
        required: source.required ?? false,
        unitOfMeasureCode: source.unitOfMeasureCode,
        minValue: source.minValue,
        maxValue: source.maxValue,
        listValues: source.listValues,
        fileTypes: source.fileTypes,
        sortOrder: firstSortOrder + index,
        assemblyInstructionStepId: source.id,
        companyId,
        createdBy: userId
      }))
    )
    .returning(["id", "assemblyInstructionStepId"])
    .execute();
  const targetIdBySource = new Map(
    insertedSteps.map((step) => [step.assemblyInstructionStepId, step.id])
  );

  // Per-step slides: the instruction's 3D model leads as a model slide,
  // followed by the step's authored slides (image XOR model, with captions,
  // sizes, and annotation pins).
  const slideRows: {
    stepId: string;
    imagePath: string | null;
    modelUploadId: string | null;
    caption: string | null;
    sortOrder: number;
    size: string;
    annotations: string;
    companyId: string;
    createdBy: string;
  }[] = [];
  for (const source of sourceSteps) {
    const targetStepId = targetIdBySource.get(source.id);
    if (!targetStepId) continue;
    const authored = slidesByStep.get(source.id) ?? [];
    const modelUploadId = instruction.modelUploadId;
    if (
      modelUploadId &&
      !authored.some((slide) => slide.modelUploadId === modelUploadId)
    ) {
      slideRows.push({
        stepId: targetStepId,
        imagePath: null,
        modelUploadId,
        caption: null,
        sortOrder: 0,
        size: "medium",
        annotations: JSON.stringify([]),
        companyId,
        createdBy: userId
      });
    }
    for (const slide of authored) {
      slideRows.push({
        stepId: targetStepId,
        imagePath: slide.imagePath,
        modelUploadId: slide.modelUploadId,
        caption: slide.caption,
        sortOrder: slide.sortOrder ?? 1,
        size: slide.size ?? "medium",
        annotations: JSON.stringify(slide.annotations ?? []),
        companyId,
        createdBy: userId
      });
    }
  }
  if (slideRows.length > 0) {
    await trx.insertInto("jobOperationStepSlide").values(slideRows).execute();
  }

  // Per-step tools: one jobOperationTool row per distinct tool item (quantity =
  // max across steps) plus the tool ↔ step scope links.
  const maxQuantityByItemId = new Map<string, number>();
  for (const tools of toolsByStep.values()) {
    for (const tool of tools) {
      maxQuantityByItemId.set(
        tool.itemId,
        Math.max(maxQuantityByItemId.get(tool.itemId) ?? 0, tool.quantity)
      );
    }
  }
  if (maxQuantityByItemId.size > 0) {
    // The operation may already carry rows for these tools (the quote → job
    // direction copies quoteOperationTool BEFORE this runs). Link steps to the
    // existing row instead of inserting a duplicate the MES would list twice.
    const existingTools = await trx
      .selectFrom("jobOperationTool")
      .select(["id", "toolId"])
      .where("operationId", "=", operationId)
      .execute();
    const toolRowIdByItemId = new Map(
      existingTools.map((tool) => [tool.toolId, tool.id])
    );
    const missingTools = [...maxQuantityByItemId.entries()].filter(
      ([itemId]) => !toolRowIdByItemId.has(itemId)
    );
    if (missingTools.length > 0) {
      const insertedTools = await trx
        .insertInto("jobOperationTool")
        .values(
          missingTools.map(([itemId, quantity]) => ({
            operationId,
            toolId: itemId,
            quantity,
            companyId,
            createdBy: userId
          }))
        )
        .returning(["id", "toolId"])
        .execute();
      for (const tool of insertedTools) {
        toolRowIdByItemId.set(tool.toolId, tool.id);
      }
    }
    const toolLinkRows: {
      jobOperationToolId: string;
      jobOperationStepId: string;
    }[] = [];
    for (const source of sourceSteps) {
      const targetStepId = targetIdBySource.get(source.id);
      if (!targetStepId) continue;
      for (const tool of toolsByStep.get(source.id) ?? []) {
        const jobOperationToolId = toolRowIdByItemId.get(tool.itemId);
        if (jobOperationToolId) {
          toolLinkRows.push({
            jobOperationToolId,
            jobOperationStepId: targetStepId
          });
        }
      }
    }
    if (toolLinkRows.length > 0) {
      await trx
        .insertInto("jobOperationToolStep")
        .values(toolLinkRows)
        .execute();
    }
  }
  // Tool ids the instruction accounts for — the method → job copy paths filter
  // methodOperationTool by this set so the same tool isn't inserted a second
  // time (unlinked, so the MES would show it on every step AND on its step).
  return new Set(maxQuantityByItemId.keys());
}

// Post-materials pass: link the assembly-materialized job steps to the job's
// materials, resolving the instruction's per-step itemIds against the
// operation's own make method (same resolution the app-side sync performs).
// Must read jobOperation/jobOperationStep/jobMaterial through the TRANSACTION —
// those rows are uncommitted at this point.
async function linkAssemblyStepMaterialsForJobOperations(
  trx: Transaction<KyselyDatabase>,
  operations: Array<{ operationId: string; assemblyInstructionId: string }>,
  companyId: string
) {
  for (const { operationId } of operations) {
    const operation = await trx
      .selectFrom("jobOperation")
      .select(["jobMakeMethodId"])
      .where("id", "=", operationId)
      .executeTakeFirst();
    if (!operation?.jobMakeMethodId) continue;

    const steps = await trx
      .selectFrom("jobOperationStep")
      .select(["id", "assemblyInstructionStepId"])
      .where("operationId", "=", operationId)
      .where("assemblyInstructionStepId", "is not", null)
      .execute();
    if (steps.length === 0) continue;

    const sourceStepIds = steps.map(
      (step) => step.assemblyInstructionStepId as string
    );
    const stepMaterials = await trx
      .selectFrom("assemblyInstructionStepMaterial")
      .select(["stepId", "itemId", "quantity"])
      .where("stepId", "in", sourceStepIds)
      .where("companyId", "=", companyId)
      .execute();
    if (stepMaterials.length === 0) continue;

    const jobMaterials = await trx
      .selectFrom("jobMaterial")
      .select(["id", "itemId"])
      .where("jobMakeMethodId", "=", operation.jobMakeMethodId)
      .where("companyId", "=", companyId)
      .execute();
    const materialIdByItemId = new Map(
      jobMaterials.map((material) => [material.itemId, material.id])
    );
    const jobStepBySourceStep = new Map(
      steps.map((step) => [step.assemblyInstructionStepId as string, step.id])
    );

    const linkRows = stepMaterials.flatMap((link) => {
      const jobOperationStepId = jobStepBySourceStep.get(link.stepId);
      const jobMaterialId = link.itemId
        ? materialIdByItemId.get(link.itemId)
        : undefined;
      return jobOperationStepId && jobMaterialId
        ? [
            {
              jobMaterialId,
              jobOperationStepId,
              quantity: link.quantity ?? null
            }
          ]
        : [];
    });

    if (linkRows.length > 0) {
      await trx
        .insertInto("jobMaterialStep")
        .values(linkRows)
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
}

async function hydrateConfiguration(
  db: Kysely<KyselyDatabase>,
  configuration: Record<string, unknown> | undefined,
  itemId: string | undefined | null,
  companyId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    if (!configuration || !itemId || Object.keys(configuration).length === 0) {
      return configuration;
    }

    const materialParams = await db
      .selectFrom("configurationParameter")
      .select(["key"])
      .where("itemId", "=", itemId)
      .where("companyId", "=", companyId)
      .where("dataType", "=", "material")
      .execute();

    const materialKeys = new Set(materialParams.map((p) => p.key));

    if (materialKeys.size === 0) return configuration;

    const entries = Object.entries(configuration).filter(
      ([key, value]) =>
        materialKeys.has(key) && typeof value === "string" && value
    );

    if (entries.length === 0) return configuration;

    const itemIds = entries.map(([, value]) => value as string);

    // Get items that correspond to the item IDs
    const items = await db
      .selectFrom("item")
      .select(["id", "readableId"])
      .where("id", "in", itemIds)
      .where("companyId", "=", companyId)
      .execute();

    // Create map of itemId to readableId (which is the materialId)
    const itemIdToMaterialId = new Map(items.map((i) => [i.id, i.readableId]));

    const materialIds = items.map((i) => i.readableId);
    if (materialIds.length === 0) return configuration;

    // Get material details using the readableIds (which are the material IDs)
    const materials = await db
      .selectFrom("material")
      .select([
        "id",
        "materialFormId",
        "materialSubstanceId",
        "materialTypeId",
        "dimensionId",
        "finishId",
        "gradeId"
      ])
      .where("id", "in", materialIds)
      .where("companyId", "=", companyId)
      .execute();

    const materialsByMaterialId = new Map(materials.map((m) => [m.id, m]));

    const transformed: Record<string, unknown> = { ...configuration };

    for (const [key, value] of entries) {
      const itemId = value as string;
      const materialId = itemIdToMaterialId.get(itemId);

      if (materialId) {
        const material = materialsByMaterialId.get(materialId);
        if (material) {
          transformed[key] = {
            id: itemId,
            materialFormId: material.materialFormId ?? null,
            materialSubstanceId: material.materialSubstanceId ?? null,
            materialTypeId: material.materialTypeId ?? null,
            dimensionId: material.dimensionId ?? null,
            finishId: material.finishId ?? null,
            gradeId: material.gradeId ?? null
          };
        }
      }
    }

    return transformed;
  } catch (err) {
    getMethodLogger.error("configuration transform failed", {
      error: String((err as Error)?.stack ?? err)
    });
    return configuration;
  }
}
const rescheduleJobLogger = getLogger("server-functions", "reschedule");
// Types
type JobOperation = {
  id: string;
  jobId: string;
  workCenterId: string | null;
  status: string;
  priority: number | null;
  dueDate: string | null;
  startDate: string | null;
  setupTime: number | null;
  laborTime: number | null;
  machineTime: number | null;
  setupUnit: string | null;
  laborUnit: string | null;
  machineUnit: string | null;
  operationQuantity: number | null;
};

type JobOperationDependency = {
  operationId: string;
  dependsOnId: string;
  jobId: string;
};

type DependencyGraph = Map<
  string,
  {
    dependsOn: string[];
    requiredBy: string[];
  }
>;

type ScheduledOperation = JobOperation & {
  hasConflict: boolean;
  conflictReason: string | null;
};

type OperationWithJobInfo = {
  id: string;
  dueDate: string | null;
  priority: number | null;
  deadlineType: string | null;
  jobPriority: number | null;
  workCenterId: string | null;
};

// Helper: Get job with operations and dependencies
async function getJobWithOperations(
  trx: Transaction<KyselyDatabase>,
  jobId: string
) {
  const job = await trx
    .selectFrom("job")
    .select(["id", "dueDate", "priority", "deadlineType"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();

  const operations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("jobId", "=", jobId)
    .where("status", "not in", ["Done", "Canceled"])
    .execute();

  const dependencies = await trx
    .selectFrom("jobOperationDependency")
    .selectAll()
    .where("jobId", "=", jobId)
    .execute();

  return { job, operations, dependencies };
}

// Helper: Build dependency graph
function buildDependencyGraph(
  operations: JobOperation[],
  dependencies: JobOperationDependency[]
): DependencyGraph {
  const graph = new Map<
    string,
    {
      dependsOn: string[];
      requiredBy: string[];
    }
  >();

  // Initialize all operations
  for (const op of operations) {
    graph.set(op.id, { dependsOn: [], requiredBy: [] });
  }

  // Build edges
  for (const dep of dependencies) {
    const opNode = graph.get(dep.operationId);
    const depNode = graph.get(dep.dependsOnId);

    if (opNode) {
      opNode.dependsOn.push(dep.dependsOnId);
    }
    if (depNode) {
      depNode.requiredBy.push(dep.operationId);
    }
  }

  return graph;
}

// Helper: Topological sort
function topologicalSort(
  operations: JobOperation[],
  graph: DependencyGraph,
  direction: "forward" | "reverse"
): JobOperation[] {
  const inDegree = new Map<string, number>();
  const queue: string[] = [];
  const result: JobOperation[] = [];

  // Calculate in-degrees
  for (const op of operations) {
    const deps =
      direction === "forward"
        ? graph.get(op.id)?.dependsOn || []
        : graph.get(op.id)?.requiredBy || [];
    inDegree.set(op.id, deps.length);
    if (deps.length === 0) queue.push(op.id);
  }

  // Process queue
  while (queue.length > 0) {
    const opId = queue.shift()!;
    const op = operations.find((o) => o.id === opId)!;
    result.push(op);

    const neighbors =
      direction === "forward"
        ? graph.get(opId)?.requiredBy || []
        : graph.get(opId)?.dependsOn || [];

    for (const neighborId of neighbors) {
      const degree = inDegree.get(neighborId)! - 1;
      inDegree.set(neighborId, degree);
      if (degree === 0) queue.push(neighborId);
    }
  }

  return result;
}

// Helper: Calculate operation duration in days
function calculateOperationDuration(op: JobOperation): number {
  const quantity = op.operationQuantity || 1;

  // Calculate total hours
  let setupHours = 0;
  let laborHours = 0;
  let machineHours = 0;

  if (op.setupTime) {
    setupHours =
      op.setupUnit === "Hours/Piece" ? op.setupTime * quantity : op.setupTime;
  }

  if (op.laborTime) {
    laborHours =
      op.laborUnit === "Hours/Piece" ? op.laborTime * quantity : op.laborTime;
  }

  if (op.machineTime) {
    machineHours =
      op.machineUnit === "Hours/Piece"
        ? op.machineTime * quantity
        : op.machineTime;
  }

  // Total hours (setup + max of labor/machine since they can overlap)
  const totalHours = setupHours + Math.max(laborHours, machineHours);

  // Convert to days (assuming 8-hour workday)
  const days = totalHours / 8;

  // Round up to at least 1 day
  return Math.max(Math.ceil(days), 1);
}

// Helper: Backward schedule operations
function backwardScheduleOperations(
  operations: JobOperation[],
  graph: DependencyGraph,
  jobDueDate: string | null
): ScheduledOperation[] {
  const scheduled = new Map<string, ScheduledOperation>();
  const today = new Date().toISOString().split("T")[0]!;

  // Default to today if no due date
  const finalDueDate = jobDueDate || today;

  // Topological sort (reverse: final ops first)
  const sorted = topologicalSort(operations, graph, "reverse");

  for (const op of sorted) {
    const deps = graph.get(op.id);
    if (!deps) continue;

    const totalDuration = calculateOperationDuration(op);

    // Calculate due date
    let dueDate: string;
    if (deps.requiredBy.length === 0) {
      // Leaf operation: use job due date
      dueDate = finalDueDate;
    } else {
      // Has dependents: must finish before earliest dependent starts
      const dependentStartDates = deps.requiredBy
        .map((depId) => scheduled.get(depId)?.startDate)
        .filter((date): date is string => date !== null && date !== undefined);

      if (dependentStartDates.length === 0) {
        dueDate = finalDueDate;
      } else {
        // Subtract 1 day buffer
        const minDate = new Date(
          Math.min(...dependentStartDates.map((d) => new Date(d).getTime()))
        );
        minDate.setDate(minDate.getDate() - 1);
        dueDate = minDate.toISOString().split("T")[0]!;
      }
    }

    // Calculate start date
    const dueDateObj = new Date(dueDate);
    dueDateObj.setDate(dueDateObj.getDate() - totalDuration);
    const startDate = dueDateObj.toISOString().split("T")[0]!;

    // Check for conflicts
    const hasConflict = startDate < today;
    const conflictReason = hasConflict
      ? `Operation must start on ${startDate} but current date is ${today}`
      : null;

    scheduled.set(op.id, {
      ...op,
      startDate,
      dueDate,
      hasConflict,
      conflictReason
    });
  }

  return Array.from(scheduled.values());
}

// Helper: Sort operations by priority criteria
function sortOperationsByPriority(
  operations: OperationWithJobInfo[]
): OperationWithJobInfo[] {
  const deadlineOrder: Record<string, number> = {
    ASAP: 0,
    "Hard Deadline": 1,
    "Soft Deadline": 2,
    "No Deadline": 3
  };

  return operations.sort((a, b) => {
    // 1. Deadline type
    const aDeadline = a.deadlineType || "No Deadline";
    const bDeadline = b.deadlineType || "No Deadline";
    if (aDeadline !== bDeadline) {
      return deadlineOrder[aDeadline]! - deadlineOrder[bDeadline]!;
    }

    // 2. Due date (earliest first, nulls last)
    if (a.dueDate && b.dueDate) {
      const dateCompare =
        new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      if (dateCompare !== 0) return dateCompare;
    } else if (a.dueDate) {
      return -1;
    } else if (b.dueDate) {
      return 1;
    }

    // 3. Job priority
    const aPriority = a.jobPriority || 0;
    const bPriority = b.jobPriority || 0;
    return aPriority - bPriority;
  });
}

// Helper: Apply fractional priorities
function applyFractionalPriorities(
  sorted: OperationWithJobInfo[]
): OperationWithJobInfo[] {
  return sorted.map((op, index) => {
    if (index === 0) {
      op.priority = 0;
    } else {
      const prevPriority = sorted[index - 1]!.priority || 0;
      op.priority = prevPriority + 1;
    }
    return op;
  });
}

// Helper: Recalculate priorities by work center
async function recalculatePriorities(
  trx: Transaction<KyselyDatabase>,
  scheduledOps: ScheduledOperation[],
  workCenterIds: string[]
): Promise<ScheduledOperation[]> {
  const prioritizedOps = [...scheduledOps];

  for (const wcId of workCenterIds) {
    if (!wcId) continue;

    // Get ALL active operations at this work center (not just from current job)
    const allWcOps = await trx
      .selectFrom("jobOperation as jo")
      .innerJoin("job as j", "j.id", "jo.jobId")
      .select([
        "jo.id",
        "jo.dueDate",
        "jo.priority",
        "j.deadlineType",
        "j.priority as jobPriority",
        "jo.workCenterId"
      ])
      .where("jo.workCenterId", "=", wcId)
      .where("jo.status", "not in", ["Done", "Canceled"])
      .execute();

    // Merge with scheduled ops (use scheduled data if available)
    const mergedOps = allWcOps.map((wcOp) => {
      const scheduled = scheduledOps.find((s) => s.id === wcOp.id);
      if (scheduled) {
        return {
          id: scheduled.id,
          dueDate: scheduled.dueDate,
          priority: scheduled.priority,
          deadlineType: wcOp.deadlineType,
          jobPriority: wcOp.jobPriority,
          workCenterId: wcOp.workCenterId
        };
      }
      return wcOp;
    });

    // Sort by priority criteria
    const sorted = sortOperationsByPriority(mergedOps);

    // Apply fractional indexing
    const prioritized = applyFractionalPriorities(sorted);

    // Update prioritized ops
    for (const op of prioritized) {
      const idx = prioritizedOps.findIndex((p) => p.id === op.id);
      if (idx >= 0) {
        prioritizedOps[idx]!.priority = op.priority;
      }
    }
  }

  return prioritizedOps;
}

export const rescheduleJobPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof rescheduleInput>>;

/**
 * Re-plans a job's operations: backward-schedules their dates from the job's due
 * date, flags conflicts, and recalculates priorities on the affected work centers.
 */
export async function rescheduleJob(
  ctx: ServiceContext,
  raw: z.input<typeof rescheduleInput>
) {
  const { jobId } = rescheduleInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  const owned = await db
    .selectFrom("job")
    .select("id")
    .where("id", "=", jobId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!owned) throw new NotFoundError("Job not found");

  rescheduleJobLogger.info(`🔰 Starting reschedule for job ${jobId}`);

  const result = await db.transaction().execute(async (trx) => {
    // 1. Get job and all its operations with dependencies
    const { job, operations, dependencies } = await getJobWithOperations(
      trx,
      jobId
    );

    rescheduleJobLogger.info(
      `📊 Job has ${operations.length} operations, ${dependencies.length} dependencies`
    );

    // 2. Build dependency graph
    const graph = buildDependencyGraph(operations, dependencies);

    // 3. Backward schedule (calculate dates, flag conflicts)
    const scheduledOps = backwardScheduleOperations(
      operations,
      graph,
      job.dueDate
    );

    const conflicts = scheduledOps.filter((op) => op.hasConflict);
    rescheduleJobLogger.info(
      `⚠️  Detected ${conflicts.length} scheduling conflicts`
    );

    // 4. Get affected work centers
    const workCenterIds = [
      ...new Set(
        scheduledOps
          .map((op) => op.workCenterId)
          .filter((id): id is string => id !== null)
      )
    ];

    rescheduleJobLogger.info(
      `🏭 Affected work centers: ${workCenterIds.length}`
    );

    // 5. Recalculate priorities for each work center
    const prioritizedOps = await recalculatePriorities(
      trx,
      scheduledOps,
      workCenterIds
    );

    // 6. Batch update all operations
    for (const op of prioritizedOps) {
      await trx
        .updateTable("jobOperation")
        .set({
          startDate: op.startDate,
          dueDate: op.dueDate,
          priority: op.priority!,
          hasConflict: op.hasConflict,
          conflictReason: op.conflictReason,
          updatedAt: datetime.timestamp(),
          updatedBy: userId
        })
        .where("id", "=", op.id)
        .where("companyId", "=", companyId)
        .execute();
    }

    rescheduleJobLogger.info(`✅ Updated ${prioritizedOps.length} operations`);

    return {
      operationsUpdated: prioritizedOps.length,
      conflictsDetected: conflicts.length,
      workCentersAffected: workCenterIds.length
    };
  });

  return { success: true, ...result };
}

export const PRODUCTION_EVENT_POSTED_CONCURRENTLY_ERROR =
  "This production event was just posted by another process.";

/** The net amount posted for one event so far, per account. */
async function readPostedNet(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  eventReference: string
) {
  const lines = await db
    .selectFrom("journalLine")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "journalLine.journalId")
        .onRef("journal.companyId", "=", "journalLine.companyId")
    )
    .select([
      "journalLine.accountId",
      "journalLine.accountDefaultRole",
      (eb) => eb.fn.sum("journalLine.amount").as("amount")
    ])
    .where("journalLine.documentLineReference", "=", eventReference)
    .where("journalLine.companyId", "=", companyId)
    .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
    .groupBy(["journalLine.accountId", "journalLine.accountDefaultRole"])
    .execute();
  return lines.filter((line) => Math.abs(Number(line.amount)) >= 0.000001);
}

/** A posted net as one comparable value, independent of row order. */
const postedNetKey = (lines: Awaited<ReturnType<typeof readPostedNet>>) =>
  lines
    .map(
      (line) =>
        `${line.accountId}|${line.accountDefaultRole ?? ""}|${round(Number(line.amount))}`
    )
    .sort()
    .join(";");

export const postProductionEventPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof postProductionEventInput>>;

/** Posts (or reverses) a production event's labor/machine and overhead cost to WIP. */
export async function postProductionEvent(
  ctx: ServiceContext,
  raw: z.input<typeof postProductionEventInput>
): Promise<PostProductionEventResult> {
  const { productionEventId, reverse } = postProductionEventInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const today = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  const companyRecord = await single(
    db,
    "company",
    { id: companyId },
    { columns: ["companyGroupId"] }
  );

  if (companyRecord.error) throw new Error("Failed to fetch company");

  const [productionEvent, accountDefaults, dimensions] = await inOrder([
    () =>
      // `jobOperation!inner`: only an event that belongs to an operation.
      maybeSingle<
        "productionEvent",
        rows.Tables["productionEvent"]["Row"] & {
          jobOperation: Pick<
            rows.Tables["jobOperation"]["Row"],
            "jobId" | "processId"
          > | null;
        }
      >(
        db,
        "productionEvent",
        { id: productionEventId, companyId, jobOperationId: notNull },
        {
          embed: {
            jobOperation: {
              table: "jobOperation",
              via: "jobOperationId",
              columns: ["jobId", "processId"]
            }
          }
        }
      ),
    () => getDefaultPostingGroup(db, companyId),
    () =>
      companyRecord.data.companyGroupId
        ? many(
            db,
            "dimension",
            {
              companyGroupId: companyRecord.data.companyGroupId,
              active: true,
              entityType: [
                "ItemPostingGroup",
                "Item",
                "Location",
                "Employee",
                "WorkCenter",
                "Process"
              ]
            },
            { columns: ["id", "entityType"] }
          )
        : Promise.resolve({ data: null, error: null })
  ]);

  if (productionEvent.error)
    throw new Error("Failed to fetch production event");
  // Service-role client: a production event outside companyId is a 404.
  if (!productionEvent.data) {
    throw new NotFoundError("Production event not found");
  }
  if (accountDefaults?.error || !accountDefaults?.data) {
    throw new Error("Error getting account defaults");
  }

  // Every event with a cost posts a journal: Provisional before the
  // company's accounting cutover, Posted after it. Read here to decide
  // whether to resolve a period, and again inside the transaction.
  const postingStatus = await journalPostingStatus(db, companyId);

  // After the cutover an empty absorption account refuses the posting, as
  // it always has. Before it, the line becomes a stand-in (see below).
  if (
    postingStatus === "Posted" &&
    !accountDefaults.data.laborAbsorptionAccount
  ) {
    throw new MissingAccountDefaultError("laborAbsorptionAccount");
  }

  const event = productionEvent.data;

  if (reverse && !event.postedToGL) {
    // Nothing was posted for this event, so there is nothing to reverse.
    return { success: true } as PostProductionEventResult;
  }

  if (!reverse && (!event.endTime || !event.duration || !event.workCenterId)) {
    // Leave postedToGL untouched so the event can still be posted later
    // (manually or by complete_job_to_inventory) once it's completable.
    const reason = !event.endTime
      ? "event has no end time"
      : !event.duration
        ? "event has no duration"
        : "event has no work center";
    return { success: false, reason } as PostProductionEventResult;
  }

  const jobId = (event.jobOperation as any).jobId as string;

  let cost = 0;
  let overheadCost = 0;
  if (!reverse) {
    const workCenter = await single(
      db,
      "workCenter",
      { id: event.workCenterId! },
      { columns: ["laborRate", "machineRate", "overheadRate"] }
    );

    if (workCenter.error)
      throw new Error(
        `Failed to fetch work center ${event.workCenterId}: ${workCenter.error.message}`
      );

    const durationHours = (event.duration ?? 0) / 3600;
    const rate =
      event.type === "Machine"
        ? Number(workCenter.data.machineRate ?? 0)
        : Number(workCenter.data.laborRate ?? 0);

    cost = durationHours * rate;
    overheadCost = durationHours * Number(workCenter.data.overheadRate ?? 0);

    if (
      postingStatus === "Posted" &&
      overheadCost > 0 &&
      !accountDefaults.data.overheadAbsorptionAccount
    ) {
      throw new MissingAccountDefaultError("overheadAbsorptionAccount");
    }
  }

  // Net amount already posted for this specific event, grouped by account.
  const eventReference = journalReference.to.productionEvent(productionEventId);

  // The enable superseded the journal of an event posted before the
  // cutover and opened the job's WIP with its cost, so the reads below see
  // nothing to reverse: a re-post would add the cost again and a reversal
  // would leave it. The re-post is dated today, after the cutover, so no
  // closed period refuses it.
  if (event.postedToGL) {
    const superseded = await db
      .selectFrom("journalLine")
      .innerJoin("journal", (join) =>
        join
          .onRef("journal.id", "=", "journalLine.journalId")
          .onRef("journal.companyId", "=", "journalLine.companyId")
      )
      .select("journalLine.id")
      .where("journalLine.documentLineReference", "=", eventReference)
      .where("journalLine.companyId", "=", companyId)
      .where("journal.status", "=", "Superseded")
      .limit(1)
      .executeTakeFirst();
    if (superseded) {
      throw new InvalidInputError(TIME_ENTRY_BEFORE_CUTOVER_ERROR);
    }
  }
  const reversalLines = event.postedToGL
    ? await readPostedNet(db, companyId, eventReference)
    : [];

  // Did this event's job post any production-event lines under the old
  // job-tagged scheme (documentLineReference = job:...)? Those can't be
  // attributed to one event, so editing/reversing a posted event that has no
  // per-event lines can't be done safely — it needs a manual journal entry.
  // This is rate-independent: unlike recomputing cost, it still recognizes a
  // zero-cost posted event (which posted nothing) as safe to delete even
  // after the work center's rate later changes.
  const hasOldSchemePostings =
    event.postedToGL && reversalLines.length === 0
      ? Number(
          (
            await db
              .selectFrom("journalLine")
              .innerJoin("journal", (join) =>
                join
                  .onRef("journal.id", "=", "journalLine.journalId")
                  .onRef("journal.companyId", "=", "journalLine.companyId")
              )
              .select((eb) => eb.fn.countAll().as("count"))
              .where("journalLine.documentType", "=", "Production Event")
              .where("journalLine.documentId", "=", jobId)
              .where(
                "journalLine.documentLineReference",
                "=",
                journalReference.to.job(jobId)
              )
              .where("journalLine.companyId", "=", companyId)
              .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
              .executeTakeFirst()
          )?.count ?? 0
        ) > 0
      : false;

  // Block only when the event posted amounts under the old scheme that we
  // can't attribute/reverse. A zero-cost posted event posted nothing, so
  // there's nothing to reverse and it's safe to delete.
  if (event.postedToGL && reversalLines.length === 0 && hasOldSchemePostings) {
    return {
      success: false,
      reason:
        "event was posted before per-event journal references; adjust with a manual journal entry"
    } as PostProductionEventResult;
  }

  if (cost <= 0 && overheadCost <= 0 && reversalLines.length === 0) {
    // Nothing to post and nothing to reverse. On a reversal this clears the
    // flag so the event can be deleted; on a post it marks it done.
    await updateRows(
      db,
      "productionEvent",
      { postedToGL: !reverse },
      { id: productionEventId, companyId }
    );
    return { success: true } as PostProductionEventResult;
  }

  const dimensionMap = new Map<string, string>();
  if (dimensions?.data) {
    for (const dim of dimensions.data) {
      if (dim.entityType) dimensionMap.set(dim.entityType, dim.id);
    }
  }

  const job = await single(
    db,
    "job",
    { id: jobId },
    { columns: ["itemId", "locationId", "jobId"] }
  );

  if (job.error) throw new Error("Failed to fetch job");

  const finishedItemCost = job.data.itemId
    ? await single(
        db,
        "itemCost",
        { itemId: job.data.itemId, companyId },
        { columns: ["itemPostingGroupId"] }
      )
    : null;

  const journalLineReference = nanoid();

  // Resolved only for a line that is built: after the cutover an empty
  // default has already refused the posting above.
  const laborAbsorption =
    !reverse && cost > 0
      ? resolveDefaultAccount(
          accountDefaults.data,
          "laborAbsorptionAccount",
          postingStatus
        )
      : null;
  const overheadAbsorption =
    !reverse && overheadCost > 0
      ? resolveDefaultAccount(
          accountDefaults.data,
          "overheadAbsorptionAccount",
          postingStatus
        )
      : null;

  const journalLineInserts = [
    // Reposting an edited event: first negate the net previously posted for
    // this event per account, then post the new amount.
    ...reversalLines.map((line) => ({
      accountId: line.accountId,
      accountDefaultRole: line.accountDefaultRole,
      description: "Production Event Reversal",
      amount: round(-Number(line.amount)),
      quantity: 1,
      documentType: "Production Event" as const,
      documentId: jobId,
      documentLineReference: eventReference,
      journalLineReference,
      companyId
    })),
    ...(laborAbsorption
      ? [
          {
            accountId: accountDefaults.data.workInProgressAccount,
            accountDefaultRole: null,
            description: "WIP Account",
            amount: round(debit("asset", cost)),
            quantity: 1,
            documentType: "Production Event" as const,
            documentId: jobId,
            documentLineReference: eventReference,
            journalLineReference,
            companyId
          },
          {
            accountId: laborAbsorption.accountId,
            accountDefaultRole: laborAbsorption.accountDefaultRole,
            description: "Labor/Machine Absorption",
            amount: round(credit("expense", cost)),
            quantity: 1,
            documentType: "Production Event" as const,
            documentId: jobId,
            documentLineReference: eventReference,
            journalLineReference,
            companyId
          }
        ]
      : []),
    ...(overheadAbsorption
      ? [
          {
            accountId: accountDefaults.data.workInProgressAccount,
            accountDefaultRole: null,
            description: "WIP Account (Overhead)",
            amount: round(debit("asset", overheadCost)),
            quantity: 1,
            documentType: "Production Event" as const,
            documentId: jobId,
            documentLineReference: eventReference,
            journalLineReference,
            companyId
          },
          {
            accountId: overheadAbsorption.accountId,
            accountDefaultRole: overheadAbsorption.accountDefaultRole,
            description: "Overhead Absorption",
            amount: round(credit("expense", overheadCost)),
            quantity: 1,
            documentType: "Production Event" as const,
            documentId: jobId,
            documentLineReference: eventReference,
            journalLineReference,
            companyId
          }
        ]
      : [])
  ];

  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getCurrentAccountingPeriod(companyId, db, today)
      : null;

  await db.transaction().execute(async (trx) => {
    await assertPostingStatusUnchanged(trx, companyId, postingStatus);

    // Several callers post an event as it ends: a press, the OEE sync, an
    // operation finish, an edit's repost. Under the row lock, a second
    // caller that read the event before the first committed sees what the
    // first wrote and stops, instead of posting the cost or the adjustment
    // twice: the flag for a first post, the net already posted for a
    // repost (the flag stays true across reposts).
    const locked = await trx
      .selectFrom("productionEvent")
      .select("postedToGL")
      .where("id", "=", productionEventId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !locked ||
      locked.postedToGL !== event.postedToGL ||
      (locked.postedToGL &&
        postedNetKey(await readPostedNet(trx, companyId, eventReference)) !==
          postedNetKey(reversalLines))
    ) {
      throw new ServerFnError(PRODUCTION_EVENT_POSTED_CONCURRENTLY_ERROR, 409);
    }

    const journalEntryId = await getNextSequence(
      trx,
      "journalEntry",
      companyId
    );

    const journalResult = await trx
      .insertInto("journal")
      .values({
        journalEntryId,
        accountingPeriodId,
        description: `${event.type} Time — Job ${job.data.jobId}${
          reverse
            ? " (Reversal)"
            : reversalLines.length > 0
              ? " (Adjustment)"
              : ""
        }`,
        postingDate: today,
        companyId,
        sourceType: "Production Event",
        status: postingStatus,
        postedAt: datetime.timestamp(),
        postedBy: userId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    const journalLineResults = await trx
      .insertInto("journalLine")
      .values(
        journalLineInserts.map((line) => ({
          ...line,
          journalId: journalResult.id
        }))
      )
      .returning(["id"])
      .execute();

    if (dimensionMap.size > 0) {
      const dimensionInserts: {
        journalLineId: string;
        dimensionId: string;
        valueId: string;
        companyId: string;
      }[] = [];

      journalLineResults.forEach((jl) => {
        if (
          finishedItemCost?.data?.itemPostingGroupId &&
          dimensionMap.has("ItemPostingGroup")
        ) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("ItemPostingGroup")!,
            valueId: finishedItemCost.data.itemPostingGroupId,
            companyId
          });
        }
        if (job.data.itemId && dimensionMap.has("Item")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("Item")!,
            valueId: job.data.itemId,
            companyId
          });
        }
        if (job.data.locationId && dimensionMap.has("Location")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("Location")!,
            valueId: job.data.locationId,
            companyId
          });
        }
        if (event.employeeId && dimensionMap.has("Employee")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("Employee")!,
            valueId: event.employeeId,
            companyId
          });
        }
        if (event.workCenterId && dimensionMap.has("WorkCenter")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("WorkCenter")!,
            valueId: event.workCenterId,
            companyId
          });
        }
        const processId = (event.jobOperation as any)?.processId as
          | string
          | null;
        if (processId && dimensionMap.has("Process")) {
          dimensionInserts.push({
            journalLineId: jl.id,
            dimensionId: dimensionMap.get("Process")!,
            valueId: processId,
            companyId
          });
        }
      });

      if (dimensionInserts.length > 0) {
        await trx
          .insertInto("journalLineDimension")
          .values(dimensionInserts)
          .execute();
      }
    }

    await trx
      .updateTable("productionEvent")
      .set({ postedToGL: !reverse })
      .where("id", "=", productionEventId)
      .where("companyId", "=", companyId)
      .execute();
  });

  return { success: true };
}
const recalculateRequirementsLogger = getLogger(
  "server-functions",
  "recalculate"
);
export const recalculateRequirementsPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof recalculateInput>>;

/** Re-derives a job's (or one make method's) material and operation quantities. */
export async function recalculateRequirements(
  ctx: ServiceContext,
  raw: z.input<typeof recalculateInput>
) {
  const { type, id } = recalculateInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  recalculateRequirementsLogger.info({ type, id, companyId, userId });

  // Every read here goes over the direct connection: a PostgREST call costs
  // roughly ten times a statement, and this runs on every job save.
  switch (type) {
    case "jobMakeMethodRequirements": {
      const jobMakeMethodId = id;

      const jobMakeMethod = await db
        .selectFrom("jobMakeMethod")
        .select(["id", "jobId", "parentMaterialId"])
        .where("id", "=", jobMakeMethodId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();

      // A make method outside companyId is a 404.
      if (!jobMakeMethod) {
        throw new NotFoundError("Job make method not found");
      }

      let parentQuantity = 1;
      if (jobMakeMethod.parentMaterialId) {
        const jobMaterial = await db
          .selectFrom("jobMaterial")
          .select(["methodType", "estimatedQuantity", "quantity"])
          .where("id", "=", jobMakeMethod.parentMaterialId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();

        if (jobMaterial?.methodType !== "Make to Order") {
          recalculateRequirementsLogger.info(
            `Job material ${jobMakeMethod.parentMaterialId} is not a 'Make' type. Skipping recalculation.`
          );
          return { success: true };
        }

        parentQuantity = jobMaterial.estimatedQuantity ?? jobMaterial.quantity;
      } else {
        const job = await db
          .selectFrom("job")
          .select(["quantity"])
          .where("id", "=", jobMakeMethod.jobId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!job) {
          throw new Error("Failed to get job");
        }
        // Use job.quantity as the root's target quantity (not productionQuantity)
        // The item's scrap percentage will be applied within updateJobQuantities
        parentQuantity = job.quantity ?? 1;
      }

      const jobMethodTrees = await getJobMethodTree(
        db,
        jobMakeMethod.id,
        jobMakeMethod.parentMaterialId
      );

      const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
      if (!jobMethodTree) {
        throw new NotFoundError("Method tree not found");
      }

      await db.transaction().execute(async (trx) => {
        await updateJobQuantities(trx, jobMethodTree, parentQuantity);
      });

      break;
    }
    case "jobRequirements": {
      const jobId = id;
      const [job, jobMakeMethods] = await inOrder([
        () =>
          db
            .selectFrom("job")
            .select(["quantity"])
            .where("id", "=", jobId)
            .where("companyId", "=", companyId)
            .executeTakeFirst(),
        () =>
          db
            .selectFrom("jobMakeMethod")
            .select(["id"])
            .where("jobId", "=", jobId)
            .where("companyId", "=", companyId)
            .where("parentMaterialId", "is", null)
            .execute()
      ]);

      // A job outside companyId is a 404.
      if (!job) throw new NotFoundError("Job not found");

      // Exactly one root make method, as `.single()` required before.
      const jobMakeMethod = jobMakeMethods[0];
      if (!jobMakeMethod || jobMakeMethods.length > 1) {
        throw new Error(
          `Failed to get job make method: found ${jobMakeMethods.length}`
        );
      }

      const jobMethodTrees = await getJobMethodTree(db, jobMakeMethod.id);

      const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
      if (!jobMethodTree) {
        throw new NotFoundError("Method tree not found");
      }

      await db.transaction().execute(async (trx) => {
        // Use job.quantity as the root's target quantity (not productionQuantity)
        // The item's scrap percentage will be applied within updateJobQuantities
        await updateJobQuantities(trx, jobMethodTree, job.quantity ?? 1);
      });

      break;
    }

    default:
      throw new Error(`Invalid type  ${type}`);
  }

  return { success: true };
}

const updateJobQuantities = async (
  trx: Transaction<KyselyDatabase>,
  tree: JobMethodTreeItem,
  parentEstimatedQuantity: number = 1
) => {
  // The tree is already fully loaded, so compute every node's quantities in
  // memory (@carbon/database/job-quantities-engine, mirroring the mrp-engine pattern)
  // and write them set-based. The previous per-node recursion issued 2–4
  // statements per node on one transaction connection — O(tree) sequential
  // roundtrips, which on a large BOM exceeded the request timeout.
  const { nodes, cycleNodeIds: flattenCycles } = flattenJobQuantityTree(tree);

  const jobMaterials = await trx
    .selectFrom("jobMaterial")
    .select(["id", "itemScrapPercentage"])
    .where(
      "id",
      "in",
      nodes.map((n) => n.id)
    )
    .execute();
  const storedScrapById = new Map(
    jobMaterials.map((m) => [m.id, m.itemScrapPercentage])
  );

  const fallbackItemIds = [
    ...new Set(
      nodes
        .filter((n) => storedScrapById.get(n.id) == null)
        .map((n) => n.data.itemId)
    )
  ];
  const replenishmentScrapByItemId = new Map<string, number>();
  if (fallbackItemIds.length > 0) {
    const replenishments = await trx
      .selectFrom("itemReplenishment")
      .select(["itemId", "scrapPercentage"])
      .where("itemId", "in", fallbackItemIds)
      .execute();
    for (const row of replenishments) {
      replenishmentScrapByItemId.set(
        row.itemId,
        Number(row.scrapPercentage ?? 0)
      );
    }
  }

  const { computed, cycleNodeIds } = computeJobQuantities({
    tree,
    parentEstimatedQuantity,
    storedScrapById,
    replenishmentScrapByItemId
  });
  const allCycleNodeIds = new Set([...flattenCycles, ...cycleNodeIds]);
  if (allCycleNodeIds.size > 0) {
    // Corrupt tree data — the nodes were skipped rather than looped on.
    recalculateRequirementsLogger.error(
      "recalculate: cyclic job method tree; skipped nodes",
      {
        skippedNodeIds: [...allCycleNodeIds]
      }
    );
  }

  // jobMaterial scrap/estimated — one VALUES-join update for the whole tree
  const materialRows = computed.filter((c) => c.hasJobMaterial);
  if (materialRows.length > 0) {
    await sql`
      UPDATE "jobMaterial" AS m
      SET "scrapQuantity" = v.scrap::numeric,
          "estimatedQuantity" = v.estimated::numeric
      FROM (VALUES ${sql.join(
        materialRows.map(
          (c) => sql`(${c.id}, ${c.scrapQuantity}, ${c.estimatedQuantity})`
        )
      )}) AS v(id, scrap, estimated)
      WHERE m.id = v.id
    `.execute(trx);
  }

  const makeNodes = computed.filter(
    (c): c is ComputedJobQuantityNode & { jobMaterialMakeMethodId: string } =>
      c.jobMaterialMakeMethodId !== null
  );
  if (makeNodes.length > 0) {
    // Not the tree's root: the tree does not know how many of it its parent
    // needs, and writing its placeholder reset a sub-assembly to 1.
    const perParent = makeNodes.filter((c) => c.quantityPerParent !== null);
    if (perParent.length > 0) {
      await sql`
        UPDATE "jobMakeMethod" AS jmm
        SET "quantityPerParent" = v.qpp::numeric
        FROM (VALUES ${sql.join(
          perParent.map(
            (c) => sql`(${c.jobMaterialMakeMethodId}, ${c.quantityPerParent})`
          )
        )}) AS v(id, qpp)
        WHERE jmm.id = v.id
      `.execute(trx);
    }

    await sql`
      UPDATE "jobOperation" AS op
      SET "targetQuantity" = v.target::numeric,
          "operationQuantity" = v.total::numeric
      FROM (VALUES ${sql.join(
        makeNodes.map(
          (c) =>
            sql`(${c.jobMaterialMakeMethodId}, ${c.targetQuantity}, ${c.totalWithScrap})`
        )
      )}) AS v(id, target, total)
      WHERE op."jobMakeMethodId" = v.id
        AND op."reworkId" IS NULL
    `.execute(trx);

    const trackedMakeMethods = await trx
      .selectFrom("jobMakeMethod")
      .select(["id", "trackedEntityId", "requiresSerialTracking"])
      .where(
        "id",
        "in",
        makeNodes.map((c) => c.jobMaterialMakeMethodId)
      )
      .where("trackedEntityId", "is not", null)
      .execute();

    if (trackedMakeMethods.length > 0) {
      const totalByMakeMethodId = new Map(
        makeNodes.map((c) => [c.jobMaterialMakeMethodId, c.totalWithScrap])
      );
      await sql`
        UPDATE "trackedEntity" AS te
        SET "quantity" = v.quantity::numeric
        FROM (VALUES ${sql.join(
          trackedMakeMethods.map(
            (m) =>
              sql`(${m.trackedEntityId}, ${
                m.requiresSerialTracking
                  ? 1
                  : (totalByMakeMethodId.get(m.id) ?? 1)
              })`
          )
        )}) AS v(id, quantity)
        WHERE te.id = v.id
      `.execute(trx);
    }
  }
};
const triggerReworkLogger = getLogger("server-functions", "trigger-rework");

interface TriggerReworkRequest {
  jobId: string;
  triggeredAtJobOperationId: string;
  targetJobOperationId: string;
  reason: string;
  quantity: number;
  trackedEntityIds?: string[];
  // Provenance link when an inspection disposition triggered the rework —
  // stamped on the Rework productionQuantity row.
  inspectionId?: string;
  companyId: string;
  userId: string;
}

/**
 * Finds the shortest path from targetOperationId to triggeredAtOperationId
 * by walking backwards through the DAG from triggeredAt.
 * Returns operations in forward order (target → ... → triggeredAt).
 */
async function findReworkPath(
  trx: Transaction<KyselyDatabase>,
  jobId: string,
  targetOperationId: string,
  triggeredAtOperationId: string
): Promise<string[]> {
  const dependencies = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId", "dependsOnId"])
    .where("jobId", "=", jobId)
    .execute();

  // Build adjacency list: operationId → [operations it depends on]
  const dependsOn = new Map<string, string[]>();
  for (const dep of dependencies) {
    const existing = dependsOn.get(dep.operationId) ?? [];
    existing.push(dep.dependsOnId);
    dependsOn.set(dep.operationId, existing);
  }

  // BFS backwards from triggeredAt to find target
  const visited = new Set<string>();
  const parent = new Map<string, string>();
  const queue: string[] = [triggeredAtOperationId];
  visited.add(triggeredAtOperationId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetOperationId) break;

    for (const predecessor of dependsOn.get(current) ?? []) {
      if (!visited.has(predecessor)) {
        visited.add(predecessor);
        parent.set(predecessor, current);
        queue.push(predecessor);
      }
    }
  }

  if (!visited.has(targetOperationId)) {
    throw new Error(
      `No path found from target operation ${targetOperationId} to triggered operation ${triggeredAtOperationId}`
    );
  }

  // Trace path from target back to triggeredAt (forward order)
  const path: string[] = [];
  let current = targetOperationId;
  while (current !== triggeredAtOperationId) {
    path.push(current);
    current = parent.get(current)!;
  }
  path.push(triggeredAtOperationId);

  return path;
}

async function cloneReworkOperations(
  trx: Transaction<KyselyDatabase>,
  body: TriggerReworkRequest
) {
  const {
    jobId,
    triggeredAtJobOperationId,
    targetJobOperationId,
    reason,
    quantity,
    trackedEntityIds,
    inspectionId,
    companyId,
    userId
  } = body;

  // 1. Find the path of operations to clone
  const operationPath = await findReworkPath(
    trx,
    jobId,
    targetJobOperationId,
    triggeredAtJobOperationId
  );

  triggerReworkLogger.info(
    `📋 Rework path: ${operationPath.length} operations to clone`
  );

  // 2. Create the rework record
  const [rework] = await trx
    .insertInto("rework")
    .values({
      jobId,
      triggeredAtJobOperationId,
      targetJobOperationId,
      reason,
      quantity,
      requestedById: userId,
      companyId
    })
    .returning(["id"])
    .execute();

  // 2b. Create tracked activity for traceability
  if (trackedEntityIds && trackedEntityIds.length > 0) {
    const activityId = nanoid();
    await trx
      .insertInto("trackedActivity")
      .values({
        id: activityId,
        type: "Rework",
        sourceDocument: "Rework",
        sourceDocumentId: rework!.id,
        attributes: {
          Job: jobId,
          "Triggered At": triggeredAtJobOperationId,
          Target: targetJobOperationId,
          Reason: reason,
          Quantity: quantity
        },
        companyId,
        createdBy: userId
      })
      .execute();

    const isSerial = trackedEntityIds.length > 1 || quantity === 1;
    for (const entityId of trackedEntityIds) {
      await trx
        .insertInto("trackedActivityInput")
        .values({
          trackedActivityId: activityId,
          trackedEntityId: entityId,
          quantity: isSerial ? 1 : quantity,
          companyId,
          createdBy: userId
        })
        .execute();
    }
  }

  // 3. Fetch the source operations to clone
  const sourceOperations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("id", "in", operationPath)
    .execute();

  // Sort by path order
  const pathIndex = new Map(operationPath.map((id, i) => [id, i]));
  sourceOperations.sort(
    (a, b) => (pathIndex.get(a.id) ?? 0) - (pathIndex.get(b.id) ?? 0)
  );

  // 4. Compute sort order: place rework ops after the triggering operation
  // "With Previous" on the first rework op lets it run in parallel with
  // the triggering operation's successors until the DAG converges.
  const [triggerOp, nextOp] = await Promise.all([
    trx
      .selectFrom("jobOperation")
      .select("order")
      .where("id", "=", triggeredAtJobOperationId)
      .executeTakeFirstOrThrow(),
    trx
      .selectFrom("jobOperation")
      .select("order")
      .where("jobId", "=", jobId)
      .where(
        "order",
        ">",
        trx
          .selectFrom("jobOperation")
          .select("order")
          .where("id", "=", triggeredAtJobOperationId)
      )
      .orderBy("order", "asc")
      .executeTakeFirst()
  ]);

  const triggerOrder = Number(triggerOp.order);
  const upperBound = nextOp?.order ? Number(nextOp.order) : triggerOrder + 1;
  const gap = upperBound - triggerOrder;
  const increment = gap / (sourceOperations.length + 1);

  // 5. Clone operations (batch insert)
  const clonedOps = await trx
    .insertInto("jobOperation")
    .values(
      sourceOperations.map((sourceOp, i) => ({
        jobId: sourceOp.jobId,
        jobMakeMethodId: sourceOp.jobMakeMethodId,
        order: triggerOrder + increment * (i + 1),
        processId: sourceOp.processId,
        workCenterId: sourceOp.workCenterId,
        description: sourceOp.description,
        setupTime: sourceOp.setupTime,
        setupUnit: sourceOp.setupUnit,
        laborTime: sourceOp.laborTime,
        laborUnit: sourceOp.laborUnit,
        machineTime: sourceOp.machineTime,
        machineUnit: sourceOp.machineUnit,
        operationOrder: i === 0 ? "With Previous" : sourceOp.operationOrder,
        laborRate: sourceOp.laborRate,
        overheadRate: sourceOp.overheadRate,
        machineRate: sourceOp.machineRate,
        operationType: sourceOp.operationType,
        operationMinimumCost: sourceOp.operationMinimumCost,
        operationLeadTime: sourceOp.operationLeadTime,
        operationUnitCost: sourceOp.operationUnitCost,
        operationSupplierProcessId: sourceOp.operationSupplierProcessId,
        workInstruction: sourceOp.workInstruction,
        procedureId: sourceOp.procedureId,
        // A cloned Inspection op must re-inspect against the SAME plan — its
        // lazily-created lot resolves features/sampling from this document.
        // Assembly ops likewise keep their instruction link for 3D playback.
        inspectionDocumentId: sourceOp.inspectionDocumentId,
        assemblyInstructionId: sourceOp.assemblyInstructionId,
        operationQuantity: quantity,
        targetQuantity: quantity,
        tags: sourceOp.tags,
        companyId,
        createdBy: userId,
        reworkId: rework!.id,
        status: i === 0 ? "Ready" : "Waiting",
        customFields: sourceOp.customFields
      }))
    )
    .returning(["id"])
    .execute();

  const clonedOperationIds = clonedOps.map((op) => op.id);
  const sourceToCloneMap = new Map<string, string>();
  sourceOperations.forEach((sourceOp, i) => {
    sourceToCloneMap.set(sourceOp.id, clonedOps[i]!.id);
  });

  triggerReworkLogger.info(`🔧 Cloned ${clonedOperationIds.length} operations`);

  // 6. Clone steps, tools, and parameters (batch fetch + batch insert)
  const [allSteps, allTools, allParams] = await Promise.all([
    trx
      .selectFrom("jobOperationStep")
      .selectAll()
      .where("operationId", "in", operationPath)
      .execute(),
    trx
      .selectFrom("jobOperationTool")
      .selectAll()
      .where("operationId", "in", operationPath)
      .execute(),
    trx
      .selectFrom("jobOperationParameter")
      .selectAll()
      .where("operationId", "in", operationPath)
      .execute()
  ]);

  const stepValues = allSteps.map(
    ({
      id: _id,
      operationId,
      createdAt: _ca,
      updatedAt: _ua,
      updatedBy: _ub,
      ...step
    }) => ({
      ...step,
      operationId: sourceToCloneMap.get(operationId)!,
      createdBy: userId
    })
  );

  const toolValues = allTools.map((tool) => ({
    toolId: tool.toolId,
    quantity: tool.quantity,
    operationId: sourceToCloneMap.get(tool.operationId)!,
    companyId,
    createdBy: userId
  }));

  const paramValues = allParams.map((param) => ({
    key: param.key,
    value: param.value,
    operationId: sourceToCloneMap.get(param.operationId)!,
    companyId,
    createdBy: userId
  }));

  await Promise.all([
    stepValues.length > 0
      ? trx.insertInto("jobOperationStep").values(stepValues).execute()
      : null,
    toolValues.length > 0
      ? trx.insertInto("jobOperationTool").values(toolValues).execute()
      : null,
    paramValues.length > 0
      ? trx.insertInto("jobOperationParameter").values(paramValues).execute()
      : null
  ]);

  // 7. Wire the rework operations into the DAG
  // First rework op has no dependencies — it's an independent parallel branch.
  // Traceability is captured via the rework record, not DAG edges.
  const dagEdges: Array<{
    operationId: string;
    dependsOnId: string;
    jobId: string;
    companyId: string;
  }> = [];

  // 7a. Each subsequent rework op depends on the previous
  for (let i = 1; i < clonedOperationIds.length; i++) {
    dagEdges.push({
      operationId: clonedOperationIds[i]!,
      dependsOnId: clonedOperationIds[i - 1]!,
      jobId,
      companyId
    });
  }

  // 7b. Convergence: downstream ops that depended on triggeredAt also depend
  //     on the last rework op so the DAG merges back.
  // Filter on `jobId`, not `companyId`: dependency edges are per-job, and
  // `jobId` is the column the scheduler's own rebuild filters on. Trusting the
  // row's stamped `companyId` would trust exactly the field that cross-tenant
  // mis-stamping makes unreliable. Without any filter this read reaches every
  // tenant's edges and re-inserts them under this job's company.
  const downstreamDeps = await trx
    .selectFrom("jobOperationDependency")
    .select(["operationId"])
    .where("jobId", "=", jobId)
    .where("dependsOnId", "=", triggeredAtJobOperationId)
    .where("operationId", "not in", clonedOperationIds)
    .execute();

  const lastReworkOpId = clonedOperationIds[clonedOperationIds.length - 1]!;

  for (const dep of downstreamDeps) {
    dagEdges.push({
      operationId: dep.operationId,
      dependsOnId: lastReworkOpId,
      jobId,
      companyId
    });
  }

  if (dagEdges.length > 0) {
    await trx.insertInto("jobOperationDependency").values(dagEdges).execute();
  }

  triggerReworkLogger.info(
    `🔗 DAG wired with ${downstreamDeps.length} downstream deps rewired`
  );

  // 8. Record a productionQuantity entry for the rework
  await trx
    .insertInto("productionQuantity")
    .values({
      jobOperationId: triggeredAtJobOperationId,
      type: "Rework",
      quantity,
      inspectionId: inspectionId ?? null,
      companyId,
      createdBy: userId
    })
    .execute();

  return {
    reworkId: rework!.id,
    clonedOperationIds,
    operationsCloned: clonedOperationIds.length
  };
}

export const triggerReworkPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof triggerReworkInput>>;

/**
 * Sends a job back to an earlier operation: clones the operations from the
 * target up to where the problem was found, then reschedules the job.
 */
export async function triggerRework(
  ctx: ServiceContext,
  raw: z.input<typeof triggerReworkInput>
) {
  const parsed = triggerReworkInput.parse(raw);

  const db = ctx.asSystem.pg;

  const body: TriggerReworkRequest = {
    ...parsed,
    companyId: ctx.company.id,
    userId: ctx.auditUserId
  };

  // `jobId` and `companyId` both arrive in the payload, and nothing proved
  // they belong together. Without this, a request pairing one company's id
  // with another company's job writes rows attributed to the wrong tenant.
  // See .ai/specs/2026-08-25-backup-durability.md Part 3.
  const job = await db
    .selectFrom("job")
    .select(["id", "companyId"])
    .where("id", "=", body.jobId)
    .executeTakeFirst();

  // 404, not 403: a job in another company must be indistinguishable from a
  // job that does not exist.
  if (!job || job.companyId !== body.companyId) {
    throw new NotFoundError("Job not found in this company");
  }

  // The same holds for the two operation ids: triggerRework reads, clones and
  // writes productionQuantity against them by id alone, so both must be
  // operations of this job (the job is already proven to be this company's).
  const operationIds = [
    ...new Set([body.triggeredAtJobOperationId, body.targetJobOperationId])
  ];
  const operations = await db
    .selectFrom("jobOperation")
    .select("id")
    .where("id", "in", operationIds)
    .where("jobId", "=", body.jobId)
    .where("companyId", "=", body.companyId)
    .execute();
  if (operations.length !== operationIds.length) {
    throw new NotFoundError("Job operation not found in this company");
  }

  await assertCompanyRecords(
    db,
    "trackedEntity",
    body.trackedEntityIds ?? [],
    body.companyId,
    "Tracked entity"
  );

  // Written as productionQuantity.inspectionId, whose FK accepts any company's
  // inspection.
  await assertCompanyRecords(
    db,
    "inspection",
    [body.inspectionId],
    body.companyId,
    "Inspection"
  );

  triggerReworkLogger.info(
    `🔰 Starting rework for job ${body.jobId}: go back to ${body.targetJobOperationId} from ${body.triggeredAtJobOperationId}`
  );

  const result = await db.transaction().execute(async (trx) => {
    return await cloneReworkOperations(trx, body);
  });

  // Reschedule for date/priority recalculation (after the transaction). A
  // failure is logged, not raised: the rework itself has committed.
  const rescheduled = await invokePosting(
    { db, companyId: body.companyId, userId: body.userId },
    "reschedule",
    { jobId: body.jobId },
    rescheduleJob
  );
  if (rescheduled.error) {
    triggerReworkLogger.error("Failed to trigger reschedule after rework", {
      error: rescheduled.error
    });
  }

  return { success: true, ...result };
}
const NOT_STARTED = ["Todo", "Ready", "Waiting"];
// The produced item + tracking of each member, and its live WIP entity (the
// entity a member's output lot is finalized from; its readableId is the lot
// number).
async function loadMemberOutputs(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  jobMakeMethodIds: string[]
) {
  if (jobMakeMethodIds.length === 0) return new Map();
  const makeMethods = await trx
    .selectFrom("jobMakeMethod")
    .select(["id", "itemId", "requiresBatchTracking"])
    .where("id", "in", jobMakeMethodIds)
    .where("companyId", "=", companyId)
    .execute();
  const entities = await trx
    .selectFrom("trackedEntity")
    .select([
      "id",
      "createdAt",
      sql<string>`"attributes"->>'Job Make Method'`.as("jobMakeMethodId")
    ])
    .where(sql`"attributes"->>'Job Make Method'`, "in", jobMakeMethodIds)
    .where("companyId", "=", companyId)
    .where("status", "not in", ["Consumed", "Scrapped", "Rejected"])
    // Deterministic among tied `createdAt` (bulk-minted serials).
    .orderBy("createdAt", "asc")
    .orderBy("readableId", "asc")
    .orderBy("id", "asc")
    .execute();
  const entityByMakeMethod = new Map<string, string>();
  for (const e of entities) {
    if (!entityByMakeMethod.has(e.jobMakeMethodId)) {
      entityByMakeMethod.set(e.jobMakeMethodId, e.id);
    }
  }
  return new Map(
    makeMethods.map((m) => [
      m.id,
      {
        itemId: m.itemId as string | null,
        requiresBatchTracking: Boolean(m.requiresBatchTracking),
        trackedEntityId: entityByMakeMethod.get(m.id) ?? null
      }
    ])
  );
}

// A merged batch's members must all produce ONE batch-tracked item: lots of
// different items can never merge, and an untracked item has no lot at all.
function assertMergeable(
  operations: Array<{ jobMakeMethodId: string | null }>,
  outputs: Map<
    string,
    { itemId: string | null; requiresBatchTracking: boolean }
  >
) {
  const items = new Set<string>();
  for (const op of operations) {
    const out = op.jobMakeMethodId
      ? outputs.get(op.jobMakeMethodId)
      : undefined;
    if (!out?.requiresBatchTracking || !out.itemId) {
      throw new Error(
        "Only operations that produce a batch-tracked item can combine into one lot"
      );
    }
    items.add(out.itemId);
  }
  if (items.size > 1) {
    throw new Error("Lots of different items can't combine into one lot");
  }
}

async function assertEligible(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  jobOperationIds: string[],
  expectedProcessId?: string
) {
  const operations = await trx
    .selectFrom("jobOperation")
    .selectAll()
    .where("id", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .execute();
  if (operations.length !== jobOperationIds.length) {
    throw new NotFoundError("One or more operations not found");
  }
  const processId = expectedProcessId ?? operations[0]!.processId;
  const process = await trx
    .selectFrom("process")
    .select(["id", "batchable"])
    .where("id", "=", processId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!process?.batchable) {
    throw new Error("The process is not batchable");
  }
  for (const op of operations) {
    if (op.processId !== processId) {
      throw new Error(`Operation ${op.id} is not on the batch's process`);
    }
    if (op.jobOperationBatchId) {
      throw new Error(`Operation ${op.id} is already in a batch`);
    }
    // A batch is one run on one of our work centers; subcontracted work runs
    // at the supplier, and joining a batch would stamp the batch's work center
    // onto it.
    if (op.operationType === "Outside Processing") {
      throw new Error(
        `Operation ${op.id} is outside processing and can't be batched`
      );
    }
    if (!NOT_STARTED.includes(op.status)) {
      throw new Error(`Operation ${op.id} has already started`);
    }
  }
  const events = await trx
    .selectFrom("productionEvent")
    .select("id")
    .where("jobOperationId", "in", jobOperationIds)
    .where("companyId", "=", companyId)
    .limit(1)
    .execute();
  if (events.length > 0) {
    throw new Error(
      "Operations with recorded production events cannot be batched"
    );
  }
  return { operations, processId };
}

// Record ids in the payload come straight from the caller and prove nothing
// about tenancy — the permission check only authorizes the CALLER for companyId.
// Re-read the record under companyId and refuse on a miss (the same rule the
// composite FKs enforce at the schema level; this gives the caller a named
// error instead of a constraint violation).
// Enforce the process's "must match" compatibility rules across the WHOLE batch
// membership (create: the incoming set; add: existing members + incoming). Skips
// entirely when the process has no "must" dimension. Uses ids where the client
// (BatchBuilder) uses names — mustViolations is value-agnostic, so both agree.
async function assertMaterialCompatible(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  processId: string,
  jobOperationIds: string[]
) {
  const process = await trx
    .selectFrom("process")
    .select(["batchRules"])
    .where("id", "=", processId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const rules = resolveBatchRules(
    (process?.batchRules ?? null) as BatchRules | null
  );
  if (!BATCH_RULE_DIMENSIONS.some((d) => rules[d] === "must")) return;

  // Mirror the get_batchable_operations fallback: an op's materials are its
  // op-linked BOM lines, or — when it has none — the JOB's unassigned lines
  // (jobOperationId IS NULL). The gate must judge the same materials the
  // builder shows, or a visible "must" match could still be refused (and vice
  // versa).
  // Produced item mirrors the builder's candidate `itemReadableId` (the JOB's
  // item — get_batchable_operations joins item on job.itemId), so the gate and
  // the builder judge the producedItem dimension by the same value.
  const memberOps = await trx
    .selectFrom("jobOperation")
    .innerJoin("job", (join: any) =>
      join
        .onRef("job.id", "=", "jobOperation.jobId")
        .onRef("job.companyId", "=", "jobOperation.companyId")
    )
    .leftJoin("item as pi", (join: any) =>
      join
        .onRef("pi.id", "=", "job.itemId")
        .onRef("pi.companyId", "=", "job.companyId")
    )
    .select([
      "jobOperation.id as id",
      "jobOperation.jobId as jobId",
      "pi.readableId as producedItemReadableId"
    ])
    .where("jobOperation.id", "in", jobOperationIds)
    .where("jobOperation.companyId", "=", companyId)
    .execute();
  const jobIdByOp = new Map(memberOps.map((o) => [o.id, o.jobId]));
  const producedByOp = new Map(
    memberOps.map((o) => [o.id, o.producedItemReadableId])
  );
  const memberJobIds = [...new Set(memberOps.map((o) => o.jobId))];

  const rows = await trx
    .selectFrom("jobMaterial as jm")
    .innerJoin("item as mi", (join: any) =>
      join
        .onRef("mi.id", "=", "jm.itemId")
        .onRef("mi.companyId", "=", "jm.companyId")
    )
    .leftJoin("material as m", (join: any) =>
      join
        .onRef("m.id", "=", "mi.readableId")
        .onRef("m.companyId", "=", "mi.companyId")
    )
    .select([
      "jm.jobOperationId as opId",
      "jm.jobId as jobId",
      "mi.readableId as itemReadableId",
      "m.materialSubstanceId as substanceId",
      "m.gradeId as gradeId",
      "m.dimensionId as dimensionId",
      "m.materialFormId as formId",
      "m.finishId as finishId"
    ])
    .where("jm.companyId", "=", companyId)
    .where((eb: any) =>
      eb.or([
        eb("jm.jobOperationId", "in", jobOperationIds),
        eb.and([
          eb("jm.jobOperationId", "is", null),
          eb("jm.jobId", "in", memberJobIds)
        ])
      ])
    )
    .execute();

  type MaterialRow = (typeof rows)[number];
  const pushRow = (sets: MemberValueSets, r: MaterialRow) => {
    if (r.itemReadableId) sets.item!.push(r.itemReadableId);
    if (r.substanceId) sets.substance!.push(r.substanceId);
    if (r.gradeId) sets.grade!.push(r.gradeId);
    if (r.dimensionId) sets.dimension!.push(r.dimensionId);
    if (r.formId) sets.form!.push(r.formId);
    if (r.finishId) sets.finish!.push(r.finishId);
  };

  const byOp = new Map<string, MemberValueSets>();
  for (const id of jobOperationIds) {
    const produced = producedByOp.get(id);
    byOp.set(id, {
      item: [],
      substance: [],
      grade: [],
      dimension: [],
      form: [],
      finish: [],
      producedItem: produced ? [produced] : []
    });
  }
  const opsWithLinkedRows = new Set(
    rows.map((r) => r.opId).filter(Boolean) as string[]
  );
  const unassignedByJob = new Map<string, MaterialRow[]>();
  for (const r of rows) {
    if (r.opId) {
      const sets = byOp.get(r.opId);
      if (sets) pushRow(sets, r);
    } else if (r.jobId) {
      const list = unassignedByJob.get(r.jobId) ?? [];
      list.push(r);
      unassignedByJob.set(r.jobId, list);
    }
  }
  for (const id of jobOperationIds) {
    if (opsWithLinkedRows.has(id)) continue;
    const jobId = jobIdByOp.get(id);
    const fallback = jobId ? unassignedByJob.get(jobId) : undefined;
    if (!fallback) continue;
    const sets = byOp.get(id)!;
    for (const r of fallback) pushRow(sets, r);
  }

  const violations = mustViolations(rules, Array.from(byOp.values()));
  if (violations.length > 0) {
    throw new Error(
      `These operations can't share a batch — the ${violations.join(
        ", "
      )} must match on this process`
    );
  }
}

// Two-phase, resumable batch completion.
//
// Phase 1 (one Kysely transaction, runs once): FOR UPDATE the batch row to
// serialize completers, then slice the recorded aggregate timers into per-member
// productionEvent rows (∝ operationQuantity) + write per-member productionQuantity
// rows, and flip the batch Active -> Completing (guarded). productionEvent.duration
// is a GENERATED column, so the proportional windows make each member's duration —
// and thus GL cost — proportional with no manual duration write.
//
// Phase 2 (post-commit, idempotent): issue each member's own BOM (backflush-capped),
// flip members Done (skipping already-Done), and post GL per sliced event (skipping
// already-posted). Any throw here leaves the batch Completing; re-running with the
// same payload re-enters via planBatchCompletion -> "resume" and finishes phase 2
// without re-slicing. Only after every phase-2 effect succeeds is the batch flipped
// Completing -> Completed. This removes the old failure mode where a post-commit
// error left the batch Completed with unissued materials or unposted GL and no
// recovery path.
async function completeBatch(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    batchId: string;
    members: {
      jobOperationId: string;
      quantity: number;
      scrapQuantity?: number;
      trackedEntityId?: string | null;
      batchNumber?: string | null;
      excluded?: boolean;
    }[];
  }
): Promise<Record<string, unknown>> {
  const { companyId, userId, batchId } = args;
  // Partition "not in this run" members: they were never physically part of the
  // batch run, so they detach back to the schedule un-run instead of completing.
  // They may not carry quantities, and a batch cannot exclude everyone —
  // dissolve exists for that.
  const members = args.members.filter((m) => !m.excluded);
  const excluded = args.members.filter((m) => m.excluded);
  if (members.length === 0) {
    throw new Error(
      "Every operation is excluded — dissolve the batch instead of completing it"
    );
  }
  for (const m of excluded) {
    if (m.quantity > 0 || (m.scrapQuantity ?? 0) > 0) {
      throw new Error(
        `Excluded operation ${m.jobOperationId} cannot record quantities`
      );
    }
  }
  const memberIds = members.map((m) => m.jobOperationId);
  const excludedIds = excluded.map((m) => m.jobOperationId);
  const now = datetime.timestamp();

  // The per-member sliced events whose GL is posted AFTER the transaction commits.
  // postedToGL lets a resume skip events a prior attempt already posted. Populated
  // inside the transaction: freshly sliced on the first attempt, re-loaded on resume.
  let glEvents: { id: string; postedToGL: boolean }[] = [];

  // Strict backflush: refuse before phase 1 writes, since phase 2 issues after
  // it commits. Every member is checked in one dry run, so members sharing a
  // bin are held to their combined demand. A completed batch skips this, so a
  // retry still gets the "already completed" answer.
  const batchStatus = await db
    .selectFrom("jobOperationBatch")
    .select("status")
    .where("id", "=", batchId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (batchStatus?.status !== "Completed") {
    await inventoryPostings.dryRunJobOperationIssues(db, {
      companyId,
      userId,
      operations: members.map((m) => ({
        id: m.jobOperationId,
        quantity: m.quantity
      }))
    });
  }
  const system = { db, companyId, userId };

  await db.transaction().execute(async (trx) => {
    const batch = await trx
      .selectFrom("jobOperationBatch")
      .select(["id", "status"])
      .where("id", "=", batchId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!batch) throw new NotFoundError(`Batch ${batchId} was not found`);

    if (batch.status === "Completed") {
      throw new ServerFnError("This batch has already been completed", 409, {
        alreadyCompleted: true
      });
    }
    // "resume" if the batch is already Completing (a prior phase-2 step failed);
    // "slice" if Active; throws for a terminal status.
    const phase = planBatchCompletion(batch.status);

    if (phase === "resume") {
      // The payload must cover EXACTLY the batch's membership — phase 2 flips
      // every member Done batch-wide but issues materials only for the submitted
      // members, so a short payload would strand an omitted member Done with
      // unissued BOM. Re-assert membership on resume just as the slice path does.
      const currentMembers = await trx
        .selectFrom("jobOperation")
        .select("id")
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .execute();
      const currentIds = new Set(currentMembers.map((o: any) => o.id));
      // An exclusion that phase 1 already applied is a stale-form resubmission
      // and passes (the op is no longer a member). Excluding an op that IS still
      // a member would rewrite phase 1's committed decision — reject it like a
      // changed quantity.
      const lateExclusion = excludedIds.find((id) => currentIds.has(id));
      if (lateExclusion) {
        throw new Error(
          `Operation ${lateExclusion} was included when completion started — ` +
            `retry with the recorded values; corrections happen after completion.`
        );
      }
      assertBatchCompletionMembership(memberIds, [...currentIds]);

      // Resume contract: the payload must match what phase 1 already recorded —
      // an edited quantity on retry is rejected, never silently ignored and never
      // rewritten (phase 1's slices/quantities are already committed). Batch
      // members were unstarted at batch time and batch completion is the only
      // productionQuantity writer between Active and Completing, so per-op sums
      // equal the phase-1 inserts.
      const recordedQuantities = await trx
        .selectFrom("productionQuantity")
        .select(["jobOperationId", "type", "quantity"])
        .where("jobOperationId", "in", memberIds)
        .where("companyId", "=", companyId)
        .execute();
      const sums = new Map<string, { produced: number; scrap: number }>();
      for (const r of recordedQuantities as any[]) {
        const s = sums.get(r.jobOperationId) ?? { produced: 0, scrap: 0 };
        if (r.type === "Production") s.produced += Number(r.quantity);
        if (r.type === "Scrap") s.scrap += Number(r.quantity);
        sums.set(r.jobOperationId, s);
      }
      const mismatches = members.filter((m) => {
        const s = sums.get(m.jobOperationId) ?? { produced: 0, scrap: 0 };
        return s.produced !== m.quantity || s.scrap !== (m.scrapQuantity ?? 0);
      });
      if (mismatches.length > 0) {
        const detail = mismatches
          .map((m) => {
            const s = sums.get(m.jobOperationId) ?? { produced: 0, scrap: 0 };
            return `${m.jobOperationId}: ${s.produced} produced / ${s.scrap} scrap`;
          })
          .join(", ");
        throw new Error(
          `Quantities were already recorded for this batch (${detail}). ` +
            `Retry with the recorded values; corrections happen after completion.`
        );
      }

      const existing = await trx
        .selectFrom("productionEvent")
        .select(["id", "postedToGL"])
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .where("endTime", "is not", null)
        .execute();
      glEvents = existing.map((e: any) => ({
        id: e.id,
        postedToGL: e.postedToGL ?? false
      }));
      return;
    }

    // phase === "slice": first attempt.
    const operations = await trx
      .selectFrom("jobOperation")
      .select(["id", "operationQuantity"])
      .where("jobOperationBatchId", "=", batchId)
      .where("companyId", "=", companyId)
      .execute();
    if (operations.length === 0)
      throw new NotFoundError("Batch not found or empty");

    // Reject dupes / unknown ids / omitted members — any would corrupt
    // quantities or material issue. Included AND excluded together must cover
    // the membership exactly; the excluded ones then detach below.
    assertBatchCompletionMembership(
      [...memberIds, ...excludedIds],
      operations.map((o: any) => o.id)
    );

    // Detach "not in this run" members inside the same transaction: back to the
    // schedule un-run — no time slice, no quantities, and phase 2's batch-wide
    // Done flip no longer reaches them.
    if (excludedIds.length > 0) {
      const detached = await trx
        .updateTable("jobOperation")
        .set({ jobOperationBatchId: null, updatedBy: userId })
        .where("id", "in", excludedIds)
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (Number(detached?.numUpdatedRows ?? 0) !== excludedIds.length) {
        throw new Error("Failed to detach excluded operations — retry");
      }
    }
    const excludedIdSet = new Set(excludedIds);
    const runOperations = operations.filter(
      (o: any) => !excludedIdSet.has(o.id)
    );

    const opById = new Map(runOperations.map((o: any) => [o.id, o]));

    // Auto-stop any still-running batch timer, mirroring the single-operation
    // flow: writing jobOperation.status = 'Done' fires sync_finish_job_operation,
    // which closes that op's open productionEvents with endTime = NOW(). A batch
    // completes the same way — stop the shared timer here rather than refusing —
    // so the just-closed aggregate is sliced per member below and its cost posts
    // once in phase 2. (This is inside the phase-1 txn; the batch-tagged End path
    // deliberately skips post-production-event, so there is no double GL post.)
    await trx
      .updateTable("productionEvent")
      .set({ endTime: datetime.timestamp() })
      .where("jobOperationBatchId", "=", batchId)
      .where("companyId", "=", companyId)
      .where("endTime", "is", null)
      .execute();

    const recorded = await trx
      .selectFrom("productionEvent")
      .select([
        "id",
        "type",
        "startTime",
        "endTime",
        "workCenterId",
        "employeeId"
      ])
      .where("jobOperationBatchId", "=", batchId)
      .where("companyId", "=", companyId)
      .where("endTime", "is not", null)
      .execute();

    const plan = buildBatchCompletionPlan(
      recorded
        .filter((e: any) => e.endTime)
        .map((e: any) => ({
          id: e.id,
          type: e.type,
          startTime: e.startTime,
          endTime: e.endTime as string,
          workCenterId: e.workCenterId,
          employeeId: e.employeeId
        })),
      members.map((m) => ({
        jobOperationId: m.jobOperationId,
        operationQuantity: Number(
          opById.get(m.jobOperationId)?.operationQuantity ?? 0
        ),
        quantity: m.quantity,
        scrapQuantity: m.scrapQuantity
      }))
    );

    // Replace the aggregate timers with the per-member slices.
    if (recorded.length > 0) {
      await trx
        .deleteFrom("productionEvent")
        .where("jobOperationBatchId", "=", batchId)
        .where("companyId", "=", companyId)
        .where("endTime", "is not", null)
        .execute();
    }

    for (const e of plan.memberEvents) {
      const inserted = await trx
        .insertInto("productionEvent")
        .values({
          // The shared plan types `type` as `string | null`; narrow it back to
          // the column's enum here rather than casting the whole insert object.
          type: e.type as
            | Database["public"]["Enums"]["productionEventType"]
            | null,
          employeeId: e.employeeId,
          workCenterId: e.workCenterId,
          companyId,
          createdBy: userId,
          jobOperationBatchId: batchId,
          jobOperationId: e.jobOperationId,
          startTime: e.startTime,
          endTime: e.endTime,
          postedToGL: false
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      glEvents.push({ id: inserted.id, postedToGL: false });
    }

    if (plan.quantities.length > 0) {
      await trx
        .insertInto("productionQuantity")
        .values(
          // q.type is "Production" | "Scrap", a subset of productionQuantityType,
          // so the insert types cleanly without a cast.
          plan.quantities.map((q) => ({
            jobOperationId: q.jobOperationId,
            type: q.type,
            quantity: q.quantity,
            companyId,
            createdBy: userId
          }))
        )
        .execute();
    }

    // Guarded Active -> Completing. WHERE status='Active' is the backstop to the
    // FOR UPDATE lock: 0 rows means a concurrent completer won — throw and roll
    // back every write in this transaction.
    const marked = await trx
      .updateTable("jobOperationBatch")
      .set({ status: "Completing", updatedBy: userId, updatedAt: now })
      .where("id", "=", batchId)
      .where("companyId", "=", companyId)
      .where("status", "=", "Active")
      .returning("id")
      .executeTakeFirst();
    if (!marked) throw new Error("Only an active batch can be completed");
  });

  // Phase 2 (post-commit, idempotent). Any throw leaves the batch Completing; a
  // retry re-runs these steps alone. Runs as the system: the batch completion
  // itself was authorized.
  for (const m of members) {
    if (m.quantity <= 0) continue;
    const issued = await invokePosting(
      system,
      "issue",
      {
        id: m.jobOperationId,
        type: "jobOperation",
        quantity: m.quantity
      },
      inventoryPostings.issueMaterial
    );
    if (issued.error) {
      // Keep a strict backflush refusal's 409; completing again resumes.
      throw new ServerFnError(
        `Failed to issue materials for operation ${m.jobOperationId}: ${issued.error.message}`,
        issued.error instanceof ServerFnError ? issued.error.status : 500
      );
    }
  }

  // Finalize batch-tracked outputs: for each member producing a batch-tracked
  // item, flip its WIP entity to an Available lot via the lean
  // jobOperationBatchOutput case (Produce activity + entity flip only — the
  // productionQuantity rows were written in Phase 1 and the member's materials
  // were issued above). Idempotent: an already-Available entity is a no-op, so
  // a resume fast-forwards. Runs BEFORE the Done flip so a failure here leaves
  // the batch resumable with no member stranded Done without its output lot.
  const memberOpRows = await many(
    db,
    "jobOperation",
    { id: memberIds, companyId },
    { columns: ["id", "jobMakeMethodId"] }
  );
  if (memberOpRows.error) {
    throw new Error(
      `Failed to load member operations: ${memberOpRows.error.message}`
    );
  }
  const makeMethodIds = [
    ...new Set(
      (memberOpRows.data ?? [])
        .map((o: any) => o.jobMakeMethodId)
        .filter(Boolean) as string[]
    )
  ];
  const makeMethods = makeMethodIds.length
    ? await many(
        db,
        "jobMakeMethod",
        { id: makeMethodIds, companyId },
        { columns: ["id", "requiresBatchTracking"] }
      )
    : { data: [], error: null };
  if (makeMethods.error) {
    throw new Error(
      `Failed to load make methods: ${makeMethods.error.message}`
    );
  }
  const requiresBatchByMakeMethod = new Map(
    (makeMethods.data ?? []).map((m: any) => [m.id, m.requiresBatchTracking])
  );
  const makeMethodByOp = new Map(
    (memberOpRows.data ?? []).map((o: any) => [o.id, o.jobMakeMethodId])
  );

  const outputTrackedEntityIds: string[] = [];
  for (const m of members) {
    const makeMethodId = makeMethodByOp.get(m.jobOperationId);
    const requiresBatch = makeMethodId
      ? (requiresBatchByMakeMethod.get(makeMethodId) ?? false)
      : false;
    if (!requiresBatch) continue;
    if (m.quantity <= 0) continue;
    if (!m.trackedEntityId) {
      throw new Error(
        `Operation ${m.jobOperationId} produces a batch-tracked item — its output lot is required`
      );
    }
    const output = await invokePosting(
      system,
      "issue",
      {
        type: "jobOperationBatchOutput",
        jobOperationId: m.jobOperationId,
        trackedEntityId: m.trackedEntityId,
        quantity: m.quantity,
        readableId: m.batchNumber ?? null
      },
      inventoryPostings.issueMaterial
    );
    if (output.error) {
      throw new Error(
        `Failed to create the output lot for operation ${m.jobOperationId}: ${output.error.message}`
      );
    }
    outputTrackedEntityIds.push(m.trackedEntityId);
  }

  // Flip members Done — sync_finish_job_operation readies each member job's next
  // operation and completes the job independently. Skip already-Done so a resume
  // does not re-fire the trigger.
  const done = await updateRows(
    db,
    "jobOperation",
    { status: "Done", updatedBy: userId },
    { jobOperationBatchId: batchId, companyId, status: neq("Done") }
  );
  if (done.error) {
    throw new Error(`Failed to finish batch operations: ${done.error.message}`);
  }

  // Post GL per sliced event; skip events a prior attempt already posted, and
  // propagate errors so a GL failure keeps the batch resumable.
  for (const e of glEvents) {
    if (e.postedToGL) continue;
    const posted = await invokePosting(
      system,
      "post-production-event",
      {
        productionEventId: e.id
      },
      postProductionEvent
    );
    if (posted.error) {
      throw new Error(
        `Failed to post GL for production event ${e.id}: ${posted.error.message}`
      );
    }
    if (posted.data.success === false) {
      throw new Error(
        `Production event ${e.id} was not posted to GL: ${posted.data.reason}`
      );
    }
  }

  // Finalize: Completing -> Completed now that every phase-2 effect succeeded.
  const finalized = await updateRows(
    db,
    "jobOperationBatch",
    { status: "Completed", updatedBy: userId, updatedAt: now },
    { id: batchId, companyId, status: "Completing" }
  );
  if (finalized.error) {
    throw new Error(
      `Failed to finalize batch completion: ${finalized.error.message}`
    );
  }

  return {
    completed: members.length,
    excluded: excludedIds.length,
    memberIds,
    eventIds: glEvents.map((e) => e.id),
    outputTrackedEntityIds
  };
}

export const batchOperationPermission = {
  update: "production"
} satisfies PermissionRule<z.output<typeof batchOperationsInput>>;

/** Job-operation batches: create, change membership, release, dissolve and complete. */
export async function batchOperation(
  ctx: ServiceContext,
  raw: z.input<typeof batchOperationsInput>
) {
  const payload = batchOperationsInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;

  let result: Record<string, unknown> = {};

  switch (payload.type) {
    case "create": {
      result = await db.transaction().execute(async (trx) => {
        const { operations, processId } = await assertEligible(
          trx,
          companyId,
          payload.jobOperationIds
        );
        await assertCompanyRecords(
          trx,
          "location",
          [payload.locationId],
          companyId,
          "Location"
        );
        await assertCompanyRecords(
          trx,
          "workCenter",
          [payload.workCenterId],
          companyId,
          "Work center"
        );
        await assertMaterialCompatible(
          trx,
          companyId,
          processId,
          payload.jobOperationIds
        );
        // The board's "Create batch" sends no work center (assignment is a
        // drag) — but when every member already sits on the same one, that IS
        // the batch's work center; adopt it so the header isn't blank.
        const memberWorkCenters = new Set(
          operations.map((o: any) => o.workCenterId).filter(Boolean)
        );
        const workCenterId =
          payload.workCenterId ??
          (memberWorkCenters.size === 1
            ? ([...memberWorkCenters][0] as string)
            : null);
        // Creating straight onto the floor (release: true) needs no work
        // center: the scheduler's batch pre-pass auto-selects the
        // earliest-finish candidate (load balancing, like single ops) for
        // any Released batch still lacking one, and persists it.
        const outputs = await loadMemberOutputs(
          trx,
          companyId,
          operations.map((o: any) => o.jobMakeMethodId).filter(Boolean)
        );
        const mergeOutput = payload.mergeOutput === true;
        if (mergeOutput) {
          if (!payload.outputLotNumber) {
            throw new Error("A combined output needs its lot number");
          }
          assertMergeable(operations, outputs);
        }
        // Split mode: one number per batch-tracked member, never repeated —
        // two separate lots sharing a number is exactly the ambiguity the
        // merge option exists to remove.
        const lotNumbers = mergeOutput ? [] : (payload.lotNumbers ?? []);
        const seen = new Set<string>();
        const lotWrites: Array<{
          trackedEntityId: string;
          lotNumber: string;
        }> = [];
        for (const entry of lotNumbers) {
          const op = operations.find((o: any) => o.id === entry.jobOperationId);
          const out = op?.jobMakeMethodId
            ? outputs.get(op.jobMakeMethodId)
            : undefined;
          if (!out?.requiresBatchTracking || !out.trackedEntityId) {
            throw new Error(
              `Operation ${entry.jobOperationId} does not produce a batch-tracked lot`
            );
          }
          const key = entry.lotNumber.toLowerCase();
          if (seen.has(key)) {
            throw new Error(
              `Lot number ${entry.lotNumber} is used twice — give each job its own, or combine them into one lot`
            );
          }
          seen.add(key);
          lotWrites.push({
            trackedEntityId: out.trackedEntityId,
            lotNumber: entry.lotNumber
          });
        }

        const readableId = await getNextSequence(
          trx,
          "jobOperationBatch",
          companyId
        );
        const batch = await trx
          .insertInto("jobOperationBatch")
          .values({
            readableId,
            companyId,
            processId,
            workCenterId,
            locationId: payload.locationId,
            status: payload.release ? "Active" : "Planned",
            notes: payload.notes ?? null,
            mergeOutput,
            outputLotNumber: mergeOutput ? payload.outputLotNumber : null,
            createdBy: userId
          })
          .returning(["id", "readableId"])
          .executeTakeFirstOrThrow();

        for (const write of lotWrites) {
          await trx
            .updateTable("trackedEntity")
            .set({ readableId: write.lotNumber, updatedBy: userId })
            .where("id", "=", write.trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        const memberUpdate: Record<string, unknown> = {
          jobOperationBatchId: batch.id,
          updatedBy: userId
        };
        if (payload.workCenterId)
          memberUpdate.workCenterId = payload.workCenterId;
        // Claim only ops still unbatched (IS NULL) and in this company: two
        // concurrent creates sharing an op both pass assertEligible's read, so
        // the IS NULL predicate + row-count assert is what actually serializes
        // the claim (assertEligible is not FOR UPDATE).
        const claimed = await trx
          .updateTable("jobOperation")
          .set(memberUpdate)
          .where("id", "in", payload.jobOperationIds)
          .where("companyId", "=", companyId)
          .where("jobOperationBatchId", "is", null)
          .executeTakeFirst();
        assertAllOperationsClaimed(
          payload.jobOperationIds,
          Number(claimed?.numUpdatedRows ?? 0)
        );
        return batch;
      });
      break;
    }

    case "add": {
      result = await db.transaction().execute(async (trx) => {
        const batch = await trx
          .selectFrom("jobOperationBatch")
          .selectAll()
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!batch) throw new NotFoundError("Batch not found");
        // Membership is mutable while the batch is staged (Planned) or on
        // the floor but unstarted (Active); the production-event check below
        // is what actually freezes it.
        if (batch.status !== "Planned" && batch.status !== "Active") {
          throw new Error(
            `Cannot add operations to a batch with status ${batch.status}`
          );
        }

        const batchEvents = await trx
          .selectFrom("productionEvent")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (batchEvents.length > 0) {
          throw new Error(
            "The batch has already started — complete it instead"
          );
        }

        const { operations: incoming } = await assertEligible(
          trx,
          companyId,
          payload.jobOperationIds,
          batch.processId
        );

        // Compatibility is a property of the whole run: check existing members
        // plus the incoming ops together, not the newcomers in isolation.
        const existingMembers = await trx
          .selectFrom("jobOperation")
          .select(["id", "jobMakeMethodId"])
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .execute();

        // A combined-output batch stays one item: a newcomer producing
        // something else could never merge into the planned lot.
        if (batch.mergeOutput) {
          const all = [...existingMembers, ...incoming];
          const outputs = await loadMemberOutputs(
            trx,
            companyId,
            all.map((o: any) => o.jobMakeMethodId).filter(Boolean)
          );
          assertMergeable(all, outputs);
        }
        await assertMaterialCompatible(trx, companyId, batch.processId, [
          ...existingMembers.map((m: any) => m.id as string),
          ...payload.jobOperationIds
        ]);

        const memberUpdate: Record<string, unknown> = {
          jobOperationBatchId: batch.id,
          updatedBy: userId
        };
        if (batch.workCenterId) memberUpdate.workCenterId = batch.workCenterId;
        const claimed = await trx
          .updateTable("jobOperation")
          .set(memberUpdate)
          .where("id", "in", payload.jobOperationIds)
          .where("companyId", "=", companyId)
          .where("jobOperationBatchId", "is", null)
          .executeTakeFirst();
        assertAllOperationsClaimed(
          payload.jobOperationIds,
          Number(claimed?.numUpdatedRows ?? 0)
        );
        return { added: payload.jobOperationIds.length };
      });
      break;
    }

    case "remove": {
      result = await db.transaction().execute(async (trx) => {
        const batch = await trx
          .selectFrom("jobOperationBatch")
          .select("status")
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!batch) throw new NotFoundError("Batch not found");
        if (batch.status !== "Planned" && batch.status !== "Active") {
          throw new Error(
            `Cannot remove operations from a batch with status ${batch.status}`
          );
        }
        const batchEvents = await trx
          .selectFrom("productionEvent")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (batchEvents.length > 0) {
          throw new Error(
            "Cannot remove operations: production has been recorded. Complete the batch instead."
          );
        }
        // Count actual detaches — an id that isn't a member of this batch
        // (already removed, or never belonged) must not be reported removed.
        const removedResult = await trx
          .updateTable("jobOperation")
          .set({ jobOperationBatchId: null, updatedBy: userId })
          .where("id", "in", payload.jobOperationIds)
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        const removed = Number(removedResult?.numUpdatedRows ?? 0);

        const remaining = await trx
          .selectFrom("jobOperation")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (remaining.length === 0) {
          await trx
            .deleteFrom("jobOperationBatch")
            .where("id", "=", payload.batchId)
            .where("companyId", "=", companyId)
            .execute();
          return { removed, dissolved: true };
        }
        return { removed, dissolved: false };
      });
      break;
    }

    case "update": {
      const nextWorkCenterId = payload.workCenterId ?? null;
      result = await db.transaction().execute(async (trx) => {
        const batch = await trx
          .selectFrom("jobOperationBatch")
          .select("status")
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!batch) throw new NotFoundError("Batch not found");
        await assertCompanyRecords(
          trx,
          "workCenter",
          [nextWorkCenterId],
          companyId,
          "Work center"
        );
        // A Completed/Completing batch's events are already attributed to a
        // machine — re-pointing the work center would rewrite that history.
        assertBatchWorkCenterMutable(batch.status);
        // And once any production event exists, production has started against
        // the current work center, so the reassignment is no longer safe.
        const batchEvents = await trx
          .selectFrom("productionEvent")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (batchEvents.length > 0) {
          throw new Error(
            "Cannot change the work center: production has been recorded."
          );
        }
        await trx
          .updateTable("jobOperationBatch")
          .set({
            workCenterId: nextWorkCenterId,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .execute();
        // Members mirror the header in BOTH directions: assigning pushes the
        // work center down, and clearing (nextWorkCenterId === null) clears it
        // on the members too — otherwise they keep a stale workCenterId the
        // header no longer has.
        await trx
          .updateTable("jobOperation")
          .set({ workCenterId: nextWorkCenterId, updatedBy: userId })
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .execute();
        return { updated: true };
      });
      break;
    }

    case "release": {
      result = await db.transaction().execute(async (trx) => {
        // FOR UPDATE serializes against concurrent release/complete/dissolve
        // on the same batch; the WHERE status='Planned' on the flip below is
        // the backstop.
        const batch = await trx
          .selectFrom("jobOperationBatch")
          .select(["id", "status", "workCenterId"])
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!batch) throw new NotFoundError("Batch not found");
        if (batch.status !== "Planned") {
          throw new Error(`Cannot release a batch with status ${batch.status}`);
        }
        // No work-center requirement: release must never wait on a human
        // picking a machine. The scheduler's batch pre-pass auto-selects the
        // earliest-finish work center among the process's candidates (the
        // same load-balancing rule single operations get) and persists it.
        const members = await trx
          .selectFrom("jobOperation")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (members.length === 0) {
          throw new Error("Cannot release an empty batch");
        }
        const released = await trx
          .updateTable("jobOperationBatch")
          .set({
            status: "Active",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Planned")
          .returning("id")
          .executeTakeFirst();
        if (!released) {
          throw new Error("Only a planned batch can be released");
        }
        return { success: true };
      });
      break;
    }

    case "unrelease": {
      result = await db.transaction().execute(async (trx) => {
        const batch = await trx
          .selectFrom("jobOperationBatch")
          .select(["id", "status"])
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!batch) throw new NotFoundError("Batch not found");
        if (batch.status !== "Active") {
          throw new Error(
            `Cannot unrelease a batch with status ${batch.status}`
          );
        }
        // Once anything has run against the batch, pulling it back off the
        // floor would orphan that recorded time.
        const batchEvents = await trx
          .selectFrom("productionEvent")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (batchEvents.length > 0) {
          throw new Error(
            "production has been recorded — complete the batch instead"
          );
        }
        const unreleased = await trx
          .updateTable("jobOperationBatch")
          .set({
            status: "Planned",
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Active")
          .returning("id")
          .executeTakeFirst();
        if (!unreleased) {
          throw new Error("Only an active batch can be unreleased");
        }
        return { success: true };
      });
      break;
    }

    case "dissolve": {
      result = await db.transaction().execute(async (trx) => {
        const batchEvents = await trx
          .selectFrom("productionEvent")
          .select("id")
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .limit(1)
          .execute();
        if (batchEvents.length > 0) {
          throw new Error(
            "Cannot dissolve: production has been recorded. Complete the batch instead — member jobs then proceed independently."
          );
        }
        const members = await trx
          .updateTable("jobOperation")
          .set({ jobOperationBatchId: null, updatedBy: userId })
          .where("jobOperationBatchId", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .returning("id")
          .execute();
        await trx
          .deleteFrom("jobOperationBatch")
          .where("id", "=", payload.batchId)
          .where("companyId", "=", companyId)
          .execute();
        return { dissolved: members.length };
      });
      break;
    }

    case "complete": {
      result = await completeBatch(db, {
        companyId,
        userId,
        batchId: payload.batchId,
        members: payload.members
      });
      break;
    }
  }

  return { success: true, ...result };
}
