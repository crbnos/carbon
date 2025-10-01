import type { Database } from "@carbon/database";
import type { TrackedActivityAttributes } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { sanitize } from "~/utils/supabase";
import type {
  documentTypes,
  nonScrapQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
  stepRecordValidator,
} from "./models";
import type { BaseOperationWithDetails, Job, StorageItem } from "./types";

export async function deleteAttributeRecord(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string }
) {
  return client
    .from("jobOperationStepRecord")
    .delete()
    .eq("id", args.id)
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
      .from("jobOperationStep")
      .select("*, jobOperationStepRecord(*)")
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
    .from("jobOperationStep")
    .select("*, jobOperationStepRecord(*)")
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
    .select("*, customer(name)")
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

export async function getJobMakeMethod(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobMakeMethod").select("*").eq("id", id).single();
}

export async function getJobMaterialsByOperationId(
  client: SupabaseClient<Database>,
  args: {
    operation: BaseOperationWithDetails;
    trackedEntityId: string | undefined;
    requiresSerialTracking: boolean;
  }
) {
  const { operation, trackedEntityId, requiresSerialTracking } = args;

  const [materials, trackedInputs] = await Promise.all([
    client
      .from("jobMaterialWithMakeMethodId")
      .select("*")
      .eq("jobMakeMethodId", operation.jobMakeMethodId)
      .order("itemReadableId", { ascending: true })
      .order("id", { ascending: true }),
    getTrackedInputs(client, trackedEntityId),
  ]);

  const kittedMakeMethodIds = new Set(
    materials.data
      ?.filter((m) => m.kit)
      .map((m) => m.jobMaterialMakeMethodId) ?? []
  );
  if (kittedMakeMethodIds.size) {
    const kittedMaterials = await client
      .from("jobMaterialWithMakeMethodId")
      .select("*")
      .in("jobMakeMethodId", Array.from(kittedMakeMethodIds))
      .neq("methodType", "Make");

    // Create a map of parent kit materials by their make method ID
    const kitParentMap = new Map();
    materials.data?.forEach((material) => {
      if (material.kit && material.jobMaterialMakeMethodId) {
        kitParentMap.set(material.jobMaterialMakeMethodId, material);
      }
    });

    // Add parent reference to each kitted material
    const processedKittedMaterials = (kittedMaterials.data ?? []).map(
      (material) => ({
        ...material,
        isKitComponent: true,
        kitParentId: Array.from(kitParentMap.entries()).find(
          ([makeMethodId]) => makeMethodId === material.jobMakeMethodId
        )?.[1]?.id,
      })
    );

    materials.data = [...(materials.data ?? []), ...processedKittedMaterials];
  }

  if (requiresSerialTracking) {
    return {
      materials:
        materials.data?.map((material) => {
          if (
            !material.requiresSerialTracking &&
            !material.requiresBatchTracking
          )
            return material;
          const issuedForTrackedParent =
            trackedInputs.data
              ?.filter(
                (input) =>
                  (input.activityAttributes as TrackedActivityAttributes)?.[
                    "Job Material"
                  ] === material.id
              )
              .reduce((acc, input) => {
                return acc + input.quantity;
              }, 0) ?? 0;

          return {
            ...material,
            quantityIssued: issuedForTrackedParent,
          };
        }) ?? [],
      trackedInputs: trackedInputs.data ?? [],
    };
  } else {
    return {
      materials: materials.data ?? [],
      trackedInputs: trackedInputs.data ?? [],
    };
  }
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

export async function getTrackedEntitiesByMakeMethodId(
  client: SupabaseClient<Database>,
  jobMakeMethodId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .order("createdAt", { ascending: true });
}

export async function getTrackedEntitiesByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const jobOperation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", operationId)
    .single();

  if (jobOperation.error || !jobOperation.data.jobMakeMethodId)
    return {
      data: null,
      error: jobOperation.error,
    };

  return getTrackedEntitiesByMakeMethodId(
    client,
    jobOperation.data.jobMakeMethodId
  );
}

export async function getTrackedInputs(
  client: SupabaseClient<Database>,
  trackedEntityId?: string
) {
  if (!trackedEntityId) return { data: [] };
  const [inputs, outputs] = await Promise.all([
    client.rpc("get_direct_descendants_of_tracked_entity_strict", {
      p_tracked_entity_id: trackedEntityId,
    }),
    client.rpc("get_direct_ancestors_of_tracked_entity_strict", {
      p_tracked_entity_id: trackedEntityId,
    }),
  ]);

  if (outputs.error || outputs.data.length === 0) return inputs;

  // Handle circular references while keeping only unique entities that appear more times in inputs than outputs
  const inputCounts = new Map<string, number>();
  const outputCounts = new Map<string, number>();

  // Count occurrences in inputs
  inputs.data?.forEach((input) => {
    inputCounts.set(input.id, (inputCounts.get(input.id) || 0) + 1);
  });

  // Count occurrences in outputs
  outputs.data?.forEach((output) => {
    outputCounts.set(output.id, (outputCounts.get(output.id) || 0) + 1);
  });

  // Track which IDs we've already included to avoid duplicates
  const includedIds = new Set<string>();

  const inputsWithoutCircularReferences = inputs.data?.filter((input) => {
    const inputCount = inputCounts.get(input.id) || 0;
    const outputCount = outputCounts.get(input.id) || 0;

    // Only include if input count > output count and we haven't included this ID yet
    if (inputCount > outputCount && !includedIds.has(input.id)) {
      includedIds.add(input.id);
      return true;
    }
    return false;
  });

  return {
    data: inputsWithoutCircularReferences,
    error: inputs.error,
  };
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
  data: z.infer<typeof stepRecordValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("jobOperationStepRecord").upsert(data, {
    onConflict: "jobOperationStepId, index",
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

export async function endProductionEventsForJobOperation(
  client: SupabaseClient<Database>,
  args: {
    jobOperationId: string;
    employeeId: string;
    companyId: string;
  }
) {
  return client
    .from("productionEvent")
    .update({ endTime: new Date().toISOString(), updatedBy: args.employeeId })
    .eq("jobOperationId", args.jobOperationId)
    .is("endTime", null)
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId);
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
  },
  trackedEntityId: string | undefined
) {
  if (trackedEntityId) {
    const activityId = nanoid();

    const [eventInsert, operation] = await Promise.all([
      client.from("productionEvent").insert(data).select("id").single(),
      client
        .from("jobOperation")
        .select("*")
        .eq("id", data.jobOperationId)
        .single(),
    ]);

    if (eventInsert.error) return eventInsert;
    if (operation.error) return operation;

    const trackedActivityInsert = await client
      .from("trackedActivity")
      .insert({
        id: activityId,
        type: `${operation.data?.description} (${data.type})`,
        sourceDocument: "Production Event",
        sourceDocumentId: eventInsert.data?.id,
        attributes: {
          Job: operation.data?.jobId,
          "Job Operation": data.jobOperationId,
          "Production Event": eventInsert.data?.id,
          "Work Center": data.workCenterId,
          Employee: data.employeeId,
        },
        companyId: data.companyId,
        createdBy: data.createdBy,
      })
      .select("id")
      .single();

    if (trackedActivityInsert.error) {
      console.error(trackedActivityInsert.error);
      return trackedActivityInsert;
    }

    const trackedActivityOutputInsert = await client
      .from("trackedActivityOutput")
      .insert({
        trackedActivityId: activityId,
        trackedEntityId,
        quantity: 1,
        companyId: data.companyId,
        createdBy: data.createdBy,
      });

    if (trackedActivityOutputInsert.error) {
      console.error(trackedActivityOutputInsert.error);
      return trackedActivityOutputInsert;
    }

    return eventInsert;
  }

  return client.from("productionEvent").insert(data).select("*");
}
