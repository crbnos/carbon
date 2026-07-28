import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  type FlatTree,
  flattenTree,
  generateBomIds,
  type TrackedActivityAttributes
} from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { sanitize } from "~/utils/supabase";
import { getPickedQuantitiesByJobMaterial } from "./inventory.service";
import type {
  documentTypes,
  nonScrapQuantityValidator,
  productionEventValidator,
  scrapQuantityValidator,
  stepRecordValidator
} from "./models";
import type { BaseOperationWithDetails, Job, StorageItem } from "./types";

const log = getLogger("mes", "operations");

export async function getOpenJobs(
  client: SupabaseClient<Database>,
  args: { companyId: string; locationId: string }
) {
  return client
    .from("jobs")
    .select(
      "id, jobId, status, itemReadableIdWithRevision, name, quantity, quantityComplete, dueDate, deadlineType, assignee, jobMakeMethodId"
    )
    .eq("companyId", args.companyId)
    .eq("locationId", args.locationId)
    .in("status", ["Ready", "In Progress", "Paused"])
    .order("jobId", { ascending: true });
}

export async function getTrackedEntitiesByJobMakeMethodIds(
  client: SupabaseClient<Database>,
  jobMakeMethodIds: string[],
  companyId: string
) {
  if (jobMakeMethodIds.length === 0) return {};
  const result = await client
    .from("trackedEntity")
    .select("readableId, attributes")
    .in("attributes->>Job Make Method", jobMakeMethodIds)
    .eq("companyId", companyId);

  if (!result.data) return {};

  return result.data.reduce<Record<string, string>>((acc, curr) => {
    if (
      curr.attributes !== null &&
      typeof curr.attributes === "object" &&
      "Job Make Method" in curr.attributes &&
      curr.readableId
    ) {
      acc[curr.attributes["Job Make Method"] as string] = curr.readableId;
    }
    return acc;
  }, {});
}

export async function getJobOperations(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client
    .from("jobOperation")
    .select("*, jobMakeMethod(parentMaterialId, item(readableIdWithRevision))")
    .eq("jobId", jobId);
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

export async function getUpstreamOperations(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const operation = await client
    .from("jobOperation")
    .select("jobId")
    .eq("id", operationId)
    .single();

  if (operation.error) return { data: [], error: operation.error };

  const deps = await client
    .from("jobOperationDependency")
    .select("operationId, dependsOnId")
    .eq("jobId", operation.data.jobId);

  if (deps.error) return { data: [], error: deps.error };

  // Build adjacency list: operationId → [operations it depends on]
  const dependsOn = new Map<string, string[]>();
  for (const dep of deps.data) {
    const existing = dependsOn.get(dep.operationId) ?? [];
    existing.push(dep.dependsOnId);
    dependsOn.set(dep.operationId, existing);
  }

  // BFS backwards from operationId to find all ancestors
  const ancestors = new Set<string>();
  const queue: string[] = [...(dependsOn.get(operationId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    for (const predecessor of dependsOn.get(current) ?? []) {
      queue.push(predecessor);
    }
  }

  if (ancestors.size === 0) return { data: [], error: null };

  return client
    .from("jobOperation")
    .select(
      "id, processId, description, order, status, reworkId, jobMakeMethod(item(name))"
    )
    .in("id", Array.from(ancestors))
    .order("order", { ascending: true });
}

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
    companyId: string;
  }
) {
  const result = await client
    .from("jobOperation")
    .update({
      status: "Done",
      updatedBy: args.userId
    })
    .eq("id", args.jobOperationId);

  if (!result.error) {
    client
      .from("productionEvent")
      .select("id")
      .eq("jobOperationId", args.jobOperationId)
      .not("endTime", "is", null)
      .eq("postedToGL", false)
      .then((unpostedEvents) => {
        if (unpostedEvents.data?.length) {
          Promise.all(
            unpostedEvents.data.map((event) =>
              client.functions.invoke("post-production-event", {
                body: {
                  productionEventId: event.id,
                  userId: args.userId,
                  companyId: args.companyId
                }
              })
            )
          );
        }
      });

    // The status='Done' write fires the sync_finish_job_operation trigger, which
    // completes the job to inventory (job.status → 'Completed') when this was the
    // last operation. At that point, return any picking-list-allocated batch/serial
    // stock that was staged to lineside but not consumed back to its warehouse
    // source — the SQL trigger can't call edge functions, so we orchestrate it here.
    await returnAllocatedRemaindersAtJobComplete(client, args);
  }

  return result;
}

/**
 * When a job has just completed, sweep its tracked (batch/serial) picking-list
 * allocations and return the un-consumed remainder of each from the lineside
 * shelf back to the warehouse source (so it's re-allocatable, and inventory
 * reflects only what was actually consumed). No-op unless the job is 'Completed'.
 * Idempotent: `returnPickedRemainder` returns nothing once lineside on-hand is 0.
 *
 * Uses the client `finishJobOperation` is given — every caller passes a
 * service-role client, so the picking allocations (an inventory table the
 * finishing operator may not have RLS access to) are always readable and the
 * returns aren't silently skipped for production-only roles.
 */
async function returnAllocatedRemaindersAtJobComplete(
  client: SupabaseClient<Database>,
  args: {
    jobOperationId: string;
    userId: string;
    companyId: string;
  }
) {
  const op = await client
    .from("jobOperation")
    .select("jobId")
    .eq("id", args.jobOperationId)
    .maybeSingle();
  const jobId = op.data?.jobId;
  if (!jobId) return;

  const job = await client
    .from("job")
    .select("status, locationId")
    .eq("id", jobId)
    .maybeSingle();
  const locationId = job.data?.locationId;
  if (job.data?.status !== "Completed" || !locationId) return;

  const { data: lines } = await client
    .from("pickingListLine")
    .select("id, pickingListId, pickingListLineTrackedEntity(trackedEntityId)")
    .eq("jobId", jobId)
    .neq("status", "Cancelled");
  if (!lines?.length) return;

  const returns = lines.flatMap((line) => {
    const allocations =
      (line.pickingListLineTrackedEntity as Array<{
        trackedEntityId: string;
      }> | null) ?? [];
    return allocations.map((allocation) =>
      client.functions.invoke("post-picking", {
        body: {
          type: "returnPickedRemainder",
          pickingListId: line.pickingListId,
          pickingListLineId: line.id,
          trackedEntityId: allocation.trackedEntityId,
          locationId,
          userId: args.userId,
          companyId: args.companyId
        }
      })
    );
  });

  // `functions.invoke` resolves to `{ data, error }` rather than rejecting, so a
  // failed return never surfaces through Promise.all — inspect each result and log
  // it, otherwise a stranded lineside remainder is lost silently.
  const results = await Promise.all(returns);
  for (const { error } of results) {
    if (error) {
      log.error("returnPickedRemainder failed at job complete", {
        error,
        jobId,
        companyId: args.companyId
      });
    }
  }
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
    company_id: args.companyId
  });
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

