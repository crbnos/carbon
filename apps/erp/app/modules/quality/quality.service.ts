import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  gaugeTypeValidator,
  gaugeValidator,
  nonConformanceReviewerValidator,
  nonConformanceStatus,
  nonConformanceTypeValidator,
  nonConformanceValidator,
  nonConformanceWorkflowValidator,
} from "./quality.models";

export async function deleteGauge(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client.from("gauges").delete().eq("id", gaugeId);
}

export async function deleteGaugeType(
  client: SupabaseClient<Database>,
  gaugeTypeId: string
) {
  return client.from("gaugeType").delete().eq("id", gaugeTypeId);
}

export async function deleteNonConformance(
  client: SupabaseClient<Database>,
  nonConformanceId: string
) {
  return client.from("nonConformance").delete().eq("id", nonConformanceId);
}

export async function deleteNonConformanceAssociation(
  client: SupabaseClient<Database>,
  type: string,
  associationId: string
) {
  switch (type) {
    case "customers":
      return await client
        .from("nonConformanceCustomer")
        .delete()
        .eq("id", associationId);
    case "suppliers":
      return await client
        .from("nonConformanceSupplier")
        .delete()
        .eq("id", associationId);
    case "jobOperations":
      return await client
        .from("nonConformanceJobOperation")
        .delete()
        .eq("id", associationId);
    case "purchaseOrderLines":
      return await client
        .from("nonConformancePurchaseOrderLine")
        .delete()
        .eq("id", associationId);
    case "salesOrderLines":
      return await client
        .from("nonConformanceSalesOrderLine")
        .delete()
        .eq("id", associationId);
    case "shipmentLines":
      return await client
        .from("nonConformanceShipmentLine")
        .delete()
        .eq("id", associationId);
    case "receiptLines":
      return await client
        .from("nonConformanceReceiptLine")
        .delete()
        .eq("id", associationId);
    case "trackedEntities":
      return await client
        .from("nonConformanceTrackedEntity")
        .delete()
        .eq("id", associationId);
    default:
      throw new Error(`Invalid type: ${type}`);
  }
}

export async function deleteNonConformanceType(
  client: SupabaseClient<Database>,
  nonConformanceTypeId: string
) {
  return client
    .from("nonConformanceType")
    .delete()
    .eq("id", nonConformanceTypeId);
}

export async function deleteNonConformanceWorkflow(
  client: SupabaseClient<Database>,
  nonConformanceWorkflowId: string
) {
  return client
    .from("nonConformanceWorkflow")
    .update({ active: false })
    .eq("id", nonConformanceWorkflowId);
}

export async function getGauge(
  client: SupabaseClient<Database>,
  gaugeId: string
) {
  return client.from("gauges").select("*").eq("id", gaugeId).single();
}

export async function getGauges(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("gauges")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `gaugeId.ilike.%${args.search}%,description.ilike.%${args.search}%,modelNumber.ilike.%${args.search}%,serialNumber.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "gaugeId", ascending: false },
    ]);
  }

  return query;
}

export async function getGaugeTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("gaugeType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getGaugeType(
  client: SupabaseClient<Database>,
  gaugeTypeId: string
) {
  return client.from("gaugeType").select("*").eq("id", gaugeTypeId).single();
}

export async function getGaugeTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("gaugeType")
    .select("*", { count: "exact" })
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

export async function getNonConformance(
  client: SupabaseClient<Database>,
  nonConformanceId: string
) {
  return client
    .from("nonConformance")
    .select("*")
    .eq("id", nonConformanceId)
    .single();
}

export async function getNonConformances(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformance")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.or(
      `nonConformanceId.ilike.%${args.search}%,name.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: false },
    ]);
  }

  return query;
}

export async function getNonConformanceWorkflow(
  client: SupabaseClient<Database>,
  nonConformanceWorkflowId: string
) {
  return client
    .from("nonConformanceWorkflow")
    .select("*")
    .eq("id", nonConformanceWorkflowId)
    .single();
}

export async function getNonConformanceInvestigationTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceInvestigationTask")
    .select("*")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("investigationType", { ascending: true });
}

export async function getNonConformanceActionTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceActionTask")
    .select("*")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("actionType", { ascending: true });
}

export async function getNonConformanceApprovalTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceApprovalTask")
    .select("*")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("approvalType", { ascending: true });
}

