import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import {
  datetime,
  EPSILON,
  getPurchaseOrderStatus,
  round
} from "@carbon/utils";
import type {
  PostgrestError,
  PostgrestResponse,
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { getEmployeeJob } from "~/modules/people";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting/accounting.ee.service";
import type { PurchaseInvoice } from "../invoicing/types";
import {
  canApproveRequest,
  getLatestApprovalRequestForDocument,
  upsertExternalLink
} from "../shared/shared.service";
import type {
  purchaseOrderDeliveryValidator,
  purchaseOrderLineValidator,
  purchaseOrderPaymentValidator,
  purchaseOrderStatusType,
  purchaseOrderTypeType,
  purchaseOrderValidator,
  purchaseReturnOrderLineValidator,
  purchaseReturnOrderStatusType,
  purchaseReturnOrderValidator,
  purchasingRfqStatusType,
  selectedLinesValidator,
  supplierAccountingValidator,
  supplierContactValidator,
  supplierPaymentValidator,
  supplierProcessValidator,
  supplierQuoteLineValidator,
  supplierQuoteStatusType,
  supplierQuoteValidator,
  supplierShippingValidator,
  supplierTaxValidator,
  supplierTypeValidator,
  supplierValidator
} from "./purchasing.models";
import { PURCHASE_ORDER_LOCKED_STATUSES } from "./purchasing.models";
import type { PurchaseOrder, PurchasingRFQ, SupplierQuote } from "./types";

const PURCHASE_ORDERS_LIST_COLUMNS =
  "id,purchaseOrderId,revisionId,status,orderDate,supplierId,supplierReference,assignee,companyId,customFields,createdAt,createdBy,updatedAt,updatedBy,thumbnailPath,itemType,orderTotal,receivableQuantity,receivedQuantity,shippingMethodId,receiptRequestedDate,receiptPromisedDate,deliveryDate,dropShipment,paymentTermId,createdByFullName,assigneeFullName" as const;

const logger = getLogger("erp", "purchasing-service");

export async function closePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string
) {
  const purchaseOrder = await client
    .from("purchaseOrder")
    .select("companyId")
    .eq("id", purchaseOrderId)
    .single();
  const companyTz = await getCompanyTimeZone(
    client,
    purchaseOrder.data?.companyId ?? ""
  );
  return client
    .from("purchaseOrder")
    .update({
      closed: true,
      closedAt: datetime.today(companyTz).toString(),
      closedBy: userId
    })
    .eq("id", purchaseOrderId)
    .select("id")
    .single();
}

export async function convertSupplierQuoteToOrder(
  client: SupabaseClient<Database>,
  payload: {
    id: string;
    selectedLines: z.infer<typeof selectedLinesValidator>;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "supplierQuoteToPurchaseOrder",
      ...payload
    }
  });
}

export async function deletePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client.from("purchaseOrder").delete().eq("id", purchaseOrderId);
}

export async function deletePurchaseOrderLine(
  client: SupabaseClient<Database>,
  purchaseOrderLineId: string
) {
  return client
    .from("purchaseOrderLine")
    .delete()
    .eq("id", purchaseOrderLineId);
}

// Creates a new Draft PO header + delivery + payment via insertPurchaseOrder
// and copies the source PO's lines into it. Receipt/invoice progress is
// reset; only the order/line definition is duplicated.
export async function duplicatePurchaseOrder(
  client: SupabaseClient<Database>,
  {
    sourcePurchaseOrderId,
    companyId,
    companyGroupId,
    userId
  }: {
    sourcePurchaseOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
  }
): Promise<{
  data: { id: string; purchaseOrderId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const [source, sourceDelivery, sourceLines] = await Promise.all([
    client
      .from("purchaseOrder")
      .select(
        "id, supplierId, supplierContactId, supplierLocationId, supplierReference, currencyCode, purchaseOrderType, internalNotes, externalNotes"
      )
      .eq("id", sourcePurchaseOrderId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("purchaseOrderDelivery")
      .select("locationId, receiptRequestedDate")
      .eq("id", sourcePurchaseOrderId)
      .maybeSingle(),
    client
      .from("purchaseOrderLine")
      .select(
        "purchaseOrderLineType, itemId, assetId, description, purchaseQuantity, supplierUnitPrice, inventoryUnitOfMeasureCode, purchaseUnitOfMeasureCode, locationId, storageUnitId, setupPrice, customFields, conversionFactor, tags, internalNotes, externalNotes, exchangeRate, supplierShippingCost, modelUploadId, supplierTaxAmount, taxPercent, jobId, jobOperationId, promisedDate, requiredDate, accountId, costCenterId, ownerId, sortOrder, supplierPartId"
      )
      .eq("purchaseOrderId", sourcePurchaseOrderId)
      .eq("companyId", companyId)
  ]);

  if (source.error || !source.data) {
    return { data: null, error: source.error };
  }
  if (sourceLines.error) {
    return { data: null, error: sourceLines.error };
  }

  const insertResult = await insertPurchaseOrder(client, {
    supplierId: source.data.supplierId,
    supplierContactId: source.data.supplierContactId ?? undefined,
    supplierLocationId: source.data.supplierLocationId ?? undefined,
    supplierReference: source.data.supplierReference ?? undefined,
    currencyCode: source.data.currencyCode ?? undefined,
    purchaseOrderType: source.data.purchaseOrderType ?? undefined,
    notes: source.data.internalNotes ?? undefined,
    externalNotes: source.data.externalNotes ?? undefined,
    locationId: sourceDelivery.data?.locationId ?? undefined,
    receiptRequestedDate:
      sourceDelivery.data?.receiptRequestedDate ?? undefined,
    status: "Draft",
    companyId,
    companyGroupId,
    createdBy: userId
  });

  if (insertResult.error || !insertResult.data) {
    return insertResult;
  }

  const newId = insertResult.data.id;

  if (sourceLines.data && sourceLines.data.length > 0) {
    const lineRows = sourceLines.data.map((line) => ({
      ...line,
      purchaseOrderId: newId,
      companyId,
      createdBy: userId
    }));
    const lineInsert = await client
      .from("purchaseOrderLine")
      .insert(lineRows as never);
    if (lineInsert.error) {
      // Best-effort rollback so we don't leave an orphan header.
      await deletePurchaseOrder(client, newId);
      return { data: null, error: lineInsert.error };
    }
  }

  return insertResult;
}

export async function deleteSupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client.from("supplier").delete().eq("id", supplierId);
}

export async function deleteSupplierContact(
  client: SupabaseClient<Database>,
  supplierId: string,
  supplierContactId: string
) {
  const supplierContact = await client
    .from("supplierContact")
    .select("contactId")
    .eq("supplierId", supplierId)
    .eq("id", supplierContactId)
    .single();
  if (supplierContact.data) {
    const contactDelete = await client
      .from("contact")
      .delete()
      .eq("id", supplierContact.data.contactId);

    if (contactDelete.error) {
      return contactDelete;
    }
  }
  return supplierContact;
}

export async function deleteSupplierLocation(
  client: SupabaseClient<Database>,
  supplierId: string,
  supplierLocationId: string
) {
  const { data: supplierLocation } = await client
    .from("supplierLocation")
    .select("addressId")
    .eq("supplierId", supplierId)
    .eq("id", supplierLocationId)
    .single();

  if (supplierLocation?.addressId) {
    return client.from("address").delete().eq("id", supplierLocation.addressId);
  } else {
    // The supplierLocation should always have an addressId, but just in case
    return client
      .from("supplierLocation")
      .delete()
      .eq("supplierId", supplierId)
      .eq("id", supplierLocationId);
  }
}

export async function deleteSupplierProcess(
  client: SupabaseClient<Database>,
  supplierProcessId: string
) {
  return client.from("supplierProcess").delete().eq("id", supplierProcessId);
}

export async function deleteSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client.from("supplierQuote").delete().eq("id", supplierQuoteId);
}

export async function deleteSupplierQuoteLine(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("supplierQuoteLine").delete().eq("id", id);
}

export async function deleteSupplierType(
  client: SupabaseClient<Database>,
  supplierTypeId: string
) {
  return client.from("supplierType").delete().eq("id", supplierTypeId);
}

export async function getPurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrders")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function finalizeSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string,
  userId: string
) {
  const quoteUpdate = await client
    .from("supplierQuote")
    .update({
      status: "Active",
      updatedAt: datetime.timestamp(),
      updatedBy: userId
    })
    .eq("id", supplierQuoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  return { data: null, error: null };
}

export async function getPurchaseOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseOrders")
    .select(PURCHASE_ORDERS_LIST_COLUMNS, { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `purchaseOrderId.ilike.%${args.search}%,supplierReference.ilike.%${args.search}%`
    );
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "purchaseOrderId", ascending: false }
  ]);

  return query;
}

export async function getPurchaseOrderDelivery(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderDelivery")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function getPurchaseOrderLocations(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderLocations")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function getPurchaseOrderPayment(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderPayment")
    .select("*")
    .eq("id", purchaseOrderId)
    .single();
}

export async function getPurchaseOrderLines(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchaseOrderLines")
    .select("*")
    .eq("purchaseOrderId", purchaseOrderId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getPurchaseOrderLine(
  client: SupabaseClient<Database>,
  purchaseOrderLineId: string
) {
  return client
    .from("purchaseOrderLines")
    .select("*")
    .eq("id", purchaseOrderLineId)
    .single();
}

export async function getPurchaseOrderSuppliers(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("purchaseOrderSuppliers")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getPurchasingDocumentsAssignedToMe(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const [purchaseOrders, supplierQuotes, purchaseInvoices] = await Promise.all([
    client
      .from("purchaseOrder")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("supplierQuote")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("purchaseInvoice")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId)
  ]);

  const merged = [
    ...(purchaseOrders.data?.map((doc) => ({
      ...doc,
      type: "purchaseOrder"
    })) ?? []),
    ...(supplierQuotes.data?.map((doc) => ({
      ...doc,
      type: "supplierQuote"
    })) ?? []),
    ...(purchaseInvoices.data?.map((doc) => ({
      ...doc,
      type: "purchaseInvoice"
    })) ?? [])
  ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return merged;
}

export async function getPurchasingPlanning(
  client: SupabaseClient<Database>,
  locationId: string,
  companyId: string,
  periods: string[],
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client.rpc(
    "get_purchasing_planning",
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

export async function getPurchasingTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("terms")
    .select("purchasingTerms")
    .eq("id", companyId)
    .single();
}

export async function getSupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client.from("suppliers").select("*").eq("id", supplierId).single();
}

type ApprovalContext = {
  approvalRequest: { id: string } | null;
  canApprove: boolean;
  decision: {
    status: "Approved" | "Rejected";
    decisionBy: string;
    decisionAt: string;
  } | null;
};

export async function getSupplierApprovalContext(
  serviceRole: SupabaseClient<Database>,
  supplierId: string,
  status: string | null,
  companyId: string,
  userId: string
): Promise<ApprovalContext> {
  const latest = await getLatestApprovalRequestForDocument(
    serviceRole,
    "supplier",
    supplierId
  );

  const req = latest.data;

  const canApprove = await canApproveRequest(
    serviceRole,
    {
      amount: req?.amount ?? null,
      documentType: "supplier",
      companyId
    },
    userId
  );

  // Look for the latest terminal decision (Approved or Rejected)
  let decision: ApprovalContext["decision"] = null;
  const terminalRequest = await serviceRole
    .from("approvalRequest")
    .select("status, decisionBy, decisionAt")
    .eq("documentType", "supplier")
    .eq("documentId", supplierId)
    .in("status", ["Approved", "Rejected"])
    .order("decisionAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    terminalRequest.data?.decisionBy &&
    terminalRequest.data?.decisionAt &&
    (terminalRequest.data.status === "Approved" ||
      terminalRequest.data.status === "Rejected")
  ) {
    decision = {
      status: terminalRequest.data.status,
      decisionBy: terminalRequest.data.decisionBy,
      decisionAt: terminalRequest.data.decisionAt
    };
  }

  if (!req || req.status !== "Pending" || !req.requestedBy || !req.id) {
    return {
      approvalRequest: null,
      canApprove,
      decision
    };
  }

  return {
    approvalRequest: { id: req.id },
    canApprove,
    decision
  };
}

export async function getSupplierContact(
  client: SupabaseClient<Database>,
  supplierContactId: string
) {
  return client
    .from("supplierContact")
    .select(
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
    )
    .eq("id", supplierContactId)
    .single();
}

export async function getSupplierContacts(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierContact")
    .select(
      "*, contact(id, fullName, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
    )
    .eq("supplierId", supplierId);
}

export async function getSupplierInteraction(
  client: SupabaseClient<Database>,
  opportunityId: string | null
): Promise<
  PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchasingRfq: PurchasingRFQ | null;
    supplierQuotes: SupplierQuote[];
    purchaseOrders: PurchaseOrder[];
    purchaseInvoices: PurchaseInvoice[];
  } | null>
> {
  if (!opportunityId) {
    // @ts-expect-error
    return {
      data: null,
      error: null
    };
  }

  const response = await client.rpc(
    "get_supplier_interaction_with_related_records",
    {
      supplier_interaction_id: opportunityId
    }
  );

  return {
    data: response.data?.[0],
    error: response.error
  } as unknown as PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchasingRfq: PurchasingRFQ;
    supplierQuotes: SupplierQuote[];
    purchaseOrders: PurchaseOrder[];
    purchaseInvoices: PurchaseInvoice[];
  }>;
}

export async function getSupplierInteractionDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  interactionId: string
) {
  const result = await client.storage
    .from("private")
    .list(`${companyId}/supplier-interaction/${interactionId}`);

  if (result.error) {
    logger.error("Failed to list supplier interaction documents", result.error);
    return [];
  }

  return (
    result.data?.map((f) => ({ ...f, bucket: "supplier-interaction" })) ?? []
  );
}