export async function getActiveJobCount(
  client: SupabaseClient<Database>,
  args: {
    employeeId: string;
    companyId: string;
  }
) {
  return client.rpc("get_active_job_count", {
    employee_id: args.employeeId,
    company_id: args.companyId
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

export async function getQualityIssueTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
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
      .select("*, jobOperationStepRecord(*), jobOperationStepSlide(*)")
      .eq("operationId", operationId),
    client
      .from("jobOperationParameter")
      .select("*")
      .eq("operationId", operationId)
  ]);

  return {
    attributes: attributes.data ?? [],
    parameters: parameters.data ?? []
  };
}

// Render/display metadata for 3D model slides: glbPath when the assembler service
// has converted a STEP source (fast to load), modelPath as the raw fallback the
// viewer parses client-side, thumbnailPath for the carousel.
export async function getModelUploadsByIds(
  client: SupabaseClient<Database>,
  ids: string[]
) {
  return client
    .from("modelUpload")
    .select("id, name, modelPath, thumbnailPath, glbPath, processingStatus")
    .in("id", ids);
}

// Step-aware 3D playback for the assembly view: when the operation is linked to a
// (synced) assembly instruction whose model has converted artifacts, return the
// GLB + graph paths and the instruction's animated steps. The view maps the
// operator's current BOP step to its instruction step via the
// assemblyInstructionStepId provenance marker and drives the AssemblyPlayer to it.
// Null when there's no link or no converted artifacts (the static slides remain).
export async function getAssemblyPlaybackByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  const operation = await client
    .from("jobOperation")
    .select("assemblyInstructionId")
    .eq("id", operationId)
    .single();
  const instructionId = operation.data?.assemblyInstructionId;
  if (!instructionId) return null;

  const instruction = await client
    .from("assemblyInstruction")
    .select("id, modelUpload(glbPath, graphPath)")
    .eq("id", instructionId)
    .single();
  const model = instruction.data?.modelUpload as {
    glbPath: string | null;
    graphPath: string | null;
  } | null;
  if (!model?.glbPath || !model?.graphPath) return null;

  const steps = await client
    .from("assemblyInstructionStep")
    .select(
      "id, title, instructionText, componentNodeIds, motion, camera, fastener, durationSeconds, warnings"
    )
    .eq("assemblyInstructionId", instructionId)
    .order("sortOrder", { ascending: true });

  if (!steps.data || steps.data.length === 0) return null;
  return {
    glbPath: model.glbPath,
    graphPath: model.graphPath,
    steps: steps.data
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

const getItemFiles = async (
  client: SupabaseClient<Database>,
  companyId: string,
  items: Array<{ itemId: string }>
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

export async function getJobFiles(
  client: SupabaseClient<Database>,
  companyId: string,
  job: Job,
  items: Array<{ itemId: string }>
): Promise<StorageItem[]> {
  if (job.salesOrderLineId || job.quoteLineId) {
    const opportunityLine = job.salesOrderLineId || job.quoteLineId;

    const [opportunityLineFiles, jobFiles, itemFiles] = await Promise.all([
      client.storage
        .from("private")
        .list(`${companyId}/opportunity-line/${opportunityLine}`),
      client.storage.from("private").list(`${companyId}/job/${job.id}`),
      getItemFiles(client, companyId, items)
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
    const [jobFiles, itemFiles] = await Promise.all([
      client.storage.from("private").list(`${companyId}/job/${job.id}`),
      getItemFiles(client, companyId, items)
    ]);

    return [
      ...(jobFiles.data?.map((f) => ({ ...f, bucket: "job" })) || []),
      ...itemFiles
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
    // Batch parents share ONE lot entity across every unit, so consumed inputs
    // can't be attributed per-unit by the parent entity alone. When the operator
    // scanned from the assembly view we stamped the 1-based unit onto the Consume
    // activity ("Unit" attribute); pass the 0-based unit being viewed so we can
    // attribute issued quantities to it. Defaults keep the operation view unchanged.
    requiresBatchTracking?: boolean;
    unitIndex?: number;
  }
) {
  const {
    operation,
    trackedEntityId,
    requiresSerialTracking,
    requiresBatchTracking = false,
    unitIndex = 0
  } = args;

  const [materials, trackedInputs] = await Promise.all([
    client
      .from("jobMaterialWithMakeMethodId")
      .select("*")
      .eq("jobMakeMethodId", operation.jobMakeMethodId)
      .order("itemReadableId", { ascending: true })
      .order("id", { ascending: true }),
    getTrackedInputs(client, trackedEntityId)
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
      .neq("methodType", "Make to Order");

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
        )?.[1]?.id
      })
    );

    materials.data = [...(materials.data ?? []), ...processedKittedMaterials];
  }

  // Step assignment (Phase 2: part ↔ step, many-to-many). The make-method view doesn't carry
  // the join rows, so look them up from jobMaterialStep and attach an array. No rows = the
  // material applies to the whole operation (shown on every step); 1+ rows scope it to those
  // steps so the MES shows only the parts involved in the current step.
  const stepLinks = await client
    .from("jobMaterialStep")
    .select("jobMaterialId, jobOperationStepId")
    .in(
      "jobMaterialId",
      (materials.data ?? []).map((m) => m.id ?? "")
    );
  const stepIdsByMaterialId = new Map<string, string[]>();
  for (const r of stepLinks.data ?? []) {
    const list = stepIdsByMaterialId.get(r.jobMaterialId) ?? [];
    list.push(r.jobOperationStepId);
    stepIdsByMaterialId.set(r.jobMaterialId, list);
  }
  if (materials.data) {
    materials.data = materials.data.map((m) => ({
      ...m,
      jobOperationStepIds: stepIdsByMaterialId.get(m.id ?? "") ?? []
    }));
  }

  // The descendant rpc doesn't return expirationDate, so look it up from
  // trackedEntity for the consumed inputs in one batched call. This lets
  // us flag materials whose CONSUMED stock is now past expiry — useful
  // when the user manually overrides a batch's expirationDate after
  // consumption (food-safety scenario: rice flour shouldn't outlive its
  // already-stale rice).
  const consumedEntityIds = Array.from(
    new Set((trackedInputs.data ?? []).map((i) => i.id).filter(Boolean))
  );
  const todayStr = today(getLocalTimeZone()).toString();
  const expiredConsumed =
    consumedEntityIds.length > 0
      ? await client
          .from("trackedEntity")
          .select("id")
          .in("id", consumedEntityIds)
          .not("expirationDate", "is", null)
          .lt("expirationDate", todayStr)
      : { data: [] as { id: string }[] };
  const expiredConsumedIds = new Set(
    (expiredConsumed.data ?? []).map((r) => r.id)
  );
  const consumedExpiredFor = (materialId: string | null) =>
    (trackedInputs.data ?? []).some(
      (input) =>
        (input.activityAttributes as TrackedActivityAttributes)?.[
          "Job Material"
        ] === materialId && expiredConsumedIds.has(input.id)
    );

  // How much of each material has already been picked (staged at lineside) across any
  // non-cancelled picking-list line. Picking is optional, so this is additive overlay
  // data — materials with no picking activity have no entry and render unchanged.
  const materialIds = Array.from(
    new Set(
      (materials.data ?? []).map((m) => m.id).filter((id): id is string => !!id)
    )
  );
  const pickedByMaterial = await getPickedQuantitiesByJobMaterial(
    client,
    materialIds
  );
  const pickedFor = (materialId: string | null) =>
    (materialId ? pickedByMaterial[materialId] : undefined) ?? {
      quantityPicked: 0,
      quantityToPick: 0
    };

  if (requiresSerialTracking) {
    return {
      materials:
        materials.data?.map((material) => {
          const hasExpiredConsumed = consumedExpiredFor(material.id);
          const picked = pickedFor(material.id);
          if (
            !material.requiresSerialTracking &&
            !material.requiresBatchTracking
          )
            return { ...material, hasExpiredConsumed, ...picked };
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
            hasExpiredConsumed,
            ...picked
          };
        }) ?? [],
      trackedInputs: trackedInputs.data ?? []
    };
  } else if (requiresBatchTracking) {
    // Batch parent: every unit shares one lot entity, so trackedInputs are ALL the
    // serials/batches consumed into that lot across every unit. Attribute the current
    // unit's issued quantity from the "Unit" attribute we stamp at issue time (1-based).
    // Consumes made before that stamp existed carry no "Unit" — fall back to the
    // job-wide-minus-earlier-units heuristic for those only. The returned quantityIssued
    // is per-unit (the component renders it directly, no clamp).
    const currentUnitNumber = unitIndex + 1;
    return {
      materials:
        materials.data?.map((material) => {
          const hasExpiredConsumed = consumedExpiredFor(material.id);
          const picked = pickedFor(material.id);
          if (
            !material.requiresSerialTracking &&
            !material.requiresBatchTracking
          )
            return { ...material, hasExpiredConsumed, ...picked };

          const forMaterial = (trackedInputs.data ?? []).filter(
            (input) =>
              (input.activityAttributes as TrackedActivityAttributes)?.[
                "Job Material"
              ] === material.id
          );
          const unitAttr = (input: (typeof forMaterial)[number]) =>
            (input.activityAttributes as TrackedActivityAttributes)?.Unit;

          const issuedThisUnit = forMaterial
            .filter((input) => Number(unitAttr(input)) === currentUnitNumber)
            .reduce((acc, input) => acc + input.quantity, 0);

          // Legacy (unstamped) consumes → distribute with the old per-unit heuristic.
          const legacyTotal = forMaterial
            .filter((input) => unitAttr(input) == null)
            .reduce((acc, input) => acc + input.quantity, 0);
          const requiredPerUnit =
            material.quantity ?? material.estimatedQuantity ?? 0;
          const legacyShare = Math.min(
            requiredPerUnit,
            Math.max(0, legacyTotal - unitIndex * requiredPerUnit)
          );

          return {
            ...material,
            quantityIssued: issuedThisUnit + legacyShare,
            hasExpiredConsumed,
            ...picked
          };
        }) ?? [],
      trackedInputs: trackedInputs.data ?? []
    };
  } else {
    return {
      materials: (materials.data ?? []).map((material) => ({
        ...material,
        hasExpiredConsumed: consumedExpiredFor(material.id),
        ...pickedFor(material.id)
      })),
      trackedInputs: trackedInputs.data ?? []
    };
  }
}

/**
 * Backflush untracked materials when a job operation STEP is recorded. Units are
 * built one at a time; an untracked (not serial/batch) part is consumed as the
 * step that "owns" it is recorded, so recording that step issues one unit's worth
 * automatically instead of making the operator issue it by hand (tracked parts
 * still require a scan). Step ownership:
 *   • A step-assigned part (jobMaterialStep) is owned by its assigned step(s) and
 *     issues when any of those steps is recorded for a unit.
 *   • A loose part (no step assignment) is owned by the operation's FIRST step —
 *     that's where the operator sees it — matching the prior behavior.
 * Idempotent by construction: per material the target is
 * (distinct units that recorded an owning step) × per-unit quantity, and only the
 * shortfall vs quantityIssued is issued — re-records, undo/redo, manual issues,
 * and the completion-time backflush (backflush_job_materials, which tops up to
 * completed × per-unit) can all overlap without double-issuing. A part assigned to
 * several steps is still counted once per unit, so its requirement never
 * multiplies. Eligibility mirrors backflush_job_materials (Material/Part/Consumable,
 * not Make to Order, untracked). Issue failures (e.g. insufficient stock) are
 * collected, not thrown — the part simply stays unissued and manually issuable.
 */
export async function backflushUntrackedMaterialsOnStepRecord(
  client: SupabaseClient<Database>,
  args: { jobOperationStepId: string; companyId: string; userId: string }
) {
  const step = await client
    .from("jobOperationStep")
    .select("id, operationId")
    .eq("id", args.jobOperationStepId)
    .single();
  if (step.error || !step.data.operationId) return { error: step.error };
  const operationId = step.data.operationId;

  const [steps, operation] = await Promise.all([
    client
      .from("jobOperationStep")
      .select("id")
      .eq("operationId", operationId)
      .order("sortOrder", { ascending: true })
      .order("id", { ascending: true }),
    client
      .from("jobOperation")
      .select("id, jobMakeMethodId")
      .eq("id", operationId)
      .single()
  ]);
  const firstStepId = steps.data?.[0]?.id;
  if (steps.error || !firstStepId) return { error: steps.error };
  if (operation.error || !operation.data?.jobMakeMethodId) {
    return { error: operation.error };
  }
  const stepIds = steps.data.map((s) => s.id);

  const materials = await client
    .from("jobMaterial")
    .select("id, itemId, quantity, quantityIssued, methodType")
    .eq("jobMakeMethodId", operation.data.jobMakeMethodId)
    .eq("companyId", args.companyId)
    .in("itemType", ["Material", "Part", "Consumable"])
    .neq("methodType", "Make to Order")
    .eq("requiresSerialTracking", false)
    .eq("requiresBatchTracking", false);
  if (materials.error || !materials.data?.length) {
    return { error: materials.error };
  }

  // Step ownership: materialId → the step ids it's assigned to (empty = loose).
  const stepLinks = await client
    .from("jobMaterialStep")
    .select("jobMaterialId, jobOperationStepId")
    .in(
      "jobMaterialId",
      materials.data.map((m) => m.id)
    );
  if (stepLinks.error) return { error: stepLinks.error };
  const ownedSteps = new Map<string, Set<string>>();
  for (const link of stepLinks.data ?? []) {
    const set = ownedSteps.get(link.jobMaterialId) ?? new Set<string>();
    set.add(link.jobOperationStepId);
    ownedSteps.set(link.jobMaterialId, set);
  }

  // Units (index) that have recorded each of the operation's steps, so we can
  // count distinct started units per material from its owning step(s).
  const records = await client
    .from("jobOperationStepRecord")
    .select("jobOperationStepId, index")
    .in("jobOperationStepId", stepIds);
  if (records.error) return { error: records.error };
  const unitsByStep = new Map<string, Set<number>>();
  for (const r of records.data ?? []) {
    const set = unitsByStep.get(r.jobOperationStepId) ?? new Set<number>();
    set.add(r.index);
    unitsByStep.set(r.jobOperationStepId, set);
  }

  const failures: string[] = [];
  for (const material of materials.data) {
    const perUnit = material.quantity ?? 0;
    if (perUnit <= 0) continue;
    // Owning steps: the material's assigned steps (scoped to this operation), or
    // the first step when it's loose (unassigned).
    const owning = ownedSteps.get(material.id);
    const triggerStepIds =
      owning && owning.size > 0
        ? stepIds.filter((id) => owning.has(id))
        : [firstStepId];
    // Distinct units that recorded at least one owning step — a unit that
    // recorded several owning steps of the same material still counts once.
    const units = new Set<number>();
    for (const id of triggerStepIds) {
      for (const idx of unitsByStep.get(id) ?? []) units.add(idx);
    }
    const delta = units.size * perUnit - (material.quantityIssued ?? 0);
    if (delta <= 0) continue;
    const issue = await client.functions.invoke("issue", {
      body: {
        id: operationId,
        type: "partToOperation",
        itemId: material.itemId,
        materialId: material.id,
        quantity: delta,
        adjustmentType: "Negative Adjmt.",
        companyId: args.companyId,
        userId: args.userId
      }
    });
    if (issue.error) failures.push(material.itemId);
  }

  return {
    error: failures.length
      ? new Error(
          `Backflush failed for ${failures.length} material(s): ${failures.join(", ")}`
        )
      : null
  };
}

export async function getJobOperationsAssignedToEmployee(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client.rpc("get_assigned_job_operations", {
    user_id: employeeId,
    company_id: companyId
  });
}

export async function getJobOperationById(
  client: SupabaseClient<Database>,
  operationId: string
) {
  return client.rpc("get_job_operation_by_id", {
    operation_id: operationId
  });
}

export async function getJobOperationsByWorkCenter(
  client: SupabaseClient<Database>,
  { locationId, workCenterId }: { locationId: string; workCenterId: string }
) {
  return client.rpc("get_job_operations_by_work_center", {
    location_id: locationId,
    work_center_id: workCenterId
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

export async function getKanbanByJobId(
  client: SupabaseClient<Database>,
  jobId: string | null
) {
  if (!jobId) return { data: null, error: null };
  return client.from("kanban").select("*").eq("jobId", jobId).maybeSingle();
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

export async function getNonConformanceActions(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    processId: string;
    companyId: string;
  }
) {
  const result = await client.rpc("get_action_tasks_by_item_and_process", {
    p_item_id: args.itemId,
    p_process_id: args.processId,
    p_company_id: args.companyId
  });

  return (result.data ?? []) as {
    id: string;
    actionTypeName: string;
    assignee: string;
    nonConformanceId: string;
    notes: JSONContent;
  }[];
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

export async function getToolsByOperationId(
  client: SupabaseClient<Database>,
  operationId: string
) {
  type Tool = {
    quantity: number;
    jobOperationStepIds: string[];
    item: {
      id: string;
      name: string;
      type: string;
      readableId: string | null;
    } | null;
  };

  // Read the job's OWN tools (jobOperationTool), not the method template. This carries the
  // tool ↔ step links (Phase 2, many-to-many) via jobOperationToolStep, copied from the
  // method by get-method, so the assembly view can show only the tools relevant to the
  // current step. No links = the tool applies to the whole operation (shown on every step).
  // Mirrors the per-step material filter.
  const result = await client
    .from("jobOperationTool")
    .select(
      "quantity, item:toolId(id, name, type, readableId), jobOperationToolStep(jobOperationStepId)"
    )
    .eq("operationId", operationId);

  const tools = (result.data ?? []).map((t) => ({
    quantity: (t as { quantity: number }).quantity,
    item: (t as { item: Tool["item"] }).item,
    jobOperationStepIds: (
      (t as { jobOperationToolStep?: { jobOperationStepId: string }[] })
        .jobOperationToolStep ?? []
    ).map((s) => s.jobOperationStepId)
  })) as Tool[];

  // Merge duplicate rows for the same tool (union step links, max quantity).
  // Older get-method copies inserted assembly-instruction tools AND method
  // tools separately, leaving e.g. one step-linked row plus one unlinked row —
  // which the MES would show on every step AND twice on the linked step.
  const merged = new Map<string, Tool>();
  for (const tool of tools) {
    const key = tool.item?.id;
    if (!key) {
      merged.set(`__no_item_${merged.size}`, tool);
      continue;
    }
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, tool);
    } else {
      existing.quantity = Math.max(existing.quantity, tool.quantity);
      existing.jobOperationStepIds = [
        ...new Set([
          ...existing.jobOperationStepIds,
          ...tool.jobOperationStepIds
        ])
      ];
    }
  }

  return {
    data: [...merged.values()],
    error: result.error
  };
}

export async function getNcrsByJobOperationId(
  client: SupabaseClient<Database>,
  jobOperationId: string
) {
  return client
    .from("nonConformanceJobOperation")
    .select(
      "nonConformanceId, nonConformance(id, nonConformanceId, status, priority)"
    )
    .eq("jobOperationId", jobOperationId);
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
    company_id: args.companyId
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

export async function getTrackedEntity(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("trackedEntity").select("*").eq("id", id).single();
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
      error: jobOperation.error
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
      p_tracked_entity_id: trackedEntityId
    }),
    client.rpc("get_direct_ancestors_of_tracked_entity_strict", {
      p_tracked_entity_id: trackedEntityId
    })
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
    error: inputs.error
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
  return client
    .from("workCentersWithBlockingStatus")
    .select(
      "id, name, isBlocked, blockingDispatchId, blockingDispatchReadableId"
    )
    .eq("id", workCenterId)
    .single();
}

export async function getWorkCentersByLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  // Query both views and merge - workCenters has processes, workCentersWithBlockingStatus has blocking info
  const [workCentersResult, blockingStatusResult] = await Promise.all([
    client
      .from("workCenters")
      .select("*")
      .eq("locationId", locationId)
      .eq("active", true)
      .order("name", { ascending: true }),
    client
      .from("workCentersWithBlockingStatus")
      .select("id, isBlocked, blockingDispatchId, blockingDispatchReadableId")
      .eq("locationId", locationId)
      .eq("active", true)
  ]);

  if (workCentersResult.error) {
    return workCentersResult;
  }

  // Create a map of blocking status by work center id
  const blockingStatusMap = new Map(
    blockingStatusResult.data?.map((wc) => [wc.id, wc]) ?? []
  );

  // Merge the data
  const mergedData = workCentersResult.data?.map((wc) => {
    const blockingStatus = blockingStatusMap.get(wc.id);
    return {
      ...wc,
      isBlocked: blockingStatus?.isBlocked ?? false,
      blockingDispatchId: blockingStatus?.blockingDispatchId ?? null,
      blockingDispatchReadableId:
        blockingStatus?.blockingDispatchReadableId ?? null
    };
  });

  return { data: mergedData, error: null };
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
    ignoreDuplicates: false
  });
}

