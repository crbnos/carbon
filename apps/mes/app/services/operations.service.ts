import type { Database } from "@carbon/database";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { sanitize } from "~/utils/supabase";
import type {
  attributeRecordValidator,
  documentTypes,
  nonScrapQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
} from "./models";
import type { BaseOperationWithDetails, Job, StorageItem } from "./types";

export async function deleteAttributeRecord(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string }
) {
  return client
    .from("jobOperationAttributeRecord")
    .delete()
    .eq("jobOperationAttributeId", args.id)
    .eq("companyId", args.companyId)
    .eq("createdBy", args.userId);
}

export async function finishJobOperation(
  client: SupabaseClient<Database>,
  args: {
    jobOperationId: string;
    userId: string;
  }
) {
  const closeProductionEvents = await client
    .from("productionEvent")
    .update({
      endTime: new Date().toISOString(),
      updatedBy: args.userId,
    })
    .eq("jobOperationId", args.jobOperationId);

  if (closeProductionEvents.error) {
    return closeProductionEvents;
  }

  return client
    .from("jobOperation")
    .update({
      status: "Done",
      updatedBy: args.userId,
    })
    .eq("id", args.jobOperationId);
}

export async function getActiveJobOperationsByEmployee(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
  }
) {
  return client.rpc("get_active_job_operations_by_employee", {
    employee_id: args.employeeId,
    company_id: args.companyId,
  });
}

export async function getActiveJobOperationsByLocation(
  client: SupabaseClient<Database>,
  locationId: string,
  workCenterIds: string[] = []
) {
  return client.rpc("get_active_job_operations_by_location", {
    location_id: locationId,
    work_center_ids: workCenterIds,
  });
}

export async function getActiveJobCount(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
  }
) {
  return client.rpc("get_active_job_count", {
    employee_id: args.employeeId,
    company_id: args.companyId,
  });
}

export async function getCustomers(
  client: SupabaseClient<Database>,
  companyId: string,
  customerIds: string[]
) {
  return client
    .from("customer")
    .select("id, name")
    .in("id", customerIds)
    .eq("companyId", companyId);
}

export function getFileType(fileName: string): (typeof documentTypes)[number] {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
    return "Archive";
  }

  if (["pdf"].includes(extension)) {
    return "PDF";
  }

  if (["doc", "docx", "txt", "rtf"].includes(extension)) {
    return "Document";
  }

  if (["ppt", "pptx"].includes(extension)) {
    return "Presentation";
  }

  if (["csv", "xls", "xlsx"].includes(extension)) {
    return "Spreadsheet";
  }

  if (["txt"].includes(extension)) {
    return "Text";
  }

  if (["png", "jpg", "jpeg", "gif", "avif"].includes(extension)) {
    return "Image";
  }

  if (["mp4", "mov", "avi", "wmv", "flv", "mkv"].includes(extension)) {
    return "Video";
  }

  if (["mp3", "wav", "wma", "aac", "ogg", "flac"].includes(extension)) {
    return "Audio";
  }

  return "Other";
}

export async function getJobOperationProcedure(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const [attributes, parameters] = await Promise.all([
    client
      .from("jobOperationAttribute")
      .select("*, jobOperationAttributeRecord(*)")
      .eq("operationId", operationId),
    client
      .from("jobOperationParameter")
      .select("*")
      .eq("operationId", operationId),
  ]);

  return {
    attributes: attributes.data ?? [],
    parameters: parameters.data ?? [],
  };
}

export async function getJobAttributesByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  return client
    .from("jobOperationAttribute")
    .select("*, jobOperationAttributeRecord(*)")
    .eq("operationId", operationId);
}

export async function getJobByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const operation = await client
    .from("jobOperation")
    .select("jobId")
    .eq("id", operationId)
    .single();
  if (operation.error) return operation;
  return client
    .from("jobs")
    .select("*")
    .eq("id", operation.data.jobId)
    .single();
}

export async function getJobFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  job: Job,
  itemId: string
): Promise<StorageItem[]> {
  if (job.salesOrderLineId || job.quoteLineId) {
    const opportunityLine = job.salesOrderLineId || job.quoteLineId;

    const [opportunityLineFiles, jobFiles, itemFiles] = await Promise.all([
      client.storage
        .from("private")
        .list(`${companyId}/opportunity-line/${opportunityLine}`),
      client.storage.from("private").list(`${companyId}/job/${job.id}`),
      client.storage.from("private").list(`${companyId}/parts/${itemId}`),
    ]);

    // Combine and return both sets of files
    return [
      ...(opportunityLineFiles.data?.map((f) => ({
        ...f,
        bucket: "opportunity-line",
      })) || []),
      ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
      ...(itemFiles.data?.map((f) => ({ ...f, bucket: "parts" })) || []),
    ];
  } else {
    const [jobFiles, itemFiles] = await Promise.all([
      client.storage.from("private").list(`${companyId}/job/${job.id}`),
      client.storage.from("private").list(`${companyId}/parts/${itemId}`),
    ]);

    return [
      ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
      ...(itemFiles.data?.map((f) => ({ ...f, bucket: "parts" })) || []),
    ];
  }
}