export async function getSupplierInteractionLineDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  lineId: string
) {
  const result = await client.storage
    .from("private")
    .list(`${companyId}/supplier-interaction-line/${lineId}`);

  if (result.error) {
    logger.error(
      "Failed to list supplier interaction line documents",
      result.error
    );
    return [];
  }

  return (
    result.data?.map((f) => ({
      ...f,
      bucket: "supplier-interaction-line"
    })) ?? []
  );
}

export async function getSupplierLocations(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("supplierId", supplierId);
}

export async function getSupplierLocation(
  client: SupabaseClient<Database>,
  supplierContactId: string
) {
  return client
    .from("supplierLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("id", supplierContactId)
    .single();
}

export async function getSupplierPayment(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierPayment")
    .select("*")
    .eq("supplierId", supplierId)
    .single();
}

export async function getSupplierProcessById(
  client: SupabaseClient<Database>,
  supplierProcessId: string
) {
  return client
    .from("supplierProcesses")
    .select("*")
    .eq("id", supplierProcessId)
    .single();
}

export async function getSupplierProcessesByProcess(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client
    .from("supplierProcesses")
    .select("*")
    .eq("processId", processId);
}

export async function getSupplierProcessesBySupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierProcesses")
    .select("*")
    .eq("supplierId", supplierId);
}

export async function getSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("supplierQuotes")
    .select("*")
    .eq("id", supplierQuoteId)
    .single();
}

export async function getSupplierQuoteByInteractionId(
  client: SupabaseClient<Database>,
  interactionId: string
) {
  return client
    .from("supplierQuotes")
    .select("*")
    .eq("supplierInteractionId", interactionId)
    .single();
}

export async function getSupplierQuoteByExternalLinkId(
  client: SupabaseClient<Database>,
  externalLinkId: string
) {
  return client
    .from("supplierQuote")
    .select("*")
    .eq("externalLinkId", externalLinkId)
    .single();
}