// Manager override: record every step of an operation that has no record yet for this unit
// index, in one write. Records carry no captured value (booleanValue/numericValue/etc. left
// null) — the override marks steps done without their data capture, which is the point of an
// override. Already-recorded steps are skipped (ignoreDuplicates) so it never overwrites real
// operator data. Gated at the route on the Production DELETE permission.
export async function completeAllStepsForUnit(
  client: SupabaseClient<Database>,
  args: {
    operationId: string;
    index: number;
    companyId: string;
    createdBy: string;
  }
): Promise<{
  data: { count: number; backflushError: Error | null } | null;
  error: PostgrestError | null;
}> {
  // Scope by companyId: this runs with the service-role client (RLS bypassed) and
  // operationId comes from the request, so the tenant filter is the only guard against
  // reading or stamping another company's steps.
  const steps = await client
    .from("jobOperationStep")
    .select("id, jobOperationStepRecord(index)")
    .eq("operationId", args.operationId)
    .eq("companyId", args.companyId);
  if (steps.error) return { data: null, error: steps.error };

  const missing = (steps.data ?? []).filter(
    (s) => !(s.jobOperationStepRecord ?? []).some((r) => r.index === args.index)
  );
  if (missing.length === 0) {
    return { data: { count: 0, backflushError: null }, error: null };
  }

  const insert = await client.from("jobOperationStepRecord").upsert(
    missing.map((s) => ({
      jobOperationStepId: s.id,
      index: args.index,
      companyId: args.companyId,
      createdBy: args.createdBy
    })),
    { onConflict: "jobOperationStepId, index", ignoreDuplicates: true }
  );
  if (insert.error) return { data: null, error: insert.error };

  // The override marks steps done without their per-step data capture, so it
  // must still consume the untracked materials those steps own for this unit —
  // otherwise recording via the override under-issues vs. recording step by step
  // (which backflushes on every record). The backflush is idempotent and
  // operation-wide, so one call after the inserts tops up this unit's shortfall.
  // Non-blocking: a failure (e.g. insufficient stock) leaves parts manually
  // issuable, matching the per-step record path.
  const backflush = await backflushUntrackedMaterialsOnStepRecord(client, {
    jobOperationStepId: missing[0].id,
    companyId: args.companyId,
    userId: args.createdBy
  });

  return {
    data: { count: missing.length, backflushError: backflush.error ?? null },
    error: null
  };
}

