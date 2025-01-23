import type { Database, Json } from "@carbon/database";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { StorageItem } from "~/types";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type { operationToolValidator } from "../shared";
import type {
  jobMaterialValidator,
  jobOperationStatus,
  jobOperationValidator,
  jobStatus,
  jobValidator,
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

export async function deleteJobOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("jobOperationTool").delete().eq("id", id);
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

export async function getJob(client: SupabaseClient<Database>, id: string) {
  return client.from("jobs").select("*").eq("id", id).single();
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
      { column: "id", ascending: false },
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
  return client
    .from("job")
    .select("id, jobId")
    .eq("companyId", companyId)
    .order("jobId");
}

export async function getJobMaterialsWithQuantityOnHand(
  client: SupabaseClient<Database>,
  jobId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("jobMaterial")
    .select(
      "*, item(itemTrackingType,itemInventory(quantityOnHand, locationId, shelfId))",
      {
        count: "exact",
      }
    )
    .eq("jobId", jobId);

  if (args?.search) {
    query = query.or(
      `itemReadableId.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true },
    ]);
  }

  return query;
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
    .select("*, jobMakeMethod(parentMaterialId, item(readableId))", {
      count: "exact",
    })
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
      "*, jobOperationTool(id, operationId, toolId, quantity, createdBy, createdAt, updatedBy, updatedAt)"
    )
    .eq("jobMakeMethodId", jobMakeMethodId)
    .order("order", { ascending: true });
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
      "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableId)))",
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
      "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableId)))"
    )
    .in("jobOperationId", jobOperationIds)
    .order("startTime", { ascending: true });
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
      "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableId)))",
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
        "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableId)))"
      )
      .in("jobOperationId", jobOperationIds),
    client
      .from("productionEvent")
      .select(
        "*, jobOperation(description, jobMakeMethod(parentMaterialId, item(readableId)))"
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
  });
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
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof jobValidator>, "id" | "jobId"> & {
        id: string;
        jobId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in job) {
    return client
      .from("job")
      .update(sanitize(job))
      .eq("id", job.id)
      .select("id")
      .single();
  } else {
    return client.from("job").insert([job]).select("id").single();
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
    | (Omit<z.infer<typeof jobOperationValidator>, "id"> & {
        jobId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof jobOperationValidator>, "id"> & {
        id: string;
        jobId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in jobOperation) {
    return client
      .from("jobOperation")
      .update(sanitize(jobOperation))
      .eq("id", jobOperation.id)
      .select("id")
      .single();
  }
  return client
    .from("jobOperation")
    .insert([jobOperation])
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
    configuration?: any;
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type,
      ...jobMethod,
    },
  });
}

export async function upsertJobMaterialMakeMethod(
  client: SupabaseClient<Database>,
  jobMaterial: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
  }
) {
  const makeMethod = await client
    .from("jobMakeMethod")
    .select("id")
    .eq("parentMaterialId", jobMaterial.targetId)
    .single();
  if (makeMethod.error) {
    return makeMethod;
  }

  const { error } = await client.functions.invoke("get-method", {
    body: {
      type: "itemToJobMakeMethod",
      sourceId: jobMaterial.sourceId,
      targetId: makeMethod.data.id,
      companyId: jobMaterial.companyId,
      userId: jobMaterial.userId,
    },
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
  const makeMethod = await client
    .from("jobMakeMethod")
    .select("id")
    .eq("parentMaterialId", jobMethod.sourceId)
    .single();
  if (makeMethod.error) {
    return makeMethod;
  }

  const { error } = await client.functions.invoke("get-method", {
    body: {
      type: "jobMakeMethodToItem",
      sourceId: makeMethod.data.id,
      targetId: jobMethod.targetId,
      companyId: jobMethod.companyId,
      userId: jobMethod.userId,
    },
  });

  if (error) {
    return {
      data: null,
      error: { message: "Failed to save method" } as PostgrestError,
    };
  }

  return { data: null, error: null };
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