export async function getSupplierQuotes(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("supplierQuotes")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `supplierQuoteId.ilike.%${args.search}%,name.ilike.%${args.search}%,supplierReference.ilike%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "supplierQuoteId", ascending: false }
  ]);
  return query;
}

export async function getSupplierQuoteLine(
  client: SupabaseClient<Database>,
  supplierQuoteLineId: string
) {
  return client
    .from("supplierQuoteLines")
    .select("*")
    .eq("id", supplierQuoteLineId)
    .single();
}

export async function getSupplierQuoteLines(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("supplierQuoteLines")
    .select("*")
    .eq("supplierQuoteId", supplierQuoteId)
    .order("sortOrder", { ascending: true });
}

export async function getSupplierQuoteLinePrices(
  client: SupabaseClient<Database>,
  supplierQuoteLineId: string
) {
  return client
    .from("supplierQuoteLinePrice")
    .select("*")
    .eq("supplierQuoteLineId", supplierQuoteLineId);
}

export async function getSupplierQuoteLinePricesByQuoteId(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("supplierQuoteLinePrice")
    .select("*")
    .eq("supplierQuoteId", supplierQuoteId)
    .order("supplierQuoteLineId", { ascending: true });
}

export async function getSupplierQuotesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    supplierQuoteId: string;
  }>(client, "supplierQuote", "id, supplierQuoteId", (query) =>
    query.eq("companyId", companyId).order("createdAt", { ascending: false })
  );
}

export async function getSupplierShipping(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierShipping")
    .select("*")
    .eq("supplierId", supplierId)
    .single();
}

export async function getSuppliers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    type: string | null;
    status: string | null;
  }
) {
  let query = client
    .from("suppliers")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args.type) {
    query = query.eq("supplierTypeId", args.type);
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as "Active" | "Inactive" | "Pending" | "Rejected"
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getSuppliersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "supplier", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function getSupplierType(
  client: SupabaseClient<Database>,
  supplierTypeId: string
) {
  return client
    .from("supplierType")
    .select("*")
    .eq("id", supplierTypeId)
    .single();
}

export async function getSupplierTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("supplierType")
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

export async function getSupplierTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("supplierType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function insertSupplier(
  client: SupabaseClient<Database>,
  supplier: Omit<z.infer<typeof supplierValidator>, "id"> & {
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  return client.from("supplier").insert([supplier]).select("*").single();
}

export async function insertSupplierContact(
  client: SupabaseClient<Database>,
  supplierContact: {
    supplierId: string;
    companyId: string;
    contact: z.infer<typeof supplierContactValidator>;
    supplierLocationId?: string;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      {
        ...supplierContact.contact,
        companyId: supplierContact.companyId,
        isCustomer: false
      }
    ])
    .select("id")
    .single();

  if (insertContact.error) {
    return insertContact;
  }

  const contactId = insertContact.data?.id;
  if (!contactId) {
    return { data: null, error: new Error("Contact ID not found") };
  }

  return client
    .from("supplierContact")
    .insert([
      {
        supplierId: supplierContact.supplierId,
        contactId,
        supplierLocationId: supplierContact.supplierLocationId,
        companyId: supplierContact.companyId,
        customFields: supplierContact.customFields
      }
    ])
    .select("id")
    .single();
}

export async function insertSupplierInteraction(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string
) {
  return client
    .from("supplierInteraction")
    .insert([{ companyId, supplierId }])
    .select("id")
    .single();
}

export async function insertSupplierLocation(
  client: SupabaseClient<Database>,
  supplierLocation: {
    supplierId: string;
    companyId: string;
    name: string;
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateProvince?: string;
      postalCode?: string;
      countryCode?: string;
    };
    customFields?: Json;
  }
) {
  const insertAddress = await client
    .from("address")
    .insert([
      { ...supplierLocation.address, companyId: supplierLocation.companyId }
    ])
    .select("id")
    .single();
  if (insertAddress.error) {
    return insertAddress;
  }

  const addressId = insertAddress.data?.id;
  if (!addressId) {
    return { data: null, error: new Error("Address ID not found") };
  }

  return client
    .from("supplierLocation")
    .insert([
      {
        supplierId: supplierLocation.supplierId,
        addressId,
        name: supplierLocation.name,
        companyId: supplierLocation.companyId,
        customFields: supplierLocation.customFields
      }
    ])
    .select("id")
    .single();
}

export async function finalizePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string
) {
  const [purchaseOrder, lines] = await Promise.all([
    getPurchaseOrder(client, purchaseOrderId),
    getPurchaseOrderLines(client, purchaseOrderId)
  ]);
  const { status } = getPurchaseOrderStatus(lines.data || []);

  const updateData: Database["public"]["Tables"]["purchaseOrder"]["Update"] = {
    status,
    updatedAt: datetime.timestamp(),
    updatedBy: userId
  };

  // Only set orderDate if it's not already set
  if (!purchaseOrder.data?.orderDate) {
    const companyTz = await getCompanyTimeZone(
      client,
      purchaseOrder.data?.companyId ?? ""
    );
    updateData.orderDate = datetime.today(companyTz).toString();
  }

  return client
    .from("purchaseOrder")
    .update(updateData)
    .eq("id", purchaseOrderId);
}

export async function sendSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string,
  userId: string
) {
  // Send keeps status as Draft, just updates timestamp
  const quoteUpdate = await client
    .from("supplierQuote")
    .update({
      updatedAt: datetime.timestamp(),
      updatedBy: userId
    })
    .eq("id", supplierQuoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  return { data: null, error: null };
}

/** @deprecated Use updatePurchaseOrderStatus or the new updatePurchaseOrder instead */
export async function updatePurchaseOrderStatusLegacy(
  client: SupabaseClient<Database>,
  purchaseOrder: {
    id: string;
    status: (typeof purchaseOrderStatusType)[number];
    updatedBy: string;
  }
) {
  return client
    .from("purchaseOrder")
    .update(purchaseOrder)
    .eq("id", purchaseOrder.id);
}

export async function updatePurchaseOrderExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString()
  };

  return client.from("purchaseOrder").update(update).eq("id", update.id);
}

export async function updatePurchaseOrderFavorite(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    favorite: boolean;
    userId: string;
  }
) {
  const { id, favorite, userId } = args;
  if (!favorite) {
    return client
      .from("purchaseOrderFavorite")
      .delete()
      .eq("purchaseOrderId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("purchaseOrderFavorite")
      .insert({ purchaseOrderId: id, userId: userId });
  }
}

export async function updatePurchaseOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof purchaseOrderStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  return client.from("purchaseOrder").update(update).eq("id", update.id);
}

/**
 * Reopens a released purchase order to Draft as its next revision.
 *
 * Compare-and-swap: the increment and the eligibility conditions are both in
 * SQL, so concurrent requests can't share a revision number and an ineligible
 * order matches no rows. Returns rows updated — 0 means it was not eligible.
 */
export async function reopenPurchaseOrderAsRevision(
  db: Kysely<KyselyDatabase>,
  {
    id,
    companyId,
    updatedBy
  }: {
    id: string;
    companyId: string;
    updatedBy: string;
  }
) {
  const result = await db
    .updateTable("purchaseOrder")
    .set((eb) => ({
      status: "Draft" as const,
      assignee: null,
      revisionId: eb("revisionId", "+", 1),
      updatedBy,
      updatedAt: datetime.timestamp()
    }))
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .where("status", "in", [...PURCHASE_ORDER_LOCKED_STATUSES])
    .where("orderDate", "is not", null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}

export async function updateSupplierAccounting(
  client: SupabaseClient<Database>,
  supplierAccounting: z.infer<typeof supplierAccountingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("supplier")
    .update(sanitize(supplierAccounting))
    .eq("id", supplierAccounting.id);
}

export async function updateSupplierContact(
  client: SupabaseClient<Database>,
  supplierContact: {
    contactId: string;
    contact: z.infer<typeof supplierContactValidator>;
    supplierLocationId?: string;
    customFields?: Json;
  }
) {
  if (supplierContact.customFields) {
    const customFieldUpdate = await client
      .from("supplierContact")
      .update({
        customFields: supplierContact.customFields,
        supplierLocationId: supplierContact.supplierLocationId
      })
      .eq("contactId", supplierContact.contactId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  return client
    .from("contact")
    .update(sanitize(supplierContact.contact))
    .eq("id", supplierContact.contactId)
    .select("id")
    .single();
}

export async function updateSupplierLocation(
  client: SupabaseClient<Database>,
  supplierLocation: {
    addressId: string;
    name: string;
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      stateProvince?: string;
      countryCode?: string;
      postalCode?: string;
    };
    customFields?: Json;
  }
) {
  if (supplierLocation.customFields) {
    const customFieldUpdate = await client
      .from("supplierLocation")
      .update({
        name: supplierLocation.name,
        customFields: supplierLocation.customFields
      })
      .eq("addressId", supplierLocation.addressId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  return client
    .from("address")
    .update(sanitize(supplierLocation.address))
    .eq("id", supplierLocation.addressId)
    .select("id")
    .single();
}

export async function updateSupplierPayment(
  client: SupabaseClient<Database>,
  supplierPayment: z.infer<typeof supplierPaymentValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("supplierPayment")
    .update(sanitize(supplierPayment))
    .eq("supplierId", supplierPayment.supplierId);
}

export async function updateSupplierQuoteExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString()
  };

  return client.from("supplierQuote").update(update).eq("id", update.id);
}

export async function updateSupplierQuoteFavorite(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    favorite: boolean;
    userId: string;
  }
) {
  const { id, favorite, userId } = args;
  if (!favorite) {
    return client
      .from("supplierQuoteFavorite")
      .delete()
      .eq("supplierQuoteId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("supplierQuoteFavorite")
      .insert({ supplierQuoteId: id, userId: userId });
  }
}

export async function updateSupplierQuoteStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof supplierQuoteStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  return client.from("supplierQuote").update(update).eq("id", update.id);
}

export async function updateSupplierShipping(
  client: SupabaseClient<Database>,
  supplierShipping: z.infer<typeof supplierShippingValidator> & {
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("supplierShipping")
    .update(sanitize(supplierShipping))
    .eq("supplierId", supplierShipping.supplierId);
}

export async function getSupplierTax(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierTax")
    .select("*")
    .eq("supplierId", supplierId)
    .maybeSingle();
}

export async function updateSupplierTax(
  client: SupabaseClient<Database>,
  supplierTax: z.infer<typeof supplierTaxValidator> & {
    companyId: string;
    updatedBy: string;
    taxExemptionCertificatePath?: string | null;
  }
) {
  return client
    .from("supplierTax")
    .update(sanitize(supplierTax))
    .eq("supplierId", supplierTax.supplierId);
}

export async function insertPurchaseOrder(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    purchaseOrderId?: string;
    purchaseOrderType?: "Purchase" | "Return" | "Outside Processing";
    locationId?: string;
    status?: (typeof purchaseOrderStatusType)[number];
    currencyCode?: string;
    orderDate?: string;
    supplierContactId?: string;
    supplierLocationId?: string;
    supplierQuoteId?: string;
    receiptRequestedDate?: string;
    supplierReference?: string;
    notes?: Json;
    externalNotes?: Json;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; purchaseOrderId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let purchaseOrderId: string;
  if (input.purchaseOrderId) {
    purchaseOrderId = input.purchaseOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate PO sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    purchaseOrderId = seq.data;
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(client, input.companyId, input.supplierId),
      getSupplierPayment(client, input.supplierId),
      getSupplierShipping(client, input.supplierId),
      getEmployeeJob(client, input.createdBy, input.companyId)
    ]);

  if (supplierInteraction.error)
    return { data: null, error: supplierInteraction.error };
  if (supplierPayment.error)
    return { data: null, error: supplierPayment.error };
  if (supplierShipping.error)
    return { data: null, error: supplierShipping.error };

  const {
    paymentTermId,
    invoiceSupplierId,
    invoiceSupplierContactId,
    invoiceSupplierLocationId
  } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  let exchangeRate = 1;
  let exchangeRateUpdatedAt = new Date().toISOString();
  if (input.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      input.companyGroupId,
      input.currencyCode
    );
    if (currency.data) {
      exchangeRate = currency.data.exchangeRate ?? 1;
      exchangeRateUpdatedAt = new Date().toISOString();
    }
  }

  const locationId = input.locationId ?? purchaser?.data?.locationId ?? null;

  const order = await client
    .from("purchaseOrder")
    .insert({
      purchaseOrderId,
      purchaseOrderType: input.purchaseOrderType,
      supplierId: input.supplierId,
      supplierContactId: input.supplierContactId,
      supplierLocationId: input.supplierLocationId,
      supplierInteractionId: supplierInteraction.data?.id,
      status: input.status ?? "Draft",
      orderDate:
        input.orderDate ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      currencyCode: input.currencyCode,
      exchangeRate,
      exchangeRateUpdatedAt,
      supplierReference: input.supplierReference ?? null,
      internalNotes: input.notes ?? null,
      externalNotes: input.externalNotes ?? null,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, purchaseOrderId")
    .single();

  if (order.error) return { data: null, error: order.error };

  const orderId = order.data.id;

  const [delivery, payment] = await Promise.all([
    client.from("purchaseOrderDelivery").insert({
      id: orderId,
      locationId,
      receiptRequestedDate: input.receiptRequestedDate ?? null,
      shippingMethodId,
      shippingTermId,
      incoterm,
      incotermLocation,
      companyId: input.companyId
    }),
    client.from("purchaseOrderPayment").insert({
      id: orderId,
      paymentTermId,
      invoiceSupplierId: invoiceSupplierId ?? input.supplierId,
      invoiceSupplierContactId,
      invoiceSupplierLocationId,
      companyId: input.companyId
    })
  ]);

  if (delivery.error || payment.error) {
    await deletePurchaseOrder(client, orderId);
    return { data: null, error: delivery.error ?? payment.error };
  }

  return { data: { id: orderId, purchaseOrderId }, error: null };
}

export async function updatePurchaseOrder(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    status?: (typeof purchaseOrderStatusType)[number];
    currencyCode?: string;
    orderDate?: string;
    supplierId?: string;
    supplierContactId?: string | null;
    supplierLocationId?: string | null;
    supplierReference?: string;
    purchaseOrderType?: (typeof purchaseOrderTypeType)[number];
    notes?: string | null;
    customFields?: Json;
  },
  companyGroupId?: string
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, updatedBy, notes, ...updates } = input;

  let exchangeRate: number | undefined;
  let exchangeRateUpdatedAt: string | undefined;
  if (updates.currencyCode && companyGroupId) {
    const currency = await getCurrencyByCode(
      client,
      companyGroupId,
      updates.currencyCode
    );
    if (currency.data) {
      exchangeRate = currency.data.exchangeRate ?? 1;
      exchangeRateUpdatedAt = new Date().toISOString();
    }
  }

  return client
    .from("purchaseOrder")
    .update({
      ...sanitize(updates),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(exchangeRateUpdatedAt && { exchangeRateUpdatedAt }),
      ...(notes !== undefined && { internalNotes: notes }),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/** @deprecated Use insertPurchaseOrder for new orders, updatePurchaseOrder for existing orders */
export async function upsertPurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrder:
    | (Omit<
        z.infer<typeof purchaseOrderValidator>,
        "id" | "purchaseOrderId"
      > & {
        purchaseOrderId: string;
        status?: (typeof purchaseOrderStatusType)[number];
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof purchaseOrderValidator>,
        "id" | "purchaseOrderId"
      > & {
        id: string;
        purchaseOrderId: string;
        updatedBy: string;
        customFields?: Json;
      }),
  receiptRequestedDate?: string
) {
  if ("id" in purchaseOrder) {
    return client
      .from("purchaseOrder")
      .update(sanitize(purchaseOrder))
      .eq("id", purchaseOrder.id)
      .select("id, purchaseOrderId");
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(
        client,
        purchaseOrder.companyId,
        purchaseOrder.supplierId
      ),
      getSupplierPayment(client, purchaseOrder.supplierId),
      getSupplierShipping(client, purchaseOrder.supplierId),
      getEmployeeJob(client, purchaseOrder.createdBy, purchaseOrder.companyId)
    ]);

  if (supplierInteraction.error) return supplierInteraction;
  if (supplierPayment.error) return supplierPayment;
  if (supplierShipping.error) return supplierShipping;

  const {
    paymentTermId,
    invoiceSupplierId,
    invoiceSupplierContactId,
    invoiceSupplierLocationId
  } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  if (purchaseOrder.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      purchaseOrder.companyGroupId,
      purchaseOrder.currencyCode
    );
    if (currency.data) {
      purchaseOrder.exchangeRate = currency.data.exchangeRate ?? undefined;
      purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    purchaseOrder.exchangeRate = 1;
    purchaseOrder.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    purchaseOrder.locationId ?? purchaser?.data?.locationId ?? null;

  // locationId is not a column on purchaseOrder -- it belongs on the delivery record
  const {
    locationId: _locationId,
    companyGroupId: _companyGroupId,
    ...purchaseOrderData
  } = purchaseOrder;

  const order = await client
    .from("purchaseOrder")
    .insert([
      {
        ...purchaseOrderData,
        supplierInteractionId: supplierInteraction.data?.id,
        status: purchaseOrder.status ?? "Draft"
      }
    ])
    .select("id, purchaseOrderId");

  if (order.error) return order;

  const purchaseOrderId = order.data[0].id;

  const [delivery, payment] = await Promise.all([
    client.from("purchaseOrderDelivery").insert([
      {
        id: purchaseOrderId,
        receiptRequestedDate: receiptRequestedDate ?? null,
        locationId: locationId,
        shippingMethodId: shippingMethodId,
        shippingTermId: shippingTermId,
        incoterm: incoterm,
        incotermLocation: incotermLocation,
        companyId: purchaseOrder.companyId
      }
    ]),
    client.from("purchaseOrderPayment").insert([
      {
        id: purchaseOrderId,
        invoiceSupplierId: invoiceSupplierId,
        invoiceSupplierContactId: invoiceSupplierContactId,
        invoiceSupplierLocationId: invoiceSupplierLocationId,
        paymentTermId: paymentTermId,
        companyId: purchaseOrder.companyId
      }
    ])
  ]);

  if (delivery.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return payment;
  }
  if (payment.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return payment;
  }

  return order;
}

export async function upsertPurchaseOrderDelivery(
  client: SupabaseClient<Database>,
  purchaseOrderDelivery:
    | (z.infer<typeof purchaseOrderDeliveryValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof purchaseOrderDeliveryValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseOrderDelivery) {
    return client
      .from("purchaseOrderDelivery")
      .update(sanitize(purchaseOrderDelivery))
      .eq("id", purchaseOrderDelivery.id)
      .select("id")
      .single();
  }
  return client
    .from("purchaseOrderDelivery")
    .insert([purchaseOrderDelivery])
    .select("id")
    .single();
}

export async function upsertPurchaseOrderLine(
  client: SupabaseClient<Database>,
  purchaseOrderLine:
    | (Omit<z.infer<typeof purchaseOrderLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseOrderLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseOrderLine) {
    return client
      .from("purchaseOrderLine")
      .update(sanitize(purchaseOrderLine))
      .eq("id", purchaseOrderLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("purchaseOrderLine")
    .select("sortOrder")
    .eq("purchaseOrderId", purchaseOrderLine.purchaseOrderId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("purchaseOrderLine")
    .insert([{ ...purchaseOrderLine, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updatePurchaseOrderLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchaseOrderLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

/**
 * Short-close ("stop receiving") or reopen a purchase order line whose
 * remaining quantity will never arrive. Sets `receivedComplete` without
 * touching quantities or pricing, then recomputes the header status from the
 * line completeness flags. Open-PO supply queries (get_inventory_quantities,
 * openPurchaseOrderLines) exclude `receivedComplete` lines, so the undelivered
 * remainder stops counting as incoming stock.
 *
 * Closing also caps the billable quantity at what was received (the convert
 * and post-purchase-invoice functions apply the same rule), so a line whose
 * received quantity is already fully invoiced gets `invoicedComplete` too —
 * otherwise the order could never reach Completed. Reopening restores the
 * natural rule (fully invoiced = ordered quantity).
 */
export async function shortClosePurchaseOrderLine(
  db: Kysely<KyselyDatabase>,
  {
    lineId,
    purchaseOrderId,
    companyId,
    userId,
    intent
  }: {
    lineId: string;
    purchaseOrderId: string;
    companyId: string;
    userId: string;
    intent: "close" | "reopen";
  }
) {
  return db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseOrderLine")
      .select(["purchaseQuantity", "quantityReceived", "quantityInvoiced"])
      .where("id", "=", lineId)
      .where("purchaseOrderId", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!line) throw new Error("Purchase order line not found");

    // NUMERIC columns come back from the pg driver as strings
    const ordered = Number(line.purchaseQuantity ?? 0);
    const received = Number(line.quantityReceived ?? 0);
    const invoiced = Number(line.quantityInvoiced ?? 0);

    const invoicedComplete =
      intent === "close" ? invoiced >= received : invoiced >= ordered;

    await trx
      .updateTable("purchaseOrderLine")
      .set({
        receivedComplete: intent === "close",
        invoicedComplete,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", lineId)
      .where("purchaseOrderId", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .execute();

    const lines = await trx
      .selectFrom("purchaseOrderLine")
      .select(["purchaseOrderLineType", "invoicedComplete", "receivedComplete"])
      .where("purchaseOrderId", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .execute();

    const { status } = getPurchaseOrderStatus(lines);

    await trx
      .updateTable("purchaseOrder")
      .set({
        status,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", purchaseOrderId)
      .where("companyId", "=", companyId)
      .execute();
  });
}

export async function upsertPurchaseOrderPayment(
  client: SupabaseClient<Database>,
  purchaseOrderPayment:
    | (z.infer<typeof purchaseOrderPaymentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof purchaseOrderPaymentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseOrderPayment) {
    return client
      .from("purchaseOrderPayment")
      .update(sanitize(purchaseOrderPayment))
      .eq("id", purchaseOrderPayment.id)
      .select("id")
      .single();
  }
  return client
    .from("purchaseOrderPayment")
    .insert([purchaseOrderPayment])
    .select("id")
    .single();
}

export async function upsertSupplier(
  client: SupabaseClient<Database>,
  supplier:
    | (Omit<z.infer<typeof supplierValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplier) {
    return client
      .from("supplier")
      .insert([supplier])
      .select("id, name, website, supplierStatus, readableId")
      .single();
  }
  return client
    .from("supplier")
    .update({
      ...sanitize(supplier),
      updatedAt: datetime.timestamp()
    })
    .eq("id", supplier.id)
    .select("id")
    .single();
}

export async function upsertSupplierProcess(
  client: SupabaseClient<Database>,
  supplierProcess:
    | (Omit<z.infer<typeof supplierProcessValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierProcessValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierProcess) {
    return client
      .from("supplierProcess")
      .insert([supplierProcess])
      .select("id")
      .single();
  }
  return client
    .from("supplierProcess")
    .update(sanitize(supplierProcess))
    .eq("id", supplierProcess.id)
    .select("id")
    .single();
}

export async function insertSupplierQuote(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    supplierQuoteId?: string;
    locationId?: string;
    status?: (typeof supplierQuoteStatusType)[number];
    currencyCode?: string;
    expirationDate?: string;
    supplierContactId?: string;
    supplierLocationId?: string;
    notes?: string;
    customFields?: Json;
    quotedDate?: string;
    supplierReference?: string;
    supplierQuoteType?: (typeof purchaseOrderTypeType)[number];
  }
): Promise<{
  data: { id: string; supplierQuoteId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let supplierQuoteId: string;
  if (input.supplierQuoteId) {
    supplierQuoteId = input.supplierQuoteId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "supplierQuote",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate supplier quote sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    supplierQuoteId = seq.data;
  }

  let exchangeRate = 1;
  let exchangeRateUpdatedAt = new Date().toISOString();
  if (input.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      input.companyGroupId,
      input.currencyCode
    );
    if (currency.data) {
      exchangeRate = currency.data.exchangeRate ?? 1;
      exchangeRateUpdatedAt = new Date().toISOString();
    }
  }

  const supplierInteraction = await insertSupplierInteraction(
    client,
    input.companyId,
    input.supplierId
  );

  if (supplierInteraction.error)
    return { data: null, error: supplierInteraction.error };

  const quote = await client
    .from("supplierQuote")
    .insert({
      supplierQuoteId,
      supplierId: input.supplierId,
      supplierContactId: input.supplierContactId,
      supplierLocationId: input.supplierLocationId,
      supplierInteractionId: supplierInteraction.data?.id,
      status: input.status ?? "Draft",
      expirationDate: input.expirationDate,
      currencyCode: input.currencyCode,
      exchangeRate,
      exchangeRateUpdatedAt,
      internalNotes: input.notes,
      customFields: input.customFields,
      quotedDate: input.quotedDate ?? new Date().toISOString(),
      supplierReference: input.supplierReference ?? null,
      supplierQuoteType: input.supplierQuoteType ?? "Purchase",
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, supplierQuoteId, externalLinkId")
    .single();

  if (quote.error) return { data: null, error: quote.error };

  const createdQuoteId = quote.data.id;

  if (!quote.data.externalLinkId) {
    const externalLink = await upsertExternalLink(client, {
      documentType: "SupplierQuote",
      documentId: createdQuoteId,
      supplierId: input.supplierId,
      expiresAt: input.expirationDate,
      companyId: input.companyId
    });

    if (externalLink.data) {
      await client
        .from("supplierQuote")
        .update({ externalLinkId: externalLink.data.id })
        .eq("id", createdQuoteId);
    }
  }

  return { data: { id: createdQuoteId, supplierQuoteId }, error: null };
}

export async function updateSupplierQuote(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    status?: (typeof supplierQuoteStatusType)[number];
    currencyCode?: string;
    expirationDate?: string | null;
    supplierContactId?: string | null;
    supplierLocationId?: string | null;
    notes?: string | null;
    customFields?: Json;
  },
  companyGroupId?: string
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, updatedBy, notes, ...updates } = input;

  let exchangeRate: number | undefined;
  let exchangeRateUpdatedAt: string | undefined;

  const existing = await client
    .from("supplierQuote")
    .select("currencyCode")
    .eq("id", id)
    .single();

  if (existing.error) return { data: null, error: existing.error };

  if (
    updates.currencyCode &&
    companyGroupId &&
    existing.data.currencyCode !== updates.currencyCode
  ) {
    const currency = await getCurrencyByCode(
      client,
      companyGroupId,
      updates.currencyCode
    );
    if (currency.data) {
      exchangeRate = currency.data.exchangeRate ?? 1;
      exchangeRateUpdatedAt = new Date().toISOString();
    }
  }

  return client
    .from("supplierQuote")
    .update({
      ...sanitize(updates),
      ...(exchangeRate !== undefined && { exchangeRate }),
      ...(exchangeRateUpdatedAt && { exchangeRateUpdatedAt }),
      ...(notes !== undefined && { internalNotes: notes }),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/** @deprecated Use insertSupplierQuote for new quotes, updateSupplierQuote for existing quotes */
export async function upsertSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuote:
    | (Omit<
        z.infer<typeof supplierQuoteValidator>,
        "id" | "supplierQuoteId"
      > & {
        supplierQuoteId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof supplierQuoteValidator>,
        "id" | "supplierQuoteId"
      > & {
        id: string;
        supplierQuoteId: string;
        companyGroupId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierQuote) {
    if (supplierQuote.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        supplierQuote.companyGroupId,
        supplierQuote.currencyCode
      );
      if (currency.data) {
        supplierQuote.exchangeRate = currency.data.exchangeRate ?? undefined;
        supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    } else {
      supplierQuote.exchangeRate = 1;
      supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
    }

    const supplierInteraction = await insertSupplierInteraction(
      client,
      supplierQuote.companyId,
      supplierQuote.supplierId
    );

    if (supplierInteraction.error) return supplierInteraction;

    const { companyGroupId: _companyGroupId, ...supplierQuoteData } =
      supplierQuote;
    const insert = await client
      .from("supplierQuote")
      .insert([
        {
          ...supplierQuoteData,
          status: supplierQuoteData.status ?? "Draft",
          supplierInteractionId: supplierInteraction.data?.id
        }
      ])
      .select("id, supplierQuoteId, externalLinkId")
      .single();

    if (insert.error) {
      return insert;
    }

    const supplierQuoteId = insert.data?.id;
    if (!supplierQuoteId) return insert;

    // Only create external link if one doesn't exist
    if (!insert.data.externalLinkId) {
      const externalLink = await upsertExternalLink(client, {
        documentType: "SupplierQuote",
        documentId: supplierQuoteId,
        supplierId: supplierQuote.supplierId,
        expiresAt: supplierQuote.expirationDate,
        companyId: supplierQuote.companyId
      });

      if (externalLink.data) {
        const update = await client
          .from("supplierQuote")
          .update({ externalLinkId: externalLink.data.id })
          .eq("id", supplierQuoteId);

        if (update.error) {
          return update;
        }
      }
    }

    return insert;
  } else {
    // Only update the exchange rate if the currency code has changed
    const existingQuote = await client
      .from("supplierQuote")
      .select("currencyCode, status, companyId")
      .eq("id", supplierQuote.id)
      .single();

    if (existingQuote.error) return existingQuote;

    const {
      currencyCode,
      status: existingStatus,
      companyId
    } = existingQuote.data;

    if (
      supplierQuote.currencyCode &&
      currencyCode !== supplierQuote.currencyCode
    ) {
      const currency = await getCurrencyByCode(
        client,
        supplierQuote.companyGroupId,
        supplierQuote.currencyCode
      );
      if (currency.data) {
        supplierQuote.exchangeRate = currency.data.exchangeRate ?? undefined;
        supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }
    const { companyGroupId: _companyGroupId2, ...supplierQuoteUpdateData } =
      supplierQuote;
    const companyTz = await getCompanyTimeZone(client, companyId);
    return client
      .from("supplierQuote")
      .update({
        ...sanitize(supplierQuoteUpdateData),
        status:
          supplierQuote.expirationDate &&
          datetime.today(companyTz).toString() > supplierQuote.expirationDate
            ? "Expired"
            : (supplierQuote.status ?? existingStatus ?? "Draft"),
        updatedAt: datetime.timestamp()
      })
      .eq("id", supplierQuote.id);
  }
}

export async function upsertSupplierQuoteLine(
  client: SupabaseClient<Database>,
  supplierQuoteLine:
    | (Omit<z.infer<typeof supplierQuoteLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierQuoteLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in supplierQuoteLine) {
    return client
      .from("supplierQuoteLine")
      .update(sanitize(supplierQuoteLine))
      .eq("id", supplierQuoteLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("supplierQuoteLine")
    .select("sortOrder")
    .eq("supplierQuoteId", supplierQuoteLine.supplierQuoteId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("supplierQuoteLine")
    .insert([
      {
        ...supplierQuoteLine,
        description: supplierQuoteLine.description ?? "",
        sortOrder: maxSortOrder + 1
      }
    ])
    .select("id")
    .single();
}

export async function updateSupplierQuoteLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("supplierQuoteLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function upsertSupplierType(
  client: SupabaseClient<Database>,
  supplierType:
    | (Omit<z.infer<typeof supplierTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierType) {
    return client
      .from("supplierType")
      .insert([supplierType])
      .select("id")
      .single();
  } else {
    return client
      .from("supplierType")
      .update(sanitize(supplierType))
      .eq("id", supplierType.id);
  }
}

// ============================================================
// PURCHASING RFQ FUNCTIONS
// ============================================================

export async function deletePurchasingRFQ(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  return client.from("purchasingRfq").delete().eq("id", purchasingRfqId);
}

export async function deletePurchasingRFQLine(
  client: SupabaseClient<Database>,
  purchasingRfqLineId: string
) {
  return client
    .from("purchasingRfqLine")
    .delete()
    .eq("id", purchasingRfqLineId);
}

export async function getPurchasingRFQ(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("purchasingRfqs").select("*").eq("id", id).single();
}

export async function getPurchasingRFQs(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("purchasingRfqs")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("rfqId", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "rfqId", ascending: false }
  ]);
  return query;
}

export async function getPurchasingRFQLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("purchasingRfqLines")
    .select("*")
    .eq("id", lineId)
    .single();
}

export async function getPurchasingRFQLines(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  return client
    .from("purchasingRfqLines")
    .select("*")
    .eq("purchasingRfqId", purchasingRfqId)
    .order("order", { ascending: true });
}

type PurchasingRfqSupplierWithSupplier =
  Database["public"]["Tables"]["purchasingRfqSupplier"]["Row"] & {
    supplier: { id: string; name: string };
  };

type LinkedSupplierQuote = {
  supplierQuoteId: string;
  supplierQuote:
    | (Database["public"]["Tables"]["supplierQuote"]["Row"] & {
        supplier: Database["public"]["Tables"]["supplier"]["Row"] | null;
      })
    | null;
};

export async function getPurchasingRFQSuppliers(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
): Promise<PostgrestResponse<PurchasingRfqSupplierWithSupplier>> {
  // @ts-ignore TS2589 — supabase select-string instantiation depth sits on
  // tsgo's limit; the cliff shifts as unrelated modules join the program.
  // ts-ignore, not ts-expect-error, so it satisfies both tsc and tsgo.
  return client
    .from("purchasingRfqSupplier")
    .select("*, supplier(id, name)")
    .eq("purchasingRfqId", purchasingRfqId);
}

export async function insertPurchasingRFQ(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    rfqId?: string;
    rfqDate?: string;
    expirationDate?: string;
    locationId?: string;
    employeeId?: string;
    status?: (typeof purchasingRfqStatusType)[number];
    notes?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; rfqId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let rfqId: string;
  if (input.rfqId) {
    rfqId = input.rfqId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchasingRfq",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate purchasingRfq sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    rfqId = seq.data;
  }

  const rfq = await client
    .from("purchasingRfq")
    .insert({
      rfqId,
      rfqDate:
        input.rfqDate ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
      expirationDate: input.expirationDate,
      locationId: input.locationId,
      employeeId: input.employeeId,
      status: input.status ?? "Draft",
      notes: input.notes,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, rfqId")
    .single();

  if (rfq.error) return { data: null, error: rfq.error };

  return { data: { id: rfq.data.id, rfqId: rfq.data.rfqId }, error: null };
}

export async function updatePurchasingRFQ(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    rfqDate?: string;
    expirationDate?: string | null;
    locationId?: string;
    employeeId?: string | null;
    status?: (typeof purchasingRfqStatusType)[number];
    notes?: string | null;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, updatedBy, ...updates } = input;

  return client
    .from("purchasingRfq")
    .update({
      ...sanitize(updates),
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .select("id")
    .single();
}

/** @deprecated Use insertPurchasingRFQ for new RFQs, updatePurchasingRFQ for existing RFQs */
export async function upsertPurchasingRFQ(
  client: SupabaseClient<Database>,
  purchasingRfq: {
    id?: string;
    rfqId: string;
    rfqDate: string;
    expirationDate?: string;
    locationId?: string;
    employeeId?: string;
    status?: (typeof purchasingRfqStatusType)[number];
    companyId: string;
    createdBy?: string;
    updatedBy?: string;
    customFields?: Json;
  }
) {
  if (purchasingRfq.id) {
    return client
      .from("purchasingRfq")
      .update(sanitize(purchasingRfq))
      .eq("id", purchasingRfq.id)
      .select("id")
      .single();
  }
  return client
    .from("purchasingRfq")
    .insert([purchasingRfq])
    .select("id")
    .single();
}

export async function upsertPurchasingRFQLine(
  client: SupabaseClient<Database>,
  purchasingRfqLine:
    | {
        purchasingRfqId: string;
        itemId: string;
        description?: string;
        quantity: number[];
        purchaseUnitOfMeasureCode: string;
        inventoryUnitOfMeasureCode: string;
        conversionFactor?: number;
        order: number;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        purchasingRfqId: string;
        itemId: string;
        description?: string;
        quantity: number[];
        purchaseUnitOfMeasureCode: string;
        inventoryUnitOfMeasureCode: string;
        conversionFactor?: number;
        order: number;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      }
) {
  if ("id" in purchasingRfqLine) {
    return client
      .from("purchasingRfqLine")
      .update(sanitize(purchasingRfqLine))
      .eq("id", purchasingRfqLine.id)
      .select("id")
      .single();
  }
  return client
    .from("purchasingRfqLine")
    .insert([purchasingRfqLine])
    .select("id")
    .single();
}

export async function updatePurchasingRFQLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchasingRfqLine")
        .set({ order: sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function upsertPurchasingRFQSuppliers(
  client: SupabaseClient<Database>,
  purchasingRfqId: string,
  supplierIds: string[],
  companyId: string,
  createdBy: string
) {
  // Delete existing suppliers for this RFQ
  await client
    .from("purchasingRfqSupplier")
    .delete()
    .eq("purchasingRfqId", purchasingRfqId);

  // Insert new suppliers
  if (supplierIds.length === 0) {
    return { data: [], error: null };
  }

  const suppliersToInsert = supplierIds.map((supplierId) => ({
    purchasingRfqId,
    supplierId,
    companyId,
    createdBy
  }));

  return client
    .from("purchasingRfqSupplier")
    .insert(suppliersToInsert)
    .select("id");
}

export async function updatePurchasingRFQStatus(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    status: (typeof purchasingRfqStatusType)[number];
    assignee?: string | null;
    updatedBy: string;
  }
) {
  return client
    .from("purchasingRfq")
    .update({
      status: args.status,
      assignee: args.assignee,
      updatedBy: args.updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", args.id)
    .select("id")
    .single();
}

export async function getLinkedSupplierQuotes(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
): Promise<PostgrestResponse<LinkedSupplierQuote>> {
  // @ts-ignore - nested select instantiation exceeds tsgo depth limit
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier(*))
    `
    )
    .eq("purchasingRfqId", purchasingRfqId);
}