export async function insertReworkQuantity(
  client: SupabaseClient<Database>,
  data: z.infer<typeof nonScrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
  }
) {
  const {
    trackedEntityId: _trackedEntityId,
    trackingType: _trackingType,
    ...insert
  } = data;

  return client
    .from("productionQuantity")
    .insert(
      sanitize({
        ...insert,
        type: "Rework"
      })
    )
    .select("*");
}

export async function insertProductionQuantity(
  client: SupabaseClient<Database>,
  data: z.infer<typeof nonScrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
    // Provenance links for inspection-driven completions (the partial UNIQUE
    // index on inspectionSampleId is the double-count guard).
    inspectionId?: string;
    inspectionSampleId?: string;
  }
) {
  return client
    .from("productionQuantity")
    .insert(
      sanitize({
        ...data,
        type: "Production"
      })
    )
    .select("*");
}

export async function insertScrapQuantity(
  client: SupabaseClient<Database>,
  data: z.infer<typeof scrapQuantityValidator> & {
    companyId: string;
    createdBy: string;
    inspectionId?: string;
    inspectionSampleId?: string;
  }
) {
  return client
    .from("productionQuantity")
    .insert(
      sanitize({
        ...data,
        type: "Scrap"
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
      endTime: args.endTime
    })
    .is("endTime", null)
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId);
}