export async function getJobMaterialsByOperationId(
  client: SupabaseClient<Database>,
  operation: BaseOperationWithDetails
): Promise<
  PostgrestResponse<Database["public"]["Tables"]["jobMaterial"]["Row"]>
> {
  return client
    .from("jobMaterial")
    .select("*")
    .eq("jobMakeMethodId", operation.jobMakeMethodId)
    .order("itemReadableId", { ascending: true })
    .order("id", { ascending: true });
}

export async function getJobOperationsAssignedToEmployee(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client.rpc("get_assigned_job_operations", {
    user_id: employeeId,
    company_id: companyId,
  });
}

export async function getJobOperationById(
  client: SupabaseClient<Database>,
  operationId: string
) {
  return client.rpc("get_job_operation_by_id", {
    operation_id: operationId,
  });
}

export async function getJobOperationsByWorkCenter(
  client: SupabaseClient<Database>,
  { locationId, workCenterId }: { locationId: string; workCenterId: string }
) {
  return client.rpc("get_job_operations_by_work_center", {
    location_id: locationId,
    work_center_id: workCenterId,
  });
}

export async function getJobParametersByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  return client
    .from("jobOperationParameter")
    .select("*")
    .eq("operationId", operationId);
}

export async function getLocationsByCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("location")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function getProcessesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("process")
    .select(`id, name`)
    .eq("companyId", companyId)
    .order("name");
}

export async function getProductionEventsForJobOperation(
  client: SupabaseClient<Database>,
  args: {
    operationId: string;
    userId: string;
  }
) {
  return client
    .from("productionEvent")
    .select("*")
    .eq("jobOperationId", args.operationId);
}

export async function getProductionQuantitiesForJobOperation(
  client: SupabaseClient<Database>,
  operationId: string
) {
  return client
    .from("productionQuantity")
    .select("*")
    .eq("jobOperationId", operationId);
}

export async function getRecentJobOperationsByEmployee(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
  }
) {
  return client.rpc("get_recent_job_operations_by_employee", {
    employee_id: args.employeeId,
    company_id: args.companyId,
  });
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

export async function getThumbnailPathByItemId(
  client: SupabaseClient<Database>,
  itemId: string
) {
  const { data: item } = await client
    .from("item")
    .select("thumbnailPath, modelUploadId")
    .eq("id", itemId)
    .single();

  if (!item) return null;

  const { thumbnailPath, modelUploadId } = item;

  if (!modelUploadId) return thumbnailPath;

  const { data: modelUpload } = await client
    .from("modelUpload")
    .select("thumbnailPath")
    .eq("id", modelUploadId)
    .single();

  const modelUploadThumbnailPath = modelUpload?.thumbnailPath;

  if (!thumbnailPath && modelUploadThumbnailPath) {
    return modelUploadThumbnailPath;
  }
  return thumbnailPath;
}

export async function getWorkCenter(
  client: SupabaseClient<Database>,
  workCenterId: string
) {
  return client.from("workCenter").select("*").eq("id", workCenterId).single();
}

export async function getWorkCentersByLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("workCenters")
    .select("*")
    .eq("locationId", locationId)
    .eq("active", true)
    .order("name", { ascending: true });
}

export async function getWorkCentersByCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("workCenter")
    .select("*")
    .eq("companyId", companyId)
    .order("name", { ascending: true });
}

export async function insertAttributeRecord(
  client: SupabaseClient<Database>,
  data: z.infer<typeof attributeRecordValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("jobOperationAttributeRecord").upsert(data, {
    onConflict: "jobOperationAttributeId",
    ignoreDuplicates: false,
  });
}

export async function insertReworkQuantity(
  client: SupabaseClient<Database>,
  data: z.infer<typeof nonScrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("productionQuantity")
    .insert(
      sanitize({
        ...data,
        type: "Rework",
      })
    )
    .select("*");
}

export async function insertProductionQuantity(
  client: SupabaseClient<Database>,
  data: z.infer<typeof nonScrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("productionQuantity")
    .insert(
      sanitize({
        ...data,
        type: "Production",
      })
    )
    .select("*");
}

export async function insertScrapQuantity(
  client: SupabaseClient<Database>,
  data: z.infer<typeof scrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("productionQuantity")
    .insert(
      sanitize({
        ...data,
        type: "Scrap",
      })
    )
    .select("*");
}

export async function endProductionEvent(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    endTime: string;
    employeeId: string;
  }
) {
  return client
    .from("productionEvent")
    .update({ endTime: data.endTime, updatedBy: data.employeeId })
    .eq("id", data.id)
    .select("*");
}

export async function endProductionEvents(
  client: SupabaseClient<Database>,
  args: { companyId: string; employeeId: string; endTime: string }
) {
  return client
    .from("productionEvent")
    .update({
      endTime: args.endTime,
    })
    .is("endTime", null)
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId);
}

export async function startProductionEvent(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof productionEventValidator>,
    "id" | "action" | "timezone" | "hasActiveEvents"
  > & {
    startTime: string;
    employeeId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("productionEvent").insert(data).select("*");
}
