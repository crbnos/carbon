import { getCarbonServiceRole } from "@carbon/auth";
import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { parseDate } from "@internationalized/date";
import type { FileObject, StorageError } from "@supabase/storage-js";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { FunctionRegion } from "@supabase/supabase-js";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getDefaultShelfForJob } from "../inventory";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator
} from "../shared";
import type {
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
import type { Job } from "./types";

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

  const serviceRole = getCarbonServiceRole();

  const lines = salesOrderLines.data;
  if (!lines) {
    return { data: null, error: "No lines found" };
  }

  const opportunity = await serviceRole
    .from("opportunity")
    .select("*, quotes(*), salesOrders(*)")
    .eq("id", salesOrder.data?.opportunityId ?? "")
    .single();

  const quoteId = opportunity.data?.quotes[0]?.id;
  const salesOrderId = opportunity.data?.salesOrders[0]?.id;

  const errors: string[] = [];
  let jobsCreated = 0;

  for await (const line of lines) {
    if (line.methodType === "Make" && line.itemId) {
      const itemManufacturing = await serviceRole
        .from("itemReplenishment")
        .select("*")
        .eq("itemId", line.itemId)
        .eq("companyId", companyId)
        .single();

      const lotSize = itemManufacturing.data?.lotSize ?? 0;
      const totalQuantity = line.saleQuantity ?? 0;
      const totalJobs = lotSize > 0 ? Math.ceil(totalQuantity / lotSize) : 1;

      const jobsToCreate = Math.max(1, totalJobs);

      const manufacturing = await serviceRole
        .from("itemReplenishment")
        .select("*")
        .eq("itemId", line.itemId)
        .eq("companyId", companyId)
        .single();

      for await (const index of Array.from({ length: jobsToCreate }).keys()) {
        const nextSequence = await serviceRole.rpc("get_next_sequence", {
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
          const defaultLocation = await serviceRole
            .from("location")
            .select("id")
            .eq("companyId", companyId)
            .limit(1);

          if (defaultLocation.data) {
            locationId = defaultLocation.data?.[0]?.id;
          } else {
            throw new Error("No location found");
          }
        }

        const shelfId = await getDefaultShelfForJob(
          serviceRole,
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
          shelfId: shelfId ?? undefined,
          unitOfMeasureCode: line.unitOfMeasureCode ?? "EA"
        };

        // Calculate priority based on due date and deadline type
        const priority = await calculateJobPriority(serviceRole, {
          dueDate: data.dueDate ?? null,
          deadlineType: data.deadlineType,
          companyId,
          locationId: locationId!
        });

        const createJob = await serviceRole
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
          const upsertMethod = await serviceRole.functions.invoke(
            "get-method",
            {
              body: {
                type: "quoteLineToJob",
                sourceId: `${quoteId}:${line.id}`,
                targetId: createJob.data.id,
                companyId,
                userId
              }
            }
          );

          if (upsertMethod.error) {
            errors.push(
              `Failed to create method for job ${nextSequence.data}: ${upsertMethod.error.message}`
            );
            continue;
          }
        } else {
          const upsertMethod = await serviceRole.functions.invoke(
            "get-method",
            {
              body: {
                type: "itemToJob",
                sourceId: data.itemId,
                targetId: createJob.data.id,
                companyId,
                userId
              }
            }
          );

          if (upsertMethod.error) {
            errors.push(
              `Failed to create method for job ${nextSequence.data}: ${upsertMethod.error.message}`
            );
            continue;
          }
        }

        await serviceRole.functions.invoke("recalculate", {
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
    console.error(errors);
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
    return {
      data: null,
      error: {
        message: "No jobs were created",
        details: "No Make items found on sales order lines",
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
  productionEventId: string
) {
  return client.from("productionEvent").delete().eq("id", productionEventId);
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
  return client.rpc(
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
      // @ts-ignore
      lookup[itemId] = { id: itemId, children: [] };
    }

    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore
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
    .select("*")
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
    { column: "type", ascending: true }
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
    .eq("companyId", jobMakeMethod.data.companyId);
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
    },
    region: FunctionRegion.UsEast1
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
    },
    region: FunctionRegion.UsEast1
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
    },
    region: FunctionRegion.UsEast1
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
    },
    region: FunctionRegion.UsEast1
  });
}

export async function updateJobBatchNumber(
  client: SupabaseClient<Database>,
  trackedEntityId: string,
  value: string
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

export async function upsertJob(
  client: SupabaseClient<Database>,
  job:
    | (Omit<z.infer<typeof jobValidator>, "id" | "jobId"> & {
        jobId: string;
        shelfId?: string;
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
      },
      region: FunctionRegion.UsEast1
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
  }
) {
  const body: {
    type: "itemToJob" | "quoteLineToJob";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
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

  const getMethodResult = await client.functions.invoke("get-method", {
    body,
    region: FunctionRegion.UsEast1
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
  }
) {
  const body: {
    type: "itemToJobMakeMethod";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
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

  const { error } = await client.functions.invoke("get-method", {
    body,
    region: FunctionRegion.UsEast1
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
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type: "jobToItem",
      sourceId: jobMethod.sourceId,
      targetId: jobMethod.targetId,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId
    },
    region: FunctionRegion.UsEast1
  });
}

export async function upsertMakeMethodFromJobMethod(
  client: SupabaseClient<Database>,
  jobMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
  }
) {
  const { error } = await client.functions.invoke("get-method", {
    body: {
      type: "jobMakeMethodToItem",
      sourceId: jobMethod.sourceId,
      targetId: jobMethod.targetId,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId
    },
    region: FunctionRegion.UsEast1
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
 * Trigger a job scheduling task via Trigger.dev.
 * Supports both initial scheduling and rescheduling.
 */
export async function triggerJobSchedule(
  jobId: string,
  companyId: string,
  userId: string,
  mode: "initial" | "reschedule" = "reschedule",
  direction: "backward" | "forward" = "backward"
) {
  const { scheduleJob } = await import("@carbon/jobs/trigger/reschedule-job");

  const handle = await scheduleJob.trigger({
    jobId,
    companyId,
    userId,
    mode,
    direction
  });

  return { success: true, runId: handle.id };
}

/**
 * @deprecated Use triggerJobSchedule with mode="reschedule" instead.
 */
export async function triggerJobReschedule(
  jobId: string,
  companyId: string,
  userId: string
) {
  return triggerJobSchedule(jobId, companyId, userId, "reschedule", "backward");
}