export async function endProductionEventsByWorkCenter(
  client: SupabaseClient<Database>,
  args: { workCenterId: string; companyId: string; endTime: string }
) {
  return client
    .from("productionEvent")
    .update({
      endTime: args.endTime
    })
    .is("endTime", null)
    .eq("workCenterId", args.workCenterId)
    .eq("companyId", args.companyId);
}

// Phase 3 (auto-start): when an operator starts a production event, flip a not-yet-started
// job + operation to "In Progress" so the shop floor doesn't have to mark it manually. Status
// guards make re-starts and already-running jobs no-ops. Best-effort — a failure here must not
// block the production event that already succeeded.
async function autoStartJobAndOperation(
  client: SupabaseClient<Database>,
  args: { jobOperationId: string; userId: string }
) {
  const op = await client
    .from("jobOperation")
    .select("jobId, status")
    .eq("id", args.jobOperationId)
    .maybeSingle();
  if (op.error || !op.data) return;

  const updates: PromiseLike<unknown>[] = [];
  if (["Todo", "Ready", "Waiting"].includes(op.data.status ?? "")) {
    updates.push(
      client
        .from("jobOperation")
        .update({ status: "In Progress", updatedBy: args.userId })
        .eq("id", args.jobOperationId)
        .in("status", ["Todo", "Ready", "Waiting"])
    );
  }
  if (op.data.jobId) {
    updates.push(
      client
        .from("job")
        .update({ status: "In Progress", updatedBy: args.userId })
        .eq("id", op.data.jobId)
        .in("status", ["Draft", "Planned", "Ready"])
    );
  }
  await Promise.all(updates);
}