export async function getLinkedPurchasingRfqs(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
) {
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
    )
    .eq("supplierQuoteId", supplierQuoteId);
}

export async function getLinkedPurchasingRfqsForInteraction(
  client: SupabaseClient<Database>,
  supplierInteractionId: string
) {
  // First get all supplier quote IDs in this interaction
  const { data: quotes, error: quotesError } = await client
    .from("supplierQuote")
    .select("id")
    .eq("supplierInteractionId", supplierInteractionId);

  if (quotesError || !quotes || quotes.length === 0) {
    return { data: [], error: quotesError };
  }

  const quoteIds = quotes.map((q) => q.id);

  // Then get all purchasing RFQs linked to any of these quotes
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
    )
    .in("supplierQuoteId", quoteIds);
}

// Get sibling quotes (quotes sharing any RFQ with current quote)
export async function getSiblingQuotesForQuote(
  client: SupabaseClient<Database>,
  supplierQuoteId: string
): Promise<PostgrestResponse<LinkedSupplierQuote>> {
  // First get all RFQ IDs linked to this quote
  const { data: linkedRfqs, error: rfqError } = await client
    .from("purchasingRfqToSupplierQuote")
    .select("purchasingRfqId")
    .eq("supplierQuoteId", supplierQuoteId);

  if (rfqError || !linkedRfqs || linkedRfqs.length === 0) {
    return {
      data: [],
      error: rfqError
    } as unknown as PostgrestResponse<LinkedSupplierQuote>;
  }

  const rfqIds = linkedRfqs.map((r) => r.purchasingRfqId);

  // Get all quotes linked to any of these RFQs (excluding current quote)
  // @ts-ignore - nested select instantiation exceeds tsgo depth limit
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier(*))
    `
    )
    .in("purchasingRfqId", rfqIds)
    .neq("supplierQuoteId", supplierQuoteId);
}

// Direct Order→RFQ lookup (more efficient than going through interaction)
export async function getLinkedPurchasingRfqsForOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
) {
  return client
    .from("purchasingRfqToPurchaseOrder")
    .select(
      `
      purchasingRfqId,
      purchasingRfq:purchasingRfqId (*)
    `
    )
    .eq("purchaseOrderId", purchaseOrderId);
}

export async function getSupplierQuotesForComparison(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  // 1. Get all supplier quote IDs linked to this RFQ with supplier info
  // @ts-ignore - nested select instantiation exceeds tsgo depth limit
  const linksResult: PostgrestResponse<LinkedSupplierQuote> = await client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier(*))
    `
    )
    .eq("purchasingRfqId", purchasingRfqId);
  const { data: links, error: linksError } = linksResult;

  if (linksError || !links?.length) {
    return { data: { quotes: [], lines: [], prices: [] }, error: linksError };
  }

  // Extract all quotes (for comparison header count)
  const allQuotes = links
    .map((l) => l.supplierQuote)
    .filter((q): q is NonNullable<typeof q> => q !== null);

  if (allQuotes.length === 0) {
    return { data: { quotes: [], lines: [], prices: [] }, error: null };
  }

  // Get IDs of Active quotes only (for fetching lines/prices)
  const activeQuoteIds = allQuotes
    .filter((q) => q.status === "Active")
    .map((q) => q.id)
    .filter((id): id is string => !!id);

  // 2. Fetch lines and pricing for active quotes only (if any)
  if (activeQuoteIds.length === 0) {
    return {
      data: { quotes: allQuotes, lines: [], prices: [] },
      error: null
    };
  }

  const lines = await client
    .from("supplierQuoteLines")
    .select("*")
    .in("supplierQuoteId", activeQuoteIds);

  const prices = await client
    .from("supplierQuoteLinePrice")
    .select("*")
    .in("supplierQuoteId", activeQuoteIds);

  return {
    data: {
      quotes: allQuotes,
      lines: lines.data ?? [],
      prices: prices.data ?? []
    },
    error: lines.error || prices.error
  };
}

