import { fetchAllFromTable, type Database, type Json } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { FileObject, StorageError } from "@supabase/storage-js";
import {
  FunctionRegion,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
} from "../shared";
import type {
  jobMaterialValidator,
  jobOperationStatus,
  jobOperationValidator,
  jobStatus,
  jobValidator,
  procedureParameterValidator,
  procedureStepValidator,
  procedureValidator,
  productionEventValidator,
  productionQuantityValidator,
  scrapReasonValidator,
} from "./production.models";
import type { Job } from "./types";

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
      bucket: "opportunity-line",
    })) || []),
    ...(partsFiles?.data?.map((f) => ({ ...f, bucket: "parts" })) || []),
  ];
}

export async function getJobDocumentsWithItemId(
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("jobId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "jobId", ascending: false },
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
  jobMakeMethodId: string
) {
  return client
    .from("jobMakeMethod")
    .select("*, ...item(itemType:type)")
    .eq("id", jobMakeMethodId)
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
      location_id: locationId,
    },
    {
      count: "exact",
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
    error: null,
  };
}

export async function getJobMethodTreeArray(
  client: SupabaseClient<Database>,
  jobId: string
) {
  return client.rpc("get_job_method", {
    jid: jobId,
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

    lookup[itemId]["data"] = item;

    const treeItem = lookup[itemId];

    if (parentId === null || parentId === undefined) {
      rootItems.push(treeItem);
    } else {
      if (!Object.prototype.hasOwnProperty.call(lookup, parentId)) {
        // @ts-ignore
        lookup[parentId] = { id: parentId, children: [] };
      }

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
        count: "exact",
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
      { column: "createdAt", ascending: false },
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
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
        count: "exact",
      }
    )
    .in("jobOperationId", jobOperationIds)
    .order("startTime", { ascending: true });

  if (args?.search) {
    query = query.or(`jobOperation.description.ilike.%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false },
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
    hasMore: count !== null && offset + pageSize < count,
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
      periods,
    },
    {
      count: "exact",
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true },
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
      periods,
    },
    {
      count: "exact",
    }
  );

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,readableIdWithRevision.ilike.%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "readableIdWithRevision", ascending: true },
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
        count: "exact",
      }
    )
    .in("jobOperationId", jobOperationIds);

  if (args?.search) {
    query = query.or(`jobOperation.description.ilike.%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false },
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
      .in("jobOperationId", jobOperationIds),
  ]);

  return {
    quantities: quantities.data ?? [],
    events: events.data ?? [],
    notes: notes.data ?? [],
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
      { column: "name", ascending: true },
    ]);
  }

  return query;
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
      error: jobMakeMethod.error,
    };
  }

  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Job Make Method", jobMakeMethod.data.id)
    .eq("companyId", jobMakeMethod.data.companyId)
    .single();
}

export async function recalculateJobOperationDependencies(
  client: SupabaseClient<Database>,
  params: {
    jobId: string; // job operation id
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("scheduler", {
    body: {
      type: "dependencies",
      ...params,
    },
    region: FunctionRegion.UsEast1,
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
      ...params,
    },
    region: FunctionRegion.UsEast1,
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
      ...params,
    },
    region: FunctionRegion.UsEast1,
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
      ...params,
    },
    region: FunctionRegion.UsEast1,
  });
}

export async function updateJobBatchNumber(
  client: SupabaseClient<Database>,
  trackedEntityId: string,
  value: string
) {
  const currentAttributes = await client
    .from("trackedEntity")
    .select("id, attributes")
    .eq("id", trackedEntityId)
    .single();
  if (currentAttributes.error) {
    return currentAttributes;
  }

  if (typeof currentAttributes.data?.attributes !== "object") {
    return { error: new Error("Attributes is not an object") };
  }

  return client
    .from("trackedEntity")
    .update({
      attributes: {
        ...currentAttributes.data?.attributes,
        "Batch Number": value,
      },
    })
    .eq("id", currentAttributes.data.id)
    .select("id, attributes");
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
      updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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
        updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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
        ...(status && { status }),
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
          ...(status && { status }),
        },
      ])
      .select("id")
      .single();
  }
}

export async function upsertJobMaterial(
  client: SupabaseClient<Database>,
  jobMaterial:
    | (Omit<z.infer<typeof jobMaterialValidator>, "id"> & {
        jobId: string;
        jobOperationId?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof jobMaterialValidator>, "id"> & {
        id: string;
        jobId: string;
        jobOperationId?: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in jobMaterial) {
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
        userId: jobOperation.createdBy,
      },
      region: FunctionRegion.UsEast1,
    });
    if (error) {
      return {
        data: null,
        error: { message: "Failed to get procedure" } as PostgrestError,
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
    userId: jobMethod.userId,
  };

  // Only add configuration if it exists
  if (jobMethod.configuration !== undefined) {
    body.configuration = jobMethod.configuration;
  }

  const getMethodResult = await client.functions.invoke("get-method", {
    body,
    region: FunctionRegion.UsEast1,
  });
  if (getMethodResult.error) {
    return getMethodResult;
  }
  return recalculateJobRequirements(client, {
    id: jobMethod.targetId,
    companyId: jobMethod.companyId,
    userId: jobMethod.userId,
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
    userId: jobMaterial.userId,
  };

  // Only add configuration if it exists
  if (jobMaterial.configuration !== undefined) {
    body.configuration = jobMaterial.configuration;
  }

  const { error } = await client.functions.invoke("get-method", {
    body,
    region: FunctionRegion.UsEast1,
  });

  if (error) {
    return {
      data: null,
      error: { message: "Failed to pull method" } as PostgrestError,
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
      userId: jobMethod.userId,
    },
    region: FunctionRegion.UsEast1,
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
      userId: jobMethod.userId,
    },
    region: FunctionRegion.UsEast1,
  });

  if (error) {
    return {
      data: null,
      error: { message: "Failed to save method" } as PostgrestError,
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
            content: workInstruction,
          })
          .eq("id", insert.data.id),
        attributes.length > 0
          ? client.from("procedureStep").insert(
              attributes.map((attribute) => {
                const { id, procedureId, ...rest } = attribute;
                return {
                  ...rest,
                  procedureId: insert.data.id,
                  companyId: procedure.data.companyId!,
                };
              })
            )
          : Promise.resolve({ data: null, error: null }),
        parameters.length > 0
          ? client.from("procedureParameter").insert(
              parameters.map((parameter) => {
                const { id, procedureId, ...rest } = parameter;
                return {
                  ...rest,
                  procedureId: insert.data.id,
                  companyId: procedure.data.companyId!,
                };
              })
            )
          : Promise.resolve({ data: null, error: null }),
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
          updatedAt: new Date().toISOString(),
        })),
        {
          onConflict: "itemId,locationId,periodId,companyId",
        }
      )
    );
  }

  const results = await Promise.all(promises);
  const hasError = results.some((r) => r.error);

  return {
    data: hasError ? null : toUpsert,
    error: hasError ? results.find((r) => r.error)?.error : null,
  };
}

export async function deleteFutureDemandForecasts(
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
    error: result.error,
  };
}
