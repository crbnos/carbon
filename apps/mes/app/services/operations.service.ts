import type { Database } from "@carbon/database";
import type { FileObject } from "@supabase/storage-js";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { sanitize } from "~/utils/supabase";

export type BaseOperation = NonNullable<
  Awaited<ReturnType<typeof getJobOperationsByWorkCenter>>["data"]
>[number];

export type BaseOperationWithDetails = NonNullable<
  Awaited<ReturnType<typeof getJobOperationById>>["data"]
>[number];

type Durations = {
  duration: number;
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
};

export type Location = NonNullable<
  Awaited<ReturnType<typeof getLocationsByCompany>>["data"]
>[number];

export type Job = NonNullable<
  Awaited<ReturnType<typeof getJobByOperationId>>["data"]
>;

export type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterialsByOperationId>>["data"]
>[number];

export type Operation = BaseOperation & Durations;
export type OperationWithDetails = BaseOperationWithDetails & Durations;

export type OperationSettings = {
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showEmployee: boolean;
  showProgress: boolean;
  showStatus: boolean;
};

export type ProductionEvent = NonNullable<
  Awaited<ReturnType<typeof getProductionEventsForJobOperation>>["data"]
>[number];

export type ProductionQuantity = NonNullable<
  Awaited<ReturnType<typeof getProductionQuantitiesForJobOperation>>["data"]
>[number];

export type StorageItem = FileObject & {
  bucket: string;
};

export type WorkCenter = NonNullable<
  Awaited<ReturnType<typeof getJobOperationsByWorkCenter>>["data"]
>[number];

export const documentTypes = [
  "Archive",
  "Document",
  "Presentation",
  "PDF",
  "Spreadsheet",
  "Text",
  "Image",
  "Video",
  "Audio",
  "Other",
] as const;

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline",
] as const;

export const jobStatus = [
  "Draft",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled",
] as const;

export const jobOperationStatus = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused",
  "Done",
  "Canceled",
] as const;

export const productionEventType = ["Setup", "Labor", "Machine"] as const;

export const productionEventAction = ["Start", "End"] as const;

export const productionEventValidator = z.object({
  id: zfd.text(z.string().optional()),
  jobOperationId: z
    .string()
    .min(1, { message: "Job Operation ID is required" }),
  timezone: zfd.text(z.string()),
  action: z.enum(productionEventAction, {
    errorMap: (issue, ctx) => ({
      message: "Action is required",
    }),
  }),
  type: z.enum(productionEventType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required",
    }),
  }),
  workCenterId: zfd.text(z.string().optional()),
});

export const finishValidator = z.object({
  jobOperationId: z.string(),
  setupProductionEventId: zfd.text(z.string().optional()),
  laborProductionEventId: zfd.text(z.string().optional()),
  machineProductionEventId: zfd.text(z.string().optional()),
});

export const nonScrapQuantityValidator = finishValidator.extend({
  quantity: zfd.numeric(z.number().positive()),
});

export const scrapQuantityValidator = nonScrapQuantityValidator.extend({
  scrapReasonId: zfd.text(z.string()),
  notes: zfd.text(z.string().optional()),
});

export async function finishJobOperation(
  client: SupabaseClient<Database>,
  args: {
    jobOperationId: string;
    userId: string;
  }
) {
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

export async function getJobFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  job: Job
): Promise<StorageItem[]> {
  if (job.salesOrderLineId || job.quoteLineId) {
    const opportunityLine = job.salesOrderLineId || job.quoteLineId;

    const [opportunityLineFiles, jobFiles] = await Promise.all([
      client.storage
        .from("private")
        .list(`${companyId}/opportunity-line/${opportunityLine}`),
      client.storage.from("private").list(`${companyId}/job/${job.id}`),
    ]);

    // Combine and return both sets of files
    return [
      ...(opportunityLineFiles.data?.map((f) => ({
        ...f,
        bucket: "opportunity-line",
      })) || []),
      ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
    ];
  } else {
    const jobFiles = await client.storage
      .from("private")
      .list(`${companyId}/job/${job.id}`);
    return jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || [];
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
    .eq("jobMakeMethodId", operation.jobMakeMethodId);
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
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId);
}

export async function startProductionEvent(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof productionEventValidator>,
    "id" | "action" | "timezone"
  > & {
    startTime: string;
    employeeId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("productionEvent").insert(data).select("*");
}