// Get RFQ suppliers with their supplier info
export async function getPurchasingRFQSuppliersWithLinks(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
): Promise<PostgrestResponse<PurchasingRfqSupplierWithSupplier>> {
  // @ts-ignore - nested select instantiation exceeds tsgo depth limit
  return client
    .from("purchasingRfqSupplier")
    .select("*, supplier(id, name)")
    .eq("purchasingRfqId", purchasingRfqId);
}

export type PoDefaultAttachment = {
  source: "company" | "supplier" | "item";
  name: string;
  size: number | null;
  path: string;
};

export async function getDefaultAttachmentsForPO(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    supplierId: string | null;
    itemIds: string[];
  }
): Promise<PoDefaultAttachment[]> {
  const { companyId, supplierId, itemIds } = args;

  const prefixes: { source: PoDefaultAttachment["source"]; path: string }[] = [
    { source: "company", path: `${companyId}/default-attachments/company` }
  ];
  if (supplierId) {
    prefixes.push({
      source: "supplier",
      path: `${companyId}/default-attachments/supplier/${supplierId}`
    });
  }
  for (const id of itemIds ?? []) {
    prefixes.push({
      source: "item",
      path: `${companyId}/default-attachments/item/${id}`
    });
  }

  const results = await Promise.all(
    prefixes.map(({ path }) => client.storage.from("private").list(path))
  );

  return results.flatMap((result, idx) => {
    const { source, path: prefix } = prefixes[idx];
    return (result.data ?? []).map((f) => ({
      source,
      name: f.name,
      size:
        (f.metadata as { size?: number } | null | undefined)?.size != null
          ? Math.round(
              ((f.metadata as { size?: number }).size as number) / 1024
            )
          : null,
      path: `${prefix}/${f.name}`
    }));
  });
}

