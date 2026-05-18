import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { parseDate } from "@internationalized/date";
import type { FileObject, StorageError } from "@supabase/storage-js";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { AuthContextHolder, getAuthClient, mcpTool } from "~/services/mcp";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getDefaultStorageUnitForJob } from "../inventory";
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
export const convertSalesOrderLinesToJobs = mcpTool(
  {
    classification: "WRITE",
    argOrder: ["args"]
  },
  async function convertSalesOrderLinesToJobs({
    orderId
  }: {
    orderId: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
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
            errors.push(
              `Failed to get sequence for line ${line.itemReadableId}`
            );
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
            line.itemId,
            locationId!
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
          const priority = await calculateJobPriority({
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
);

/**
 * Calculate the priority for a job based on its dueDate and deadlineType.
 * Priority ordering: ASAP > Hard Deadline > Soft Deadline > No Deadline
 *
 * @param client - Supabase client
 * @param params - Job details
 * @returns The calculated priority number
 */
export const calculateJobPriority = mcpTool(
  {
    classification: "WRITE"
  },
  async function calculateJobPriority(params: {
    jobId?: string; // Optional - if updating an existing job
    dueDate: string | null;
    deadlineType: (typeof deadlineTypes)[number];
    locationId: string;
  }): Promise<number> {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteDemandForecasts = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteDemandForecasts(params: {
    itemId: string;
    locationId: string;
    futurePeriodIds: string[];
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteDemandProjections = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteDemandProjections(params: {
    itemId: string;
    locationId: string;
    futurePeriodIds: string[];
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteJob = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteJob(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("job").delete().eq("id", jobId);
  }
);

export const deleteJobMaterial = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteJobMaterial(jobMaterialId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("jobMaterial").delete().eq("id", jobMaterialId);
  }
);

export const deleteJobOperation = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteJobOperation(jobOperationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("jobOperation").delete().eq("id", jobOperationId);
  }
);

export const deleteJobOperationStep = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteJobOperationStep(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("jobOperationStep").delete().eq("id", id);
  }
);

export const deleteJobOperationParameter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteJobOperationParameter(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("jobOperationParameter").delete().eq("id", id);
  }
);

export const deleteJobOperationTool = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteJobOperationTool(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("jobOperationTool").delete().eq("id", id);
  }
);

export const deleteProcedure = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteProcedure(procedureId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("procedure").delete().eq("id", procedureId);
  }
);

export const deleteProcedureStep = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteProcedureStep(procedureStepId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("procedureStep")
      .delete()
      .eq("id", procedureStepId)
      .eq("companyId", companyId);
  }
);

export const deleteProcedureParameter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteProcedureParameter(procedureParameterId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("procedureParameter")
      .delete()
      .eq("id", procedureParameterId)
      .eq("companyId", companyId);
  }
);

export const deleteProductionEvent = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteProductionEvent(productionEventId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("productionEvent").delete().eq("id", productionEventId);
  }
);

export const deleteProductionQuantity = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteProductionQuantity(productionQuantityId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("productionQuantity")
      .delete()
      .eq("id", productionQuantityId);
  }
);

export const getActiveJobOperationByJobId = mcpTool(
  {
    classification: "READ"
  },
  async function getActiveJobOperationByJobId(jobId: string): Promise<{
    id: string;
    setupTime: number;
    laborTime: number;
    machineTime: number;
  } | null> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getActiveJobOperationsByLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getActiveJobOperationsByLocation(
    locationId: string,
    workCenterIds: string[] = []
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.rpc("get_active_job_operations_by_location", {
      location_id: locationId,
      work_center_ids: workCenterIds
    });
  }
);

export const getJobsByDateRange = mcpTool(
  {
    classification: "READ"
  },
  async function getJobsByDateRange(
    locationId: string,
    startDate: string,
    endDate: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.rpc("get_jobs_by_date_range", {
      location_id: locationId,
      start_date: startDate,
      end_date: endDate
    });
  }
);

export const getUnscheduledJobs = mcpTool(
  {
    classification: "READ"
  },
  async function getUnscheduledJobs(locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.rpc("get_unscheduled_jobs", {
      location_id: locationId
    });
  }
);

