import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { nameSimilarity, tiptapToText } from "@carbon/utils";
import type {
  AssemblyGraph,
  AssemblyGraphIndex,
  AssemblyPlan,
  AssemblyStep
} from "@carbon/viewer";
import {
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION,
  describeStep,
  groupComponentNodeIds,
  indexAssemblyGraph
} from "@carbon/viewer";
import { parseDate } from "@internationalized/date";
import type { FileObject, StorageError } from "@supabase/storage-js";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { getGenericFilter, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getDefaultStorageUnitForJob } from "../inventory";
import { getEmployeeJob } from "../people";
import type {
  MethodType,
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import type {
  assemblyInstructionStatuses,
  assemblyNoteSeverities,
  assemblyRequirementTypes,
  assemblyStepStatuses,
  deadlineTypes,
  failureModeValidator,
  jobMaterialValidator,
  jobOperationStatus,
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
  cameraSchema,
  fastenerSchema,
  getAssemblyModelState,
  isJobOrderStatusHidden,
  JOB_SUPPLY_STATUS_PRIORITY,
  motionSchema,
  PO_STATUS_PRIORITY,
  stepPlanWarningsSchema
} from "./production.models";
import type {
  AssemblyInstructionStepRow,
  ItemOrderStatus,
  ItemShortfall,
  Job,
  JobMaterialPurchaseOrderLine,
  JobMaterialSupplyJobLine
} from "./types";

const logger = getLogger("erp", "production");

export async function convertSalesOrderLinesToJobs(
  client: SupabaseClient<Database>,
  {
    orderId,
    companyId,
    userId
  }: {
    orderId: string;
    companyId: string;
    userId: string;
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

  const opportunity = await client
    .from("opportunity")
    .select("*, quotes(*), salesOrders(*)")
    .eq("id", salesOrder.data?.opportunityId ?? "")
    .single();

  const quoteId = opportunity.data?.quotes[0]?.id;
  const salesOrderId = opportunity.data?.salesOrders[0]?.id;

  const errors: string[] = [];
  let jobsCreated = 0;

  for await (const line of lines) {
    if (line.methodType === "Make to Order" && line.itemId) {
      const manufacturing = await client
        .from("itemReplenishment")
        .select("*")
        .eq("itemId", line.itemId)
        .eq("companyId", companyId)
        .single();

      const lotSize = manufacturing.data?.lotSize ?? 0;
      const totalQuantity = line.saleQuantity ?? 0;
      const totalJobs = lotSize > 0 ? Math.ceil(totalQuantity / lotSize) : 1;

      const jobsToCreate = Math.max(1, totalJobs);

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

        const storageUnitId = await getDefaultStorageUnitForJob(
          client,
          line.itemId,
          locationId!,
          companyId
        );

        // Calculate scrap quantity based on item's scrap percentage
        const scrapPercentage = manufacturing.data?.scrapPercentage ?? 0;
        const scrapQuantity =
          scrapPercentage > 0 ? Math.ceil(jobQuantity * scrapPercentage) : 0;

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
          unitOfMeasureCode: line.unitOfMeasureCode ?? "EA"
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

        if (quoteId) {
          const upsertMethod = await client.functions.invoke("get-method", {
            body: {
              type: "quoteLineToJob",
              sourceId: `${quoteId}:${line.id}`,
              targetId: createJob.data.id,
              companyId,
              userId
            }
          });

          if (upsertMethod.error) {
            errors.push(
              `Failed to create method for job ${nextSequence.data} (Line item ${line.itemReadableId}): ${upsertMethod.error.message}`
            );
            continue;
          }
        } else {
          const upsertMethod = await client.functions.invoke("get-method", {
            body: {
              type: "itemToJob",
              sourceId: data.itemId,
              targetId: createJob.data.id,
              companyId,
              userId
            }
          });

          if (upsertMethod.error) {
            errors.push(
              `Failed to create method for job ${nextSequence.data} (Line item ${line.itemReadableId}): ${upsertMethod.error.message}`
            );
            continue;
          }
        }

        await client.functions.invoke("recalculate", {
          body: {
            type: "jobRequirements",
            id: createJob.data.id,
            companyId,
            userId
          }
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

  // Define deadline type priority order (lower number = higher priority)
  const deadlineTypePriority: Record<string, number> = {
    ASAP: 0,
    "Hard Deadline": 1,
    "Soft Deadline": 2,
    "No Deadline": 3
  };

  const currentJobPriority = deadlineTypePriority[deadlineType];

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

  if (!existingJobs || existingJobs.length === 0) {
    // No existing jobs with this due date, start at priority 0
    return 0;
  }

  // Find the position where this job should be inserted based on deadlineType
  let insertBeforeIndex = existingJobs.length; // Default to end of list

  for (let i = 0; i < existingJobs.length; i++) {
    const existingJobPriority =
      deadlineTypePriority[existingJobs[i].deadlineType];

    // If the current job has higher priority (lower number) than this existing job,
    // we should insert before this job
    if (currentJobPriority < existingJobPriority) {
      insertBeforeIndex = i;
      break;
    }
  }

  // Calculate the priority value using fractional indexing
  let newPriority: number;

  if (insertBeforeIndex === 0) {
    // Insert at the beginning - use half of the first job's priority
    const firstPriority = existingJobs[0].priority ?? 0;
    newPriority = firstPriority > 0 ? firstPriority / 2 : -1;
  } else if (insertBeforeIndex === existingJobs.length) {
    // Insert at the end - add 1 to the last job's priority
    const lastPriority = existingJobs[existingJobs.length - 1].priority ?? 0;
    newPriority = lastPriority + 1;
  } else {
    // Insert between two jobs - average their priorities
    const beforePriority = existingJobs[insertBeforeIndex - 1].priority ?? 0;
    const afterPriority = existingJobs[insertBeforeIndex].priority ?? 0;
    newPriority = (beforePriority + afterPriority) / 2;
  }

  return newPriority;
}

export async function deleteDemandForecasts(
  client: SupabaseClient<Database>,
  params: {
    itemId: string;
    locationId: string;
    companyId: string;
    futurePeriodIds: string[];
  }
) {
  const { itemId, locationId, companyId, futurePeriodIds } = params;

  const result = await client
    .from("demandForecast")
    .delete()
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", futurePeriodIds);

  return {
    data: result.data,
    error: result.error
  };
}

export async function deleteDemandProjections(
  client: SupabaseClient<Database>,
  params: {
    itemId: string;
    locationId: string;
    companyId: string;
    futurePeriodIds: string[];
  }
) {
  const { itemId, locationId, companyId, futurePeriodIds } = params;

  const result = await client
    .from("demandProjection")
    .delete()
    .eq("itemId", itemId)
    .eq("locationId", locationId)
    .eq("companyId", companyId)
    .in("periodId", futurePeriodIds);

  return {
    data: result.data,
    error: result.error
  };
}

export async function deleteJob(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client.from("job").delete().eq("id", jobId);
}

export async function deleteJobMaterial(
  client: SupabaseClient<Database>,
  jobMaterialId: string
) {
  return client.from("jobMaterial").delete().eq("id", jobMaterialId);
}

export async function deleteJobOperation(
  client: SupabaseClient<Database>,
  jobOperationId: string
) {
  return client.from("jobOperation").delete().eq("id", jobOperationId);
}

export async function deleteJobOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobOperationStep").delete().eq("id", id);
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
    const reversal = await client.functions.invoke<{
      success: boolean;
      reason?: string;
    }>("post-production-event", {
      body: { productionEventId, companyId, userId, reverse: true }
    });
    if (reversal.error) {
      return {
        data: null,
        error: {
          message: `Failed to reverse the event's journal entry: ${reversal.error.message}`
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
  const promises: Promise<
    | {
        data: FileObject[];
        error: null;
      }
    | {
        data: null;
        error: StorageError;
      }
  >[] = [client.storage.from("private").list(`${companyId}/job/${job.id}`)];

  // Add opportunity line files if available
  if (job.salesOrderLineId || job.quoteLineId) {
    const opportunityLine = job.salesOrderLineId || job.quoteLineId;
    promises.push(
      client.storage
        .from("private")
        .list(`${companyId}/opportunity-line/${opportunityLine}`)
    );
  }

  // Add parts files if itemId is available
  if (job.itemId) {
    promises.push(
      client.storage.from("private").list(`${companyId}/parts/${job.itemId}`)
    );
  }

  const results = await Promise.all(promises);
  const [jobFiles, opportunityLineFiles, partsFiles] = results;

  // Combine and return all sets of files with their respective buckets
  return [
    ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
    ...(opportunityLineFiles?.data?.map((f) => ({
      ...f,
      bucket: "opportunity-line"
    })) || []),
    ...(partsFiles?.data?.map((f) => ({ ...f, bucket: "parts" })) || [])
  ];
}

export const getPartDocuments = async (
  client: SupabaseClient<Database>,
  companyId: string,
  ...items: Array<{ itemId: string }>
) => {
  const getFile = async (id: string) => {
    const res = await client.storage
      .from("private")
      .list(`${companyId}/parts/${id}`);

    if (res.error || !res.data) return null;

    return res.data.map((f) => ({ ...f, bucket: "parts", itemId: id }));
  };

  const elems = items.map((el) => getFile(el.itemId));

  const results = await Promise.all(elems);

  return results.filter((f) => f !== null).flat();
};

export async function getJobDocumentsWithItemId(
  client: SupabaseClient<Database>,
  companyId: string,
  job: Job,
  itemId: string
): Promise<StorageItem[]> {
  const itemFiles = await getPartDocuments(client, companyId, { itemId });

  if (job.salesOrderLineId || job.quoteLineId) {
    const opportunityLine = job.salesOrderLineId || job.quoteLineId;

    const [opportunityLineFiles, jobFiles] = await Promise.all([
      client.storage
        .from("private")
        .list(`${companyId}/opportunity-line/${opportunityLine}`),
      client.storage.from("private").list(`${companyId}/job/${job.id}`)
    ]);

    // Combine and return both sets of files
    return [
      ...(opportunityLineFiles.data?.map((f) => ({
        ...f,
        bucket: "opportunity-line"
      })) || []),
      ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
      ...itemFiles
    ];
  } else {
    const [jobFiles] = await Promise.all([
      client.storage.from("private").list(`${companyId}/job/${job.id}`)
    ]);

    return [
      ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
      ...itemFiles
    ];
  }
}

export async function getJob(client: SupabaseClient<Database>, id: string) {
  return client.from("jobs").select("*").eq("id", id).single();
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

export async function getJobs(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("jobs")
    .select("*", {
      count: "exact"
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
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    jobId: string;
  }>(client, "job", "id, jobId", (query) =>
    query.eq("companyId", companyId).order("jobId")
  );
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
      `itemReadableId.ilike.%${args.search}%,name.ilike.%${args.search}%,description.ilike.%${args.search}%`
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
  materials: JobItemAvailability[]
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

  // Remaining demand for those items across every active job at this location.
  const { data } = await client
    .from("jobMaterial")
    .select(
      "id, itemId, jobId, methodType, quantityToIssue, job!inner(priority, status, locationId)"
    )
    .in("itemId", itemIds)
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
      lines.push({ materialId: row.id, remaining, methodType: row.methodType });
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
      for (const line of lines) {
        const fromOnHand = Math.min(line.remaining, Math.max(onHand, 0));
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
  coveredByOnHand: boolean
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
    const poLines = material.jobMaterialItemId
      ? (linesByItemId.get(material.jobMaterialItemId) ?? [])
      : [];
    const jobLines = material.jobMaterialItemId
      ? (jobLinesByItemId.get(material.jobMaterialItemId) ?? [])
      : [];
    const lineShortfall = shortfallByMaterialId[material.id];
    byMaterialId[material.id] = getJobMaterialOrderStatus(
      material,
      poLines,
      jobLines,
      lineShortfall?.shortfall ?? 0,
      lineShortfall?.coveredByOnHand ?? false
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
  >
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
        materials
      )
    ]);

  return getJobOrderStatusByMaterial(
    materials,
    purchaseOrderLines,
    supplyJobLines,
    shortfallByMaterialId
  );
}

export async function getJobMethodTree(
  client: SupabaseClient<Database>,
  jobId: string
) {
  const items = await getJobMethodTreeArray(client, jobId);
  if (items.error) return items;

  const tree = getJobMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null
  };
}

export async function getJobMethodTreeArray(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client.rpc("get_job_method", {
    jid: jobId
  });
}

function getJobMethodTreeArrayToTree(items: JobMethod[]): JobMethodTreeItem[] {
  // function traverseAndRenameIds(node: JobMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: JobMethodTreeItem[] = [];
  const lookup: { [id: string]: JobMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-expect-error
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-expect-error
        lookup[parentId] = { id: parentId, children: [] };
      }

      // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
      lookup[parentId]["children"].push(treeItem);
    }
  }
  return rootItems;
  // return rootItems.map((item) => traverseAndRenameIds(item));
}

export type JobMethod = NonNullable<
  Awaited<ReturnType<typeof getJobMethodTreeArray>>["data"]
>[number];
export type JobMethodTreeItem = {
  id: string;
  data: JobMethod;
  children: JobMethodTreeItem[];
};

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

export async function getJobMaterialsByMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string
) {
  return client
    .from("jobMaterial")
    .select("*, item(replenishmentSystem)")
    .eq("jobMakeMethodId", jobMakeMethodId)
    .order("order", { ascending: true });
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
        count: "exact"
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

export async function getJobOperationsByMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string
) {
  return client
    .from("jobOperation")
    .select(
      "*, jobOperationTool(*), jobOperationParameter(*), jobOperationStep(*, jobOperationStepRecord(*))"
    )
    .eq("jobMakeMethodId", jobMakeMethodId)
    .order("order", { ascending: true });
}

export async function getJobOperationStepRecords(
  client: SupabaseClient<Database>,
  jobId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc("get_job_operation_step_records", {
    p_job_id: jobId
  });

  if (args.search) {
    query = query.or(
      `name.ilike.%${args.search}%,operationDescription.ilike.%${args.search}%`
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
    .eq("operationType", "Outside");
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
      count: "exact"
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
        count: "exact"
      }
    )
    .in("jobOperationId", jobOperationIds)
    .order("startTime", { ascending: true });

  if (args?.search) {
    query = query.or(`jobOperation.description.ilike.%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getProductionEventsPage(
  client: SupabaseClient<Database>,
  jobOperationId: string,
  companyId: string,
  sortDescending: boolean = false,
  page: number = 1
) {
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  let query = client
    .from("productionEvent")
    .select("*", { count: "exact" })
    .eq("jobOperationId", jobOperationId)
    .eq("companyId", companyId)
    .order("startTime", { ascending: !sortDescending })
    .range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    return { error };
  }

  return {
    data,
    count,
    page,
    pageSize,
    hasMore: count !== null && offset + pageSize < count
  };
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
  }
) {
  let query = client.rpc(
    "get_production_planning",
    {
      location_id: locationId,
      company_id: companyId,
      periods
    },
    {
      count: "exact"
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "quantityToOrder", ascending: false }
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
      count: "exact"
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
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
        count: "exact"
      }
    )
    .in("jobOperationId", jobOperationIds);

  if (args?.search) {
    query = query.or(`jobOperation.description.ilike.%${args.search}%`);
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
    .select("id, name, customFields", { count: "exact" })
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
    .select("*", { count: "exact" })
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
    .select(`*`, { count: "exact" })
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
    .select(`*`, { count: "exact" })
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

  const result = await client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Job Make Method", jobMakeMethod.data.id)
    .eq("companyId", jobMakeMethod.data.companyId)
    .is("attributes ->> Split Entity ID", null)
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
    .is("attributes ->> Split Entity ID", null);
}

/**
 * Reschedule a job using the unified scheduling engine.
 * This recalculates dates, work centers, and priorities for all operations.
 */
export async function recalculateJobOperationDependencies(
  client: SupabaseClient<Database>,
  params: {
    jobId: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("schedule", {
    body: {
      jobId: params.jobId,
      companyId: params.companyId,
      userId: params.userId,
      mode: "reschedule",
      direction: "backward"
    }
  });
}
export async function recalculateJobRequirements(
  client: SupabaseClient<Database>,
  params: {
    id: string; // job id
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("recalculate", {
    body: {
      type: "jobRequirements",
      ...params
    }
  });
}

export async function recalculateJobMakeMethodRequirements(
  client: SupabaseClient<Database>,
  params: {
    id: string; // job make method id
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("recalculate", {
    body: {
      type: "jobMakeMethodRequirements",
      ...params
    }
  });
}

export async function runMRP(
  client: SupabaseClient<Database>,
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
  return client.functions.invoke("mrp", {
    body: {
      ...params
    }
  });
}

export async function updateJobBatchNumber(
  client: SupabaseClient<Database>,
  trackedEntityId: string,
  value: string | null
) {
  return client
    .from("trackedEntity")
    .update({
      readableId: value
    })
    .eq("id", trackedEntityId)
    .select("id, readableId");
}

export async function updateJobStatus(
  client: SupabaseClient<Database>,
  params: {
    id: string;
    status: (typeof jobStatus)[number];
    assignee?: string | null;
    updatedBy: string;
  }
) {
  const { id, status, assignee, updatedBy } = params;

  return client
    .from("job")
    .update({
      status,
      assignee,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);
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

export async function updateJobOperationOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("jobOperation").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
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

export async function updateJobOperationStatus(
  client: SupabaseClient<Database>,
  id: string,
  status: (typeof jobOperationStatus)[number],
  updatedBy: string
) {
  return client
    .from("jobOperation")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select()
    .single();
}

export async function updateJobOperationDueDate(
  client: SupabaseClient<Database>,
  id: string,
  dueDate: string | null,
  updatedBy: string
) {
  return client
    .from("jobOperation")
    .update({
      dueDate,
      manuallyScheduled: dueDate !== null,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select()
    .single();
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

export async function updateProductionQuantity(
  client: SupabaseClient<Database>,
  productionQuantity: z.infer<typeof productionQuantityValidator> & {
    id: string;
    updatedBy: string;
    companyId: string;
  }
) {
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
}

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

export async function insertJob(
  client: SupabaseClient<Database>,
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
    parentJobId?: string;
    modelUploadId?: string;
    notes?: string;
    customFields?: Json;
    configuration?: Record<string, unknown>;
  },
  options?: {
    skipMethod?: boolean;
    skipRecalculate?: boolean;
    methodSource?: "item" | "quoteLine";
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

  const scrapQuantity =
    scrapPercentage > 0 ? Math.ceil(input.quantity * scrapPercentage) : 0;

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
      parentJobId: input.parentJobId,
      modelUploadId: input.modelUploadId,
      notes: input.notes,
      customFields: input.customFields,
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

  if (!options?.skipMethod) {
    const methodSource =
      options?.methodSource ??
      (input.quoteId && input.quoteLineId ? "quoteLine" : "item");

    if (methodSource === "quoteLine" && input.quoteId && input.quoteLineId) {
      const body: Record<string, unknown> = {
        type: "quoteLineToJob",
        sourceId: `${input.quoteId}:${input.quoteLineId}`,
        targetId: createdJobId,
        companyId: input.companyId,
        userId: input.createdBy
      };
      if (input.configuration) body.configuration = input.configuration;
      const { error } = await client.functions.invoke("get-method", { body });
      if (error) {
        logger.error("Failed to copy method from quote line", { error });
      }
    } else {
      const body: Record<string, unknown> = {
        type: "itemToJob",
        sourceId: input.itemId,
        targetId: createdJobId,
        companyId: input.companyId,
        userId: input.createdBy
      };
      if (input.configuration) body.configuration = input.configuration;
      const { error } = await client.functions.invoke("get-method", { body });
      if (error) {
        logger.error("Failed to copy method from item", { error });
      }
    }
  }

  if (!options?.skipRecalculate) {
    await client.functions.invoke("recalculate", {
      body: {
        type: "jobRequirements",
        id: createdJobId,
        companyId: input.companyId,
        userId: input.createdBy
      }
    });
  }

  return { data: { id: createdJobId, jobId }, error: null };
}

export async function updateJob(
  client: SupabaseClient<Database>,
  input: {
    id: string;
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
    parentJobId?: string | null;
    modelUploadId?: string | null;
    notes?: string | null;
    customFields?: Json;
    scrapQuantity?: number;
    itemId?: string;
  }
): Promise<{ data: { id: string } | null; error: PostgrestError | null }> {
  const { id, updatedBy, ...updates } = input;

  let priority = updates.priority;
  if (
    (updates.dueDate !== undefined || updates.deadlineType !== undefined) &&
    priority === undefined
  ) {
    const existing = await client
      .from("job")
      .select("dueDate, deadlineType, companyId, locationId")
      .eq("id", id)
      .single();

    if (existing.data) {
      priority = await calculateJobPriority(client, {
        jobId: id,
        dueDate: updates.dueDate ?? existing.data.dueDate,
        deadlineType: updates.deadlineType ?? existing.data.deadlineType,
        companyId: existing.data.companyId,
        locationId: existing.data.locationId
      });
    }
  }

  return client
    .from("job")
    .update({
      ...sanitize(updates),
      ...(priority !== undefined && { priority }),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/** @deprecated Use insertJob for new jobs, updateJob for existing jobs */
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
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in jobMaterial) {
    return client
      .from("jobMaterial")
      .update(sanitize(jobMaterial))
      .eq("id", jobMaterial.id)
      .select("id, methodType")
      .single();
  }
  return client
    .from("jobMaterial")
    .insert([jobMaterial])
    .select("id, methodType")
    .single();
}

export async function upsertJobOperation(
  client: SupabaseClient<Database>,
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
  if ("updatedBy" in jobOperation) {
    return client
      .from("jobOperation")
      .update(sanitize(jobOperation))
      .eq("id", jobOperation.id)
      .select("id")
      .single();
  }
  const operationInsert = await client
    .from("jobOperation")
    .insert([jobOperation])
    .select("id")
    .single();

  if (operationInsert.error) {
    return operationInsert;
  }
  const operationId = operationInsert.data?.id;
  if (!operationId) return operationInsert;

  if (jobOperation.procedureId) {
    const { error } = await client.functions.invoke("get-method", {
      body: {
        type: "procedureToOperation",
        sourceId: jobOperation.procedureId,
        targetId: operationId,
        companyId: jobOperation.companyId,
        userId: jobOperation.createdBy
      }
    });
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

export async function upsertJobMethod(
  client: SupabaseClient<Database>,
  type: "itemToJob" | "quoteLineToJob",
  jobMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
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
    type: "itemToJob" | "quoteLineToJob";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
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

  // Only add parts if it exists
  if (jobMethod.parts !== undefined) {
    body.parts = jobMethod.parts;
  }

  const getMethodResult = await client.functions.invoke("get-method", {
    body
  });
  if (getMethodResult.error) {
    return getMethodResult;
  }
  return recalculateJobRequirements(client, {
    id: jobMethod.targetId,
    companyId: jobMethod.companyId,
    userId: jobMethod.userId
  });
}

export async function upsertJobMaterialMakeMethod(
  client: SupabaseClient<Database>,
  jobMaterial: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
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

  // Only add parts if it exists
  if (jobMaterial.parts !== undefined) {
    body.parts = jobMaterial.parts;
  }

  const { error } = await client.functions.invoke("get-method", {
    body
  });

  if (error) {
    return {
      data: null,
      error: { message: "Failed to pull method" } as PostgrestError
    };
  }

  return { data: null, error: null };
}

export async function upsertMakeMethodFromJob(
  client: SupabaseClient<Database>,
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
  return client.functions.invoke("get-method", {
    body: {
      type: "jobToItem",
      sourceId: jobMethod.sourceId,
      targetId: jobMethod.targetId,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId,
      parts: jobMethod.parts
    }
  });
}

export async function upsertMakeMethodFromJobMethod(
  client: SupabaseClient<Database>,
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
  const { error } = await client.functions.invoke("get-method", {
    body: {
      type: "jobMakeMethodToItem",
      sourceId: jobMethod.sourceId,
      targetId: jobMethod.targetId,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId,
      parts: jobMethod.parts
    }
  });

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
  if ("createdBy" in failureMode) {
    return client
      .from("maintenanceFailureMode")
      .insert([failureMode])
      .select("id");
  } else {
    return client
      .from("maintenanceFailureMode")
      .update(sanitize(failureMode))
      .eq("id", failureMode.id);
  }
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

export async function upsertDemandForecasts(
  client: SupabaseClient<Database>,
  forecasts: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    forecastQuantity: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }>
) {
  // Delete existing forecasts with 0 quantity, upsert others
  const toDelete = forecasts.filter((f) => f.forecastQuantity === 0);
  const toUpsert = forecasts.filter((f) => f.forecastQuantity > 0);

  const promises = [];

  if (toDelete.length > 0) {
    for (const forecast of toDelete) {
      promises.push(
        client
          .from("demandForecast")
          .delete()
          .eq("itemId", forecast.itemId)
          .eq("locationId", forecast.locationId)
          .eq("periodId", forecast.periodId)
          .eq("companyId", forecast.companyId)
      );
    }
  }

  if (toUpsert.length > 0) {
    promises.push(
      client.from("demandForecast").upsert(
        toUpsert.map((f) => ({
          ...f,
          updatedBy: f.updatedBy ?? f.createdBy ?? "system",
          updatedAt: new Date().toISOString()
        })),
        {
          onConflict: "itemId,locationId,periodId,companyId"
        }
      )
    );
  }

  const results = await Promise.all(promises);
  const hasError = results.some((r) => r.error);

  return {
    data: hasError ? null : toUpsert,
    error: hasError ? results.find((r) => r.error)?.error : null
  };
}

export async function upsertDemandProjections(
  client: SupabaseClient<Database>,
  forecasts: Array<{
    itemId: string;
    locationId: string;
    periodId: string;
    forecastQuantity: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }>
) {
  // Delete existing forecasts with 0 quantity, upsert others
  const toDelete = forecasts.filter((f) => f.forecastQuantity === 0);
  const toUpsert = forecasts.filter((f) => f.forecastQuantity > 0);

  const promises = [];

  if (toDelete.length > 0) {
    for (const forecast of toDelete) {
      promises.push(
        client
          .from("demandProjection")
          .delete()
          .eq("itemId", forecast.itemId)
          .eq("locationId", forecast.locationId)
          .eq("periodId", forecast.periodId)
          .eq("companyId", forecast.companyId)
      );
    }
  }

  if (toUpsert.length > 0) {
    promises.push(
      client.from("demandProjection").upsert(
        toUpsert.map((f) => ({
          ...f,
          updatedBy: f.updatedBy ?? f.createdBy ?? "system",
          updatedAt: new Date().toISOString()
        })),
        {
          onConflict: "itemId,locationId,periodId,companyId"
        }
      )
    );
  }

  const results = await Promise.all(promises);
  const hasError = results.some((r) => r.error);

  return {
    data: hasError ? null : toUpsert,
    error: hasError ? results.find((r) => r.error)?.error : null
  };
}

/**
 * Trigger a job scheduling task via Inngest.
 * Supports both initial scheduling and rescheduling.
 */
export async function triggerJobSchedule(
  jobId: string,
  companyId: string,
  userId: string,
  mode: "initial" | "reschedule" = "reschedule",
  direction: "backward" | "forward" = "backward"
) {
  const { trigger } = await import("@carbon/jobs");

  await trigger("schedule-job", {
    jobId,
    companyId,
    userId,
    mode,
    direction
  });

  return { success: true };
}

// --- Assembly Instructions ---------------------------------------------

export async function getAssemblyInstruction(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstruction")
    .select(
      "*, modelUpload(id, name, modelPath, glbPath, graphPath, componentCount, processingStatus, processingError)"
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
    .from("assemblyInstruction")
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
  // Each publish bumps the version ("Edit N" in the header)
  let version: number | undefined;
  if (data.status === "Published") {
    const current = await client
      .from("assemblyInstruction")
      .select("version")
      .eq("id", id)
      .single();
    version = (current.data?.version ?? 0) + 1;
  }

  return client
    .from("assemblyInstruction")
    .update({
      status: data.status,
      publishedAt:
        data.status === "Published" ? new Date().toISOString() : undefined,
      ...(version !== undefined ? { version } : {}),
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
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
    await fetch(`${ASSEMBLER_SERVICE_URL}/cache/invalidate`, {
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
    await client.storage.from("private").remove(planPaths);
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
    await client.storage.from("private").remove([...paths]);
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

export async function upsertAssemblyInstructionStep(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    assemblyInstructionId: string;
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
          instructionText: tiptapToText(data.description as JSONContent) || null
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
      title: data.title ?? null,
      type: data.type ?? "Task",
      description: data.description ?? {},
      instructionText:
        data.description !== undefined
          ? tiptapToText(data.description as JSONContent) || null
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
      durationSeconds: data.durationSeconds ?? null,
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
 * the pose (return to auto-framing); omitting a field leaves it untouched.
 */
export async function updateAssemblyStepMotion(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    motion?: z.infer<typeof motionSchema>;
    camera?: z.infer<typeof cameraSchema> | null;
    updatedBy: string;
  }
) {
  return client
    .from("assemblyInstructionStep")
    .update({
      ...(data.motion !== undefined ? { motion: data.motion as Json } : {}),
      ...(data.camera !== undefined
        ? { camera: data.camera as Json | null }
        : {}),
      updatedBy: data.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", data.id)
    .select("id")
    .single();
}

// Autosave target for the Details panel's Add/remove component controls: patches
// only the step's assigned components, leaving the title/typed fields and motion
// untouched.
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

// Assign a set of component instances to a target step. `duplicate` unions them
// onto the target only (a component may live on several steps). `move` unions
// them onto the target AND strips them from every other step, so the component
// ends up on exactly the target. `remove` (no target) strips them from EVERY
// step, unassigning them entirely. One transaction: a half-applied move (added
// to target but not removed from the source, or vice versa) would be a real bug.
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

export async function updateAssemblyInstructionStepOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("assemblyInstructionStep")
        .set({ sortOrder, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function deleteAssemblyInstructionStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyInstructionStep").delete().eq("id", id);
}

export async function getAssemblyInstructionStepRequirements(
  client: SupabaseClient<Database>,
  stepIds: string[]
) {
  if (stepIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("assemblyInstructionStepRequirement")
    .select("*, item(id, name, readableIdWithRevision)")
    .in("stepId", stepIds)
    .order("sortOrder", { ascending: true });
}

export async function upsertAssemblyInstructionStepRequirement(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    stepId: string;
    type: (typeof assemblyRequirementTypes)[number];
    itemId?: string | null;
    name?: string | null;
    text?: string | null;
    severity?: (typeof assemblyNoteSeverities)[number] | null;
    filePath?: string | null;
    quantity?: number;
    sortOrder?: number;
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  // Snapshot the catalog item name so display never needs a join and
  // survives item deletion
  let name = data.name ?? null;
  if (!name && data.itemId) {
    const item = await client
      .from("item")
      .select("name")
      .eq("id", data.itemId)
      .single();
    name = item.data?.name ?? null;
  }

  if (data.id) {
    return client
      .from("assemblyInstructionStepRequirement")
      .update({
        itemId: data.itemId ?? null,
        name,
        text: data.text ?? null,
        severity: data.severity ?? null,
        ...(data.filePath !== undefined ? { filePath: data.filePath } : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyInstructionStepRequirement")
    .insert({
      stepId: data.stepId,
      type: data.type,
      itemId: data.itemId ?? null,
      name,
      text: data.text ?? null,
      severity: data.severity ?? null,
      filePath: data.filePath ?? null,
      quantity: data.quantity ?? 1,
      sortOrder:
        data.sortOrder ?? (await getNextRequirementSortOrder(client, data)),
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

async function getNextRequirementSortOrder(
  client: SupabaseClient<Database>,
  data: { stepId: string; type: (typeof assemblyRequirementTypes)[number] }
) {
  const last = await client
    .from("assemblyInstructionStepRequirement")
    .select("sortOrder")
    .eq("stepId", data.stepId)
    .eq("type", data.type)
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (last.data?.sortOrder ?? 0) + 1;
}

export async function getAssemblyInstructionStepRequirement(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstructionStepRequirement")
    .select("*")
    .eq("id", id)
    .single();
}

export async function updateAssemblyInstructionStepRequirementOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("assemblyInstructionStepRequirement")
        .set({ sortOrder, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function deleteAssemblyInstructionStepRequirement(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("assemblyInstructionStepRequirement")
    .delete()
    .eq("id", id);
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
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("assemblyInstructionStepMaterial")
        .set({ sortOrder, updatedBy, updatedAt: new Date().toISOString() })
        .where("id", "=", id)
        .execute();
    }
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

  const graphFile = await client.storage.from("private").download(graphPath);
  if (graphFile.error || !graphFile.data) return { created: 0 };
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

export async function getAssemblyStandardNotes(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("assemblyStandardNote")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function upsertAssemblyStandardNote(
  client: SupabaseClient<Database>,
  data: {
    id?: string;
    name: string;
    content: string;
    severity: (typeof assemblyNoteSeverities)[number];
    companyId: string;
    createdBy: string;
    updatedBy?: string;
  }
) {
  if (data.id) {
    return client
      .from("assemblyStandardNote")
      .update({
        name: data.name,
        content: data.content,
        severity: data.severity,
        updatedBy: data.updatedBy ?? data.createdBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", data.id)
      .select("id")
      .single();
  }

  return client
    .from("assemblyStandardNote")
    .insert({
      name: data.name,
      content: data.content,
      severity: data.severity,
      companyId: data.companyId,
      createdBy: data.createdBy
    })
    .select("id")
    .single();
}

export async function deleteAssemblyStandardNote(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("assemblyStandardNote").delete().eq("id", id);
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

  const file = await client.storage.from("private").download(job.data.planPath);
  if (file.error || !file.data) return null;

  try {
    const plan = JSON.parse(await file.data.text()) as AssemblyPlan;
    if ((plan.version ?? 1) < CURRENT_PLAN_VERSION) return null;
    return plan;
  } catch {
    return null;
  }
}

// --- Model component ↔ engineering BOM mappings --------------------------

/** Mappings from distinct model components (geometry hashes) to BOM items. */
export async function getAssemblyComponentMappings(
  client: SupabaseClient<Database>,
  modelUploadId: string
) {
  return client
    .from("assemblyComponentMapping")
    .select("*, item(id, name, readableIdWithRevision)")
    .eq("modelUploadId", modelUploadId);
}

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

  const graphFile = await client.storage.from("private").download(graphPath);
  if (graphFile.error || !graphFile.data) {
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

/**
 * Creates draft steps from the motion plan: walks the planned assembly
 * sequence, groups consecutive identical parts (same geometry, same motion
 * shape) into one step, and inserts them in order with status Review. Parts
 * the planner flagged (blockedBy: no collision-free path exists) are stored
 * with motion "none" plus a `warnings` payload — the viewer fades them in
 * rather than animating a fabricated colliding path. The author
 * validates/edits the drafts instead of authoring motions by hand.
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
  const instruction = await client
    .from("assemblyInstruction")
    .select("id, modelUploadId, modelUpload(graphPath)")
    .eq("id", args.assemblyInstructionId)
    .single();
  if (instruction.error || !instruction.data.modelUploadId) {
    return { ok: false, reason: "no-model" };
  }
  const modelUploadId = instruction.data.modelUploadId;

  const existing = await client
    .from("assemblyInstructionStep")
    .select("id, planConfidence, status")
    .eq("assemblyInstructionId", args.assemblyInstructionId);
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
        message: `${locked.length} ${locked.length === 1 ? "step is" : "steps are"} manually authored or done — delete or reset them before regenerating`
      };
    }
    const removed = await client
      .from("assemblyInstructionStep")
      .delete()
      .eq("assemblyInstructionId", args.assemblyInstructionId);
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
    const graphFile = await client.storage.from("private").download(graphPath);
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

/**
 * Maps a DB step row to the viewer's step shape. JSONB columns are validated
 * defensively — `path` motions with invalid keyframes throw inside the viewer,
 * so anything that fails the schema falls back to a safe default.
 */
export function toViewerStep(step: AssemblyInstructionStepRow): AssemblyStep {
  const motion = motionSchema.safeParse(step.motion);
  const camera = cameraSchema.safeParse(step.camera);
  const fastener = fastenerSchema.safeParse(step.fastener);
  const planWarnings = stepPlanWarningsSchema.safeParse(step.warnings);

  return {
    id: step.id,
    title: step.title,
    instructionText: step.instructionText,
    componentNodeIds: step.componentNodeIds ?? [],
    motion: motion.success ? motion.data : { type: "none" },
    camera: camera.success ? camera.data : null,
    fastener: fastener.success ? fastener.data : null,
    durationSeconds: step.durationSeconds,
    flagged:
      planWarnings.success && planWarnings.data.flagged === true
        ? true
        : undefined
  };
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