// ─── Purchase Return Orders (Supplier Returns) ───

export async function getPurchaseReturnOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseReturnOrders")
    .select("*", { count: LIST_COUNT })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `purchaseReturnOrderId.ilike.%${args.search}%,supplierReference.ilike.%${args.search}%`
    );
  }

  if (args.status) {
    query = query.eq(
      "status",
      args.status as (typeof purchaseReturnOrderStatusType)[number]
    );
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function getPurchaseReturnOrder(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string
) {
  return client
    .from("purchaseReturnOrders")
    .select("*")
    .eq("id", purchaseReturnOrderId)
    .single();
}

export async function getPurchaseReturnOrderLines(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("purchaseReturnOrderLine")
    .select(
      "*, returnReason(name), item(name, readableIdWithRevision, itemTrackingType, thumbnailPath)"
    )
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .order("lineNumber");
}

export async function getPurchaseReturnOrderLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client
    .from("purchaseReturnOrderLine")
    .select("*")
    .eq("id", lineId)
    .single();
}

export async function getPurchaseReturnOrderLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineIds: string[]
) {
  return client
    .from("purchaseReturnOrderLineTrackedEntity")
    .select("*, trackedEntity(id, readableId, status, quantity)")
    .in("purchaseReturnOrderLineId", lineIds);
}

export async function insertPurchaseReturnOrder(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    purchaseReturnOrderId?: string;
    orderDate: string;
    supplierLocationId?: string;
    supplierContactId?: string;
    supplierReference?: string;
    locationId?: string;
    purchaseOrderId?: string;
    currencyCode?: string;
    expirationDate?: string;
    assignee?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; purchaseReturnOrderId: string } | null;
  error: PostgrestError | null;
}> {
  let purchaseReturnOrderId: string;
  if (input.purchaseReturnOrderId) {
    purchaseReturnOrderId = input.purchaseReturnOrderId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseReturnOrder",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate return order sequence"
          } as PostgrestError)
      };
    }
    purchaseReturnOrderId = seq.data;
  }

  let currencyCode = input.currencyCode;
  if (!currencyCode) {
    const [supplier, company] = await Promise.all([
      client
        .from("supplier")
        .select("currencyCode")
        .eq("id", input.supplierId)
        .single(),
      client
        .from("company")
        .select("baseCurrencyCode")
        .eq("id", input.companyId)
        .single()
    ]);
    currencyCode =
      supplier.data?.currencyCode ?? company.data?.baseCurrencyCode ?? "USD";
  }

  let exchangeRate = 1;
  if (currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      input.companyGroupId,
      currencyCode
    );
    if (currency.data) {
      exchangeRate = currency.data.exchangeRate ?? 1;
    }
  }

  const order = await client
    .from("purchaseReturnOrder")
    .insert({
      purchaseReturnOrderId,
      supplierId: input.supplierId,
      supplierLocationId: input.supplierLocationId,
      supplierContactId: input.supplierContactId,
      supplierReference: input.supplierReference ?? null,
      locationId: input.locationId,
      purchaseOrderId: input.purchaseOrderId,
      currencyCode,
      exchangeRate,
      orderDate: input.orderDate,
      expirationDate: input.expirationDate,
      assignee: input.assignee,
      companyId: input.companyId,
      createdBy: input.createdBy,
      customFields: input.customFields
    })
    .select("id, purchaseReturnOrderId")
    .single();

  return order;
}

export async function updatePurchaseReturnOrder(
  client: SupabaseClient<Database>,
  purchaseReturnOrder: Omit<
    z.infer<typeof purchaseReturnOrderValidator>,
    "id" | "purchaseReturnOrderId" | "status"
  > & {
    id: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  const { id, ...update } = purchaseReturnOrder;
  return client
    .from("purchaseReturnOrder")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .select("id")
    .single();
}

export async function upsertPurchaseReturnOrderLine(
  client: SupabaseClient<Database>,
  line:
    | (Omit<
        z.infer<typeof purchaseReturnOrderLineValidator>,
        "id" | "trackedEntityIds"
      > & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof purchaseReturnOrderLineValidator>,
        "id" | "trackedEntityIds"
      > & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in line) {
    const existing = await client
      .from("purchaseReturnOrderLine")
      .select("lineNumber")
      .eq("purchaseReturnOrderId", line.purchaseReturnOrderId)
      .eq("companyId", line.companyId)
      .order("lineNumber", { ascending: false })
      .limit(1)
      .maybeSingle();

    return client
      .from("purchaseReturnOrderLine")
      .insert([
        {
          ...line,
          lineNumber: (existing.data?.lineNumber ?? 0) + 1
        }
      ])
      .select("id")
      .single();
  }
  const { id, ...update } = line;
  return client
    .from("purchaseReturnOrderLine")
    .update({ ...sanitize(update), updatedAt: datetime.timestamp() })
    .eq("id", id)
    .select("id")
    .single();
}

export async function deletePurchaseReturnOrder(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string
) {
  return client
    .from("purchaseReturnOrder")
    .delete()
    .eq("id", purchaseReturnOrderId);
}

export async function deletePurchaseReturnOrderLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("purchaseReturnOrderLine").delete().eq("id", lineId);
}

export async function setPurchaseReturnOrderLineTrackedEntities(
  client: SupabaseClient<Database>,
  lineId: string,
  companyId: string,
  entityIds: string[],
  userId: string
) {
  const deleteExisting = await client
    .from("purchaseReturnOrderLineTrackedEntity")
    .delete()
    .eq("purchaseReturnOrderLineId", lineId)
    .eq("companyId", companyId);
  if (deleteExisting.error) return deleteExisting;
  if (entityIds.length === 0) return deleteExisting;

  return client.from("purchaseReturnOrderLineTrackedEntity").insert(
    entityIds.map((trackedEntityId) => ({
      purchaseReturnOrderLineId: lineId,
      trackedEntityId,
      quantity: 1,
      companyId,
      createdBy: userId
    }))
  );
}

export async function getPurchaseReturnOrderShipments(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("shipment")
    .select("id, shipmentId, status, postingDate, createdAt")
    .eq("sourceDocumentId", purchaseReturnOrderId)
    .eq("sourceDocument", "Purchase Return Order")
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

export async function getPurchaseReturnOrderCredits(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("memo")
    .select("id, memoId, status, amount, currencyCode, memoDate, postingDate")
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });
}

export async function getPurchaseReturnOrderIssues(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  return client
    .from("nonConformancePurchaseReturnOrderLine")
    .select(
      "id, purchaseReturnOrderLineId, nonConformance(id, nonConformanceId, name, status)"
    )
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId);
}

/**
 * Confirm a supplier return. The reversible-quantity cap is a transactional
 * invariant: the governing SOURCE rows (receipt/PO/invoice lines) are
 * row-locked so two concurrent confirms against the same source line
 * serialize, and the aggregates are re-read under that lock
 * (replaceInvoiceSettlements pattern).
 */