export const getActiveProductionEvents = mcpTool(
  {
    classification: "READ"
  },
  async function getActiveProductionEvents() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("productionEvent")
      .select(
        "*, ...jobOperation(description, ...job(jobId:id, jobReadableId:jobId, customerId, dueDate, deadlineType, salesOrderLineId, ...salesOrderLine(...salesOrder(salesOrderId:id, salesOrderReadableId:salesOrderId))))"
      )
      .eq("companyId", companyId)
      .is("endTime", null);
  }
);

export const deleteScrapReason = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteScrapReason(scrapReasonId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("scrapReason").delete().eq("id", scrapReasonId);
  }
);

export const deleteFailureMode = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteFailureMode(failureModeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceFailureMode")
      .delete()
      .eq("id", failureModeId);
  }
);

export const deleteMaintenanceDispatch = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatch(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceDispatch").delete().eq("id", dispatchId);
  }
);

export const deleteMaintenanceDispatchComment = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchComment(commentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchComment")
      .delete()
      .eq("id", commentId);
  }
);

export const deleteMaintenanceDispatchEvent = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchEvent(eventId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceDispatchEvent").delete().eq("id", eventId);
  }
);

export const deleteMaintenanceDispatchItem = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchItem(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceDispatchItem").delete().eq("id", itemId);
  }
);

export const deleteMaintenanceDispatchWorkCenter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchWorkCenter(workCenterId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchWorkCenter")
      .delete()
      .eq("id", workCenterId);
  }
);

export const deleteMaintenanceSchedule = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceSchedule(scheduleId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceSchedule").delete().eq("id", scheduleId);
  }
);

export const deleteMaintenanceScheduleItem = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceScheduleItem(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceScheduleItem").delete().eq("id", itemId);
  }
);

export const getDemandForecasts = mcpTool(
  {
    classification: "READ"
  },
  async function getDemandForecasts(params: {
    itemId: string;
    locationId: string;
    periodIds: string[];
  }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("demandForecast")
      .select("*")
      .eq("itemId", params.itemId)
      .eq("locationId", params.locationId)
      .eq("companyId", companyId)
      .in("periodId", params.periodIds);
  }
);

export const getDemandProjections = mcpTool(
  {
    classification: "READ"
  },
  async function getDemandProjections(params: {
    itemId: string;
    locationId: string;
    periodIds: string[];
  }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("demandProjection")
      .select("*")
      .eq("itemId", params.itemId)
      .eq("locationId", params.locationId)
      .eq("companyId", companyId)
      .in("periodId", params.periodIds);
  }
);