export async function getNonConformanceAssociations(
  client: SupabaseClient<Database>,
  nonConformanceId: string,
  companyId: string
) {
  const [
    jobOperations,
    purchaseOrderLines,
    salesOrderLines,
    shipmentLines,
    receiptLines,
    trackedEntities,
    customers,
    suppliers,
  ] = await Promise.all([
    // Job Operations
    client
      .from("nonConformanceJobOperation")
      .select(
        `
        id,
        jobOperationId,
        jobId,
        jobReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Purchase Order Lines
    client
      .from("nonConformancePurchaseOrderLine")
      .select(
        `
        id,
        purchaseOrderLineId,
        purchaseOrderId,
        purchaseOrderReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Sales Order Lines
    client
      .from("nonConformanceSalesOrderLine")
      .select(
        `
        id,
        salesOrderLineId,
        salesOrderId,
        salesOrderReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Shipment Lines
    client
      .from("nonConformanceShipmentLine")
      .select(
        `
        id,
        shipmentLineId,
        shipmentId,
        shipmentReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Receipt Lines
    client
      .from("nonConformanceReceiptLine")
      .select(
        `
        id,
        receiptLineId,
        receiptId,
        receiptReadableId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Tracked Entities
    client
      .from("nonConformanceTrackedEntity")
      .select(
        `
        id,
        trackedEntityId
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Customers
    client
      .from("nonConformanceCustomer")
      .select(
        `
        id,
        customerId,
        customer:customer (
          id,
          name
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),

    // Suppliers
    client
      .from("nonConformanceSupplier")
      .select(
        `
        id,
        supplierId,
        supplier:supplier (
          id,
          name
        )
      `
      )
      .eq("nonConformanceId", nonConformanceId)
      .eq("companyId", companyId),
  ]);

  return {
    jobOperations:
      jobOperations.data?.map((item) => ({
        type: "jobOperations",
        id: item.id,
        documentId: item.jobId ?? "",
        documentLineId: item.jobOperationId,
        documentReadableId: item.jobReadableId || "",
      })) || [],
    purchaseOrderLines:
      purchaseOrderLines.data?.map((item) => ({
        id: item.id,
        type: "purchaseOrderLines",
        documentId: item.purchaseOrderId ?? "",
        documentLineId: item.purchaseOrderLineId,
        documentReadableId: item.purchaseOrderReadableId || "",
      })) || [],
    salesOrderLines:
      salesOrderLines.data?.map((item) => ({
        id: item.id,
        type: "salesOrderLines",
        documentId: item.salesOrderId ?? "",
        documentLineId: item.salesOrderLineId,
        documentReadableId: item.salesOrderReadableId || "",
      })) || [],
    shipmentLines:
      shipmentLines.data?.map((item) => ({
        id: item.id,
        type: "shipmentLines",
        documentId: item.shipmentId ?? "",
        documentLineId: item.shipmentLineId,
        documentReadableId: item.shipmentReadableId || "",
      })) || [],
    receiptLines:
      receiptLines.data?.map((item) => ({
        id: item.id,
        type: "receiptLines",
        documentId: item.receiptId ?? "",
        documentLineId: item.receiptLineId,
        documentReadableId: item.receiptReadableId || "",
      })) || [],
    trackedEntities:
      trackedEntities.data?.map((item) => ({
        id: item.id,
        type: "trackedEntities",
        documentId: item.trackedEntityId ?? "",
        documentLineId: "",
        documentReadableId: item.trackedEntityId ?? "",
      })) || [],
    customers:
      customers.data?.map((c) => ({
        id: c.id,
        type: "customers",
        documentId: c.customerId ?? "",
        documentLineId: "",
        documentReadableId: c.customer.name,
      })) || [],
    suppliers:
      suppliers.data?.map((item) => ({
        id: item.id,
        type: "suppliers",
        documentId: item.supplierId ?? "",
        documentLineId: "",
        documentReadableId: item.supplier.name,
      })) || [],
  };
}

export async function getNonConformanceReviewers(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("nonConformanceReviewer")
    .select("*")
    .eq("nonConformanceId", id)
    .eq("companyId", companyId)
    .order("id", { ascending: true });
}

export async function getNonConformanceTasks(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return Promise.all([
    client
      .from("nonConformanceInvestigationTask")
      .select("*")
      .eq("nonConformanceId", id)
      .eq("companyId", companyId)
      .order("investigationType", { ascending: true }),
    client
      .from("nonConformanceActionTask")
      .select("*")
      .eq("nonConformanceId", id)
      .eq("companyId", companyId)
      .order("actionType", { ascending: true }),
    client
      .from("nonConformanceApprovalTask")
      .select("*")
      .eq("nonConformanceId", id)
      .eq("companyId", companyId)
      .order("approvalType", { ascending: true }),
  ]);
}

export async function getNonConformanceWorkflows(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceWorkflow")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("active", true);

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

export async function getNonConformanceWorkflowsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceWorkflow")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function getNonConformanceTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getNonConformanceType(
  client: SupabaseClient<Database>,
  nonConformanceTypeId: string
) {
  return client
    .from("nonConformanceType")
    .select("*")
    .eq("id", nonConformanceTypeId)
    .single();
}

export async function getNonConformanceTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceType")
    .select("*", { count: "exact" })
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

export async function insertNonConformanceReviewer(
  client: SupabaseClient<Database>,
  reviewer: z.infer<typeof nonConformanceReviewerValidator> & {
    nonConformanceId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("nonConformanceReviewer").insert(reviewer);
}

export async function updateNonConformanceStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof nonConformanceStatus)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  return client.from("nonConformance").update(update).eq("id", update.id);
}
export async function updateNonConformanceTaskStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: "Pending" | "Completed" | "Skipped" | "In Progress";
    type: "investigation" | "action" | "approval" | "review";
    userId: string;
    assignee: string | null;
  }
) {
  const { id, status, type, userId, assignee } = args;
  const table =
    type === "investigation"
      ? "nonConformanceInvestigationTask"
      : type === "action"
      ? "nonConformanceActionTask"
      : type === "review"
      ? "nonConformanceReviewer"
      : "nonConformanceApprovalTask";

  const finalAssignee = assignee || userId;

  return client
    .from(table)
    .update({ status, updatedBy: userId, assignee: finalAssignee })
    .eq("id", id);
}

export async function upsertGauge(
  client: SupabaseClient<Database>,
  gauge:
    | (Omit<z.infer<typeof gaugeValidator>, "id" | "gaugeId"> & {
        gaugeId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof gaugeValidator>, "id" | "gaugeId"> & {
        id: string;
        gaugeId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in gauge) {
    return client.from("gauges").insert([gauge]).select("id, gaugeId").single();
  } else {
    return client.from("gauges").update(sanitize(gauge)).eq("id", gauge.id);
  }
}

export async function upsertGaugeType(
  client: SupabaseClient<Database>,
  gaugeType:
    | (Omit<z.infer<typeof gaugeTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof nonConformanceTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in gaugeType) {
    return client.from("gaugeType").insert([gaugeType]).select("id");
  } else {
    return client
      .from("gaugeType")
      .update(sanitize(gaugeType))
      .eq("id", gaugeType.id);
  }
}

export async function upsertNonConformance(
  client: SupabaseClient<Database>,
  nonConformance:
    | (Omit<
        z.infer<typeof nonConformanceValidator>,
        "id" | "nonConformanceId"
      > & {
        nonConformanceId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof nonConformanceValidator>,
        "id" | "nonConformanceId"
      > & {
        id: string;
        nonConformanceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in nonConformance) {
    return client
      .from("nonConformance")
      .insert([nonConformance])
      .select("id")
      .single();
  } else {
    return client
      .from("nonConformance")
      .update(sanitize(nonConformance))
      .eq("id", nonConformance.id);
  }
}

export async function upsertNonConformanceWorkflow(
  client: SupabaseClient<Database>,
  nonConformanceWorkflow:
    | (Omit<z.infer<typeof nonConformanceWorkflowValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof nonConformanceWorkflowValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in nonConformanceWorkflow) {
    return client
      .from("nonConformanceWorkflow")
      .insert([nonConformanceWorkflow])
      .select("id")
      .single();
  } else {
    return client
      .from("nonConformanceWorkflow")
      .update(sanitize(nonConformanceWorkflow))
      .eq("id", nonConformanceWorkflow.id);
  }
}

export async function upsertNonConformanceType(
  client: SupabaseClient<Database>,
  nonConformanceType:
    | (Omit<z.infer<typeof nonConformanceTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof nonConformanceTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in nonConformanceType) {
    return client
      .from("nonConformanceType")
      .insert([nonConformanceType])
      .select("id");
  } else {
    return client
      .from("nonConformanceType")
      .update(sanitize(nonConformanceType))
      .eq("id", nonConformanceType.id);
  }
}