export async function confirmPurchaseReturnOrder(
  db: Kysely<KyselyDatabase>,
  { id, companyId }: { id: string; companyId: string },
  userId: string
) {
  return db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("purchaseReturnOrder")
      .select(["id", "status"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!order) throw new Error("Return order not found");
    if (order.status !== "Draft") {
      throw new Error(
        `Cannot confirm a return order in ${order.status} status`
      );
    }

    const lines = await trx
      .selectFrom("purchaseReturnOrderLine")
      .select([
        "id",
        "lineNumber",
        "quantity",
        "purchaseOrderLineId",
        "receiptLineId",
        "purchaseInvoiceLineId"
      ])
      .where("purchaseReturnOrderId", "=", id)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();

    if (lines.length === 0) {
      throw new Error("Cannot confirm a return order with no lines");
    }

    // Reversible caps, checked per source-line link under a row lock on the
    // governing source row. Blind lines (no links) skip the check.
    const checks: {
      lineNumbers: number[];
      requested: number;
      linkColumn:
        | "receiptLineId"
        | "purchaseOrderLineId"
        | "purchaseInvoiceLineId";
      linkId: string;
    }[] = [];

    const byLink = new Map<string, (typeof checks)[number]>();
    for (const line of lines) {
      const linkColumn = line.receiptLineId
        ? ("receiptLineId" as const)
        : line.purchaseOrderLineId
          ? ("purchaseOrderLineId" as const)
          : line.purchaseInvoiceLineId
            ? ("purchaseInvoiceLineId" as const)
            : null;
      if (!linkColumn) continue;
      const linkId = line[linkColumn]!;
      const key = `${linkColumn}:${linkId}`;
      const existing = byLink.get(key);
      if (existing) {
        existing.requested += Number(line.quantity);
        existing.lineNumbers.push(line.lineNumber);
      } else {
        const check = {
          lineNumbers: [line.lineNumber],
          requested: Number(line.quantity),
          linkColumn,
          linkId
        };
        byLink.set(key, check);
        checks.push(check);
      }
    }

    for (const check of checks) {
      // Lock the governing source row, then read its received base. Receipt
      // line quantities are already inventory units; PO/invoice lines are in
      // purchase units and convert via conversionFactor.
      let base = 0;
      if (check.linkColumn === "receiptLineId") {
        const src = await trx
          .selectFrom("receiptLine")
          .select(["receivedQuantity"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.receivedQuantity ?? 0);
      } else if (check.linkColumn === "purchaseOrderLineId") {
        const src = await trx
          .selectFrom("purchaseOrderLine")
          .select(["quantityReceived", "conversionFactor"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base =
          Number(src?.quantityReceived ?? 0) *
          Number(src?.conversionFactor ?? 1);
      } else {
        const src = await trx
          .selectFrom("purchaseInvoiceLine")
          .select(["quantity", "conversionFactor"])
          .where("id", "=", check.linkId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        base = Number(src?.quantity ?? 0) * Number(src?.conversionFactor ?? 1);
      }

      // Everything already authorized against this source line by OTHER
      // non-cancelled return orders (re-read under the source-row lock).
      const others = await trx
        .selectFrom("purchaseReturnOrderLine")
        .innerJoin(
          "purchaseReturnOrder",
          "purchaseReturnOrder.id",
          "purchaseReturnOrderLine.purchaseReturnOrderId"
        )
        .select(({ fn }) => [
          fn
            .coalesce(
              fn.sum("purchaseReturnOrderLine.quantity"),
              sql<number>`0`
            )
            .as("authorized")
        ])
        .where(`purchaseReturnOrderLine.${check.linkColumn}`, "=", check.linkId)
        .where("purchaseReturnOrderLine.companyId", "=", companyId)
        .where("purchaseReturnOrder.status", "!=", "Cancelled")
        .where("purchaseReturnOrder.id", "!=", id)
        .executeTakeFirst();

      const alreadyAuthorized = Number(others?.authorized ?? 0);
      const cap = base - alreadyAuthorized;
      if (check.requested > cap + EPSILON) {
        throw new Error(
          `Line ${check.lineNumbers.join(", ")}: cannot authorize ${
            check.requested
          } — only ${Math.max(0, cap)} of ${base} remains returnable for the linked document line`
        );
      }
    }

    await trx
      .updateTable("purchaseReturnOrder")
      .set({
        status: "Confirmed",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .execute();
  });
}

export async function cancelPurchaseReturnOrder(
  client: SupabaseClient<Database>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  const [order, shipments, lines] = await Promise.all([
    client
      .from("purchaseReturnOrder")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
    client
      .from("shipment")
      .select("id, status", { count: "exact", head: false })
      .eq("sourceDocumentId", id)
      .eq("sourceDocument", "Purchase Return Order")
      .eq("companyId", companyId)
      .neq("status", "Voided"),
    client
      .from("purchaseReturnOrderLine")
      .select("quantityShipped")
      .eq("purchaseReturnOrderId", id)
      .eq("companyId", companyId)
  ]);

  if (order.error) return { data: null, error: order.error };
  if (shipments.error) return { data: null, error: shipments.error };
  if (lines.error) return { data: null, error: lines.error };
  if (["Completed", "Cancelled"].includes(order.data.status)) {
    return {
      data: null,
      error: {
        message: `Cannot cancel a return order in ${order.data.status} status`
      } as PostgrestError
    };
  }
  if ((shipments.data ?? []).length > 0) {
    return {
      data: null,
      error: {
        message:
          "Cannot cancel: a shipment exists for this return order. Delete or void it first."
      } as PostgrestError
    };
  }
  if ((lines.data ?? []).some((l) => Number(l.quantityShipped) > 0)) {
    return {
      data: null,
      error: {
        message: "Cannot cancel: quantity has already been shipped"
      } as PostgrestError
    };
  }

  return client
    .from("purchaseReturnOrder")
    .update({
      status: "Cancelled",
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/**
 * Guarded manual Complete (mirrors closeIssue's blocker-collection style):
 * every non-short-closed line must be fully shipped. Supplier returns have no
 * disposition stage, so there is no disposition guard.
 */
export async function completePurchaseReturnOrder(
  client: SupabaseClient<Database>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  const [order, lines] = await Promise.all([
    client
      .from("purchaseReturnOrder")
      .select("status")
      .eq("id", id)
      .eq("companyId", companyId)
      .single(),
    client
      .from("purchaseReturnOrderLine")
      .select("lineNumber, quantity, quantityShipped, closedComplete")
      .eq("purchaseReturnOrderId", id)
      .eq("companyId", companyId)
  ]);

  if (order.error) return { data: null, error: order.error };
  if (lines.error) return { data: null, error: lines.error };
  if (
    !["Confirmed", "Partially Shipped", "Shipped"].includes(order.data.status)
  ) {
    return {
      data: null,
      error: {
        message: `Cannot complete a return order in ${order.data.status} status`
      } as PostgrestError
    };
  }

  const blockers: string[] = [];
  for (const line of lines.data ?? []) {
    const quantity = Number(line.quantity);
    const shipped = Number(line.quantityShipped);
    if (!line.closedComplete && shipped < quantity - EPSILON) {
      blockers.push(
        `Line ${line.lineNumber} is short of authorized quantity (${shipped} of ${quantity}) — ship the remainder or short-close the line`
      );
    }
  }

  if (blockers.length > 0) {
    return {
      data: null,
      error: { message: blockers.join("; ") } as PostgrestError
    };
  }

  return client
    .from("purchaseReturnOrder")
    .update({
      status: "Completed",
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", id)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

/**
 * Short-close ("stop expecting") a supplier return line — the
 * shortClosePurchaseOrderLine mechanic with the supplier-return status ladder.
 */
export async function shortClosePurchaseReturnOrderLine(
  db: Kysely<KyselyDatabase>,
  {
    lineId,
    purchaseReturnOrderId,
    companyId,
    userId,
    intent
  }: {
    lineId: string;
    purchaseReturnOrderId: string;
    companyId: string;
    userId: string;
    intent: "close" | "reopen";
  }
) {
  return db.transaction().execute(async (trx) => {
    const line = await trx
      .selectFrom("purchaseReturnOrderLine")
      .select(["id"])
      .where("id", "=", lineId)
      .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();

    if (!line) throw new Error("Return order line not found");

    await trx
      .updateTable("purchaseReturnOrderLine")
      .set({
        closedComplete: intent === "close",
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .where("id", "=", lineId)
      .where("companyId", "=", companyId)
      .execute();

    const [order, lines] = await Promise.all([
      trx
        .selectFrom("purchaseReturnOrder")
        .select(["status"])
        .where("id", "=", purchaseReturnOrderId)
        .where("companyId", "=", companyId)
        .executeTakeFirst(),
      trx
        .selectFrom("purchaseReturnOrderLine")
        .select(["quantity", "quantityShipped", "closedComplete"])
        .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
        .where("companyId", "=", companyId)
        .execute()
    ]);

    if (
      !order ||
      !["Confirmed", "Partially Shipped", "Shipped"].includes(order.status)
    ) {
      return;
    }

    const anyShipped = lines.some((l) => Number(l.quantityShipped) > EPSILON);
    const allSettled = lines.every(
      (l) =>
        l.closedComplete ||
        Number(l.quantityShipped) >= Number(l.quantity) - EPSILON
    );

    const status = anyShipped
      ? allSettled
        ? ("Shipped" as const)
        : ("Partially Shipped" as const)
      : ("Confirmed" as const);

    if (status !== order.status) {
      await trx
        .updateTable("purchaseReturnOrder")
        .set({
          status,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", purchaseReturnOrderId)
        .where("companyId", "=", companyId)
        .execute();
    }
  });
}

/**
 * "From document" picker source: posted receipt lines for the supplier with
 * their reversible remainders (received − already authorized on non-cancelled
 * supplier returns). BC's "Show Reversible Lines Only".
 */
export async function getReturnableLinesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  args?: { purchaseOrderId?: string }
) {
  let receiptsQuery = client
    .from("receipt")
    .select("id, receiptId, sourceDocumentId, sourceDocumentReadableId")
    .eq("companyId", companyId)
    .eq("supplierId", supplierId)
    .eq("sourceDocument", "Purchase Order")
    .eq("status", "Posted");

  if (args?.purchaseOrderId) {
    receiptsQuery = receiptsQuery.eq("sourceDocumentId", args.purchaseOrderId);
  }

  const receipts = await receiptsQuery;
  if (receipts.error) return { data: null, error: receipts.error };
  const receiptIds = (receipts.data ?? []).map((r) => r.id);
  if (receiptIds.length === 0) {
    return { data: [], error: null };
  }
  const receiptById = new Map((receipts.data ?? []).map((r) => [r.id, r]));

  const receiptLines = await client
    .from("receiptLine")
    .select(
      "id, receiptId, lineId, itemId, receivedQuantity, unitOfMeasure, item(name, readableIdWithRevision, itemTrackingType)"
    )
    .in("receiptId", receiptIds)
    .eq("companyId", companyId);
  if (receiptLines.error) return { data: null, error: receiptLines.error };

  const receiptLineIds = (receiptLines.data ?? []).map((l) => l.id);
  if (receiptLineIds.length === 0) {
    return { data: [], error: null };
  }

  // Commercial basis comes from the linked purchase order line, converted to
  // inventory units (PO line prices are per purchase unit).
  const purchaseOrderLineIds = [
    ...new Set(
      (receiptLines.data ?? []).map((l) => l.lineId).filter(Boolean) as string[]
    )
  ];

  const [authorized, purchaseOrderLines] = await Promise.all([
    client
      .from("purchaseReturnOrderLine")
      .select("receiptLineId, quantity, purchaseReturnOrder!inner(status)")
      .in("receiptLineId", receiptLineIds)
      .eq("companyId", companyId)
      .neq("purchaseReturnOrder.status", "Cancelled"),
    purchaseOrderLineIds.length > 0
      ? client
          .from("purchaseOrderLine")
          .select("id, supplierUnitPrice, conversionFactor")
          .in("id", purchaseOrderLineIds)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (authorized.error) return { data: null, error: authorized.error };
  if (purchaseOrderLines.error) {
    return { data: null, error: purchaseOrderLines.error };
  }

  const authorizedByReceiptLine = new Map<string, number>();
  for (const row of authorized.data ?? []) {
    if (!row.receiptLineId) continue;
    authorizedByReceiptLine.set(
      row.receiptLineId,
      (authorizedByReceiptLine.get(row.receiptLineId) ?? 0) +
        Number(row.quantity)
    );
  }

  const purchaseOrderLineById = new Map(
    (purchaseOrderLines.data ?? []).map((l) => [l.id, l])
  );

  const rows = (receiptLines.data ?? [])
    .map((line) => {
      const received = Number(line.receivedQuantity ?? 0);
      const alreadyReturned = authorizedByReceiptLine.get(line.id) ?? 0;
      const poLine = line.lineId
        ? purchaseOrderLineById.get(line.lineId)
        : null;
      const receipt = receiptById.get(line.receiptId);
      return {
        receiptLineId: line.id,
        receiptReadableId: receipt?.receiptId ?? "",
        purchaseOrderReadableId: receipt?.sourceDocumentReadableId ?? "",
        purchaseOrderLineId: line.lineId,
        itemId: line.itemId,
        itemReadableId: line.item?.readableIdWithRevision ?? "",
        itemName: line.item?.name ?? "",
        itemTrackingType: line.item?.itemTrackingType ?? "Inventory",
        receivedQuantity: received,
        alreadyReturned,
        returnableQuantity: Math.max(0, received - alreadyReturned),
        // supplierUnitPrice: the return order + credit memo are in the
        // supplier's currency; unitPrice is the base-currency generated column
        unitPrice:
          Number(poLine?.supplierUnitPrice ?? 0) /
          Number(poLine?.conversionFactor ?? 1),
        unitOfMeasureCode: line.unitOfMeasure
      };
    })
    .filter((row) => row.returnableQuantity > EPSILON);

  return { data: rows, error: null };
}

/**
 * Entity picker source for supplier return lines: serials/batches on hand
 * that were received from this supplier. Provenance is the Receipt attribute
 * (written by the receipt tracking route) resolved to the receipt's supplier
 * — no code writes a Supplier attribute onto tracked entities.
 */
export async function getReturnableEntitiesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  itemId: string
) {
  const receipts = await client
    .from("receipt")
    .select("id")
    .eq("companyId", companyId)
    .eq("supplierId", supplierId)
    .eq("status", "Posted");
  if (receipts.error) {
    return { data: null, error: receipts.error };
  }
  const receiptIds = (receipts.data ?? []).map((r) => r.id);
  if (receiptIds.length === 0) {
    return { data: [], error: null };
  }
  return client
    .from("trackedEntity")
    .select("id, readableId, quantity, status, attributes")
    .eq("companyId", companyId)
    .eq("itemId", itemId)
    .eq("status", "Available")
    .in("attributes ->> Receipt", receiptIds);
}

/**
 * Per-line creditable pool = shipped − already credited. Draft memos count
 * against the pool (two Drafts must not double-credit); the VIEW's displayed
 * quantityCredited still derives from Posted memos only.
 */
export async function getCreditableQuantitiesForPurchaseReturn(
  client: SupabaseClient<Database>,
  purchaseReturnOrderId: string,
  companyId: string
) {
  const lines = await client
    .from("purchaseReturnOrderLine")
    .select("id, lineNumber, quantityShipped, unitPrice, restockFeePercent")
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .order("lineNumber");
  if (lines.error) return { data: null, error: lines.error };
  const lineIds = (lines.data ?? []).map((l) => l.id);
  if (lineIds.length === 0) return { data: [], error: null };

  const credits = await client
    .from("purchaseReturnOrderCreditLine")
    .select("purchaseReturnOrderLineId, quantity, memo!inner(status)")
    .in("purchaseReturnOrderLineId", lineIds)
    .eq("companyId", companyId)
    .neq("memo.status", "Voided");
  if (credits.error) return { data: null, error: credits.error };

  const creditedByLine = new Map<string, number>();
  for (const row of credits.data ?? []) {
    creditedByLine.set(
      row.purchaseReturnOrderLineId,
      (creditedByLine.get(row.purchaseReturnOrderLineId) ?? 0) +
        Number(row.quantity)
    );
  }

  return {
    data: (lines.data ?? []).map((line) => {
      const shipped = Number(line.quantityShipped);
      const credited = creditedByLine.get(line.id) ?? 0;
      return {
        purchaseReturnOrderLineId: line.id,
        lineNumber: line.lineNumber,
        quantityShipped: shipped,
        quantityCredited: credited,
        creditableQuantity: Math.max(0, shipped - credited),
        unitPrice: Number(line.unitPrice),
        restockFeePercent: Number(line.restockFeePercent)
      };
    }),
    error: null
  };
}

/**
 * Issue supplier credit: one AP memo + per-line purchaseReturnOrderCreditLine
 * breakdown. Cap = shipped − already credited over NON-VOIDED memos,
 * validated under a row lock. Amount rounded once at the currency's
 * decimals. Returns the memo id.
 *
 * The memo is a **Debit** memo (the `debitMemo` DR- sequence), NOT a Credit
 * memo. `direction` alone decides the control side for both AR and AP
 * (`buildMemoJournal`): a Credit memo CREDITS the control account, which on
 * AP — a liability — would INCREASE what we owe the supplier. Returning goods
 * must reduce it, so the control leg has to be a debit. That also makes the
 * reason leg CREDIT GRNI, clearing the debit the return shipment posted
 * (DR GRNI / CR Inventory) so the suspense account nets to zero over the
 * cycle. Net effect: DR AP / CR Inventory, which is the SAP/NetSuite/D365
 * vendor-return pattern. The sales side is the mirror image and correctly
 * stays `Credit` (crediting AR, an asset, reduces it).
 *
 * The rest of invoicing already assumes this: `getAvailableCredits` and
 * `getCompanyHasOpenCredits` select supplier memos with
 * `direction = "Debit"`, so a Credit-direction memo here is also invisible to
 * "Apply Credit" on a supplier invoice.
 */
export async function createPurchaseReturnOrderCredit(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    purchaseReturnOrderId,
    companyId,
    companyGroupId,
    userId,
    memoDate,
    lines
  }: {
    purchaseReturnOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
    memoDate: string;
    lines: { purchaseReturnOrderLineId: string; quantity: number }[];
  }
) {
  const order = await client
    .from("purchaseReturnOrder")
    .select(
      "id, status, supplierId, currencyCode, exchangeRate, purchaseReturnOrderId"
    )
    .eq("id", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .single();
  if (order.error) throw new Error("Return order not found");
  if (["Draft", "Cancelled"].includes(order.data.status)) {
    throw new Error(
      `Cannot issue credit for a return order in ${order.data.status} status`
    );
  }

  const currency = await getCurrencyByCode(
    client,
    companyGroupId,
    order.data.currencyCode
  );
  const decimalPlaces = currency.data?.decimalPlaces ?? 2;

  const seq = await client.rpc("get_next_sequence", {
    sequence_name: "debitMemo",
    company_id: companyId
  });
  if (seq.error || !seq.data) {
    throw new Error("Failed to allocate debit memo number");
  }
  const memoId = seq.data;

  const requested = new Map(
    lines
      .filter((l) => l.quantity > 0)
      .map((l) => [l.purchaseReturnOrderLineId, l.quantity])
  );
  if (requested.size === 0) {
    throw new Error("Nothing to credit");
  }

  return db.transaction().execute(async (trx) => {
    const orderLines = await trx
      .selectFrom("purchaseReturnOrderLine")
      .select([
        "id",
        "lineNumber",
        "quantityShipped",
        "unitPrice",
        "restockFeePercent"
      ])
      .where("purchaseReturnOrderId", "=", purchaseReturnOrderId)
      .where("companyId", "=", companyId)
      .where("id", "in", [...requested.keys()])
      .forUpdate()
      .execute();

    if (orderLines.length !== requested.size) {
      throw new Error(
        "One or more credit lines do not belong to this return order"
      );
    }

    const credited = await trx
      .selectFrom("purchaseReturnOrderCreditLine")
      .innerJoin("memo", "memo.id", "purchaseReturnOrderCreditLine.memoId")
      .select(({ fn }) => [
        "purchaseReturnOrderCreditLine.purchaseReturnOrderLineId",
        fn
          .coalesce(
            fn.sum("purchaseReturnOrderCreditLine.quantity"),
            sql<number>`0`
          )
          .as("credited")
      ])
      .where("purchaseReturnOrderCreditLine.purchaseReturnOrderLineId", "in", [
        ...requested.keys()
      ])
      .where("purchaseReturnOrderCreditLine.companyId", "=", companyId)
      .where("memo.status", "!=", "Voided")
      .groupBy("purchaseReturnOrderCreditLine.purchaseReturnOrderLineId")
      .execute();
    const creditedByLine = new Map(
      credited.map((row) => [
        row.purchaseReturnOrderLineId,
        Number(row.credited)
      ])
    );

    let total = 0;
    const creditLineValues: {
      memoId: string;
      purchaseReturnOrderLineId: string;
      quantity: number;
      unitPrice: number;
      restockFee: number;
      companyId: string;
      createdBy: string;
    }[] = [];

    for (const line of orderLines) {
      const quantity = requested.get(line.id)!;
      const shipped = Number(line.quantityShipped ?? 0);
      const alreadyCredited = creditedByLine.get(line.id) ?? 0;
      const creditable = shipped - alreadyCredited;
      if (quantity > creditable + EPSILON) {
        throw new Error(
          `Line ${line.lineNumber}: cannot credit ${quantity} — only ${Math.max(
            0,
            creditable
          )} of ${shipped} shipped remains creditable`
        );
      }
      const unitPrice = Number(line.unitPrice ?? 0);
      const feePercent = Number(line.restockFeePercent ?? 0);
      const gross = quantity * unitPrice;
      const restockFee = gross * feePercent;
      total += gross - restockFee;
      creditLineValues.push({
        memoId: "",
        purchaseReturnOrderLineId: line.id,
        quantity,
        unitPrice,
        restockFee,
        companyId,
        createdBy: userId
      });
    }

    if (total <= 0) {
      throw new Error("Credit amount must be positive");
    }

    const memo = await trx
      .insertInto("memo")
      .values({
        memoId,
        direction: "Debit",
        status: "Draft",
        supplierId: order.data.supplierId,
        memoDate,
        currencyCode: order.data.currencyCode,
        exchangeRate: order.data.exchangeRate ?? 1,
        amount: round(total, decimalPlaces),
        reference: order.data.purchaseReturnOrderId,
        purchaseReturnOrderId,
        companyId,
        createdBy: userId
      })
      .returning(["id"])
      .executeTakeFirstOrThrow();

    await trx
      .insertInto("purchaseReturnOrderCreditLine")
      .values(creditLineValues.map((v) => ({ ...v, memoId: memo.id })))
      .execute();

    return memo.id;
  });
}

/**
 * Create Replacement Purchase Order: a draft PO from the return lines,
 * priced from the linked PO line (purchase-UOM price + conversion factor
 * copied) else the supplierPart default. One replacement per return.
 */
export async function createReplacementPurchaseOrder(
  client: SupabaseClient<Database>,
  {
    purchaseReturnOrderId,
    companyId,
    companyGroupId,
    userId
  }: {
    purchaseReturnOrderId: string;
    companyId: string;
    companyGroupId: string;
    userId: string;
  }
): Promise<{
  data: { id: string } | null;
  error: PostgrestError | null;
}> {
  const order = await client
    .from("purchaseReturnOrder")
    .select("*")
    .eq("id", purchaseReturnOrderId)
    .eq("companyId", companyId)
    .single();
  if (order.error) return { data: null, error: order.error };
  if (["Draft", "Cancelled"].includes(order.data.status)) {
    return {
      data: null,
      error: {
        message: `Cannot create a replacement for a ${order.data.status} return order`
      } as PostgrestError
    };
  }
  if (order.data.replacementPurchaseOrderId) {
    return {
      data: { id: order.data.replacementPurchaseOrderId },
      error: null
    };
  }

  const lines = await client
    .from("purchaseReturnOrderLine")
    .select("*, item(type)")
    .eq("purchaseReturnOrderId", purchaseReturnOrderId)
    .eq("companyId", companyId);
  if (lines.error) return { data: null, error: lines.error };
  if ((lines.data ?? []).length === 0) {
    return {
      data: null,
      error: { message: "Return order has no lines" } as PostgrestError
    };
  }

  const linkedPoLineIds = (lines.data ?? [])
    .map((l) => l.purchaseOrderLineId)
    .filter(Boolean) as string[];
  const poLines =
    linkedPoLineIds.length > 0
      ? await client
          .from("purchaseOrderLine")
          .select(
            "id, supplierUnitPrice, conversionFactor, purchaseUnitOfMeasureCode, inventoryUnitOfMeasureCode"
          )
          .in("id", linkedPoLineIds)
          .eq("companyId", companyId)
      : { data: [], error: null };
  if (poLines.error) return { data: null, error: poLines.error };
  const poLineById = new Map((poLines.data ?? []).map((l) => [l.id, l]));

  const supplierParts = await client
    .from("supplierPart")
    .select("itemId, unitPrice, conversionFactor, supplierUnitOfMeasureCode")
    .eq("supplierId", order.data.supplierId)
    .eq("companyId", companyId)
    .in(
      "itemId",
      (lines.data ?? []).map((l) => l.itemId)
    );
  if (supplierParts.error) {
    return { data: null, error: supplierParts.error };
  }
  const supplierPartByItem = new Map(
    (supplierParts.data ?? []).map((sp) => [sp.itemId, sp])
  );

  const purchaseOrder = await insertPurchaseOrder(client, {
    supplierId: order.data.supplierId,
    companyId,
    companyGroupId,
    createdBy: userId,
    currencyCode: order.data.currencyCode,
    locationId: order.data.locationId ?? undefined,
    supplierContactId: order.data.supplierContactId ?? undefined,
    supplierLocationId: order.data.supplierLocationId ?? undefined,
    supplierReference: order.data.purchaseReturnOrderId
  });
  if (purchaseOrder.error || !purchaseOrder.data) {
    return { data: null, error: purchaseOrder.error };
  }
  const purchaseOrderId = purchaseOrder.data.id;

  const lineTypeFor = (
    itemType: string | null | undefined
  ): Database["public"]["Enums"]["purchaseOrderLineType"] => {
    switch (itemType) {
      case "Part":
      case "Material":
      case "Tool":
      case "Consumable":
      case "Service":
        return itemType;
      default:
        return "Part";
    }
  };

  const replacementLines = (lines.data ?? []).map((line) => {
    const poLine = line.purchaseOrderLineId
      ? poLineById.get(line.purchaseOrderLineId)
      : null;
    const supplierPart = supplierPartByItem.get(line.itemId);
    const conversionFactor = Number(
      poLine?.conversionFactor ?? supplierPart?.conversionFactor ?? 1
    );
    // supplierUnitPrice is the supplier-currency figure; the PO line's
    // unitPrice generated column is base currency and would double-convert
    const unitPrice = Number(
      poLine?.supplierUnitPrice ??
        supplierPart?.unitPrice ??
        Number(line.unitPrice) * conversionFactor
    );
    const purchaseQuantity =
      conversionFactor > 0
        ? Number(line.quantity) / conversionFactor
        : Number(line.quantity);

    return {
      purchaseOrderId,
      purchaseOrderLineType: lineTypeFor(line.item?.type),
      itemId: line.itemId,
      purchaseQuantity,
      supplierUnitPrice: unitPrice,
      conversionFactor,
      purchaseUnitOfMeasureCode:
        poLine?.purchaseUnitOfMeasureCode ??
        supplierPart?.supplierUnitOfMeasureCode ??
        line.unitOfMeasureCode,
      inventoryUnitOfMeasureCode:
        poLine?.inventoryUnitOfMeasureCode ?? line.unitOfMeasureCode,
      companyId,
      createdBy: userId
    };
  });

  const insertLines = await client
    .from("purchaseOrderLine")
    .insert(replacementLines);
  if (insertLines.error) {
    await deletePurchaseOrder(client, purchaseOrderId);
    return { data: null, error: insertLines.error };
  }

  const link = await client
    .from("purchaseReturnOrder")
    .update({
      replacementPurchaseOrderId: purchaseOrderId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", purchaseReturnOrderId)
    .eq("companyId", companyId);
  if (link.error) return { data: null, error: link.error };

  return { data: { id: purchaseOrderId }, error: null };
}