export async function startProductionEvent(
  client: SupabaseClient<Database>,
  data: Omit<
    z.infer<typeof productionEventValidator>,
    "id" | "action" | "timezone" | "hasActiveEvents" | "unitIndex"
  > & {
    startTime: string;
    employeeId: string;
    companyId: string;
    createdBy: string;
  },
  trackedEntityId: string | undefined,
  unitIndex?: number
) {
  if (trackedEntityId) {
    const activityId = nanoid();

    const [eventInsert, operation] = await Promise.all([
      client.from("productionEvent").insert(data).select("id").single(),
      client
        .from("jobOperation")
        .select("*")
        .eq("id", data.jobOperationId)
        .single()
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
          // The unit this event built, so traceability can scope this activity's
          // step records to just this unit (see get_job_operation_step_records).
          ...(typeof unitIndex === "number" ? { Unit: unitIndex } : {})
        },
        companyId: data.companyId,
        createdBy: data.createdBy
      })
      .select("id")
      .single();

    if (trackedActivityInsert.error) {
      log.error("Failed to insert tracked activity", {
        error: trackedActivityInsert.error
      });
      return trackedActivityInsert;
    }

    const trackedActivityOutputInsert = await client
      .from("trackedActivityOutput")
      .insert({
        trackedActivityId: activityId,
        trackedEntityId,
        quantity: 1,
        companyId: data.companyId,
        createdBy: data.createdBy
      });

    if (trackedActivityOutputInsert.error) {
      log.error("Failed to insert tracked activity output", {
        error: trackedActivityOutputInsert.error
      });
      return trackedActivityOutputInsert;
    }

    await autoStartJobAndOperation(client, {
      jobOperationId: data.jobOperationId,
      userId: data.createdBy
    });

    return eventInsert;
  }

  const eventInsert = await client
    .from("productionEvent")
    .insert(data)
    .select("*");

  if (!eventInsert.error) {
    await autoStartJobAndOperation(client, {
      jobOperationId: data.jobOperationId,
      userId: data.createdBy
    });
  }

  return eventInsert;
}