export const getJobDocuments = mcpTool(
  {
    classification: "READ"
  },
  async function getJobDocuments(job: {
    id: string | null;
    salesOrderLineId?: string | null;
    quoteLineId?: string | null;
    itemId?: string | null;
  }): Promise<StorageItem[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getPartDocuments = async (...items: Array<{ itemId: string }>) => {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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

export const getJobDocumentsWithItemId = mcpTool(
  {
    classification: "READ"
  },
  async function getJobDocumentsWithItemId(
    job: Job,
    itemId: string
  ): Promise<StorageItem[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const itemFiles = await getPartDocuments({ itemId });

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
);

export const getJob = mcpTool(
  {
    classification: "READ"
  },
  async function getJob(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("jobs").select("*").eq("id", id).single();
  }
);

export const getJobByOperationId = mcpTool(
  {
    classification: "READ"
  },
  async function getJobByOperationId(operationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobOperation")
      .select("...job(id, companyId, customerId)")
      .eq("id", operationId)
      .single();
  }
);

export const getJobPurchaseOrderLines = mcpTool(
  {
    classification: "READ"
  },
  async function getJobPurchaseOrderLines(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseOrderLine")
      .select(
        "id, itemId, purchaseQuantity, quantityReceived, quantityShipped, purchaseOrder(id, purchaseOrderId, status, supplierId, supplierInteractionId), jobOperation(id, description, operationQuantity)"
      )
      .eq("jobId", jobId);
  }
);

export const getJobs = mcpTool(
  {
    classification: "READ"
  },
  async function getJobs(
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getJobsBySalesOrderLine = mcpTool(
  {
    classification: "READ"
  },
  async function getJobsBySalesOrderLine(salesOrderLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobs")
      .select("*")
      .eq("salesOrderLineId", salesOrderLineId)
      .order("createdAt", { ascending: true });
  }
);

export const getJobsList = mcpTool(
  {
    classification: "READ"
  },
  async function getJobsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return fetchAllFromTable<{
      id: string;
      jobId: string;
    }>(client, "job", "id, jobId", (query) =>
      query.eq("companyId", companyId).order("jobId")
    );
  }
);

export const getJobMakeMethodById = mcpTool(
  {
    classification: "READ"
  },
  async function getJobMakeMethodById(jobMakeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("jobMakeMethod")
      .select("*, ...item(itemType:type, methodRevision:revision)")
      .eq("id", jobMakeMethodId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getRootMakeMethod = mcpTool(
  {
    classification: "READ"
  },
  async function getRootMakeMethod(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("jobMakeMethod")
      .select("*, ...item(itemType:type, methodRevision:revision)")
      .eq("jobId", jobId)
      .is("parentMaterialId", null)
      .eq("companyId", companyId)
      .single();
  }
);

export const getJobMaterialsWithQuantityOnHand = mcpTool(
  {
    classification: "READ"
  },
  async function getJobMaterialsWithQuantityOnHand(
    jobId: string,
    locationId: string,
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getJobMethodTree = mcpTool(
  {
    classification: "READ"
  },
  async function getJobMethodTree(jobId: string) {
    const items = await getJobMethodTreeArray(jobId);
    if (items.error) return items;

    const tree = getJobMethodTreeArrayToTree(items.data);

    return {
      data: tree,
      error: null
    };
  }
);

export const getJobMethodTreeArray = mcpTool(
  {
    classification: "READ"
  },
  async function getJobMethodTreeArray(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.rpc("get_job_method", {
      jid: jobId
    });
  }
);

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

export const getJobMaterial = mcpTool(
  {
    classification: "READ"
  },
  async function getJobMaterial(materialId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobMaterialWithMakeMethodId")
      .select("*")
      .eq("id", materialId)
      .single();
  }
);

export const getJobMaterialsByMethodId = mcpTool(
  {
    classification: "READ"
  },
  async function getJobMaterialsByMethodId(jobMakeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobMaterial")
      .select("*, item(replenishmentSystem)")
      .eq("jobMakeMethodId", jobMakeMethodId)
      .order("order", { ascending: true });
  }
);

export const getJobOperation = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperation(jobOperationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobOperation")
      .select("*")
      .eq("id", jobOperationId)
      .single();
  }
);

export const getJobOperations = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperations(
    jobId: string,
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getJobOperationsAssignedToEmployee = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperationsAssignedToEmployee(employeeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("jobOperation")
      .select(
        "id, description, workCenterId, ...job(jobId:id, jobReadableId:jobId)"
      )
      .eq("assignee", employeeId)
      .eq("companyId", companyId);
  }
);

export const getJobOperationAttachments = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperationAttachments(
    jobOperationIds: string[]
  ): Promise<Record<string, string[]>> {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getJobOperationsList = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperationsList(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobOperation")
      .select("id, description, order")
      .eq("jobId", jobId)
      .order("order", { ascending: true });
  }
);

export const getJobOperationsByMethodId = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperationsByMethodId(jobMakeMethodId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobOperation")
      .select(
        "*, jobOperationTool(*), jobOperationParameter(*), jobOperationStep(*, jobOperationStepRecord(*))"
      )
      .eq("jobMakeMethodId", jobMakeMethodId)
      .order("order", { ascending: true });
  }
);

export const getJobOperationStepRecords = mcpTool(
  {
    classification: "READ"
  },
  async function getJobOperationStepRecords(
    jobId: string,
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

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
  let query = client
    .from("jobOperationStepRecord")
    .select("id, value, jobOperationStep:operationId!inner(id, description)")
    .eq("jobOperationStep.jobId", jobId);

  if (args.search) {
    query = query.ilike("value", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false },
  ]);

  return query;
}

export const getOutsideOperationsByJobId = mcpTool(
  {
    classification: "READ"
  },
  async function getOutsideOperationsByJobId(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("jobOperation")
      .select("id, description")
      .eq("jobId", jobId)
      .eq("companyId", companyId)
      .eq("operationType", "Outside");
  }
);

export const getProcedure = mcpTool(
  {
    classification: "READ"
  },
  async function getProcedure(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("procedure")
      .select("*, procedureStep(*), procedureParameter(*)")
      .eq("id", id)
      .single();
  }
);

export const getProcedureSteps = mcpTool(
  {
    classification: "READ"
  },
  async function getProcedureSteps(procedureId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("procedureStep")
      .select("*")
      .eq("procedureId", procedureId);
  }
);

export const getProcedureParameters = mcpTool(
  {
    classification: "READ"
  },
  async function getProcedureParameters(procedureId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("procedureParameter")
      .select("*")
      .eq("procedureId", procedureId);
  }
);

export const getProcedureVersions = mcpTool(
  {
    classification: "READ"
  },
  async function getProcedureVersions(procedure: {
    name: string;
    version: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("procedure")
      .select("*")
      .eq("name", procedure.name)
      .eq("companyId", companyId)
      .neq("version", procedure.version)
      .order("version", { ascending: false });
  }
);

export const getProcedures = mcpTool(
  {
    classification: "READ"
  },
  async function getProcedures(
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProceduresList = mcpTool(
  {
    classification: "READ"
  },
  async function getProceduresList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProductionEvent = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionEvent(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("productionEvent")
      .select("*, jobOperation(description)")
      .eq("id", id)
      .single();
  }
);

export const getProductionEvents = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionEvents(
    jobOperationIds: string[],
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getProductionEventsPage = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionEventsPage(
    jobOperationId: string,
    sortDescending: boolean = false,
    page: number = 1
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProductionEventsByOperations = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionEventsByOperations(jobOperationIds: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("productionEvent")
      .select(
        "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableIdWithRevision)))"
      )
      .in("jobOperationId", jobOperationIds)
      .order("startTime", { ascending: true });
  }
);

export const getProductionPlanning = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionPlanning(
    locationId: string,
    periods: string[],
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProductionProjections = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionProjections(
    locationId: string,
    periods: string[],
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProductionQuantity = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionQuantity(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("productionQuantity")
      .select("*, jobOperation(description)")
      .eq("id", id)
      .single();
  }
);

export const getProductionQuantities = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionQuantities(
    jobOperationIds: string[],
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getProductionDataByOperations = mcpTool(
  {
    classification: "READ"
  },
  async function getProductionDataByOperations(jobOperationIds: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getScrapReasonsList = mcpTool(
  {
    classification: "READ"
  },
  async function getScrapReasonsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("scrapReason")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getScrapReason = mcpTool(
  {
    classification: "READ"
  },
  async function getScrapReason(scrapReasonId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("scrapReason")
      .select("*")
      .eq("id", scrapReasonId)
      .single();
  }
);

export const getScrapReasons = mcpTool(
  {
    classification: "READ"
  },
  async function getScrapReasons(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getFailureMode = mcpTool(
  {
    classification: "READ"
  },
  async function getFailureMode(failureModeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceFailureMode")
      .select("*")
      .eq("id", failureModeId)
      .single();
  }
);

export const getFailureModes = mcpTool(
  {
    classification: "READ"
  },
  async function getFailureModes(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getFailureModesList = mcpTool(
  {
    classification: "READ"
  },
  async function getFailureModesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("maintenanceFailureMode")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getMaintenanceDispatch = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatch(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getMaintenanceDispatches = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatches(
    args?: GenericQueryFilters & { search: string | null; status?: string }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaintenanceDispatchComments = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchComments(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchComment")
      .select(
        `id, comment, createdAt,
         createdBy:user!maintenanceDispatchComment_createdBy_fkey(id, fullName, avatarUrl)`
      )
      .eq("maintenanceDispatchId", dispatchId)
      .order("createdAt", { ascending: false });
  }
);

export const getMaintenanceDispatchEvents = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchEvents(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getMaintenanceDispatchItems = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchItems(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchItem")
      .select(
        `id, itemId, quantity, unitOfMeasureCode, unitCost, totalCost,
         item:item!maintenanceDispatchItem_itemId_fkey(id, name)`
      )
      .eq("maintenanceDispatchId", dispatchId);
  }
);

export const getMaintenanceDispatchWorkCenters = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchWorkCenters(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchWorkCenter")
      .select(
        `id, workCenterId,
         workCenter:workCenter!maintenanceDispatchWorkCenter_workCenterId_fkey(id, name)`
      )
      .eq("maintenanceDispatchId", dispatchId);
  }
);

export const getMaintenanceSchedule = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceSchedule(scheduleId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceSchedule")
      .select(
        `*,
         workCenter:workCenter!maintenanceSchedule_workCenterId_fkey(id, name)`
      )
      .eq("id", scheduleId)
      .single();
  }
);

export const getMaintenanceSchedules = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceSchedules(
    args?: GenericQueryFilters & { search: string | null; active?: boolean }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaintenanceScheduleItems = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceScheduleItems(scheduleId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceScheduleItem")
      .select(
        `id, quantity, unitOfMeasureCode,
         item:item!maintenanceScheduleItem_itemId_fkey(id, name)`
      )
      .eq("maintenanceScheduleId", scheduleId);
  }
);

export const getTrackedEntityByJobId = mcpTool(
  {
    classification: "READ"
  },
  async function getTrackedEntityByJobId(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getTrackedEntitiesByJobId = mcpTool(
  {
    classification: "READ"
  },
  async function getTrackedEntitiesByJobId(jobId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

/**
 * Reschedule a job using the unified scheduling engine.
 * This recalculates dates, work centers, and priorities for all operations.
 */
export const recalculateJobOperationDependencies = mcpTool(
  {
    classification: "WRITE"
  },
  async function recalculateJobOperationDependencies(params: {
    jobId: string;
  }) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("schedule", {
      body: {
        jobId: params.jobId,
        companyId: companyId,
        userId: userId,
        mode: "reschedule",
        direction: "backward"
      }
    });
  }
);
export const recalculateJobRequirements = mcpTool(
  {
    classification: "WRITE"
  },
  async function recalculateJobRequirements(params: {
    id: string; // job id
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("recalculate", {
      body: {
        type: "jobRequirements",
        ...params
      }
    });
  }
);

export const recalculateJobMakeMethodRequirements = mcpTool(
  {
    classification: "WRITE"
  },
  async function recalculateJobMakeMethodRequirements(params: {
    id: string; // job make method id
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("recalculate", {
      body: {
        type: "jobMakeMethodRequirements",
        ...params
      }
    });
  }
);

export const runMRP = mcpTool(
  {
    classification: "WRITE"
  },
  async function runMRP(params: {
    type:
      | "company"
      | "location"
      | "job"
      | "salesOrder"
      | "item"
      | "purchaseOrder";
    id: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("mrp", {
      body: {
        ...params
      }
    });
  }
);

export const updateJobBatchNumber = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobBatchNumber(
    trackedEntityId: string,
    value: string | null
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("trackedEntity")
      .update({
        readableId: value
      })
      .eq("id", trackedEntityId)
      .select("id, readableId");
  }
);

export const updateJobStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobStatus(params: {
    id: string;
    status: (typeof jobStatus)[number];
    assignee?: string | null;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateJobMaterialOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobMaterialOrder(
    updates: {
      id: string;
      order: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, order, updatedBy }) =>
      client.from("jobMaterial").update({ order, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateJobOperationOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobOperationOrder(
    updates: {
      id: string;
      order: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, order, updatedBy }) =>
      client.from("jobOperation").update({ order, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateJobOperationStepOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobOperationStepOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client
        .from("jobOperationStep")
        .update({ sortOrder, updatedBy })
        .eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateKanbanJob = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateKanbanJob(params: { id: string; jobId: string | null }) {
    const client = getAuthClient<SupabaseClient<Database>>();

    const { id, jobId, companyId, userId } = params;
    return client
      .from("kanban")
      .update({ jobId, updatedBy: userId, updatedAt: new Date().toISOString() })
      .eq("id", id)
      .eq("companyId", companyId);
  }
);

export const updateQuoteOperationStepOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateQuoteOperationStepOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client
        .from("quoteOperationStep")
        .update({ sortOrder, updatedBy })
        .eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateMethodOperationStepOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateMethodOperationStepOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client
        .from("methodOperationStep")
        .update({ sortOrder, updatedBy })
        .eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateJobOperationStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobOperationStatus(
    id: string,
    status: (typeof jobOperationStatus)[number],
    updatedBy: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateJobOperationDueDate = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobOperationDueDate(
    id: string,
    dueDate: string | null,
    updatedBy: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("jobOperation")
      .update({
        dueDate,
        updatedBy,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id)
      .select()
      .single();
  }
);

export const updateProcedureStepOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateProcedureStepOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client.from("procedureStep").update({ sortOrder, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const upsertProductionEvent = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertProductionEvent(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateProductionQuantity = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateProductionQuantity(
    productionQuantity: z.infer<typeof productionQuantityValidator> & {
      id: string;
      updatedBy: string;
      companyId: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertProductionQuantity = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertProductionQuantity(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertJob = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJob(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertJobMaterial = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobMaterial(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertJobOperation = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobOperation(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
          companyId: companyId,
          userId: userId
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
);

export const upsertJobOperationStep = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobOperationStep(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertJobOperationParameter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobOperationParameter(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertJobOperationTool = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobOperationTool(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertJobMethod = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobMethod(
    type: "itemToJob" | "quoteLineToJob",
    jobMethod: {
      sourceId: string;
      targetId: string;
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
      companyId: companyId,
      userId: userId
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
    return recalculateJobRequirements({
      id: jobMethod.targetId,
      companyId: companyId,
      userId: userId
    });
  }
);

export const upsertJobMaterialMakeMethod = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertJobMaterialMakeMethod(jobMaterial: {
    sourceId: string;
    targetId: string;
    configuration?: Record<string, unknown>;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
      companyId: companyId,
      userId: userId
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
);

export const upsertMakeMethodFromJob = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMakeMethodFromJob(jobMethod: {
    sourceId: string;
    targetId: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.functions.invoke("get-method", {
      body: {
        type: "jobToItem",
        sourceId: jobMethod.sourceId,
        targetId: jobMethod.targetId,
        companyId: companyId,
        userId: userId,
        parts: jobMethod.parts
      }
    });
  }
);

export const upsertMakeMethodFromJobMethod = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMakeMethodFromJobMethod(jobMethod: {
    sourceId: string;
    targetId: string;
    parts?: {
      billOfMaterial: boolean;
      billOfProcess: boolean;
      parameters: boolean;
      tools: boolean;
      steps: boolean;
      workInstructions: boolean;
    };
  }) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const { error } = await client.functions.invoke("get-method", {
      body: {
        type: "jobMakeMethodToItem",
        sourceId: jobMethod.sourceId,
        targetId: jobMethod.targetId,
        companyId: companyId,
        userId: userId,
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
);

export const upsertProcedure = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertProcedure(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertProcedureStep = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertProcedureStep(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertProcedureParameter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertProcedureParameter(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertScrapReason = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertScrapReason(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in scrapReason) {
      return client.from("scrapReason").insert([scrapReason]).select("id");
    } else {
      return client
        .from("scrapReason")
        .update(sanitize(scrapReason))
        .eq("id", scrapReason.id);
    }
  }
);

export const upsertFailureMode = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertFailureMode(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatch = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatch(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchComment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchComment(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchEvent = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchEvent(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchItem = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchItem(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchWorkCenter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchWorkCenter(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceSchedule = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceSchedule(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceScheduleItem = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceScheduleItem(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertDemandForecasts = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertDemandForecasts(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    // BUG3: `forecasts` is an array PARAM whose element type declared
    // companyId/createdBy only because the old executor injected them
    // per-element. Identity now comes from ALS. forecast.companyId →
    // companyId (server-scoped, same for every element this request).
    const { companyId, userId } = AuthContextHolder.get();
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
            .eq("companyId", companyId)
        );
      }
    }

    if (toUpsert.length > 0) {
      promises.push(
        client.from("demandForecast").upsert(
          toUpsert.map((f) => ({
            ...f,
            updatedBy: userId ?? "system",
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
);

export const upsertDemandProjections = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertDemandProjections(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    // BUG3: `forecasts` is an array PARAM whose element type declared
    // companyId/createdBy only because the old executor injected them
    // per-element. Identity now comes from ALS. forecast.companyId →
    // companyId (server-scoped, same for every element this request).
    const { companyId, userId } = AuthContextHolder.get();
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
            .eq("companyId", companyId)
        );
      }
    }

    if (toUpsert.length > 0) {
      promises.push(
        client.from("demandProjection").upsert(
          toUpsert.map((f) => ({
            ...f,
            updatedBy: userId ?? "system",
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
);

/**
 * Trigger a job scheduling task via Inngest.
 * Supports both initial scheduling and rescheduling.
 */
export const triggerJobSchedule = mcpTool(
  {
    classification: "WRITE"
  },
  async function triggerJobSchedule(
    jobId: string,
    mode: "initial" | "reschedule" = "reschedule",
    direction: "backward" | "forward" = "backward"
  ) {
    const { companyId, userId } = AuthContextHolder.get();
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
);
