import type { Database } from "@carbon/database";
import type { FileObject } from "@supabase/storage-js";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";

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

export function getDocumentType(
  fileName: string
): (typeof documentTypes)[number] {
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

export async function getJobDocuments(
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
    .from("workCenter")
    .select("*")
    .eq("locationId", locationId)
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

export async function endProductionEvent(
  client: SupabaseClient<Database>,
  data: {
    jobOperationId: string;
    employeeId: string;
    endTime: string;
    type: (typeof productionEventType)[number];
  }
) {
  return client
    .from("productionEvent")
    .update({ endTime: data.endTime, updatedBy: data.employeeId })
    .eq("jobOperationId", data.jobOperationId)
    .eq("employeeId", data.employeeId)
    .eq("type", data.type)
    .is("endTime", null);
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