type JobMethod = {
  id: string;
  methodMaterialId: string;
  parentMaterialId: string | null;
  [key: string]: unknown;
};

type JobMethodTreeItem = {
  id: string;
  data: JobMethod;
  children: JobMethodTreeItem[];
};

function arrayToTree(items: JobMethod[]): JobMethodTreeItem[] {
  const rootItems: JobMethodTreeItem[] = [];
  const lookup: { [id: string]: JobMethodTreeItem } = {};

  for (const item of items) {
    const itemId = item.methodMaterialId;
    const parentId = item.parentMaterialId;

    if (!Object.prototype.hasOwnProperty.call(lookup, itemId)) {
      // @ts-expect-error - building tree incrementally
      lookup[itemId] = { id: itemId, children: [] };
    }

    lookup[itemId].data = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-expect-error - building tree incrementally
        lookup[parentId] = { id: parentId, children: [] };
      }
      lookup[parentId].children.push(treeItem);
    }
  }
  return rootItems;
}

/**
 * Fetches the job method tree and generates BOM IDs.
 * Returns a map of methodMaterialId to hierarchical BOM ID (e.g., "1.2.3").
 */
export async function getJobMethodBomIdMap(
  client: SupabaseClient<Database>,
  jobId: string
): Promise<Map<string, string>> {
  const result = await client.rpc("get_job_method", { jid: jobId });

  if (result.error || !result.data?.length) {
    return new Map();
  }

  const tree = arrayToTree(result.data as unknown as JobMethod[]);
  if (tree.length === 0) {
    return new Map();
  }

  // Flatten tree and generate BOM IDs
  const flatMethods: FlatTree<JobMethod> = flattenTree(tree[0]);
  const bomIds = generateBomIds(flatMethods);

  // Create map of methodMaterialId to BOM ID
  const bomIdMap = new Map<string, string>();
  flatMethods.forEach((node, index) => {
    bomIdMap.set(node.data.methodMaterialId, bomIds[index]);
  });

  return bomIdMap;
}
