import { fetchAllFromTable, type Database, type Json } from "@carbon/database";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import {
  FunctionRegion,
  type PostgrestError,
  type PostgrestSingleResponse,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { z } from "zod";
import { getEmployeeJob } from "~/modules/people";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting";
import type {
  operationParameterValidator,
  operationStepValidator,
  operationToolValidator,
} from "../shared";
import { upsertExternalLink } from "../shared/shared.service";
import type {
  customerAccountingValidator,
  customerContactValidator,
  customerPaymentValidator,
  customerShippingValidator,
  customerStatusValidator,
  customerTypeValidator,
  customerValidator,
  getMethodValidator,
  noQuoteReasonValidator,
  quoteLineAdditionalChargesValidator,
  quoteLineValidator,
  quoteMaterialValidator,
  quoteOperationValidator,
  quotePaymentValidator,
  quoteShipmentValidator,
  quoteStatusType,
  quoteValidator,
  salesOrderLineValidator,
  salesOrderPaymentValidator,
  salesOrderShipmentValidator,
  salesOrderStatusType,
  salesOrderValidator,
  salesRfqLineValidator,
  salesRFQStatusType,
  salesRfqValidator,
  selectedLinesValidator,
} from "./sales.models";
import type { Quotation, SalesOrder, SalesRFQ } from "./types";

export async function closeSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  userId: string
) {
  return client
    .from("salesOrder")
    .update({
      closed: true,
      closedAt: today(getLocalTimeZone()).toString(),
      closedBy: userId,
    })
    .eq("id", salesOrderId)
    .select("id")
    .single();
}

export async function convertSalesRfqToQuote(
  client: SupabaseClient<Database>,
  payload: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "salesRfqToQuote",
      ...payload,
    },
    region: FunctionRegion.UsEast1,
  });
}

export async function convertQuoteToOrder(
  client: SupabaseClient<Database>,
  payload: {
    id: string;
    selectedLines: z.infer<typeof selectedLinesValidator>;
    companyId: string;
    purchaseOrderNumber?: string;
    userId: string;
    digitalQuoteAcceptedBy?: string;
    digitalQuoteAcceptedByEmail?: string;
  }
) {
  return client.functions.invoke<{ convertedId: string }>("convert", {
    body: {
      type: "quoteToSalesOrder",
      ...payload,
    },
    region: FunctionRegion.UsEast1,
  });
}

export async function copyQuoteLine(
  client: SupabaseClient<Database>,
  payload: z.infer<typeof getMethodValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ copiedId: string }>("get-method", {
    body: {
      ...payload,
      type: "quoteLineToQuoteLine",
    },
    region: FunctionRegion.UsEast1,
  });
}

export async function copyQuote(
  client: SupabaseClient<Database>,
  payload: Omit<z.infer<typeof getMethodValidator>, "type"> & {
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke<{ newQuoteId: string }>("get-method", {
    body: {
      ...payload,
      type: "quoteToQuote",
    },
    region: FunctionRegion.UsEast1,
  });
}
export async function deleteCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customer").delete().eq("id", customerId);
}

export async function deleteCustomerContact(
  client: SupabaseClient<Database>,
  customerId: string,
  customerContactId: string
) {
  const customerContact = await client
    .from("customerContact")
    .select("contactId")
    .eq("customerId", customerId)
    .eq("id", customerContactId)
    .single();
  if (customerContact.data) {
    const contactDelete = await client
      .from("contact")
      .delete()
      .eq("id", customerContact.data.contactId);

    if (contactDelete.error) {
      return contactDelete;
    }
  }

  return customerContact;
}

export async function deleteCustomerLocation(
  client: SupabaseClient<Database>,
  customerId: string,
  customerLocationId: string
) {
  const { data: customerLocation } = await client
    .from("customerLocation")
    .select("addressId")
    .eq("customerId", customerId)
    .eq("id", customerLocationId)
    .single();

  if (customerLocation?.addressId) {
    return client.from("address").delete().eq("id", customerLocation.addressId);
  } else {
    // The customerLocation should always have an addressId, but just in case
    return client
      .from("customerLocation")
      .delete()
      .eq("customerId", customerId)
      .eq("id", customerLocationId);
  }
}

export async function deleteCustomerStatus(
  client: SupabaseClient<Database>,
  customerStatusId: string
) {
  return client.from("customerStatus").delete().eq("id", customerStatusId);
}

export async function deleteCustomerType(
  client: SupabaseClient<Database>,
  customerTypeId: string
) {
  return client.from("customerType").delete().eq("id", customerTypeId);
}

export async function deleteNoQuoteReason(
  client: SupabaseClient<Database>,
  noQuoteReasonId: string
) {
  return client.from("noQuoteReason").delete().eq("id", noQuoteReasonId);
}

export async function deleteQuote(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quote").delete().eq("id", quoteId);
}

export async function deleteQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client.from("quoteMakeMethod").delete().eq("id", quoteMakeMethodId);
}

export async function deleteQuoteLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client.from("quoteLine").delete().eq("id", quoteLineId);
}

export async function deleteQuoteMaterial(
  client: SupabaseClient<Database>,
  quoteMaterialId: string
) {
  return client.from("quoteMaterial").delete().eq("id", quoteMaterialId);
}

export async function deleteQuoteOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string
) {
  return client.from("quoteOperation").delete().eq("id", quoteOperationId);
}

export async function deleteQuoteOperationStep(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("quoteOperationStep").delete().eq("id", id);
}

export async function deleteQuoteOperationParameter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("quoteOperationParameter").delete().eq("id", id);
}

export async function deleteQuoteOperationTool(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("quoteOperationTool").delete().eq("id", id);
}

export async function deleteSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrder").delete().eq("id", salesOrderId);
}

export async function deleteSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client.from("salesOrderLine").delete().eq("id", salesOrderLineId);
}

export async function deleteSalesRFQ(
  client: SupabaseClient<Database>,
  salesRfqId: string
) {
  return client.from("salesRfq").delete().eq("id", salesRfqId);
}

export async function deleteSalesRFQLine(
  client: SupabaseClient<Database>,
  salesRFQLineId: string
) {
  return client.from("salesRfqLine").delete().eq("id", salesRFQLineId);
}

export async function getConfigurationParametersByQuoteLineId(
  client: SupabaseClient<Database>,
  quoteLineId: string,
  companyId: string
) {
  const quoteLine = await client
    .from("quoteLine")
    .select("itemId")
    .eq("id", quoteLineId)
    .single();

  if (quoteLine.error || !quoteLine.data) {
    return { groups: [], parameters: [] };
  }

  const [parameters, groups] = await Promise.all([
    client
      .from("configurationParameter")
      .select("*")
      .eq("itemId", quoteLine.data.itemId)
      .eq("companyId", companyId),
    client
      .from("configurationParameterGroup")
      .select("*")
      .eq("itemId", quoteLine.data.itemId)
      .eq("companyId", companyId),
  ]);

  if (parameters.error) {
    console.error(parameters.error);
    return { groups: [], parameters: [] };
  }

  if (groups.error) {
    console.error(groups.error);
    return { groups: [], parameters: [] };
  }

  return { groups: groups.data ?? [], parameters: parameters.data ?? [] };
}

export async function getCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customers").select("*").eq("id", customerId).single();
}

export async function getCustomerContact(
  client: SupabaseClient<Database>,
  customerContactId: string
) {
  return client
    .from("customerContact")
    .select(
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes)"
    )
    .eq("id", customerContactId)
    .single();
}

export async function getCustomerContacts(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerContact")
    .select(
      "*, contact(id, fullName, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
    )
    .eq("customerId", customerId);
}

export async function getCustomerLocation(
  client: SupabaseClient<Database>,
  customerLocationId: string
) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, countryCode, country(alpha2, name), postalCode)"
    )
    .eq("id", customerLocationId)
    .single();
}

export async function getCustomerLocations(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
    )
    .eq("customerId", customerId);
}

export async function getCustomerPayment(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerPayment")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

export async function getCustomerShipping(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerShipping")
    .select("*")
    .eq("customerId", customerId)
    .single();
}

export async function getCustomers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("customers")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
  ]);
  return query;
}

export async function getCustomersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    name: string;
  }>(client, "customer", "id, name", (query) =>
    query.eq("companyId", companyId).order("name")
  );
}

export async function getCustomerStatus(
  client: SupabaseClient<Database>,
  customerStatusId: string
) {
  return client
    .from("customerStatus")
    .select("*")
    .eq("id", customerStatusId)
    .single();
}

export async function getCustomerStatuses(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("customerStatus")
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

export async function getCustomerStatusesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("customerStatus")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getCustomerType(
  client: SupabaseClient<Database>,
  customerTypeId: string
) {
  return client
    .from("customerType")
    .select("*")
    .eq("id", customerTypeId)
    .single();
}

export async function getCustomerTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("customerType")
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

export async function getCustomerTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("customerType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getExternalSalesOrderLines(
  client: SupabaseClient<Database>,
  customerId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client.rpc(
    "get_sales_order_lines_by_customer_id",
    { customer_id: customerId },
    {
      count: "exact",
    }
  );

  if (args.search) {
    query = query.or(
      `readableId.ilike.%${args.search}%,customerReference.ilike.%${args.search}%,salesOrderId.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "orderDate", ascending: true },
    ]);
  }

  return query;
}

export async function getModelByQuoteLineId(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  const quoteLine = await client
    .from("quoteLine")
    .select("itemId")
    .eq("id", quoteLineId)
    .single();

  if (!quoteLine.data) return null;

  const item = await client
    .from("item")
    .select("id, type, modelUploadId")
    .eq("id", quoteLine.data.itemId)
    .single();

  if (!item.data || !item.data.modelUploadId) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelPath: null,
    };
  }

  const model = await client
    .from("modelUpload")
    .select("*")
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  if (!model.data) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelSize: null,
    };
  }

  return {
    itemId: item.data!.id,
    type: item.data!.type,
    ...model.data,
  };
}

export async function getNoQuoteReasonsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("noQuoteReason")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getNoQuoteReason(
  client: SupabaseClient<Database>,
  noQuoteReasonId: string
) {
  return client
    .from("noQuoteReason")
    .select("*")
    .eq("id", noQuoteReasonId)
    .single();
}

export async function getNoQuoteReasons(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("noQuoteReason")
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

export async function getOpportunity(
  client: SupabaseClient<Database>,
  opportunityId: string | null
): Promise<
  PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchaseOrderDocumentPath: string;
    requestForQuoteDocumentPath: string;
    salesRfqs: SalesRFQ[];
    quotes: Quotation[];
    salesOrders: SalesOrder[];
  } | null>
> {
  if (!opportunityId) {
    // @ts-expect-error
    return {
      data: null,
      error: null,
    };
  }

  const response = await client.rpc("get_opportunity_with_related_records", {
    opportunity_id: opportunityId,
  });

  return {
    data: response.data?.[0],
    error: response.error,
  } as unknown as PostgrestSingleResponse<{
    id: string;
    companyId: string;
    purchaseOrderDocumentPath: string;
    requestForQuoteDocumentPath: string;
    salesRfqs: SalesRFQ[];
    quotes: Quotation[];
    salesOrders: SalesOrder[];
  }>;
}

export async function getOpportunityDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  opportunityId: string
) {
  const result = await client.storage
    .from("private")
    .list(`${companyId}/opportunity/${opportunityId}`);

  return result.data?.map((f) => ({ ...f, bucket: "opportunity" })) ?? [];
}

export async function getOpportunityLineDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  lineId: string,
  itemId?: string | null
) {
  const [opportunityLineResult, itemResult] = await Promise.all([
    client.storage
      .from("private")
      .list(`${companyId}/opportunity-line/${lineId}`),
    itemId
      ? client.storage.from("private").list(`${companyId}/parts/${itemId}`)
      : Promise.resolve({ data: [] }),
  ]);

  const opportunityLineDocs =
    opportunityLineResult.data?.map((f) => ({
      ...f,
      bucket: "opportunity-line",
    })) ?? [];
  const itemDocs =
    itemResult.data?.map((f) => ({ ...f, bucket: "parts" })) ?? [];

  return [...opportunityLineDocs, ...itemDocs];
}

export async function getQuote(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quotes").select("*").eq("id", quoteId).single();
}

export async function getQuoteFavorites(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client
    .from("quoteFavorite")
    .select("*")
    .eq("companyId", companyId)
    .eq("userId", userId);
}

export async function getQuotes(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("quotes")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `quoteId.ilike.%${args.search}%,name.ilike.%${args.search}%,customerReference.ilike%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "quoteId", ascending: false },
  ]);
  return query;
}

export async function getQuotesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    quoteId: string;
    revisionId: string;
  }>(client, "quote", "id, quoteId, revisionId", (query) =>
    query.eq("companyId", companyId).order("createdAt", { ascending: false })
  );
}

export async function getQuoteAssembliesByLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteMakeMethod")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteAssemblies(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteMakeMethod").select("*").eq("quoteId", quoteId);
}

export async function getQuoteCustomerDetails(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteCustomerDetails")
    .select("*")
    .eq("quoteId", quoteId)
    .single();
}

export async function getQuoteLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client.from("quoteLines").select("*").eq("id", quoteLineId).single();
}

export async function getQuoteLinesList(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLine")
    .select("id, description, ...item(readableIdWithRevision)")
    .eq("quoteId", quoteId);
}

type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTreeArray>>["data"]
>[number];
type QuoteMethodTreeItem = {
  id: string;
  data: QuoteMethod;
  children: QuoteMethodTreeItem[];
};

export async function getQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteMakeMethod")
    .select("*, ...item(itemType:type)")
    .eq("id", quoteMakeMethodId)
    .single();
}

export async function getQuoteMethodTrees(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  const items = await getQuoteMethodTreeArray(client, quoteId);
  if (items.error) return items;

  const tree = getQuoteMethodTreeArrayToTree(items.data);

  return {
    data: tree,
    error: null,
  };
}

export async function getQuoteMethodTreeArray(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.rpc("get_quote_methods", {
    qid: quoteId,
  });
}

function getQuoteMethodTreeArrayToTree(
  items: QuoteMethod[]
): QuoteMethodTreeItem[] {
  // function traverseAndRenameIds(node: QuoteMethodTreeItem) {
  //   const clone = structuredClone(node);
  //   clone.id = `node-${Math.random().toString(16).slice(2)}`;
  //   clone.children = clone.children.map((n) => traverseAndRenameIds(n));
  //   return clone;
  // }

  const rootItems: QuoteMethodTreeItem[] = [];
  const lookup: { [id: string]: QuoteMethodTreeItem } = {};

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

export async function getQuoteLines(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLines")
    .select("*")
    .eq("quoteId", quoteId)
    .order("itemReadableId", { ascending: true });
}

export async function getQuoteByExternalId(
  client: SupabaseClient<Database>,
  externalId: string
) {
  return client
    .from("quote")
    .select("*")
    .eq("externalLinkId", externalId)
    .single();
}

export async function getQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteLinePricesByQuoteId(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteId", quoteId)
    .order("quoteLineId", { ascending: true });
}

export async function getQuoteLinePricesByItemId(
  client: SupabaseClient<Database>,
  itemId: string,
  currentQuoteId: string
) {
  return client
    .from("quoteLinePrices")
    .select("*")
    .eq("itemId", itemId)
    .neq("quoteId", currentQuoteId)
    .order("quoteCreatedAt", { ascending: false })
    .order("qty", { ascending: true });
}

export async function getQuoteLinePricesByItemIds(
  client: SupabaseClient<Database>,
  itemIds: string[],
  currentQuoteId: string
) {
  return client
    .from("quoteLinePrices")
    .select("*")
    .in("itemId", itemIds)
    .neq("quoteId", currentQuoteId)
    .order("quoteCreatedAt", { ascending: false })
    .order("qty", { ascending: true })
    .limit(10);
}

export async function getQuoteMaterials(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteMaterial").select("*").eq("quoteId", quoteId);
}

export async function getQuoteMaterial(
  client: SupabaseClient<Database>,
  materialId: string
) {
  return client
    .from("quoteMaterialWithMakeMethodId")
    .select("*")
    .eq("id", materialId)
    .single();
}

export async function getQuoteMaterialsByLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteMaterial")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteMaterialsByMethodId(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteMaterial")
    .select("*, item(name, itemTrackingType)")
    .eq("quoteMakeMethodId", quoteMakeMethodId)
    .order("order", { ascending: true });
}

export async function getQuoteMaterialsByOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string
) {
  return client
    .from("quoteMaterial")
    .select("*")
    .eq("quoteOperationId", quoteOperationId);
}

export async function getQuoteOperation(
  client: SupabaseClient<Database>,
  quoteOperationId: string
) {
  return client
    .from("quoteOperation")
    .select("*")
    .eq("id", quoteOperationId)
    .single();
}

export async function getQuoteOperationsByLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteOperation")
    .select("*")
    .eq("quoteLineId", quoteLineId);
}

export async function getQuoteOperationsByMethodId(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteOperation")
    .select(
      "*, quoteOperationTool(*), quoteOperationParameter(*), quoteOperationStep(*)"
    )
    .eq("quoteMakeMethodId", quoteMakeMethodId)
    .order("order", { ascending: true });
}

export async function getQuoteOperations(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteOperation").select("*").eq("quoteId", quoteId);
}

export async function getQuotePayment(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quotePayment").select("*").eq("id", quoteId).single();
}

export async function getQuoteShipment(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteShipment").select("*").eq("id", quoteId).single();
}

export async function getRelatedPricesForQuoteLine(
  client: SupabaseClient<Database>,
  itemId: string,
  quoteId: string
) {
  const item = await client
    .rpc("get_part_details", {
      item_id: itemId,
    })
    .single();

  const itemIds = (item.data?.revisions as { id: string }[])?.map(
    (revision) => revision.id
  ) ?? [itemId];

  const [historicalQuoteLinePrices, relatedSalesOrderLines] = await Promise.all(
    [
      getQuoteLinePricesByItemIds(client, itemIds, quoteId),
      getSalesOrderLinesByItemIds(client, itemIds),
    ]
  );

  return {
    historicalQuoteLinePrices: historicalQuoteLinePrices.data,
    relatedSalesOrderLines: relatedSalesOrderLines.data,
  };
}

export async function getSalesDocumentsAssignedToMe(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const [salesOrders, quotes, rfqs] = await Promise.all([
    client
      .from("salesOrder")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("quote")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
    client
      .from("salesRfq")
      .select("*")
      .eq("assignee", userId)
      .eq("companyId", companyId),
  ]);

  const merged = [
    ...(salesOrders.data?.map((doc) => ({ ...doc, type: "salesOrder" })) ?? []),
    ...(quotes.data?.map((doc) => ({ ...doc, type: "quote" })) ?? []),
    ...(rfqs.data?.map((doc) => ({ ...doc, type: "rfq" })) ?? []),
  ].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

  return merged;
}

export async function getSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrders").select("*").eq("id", salesOrderId).single();
}

export async function getSalesOrderCustomerDetails(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderLocations")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}

export async function getSalesOrderFavorites(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client
    .from("salesOrderFavorite")
    .select("*")
    .eq("companyId", companyId)
    .eq("userId", userId);
}

export async function getSalesOrderRelatedItems(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  opportunityId: string
) {
  const [jobs, shipments, invoices] = await Promise.all([
    client.from("job").select("*").eq("salesOrderId", salesOrderId),
    client
      .from("shipment")
      .select("*, shipmentLine(*)")
      .eq("opportunityId", opportunityId),
    client
      .from("salesInvoice")
      .select("id, invoiceId, status")
      .eq("opportunityId", opportunityId),
  ]);

  return {
    jobs: jobs.data ?? [],
    shipments: shipments.data ?? [],
    invoices: invoices.data ?? [],
  };
}

export async function getSalesOrders(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    status: string | null;
    customerId: string | null;
  }
) {
  let query = client
    .from("salesOrders")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `salesOrderId.ilike.%${args.search}%,customerReference.ilike.%${args.search}%`
    );
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "salesOrderId", ascending: false },
  ]);

  return query;
}

export async function getSalesOrdersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllFromTable<{
    id: string;
    salesOrderId: string;
  }>(client, "salesOrder", "id, salesOrderId", (query) =>
    query.eq("companyId", companyId)
  );
}

export async function getSalesOrderPayment(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderPayment")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}

export async function getSalesTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("terms").select("salesTerms").eq("id", companyId).single();
}

export async function getSalesOrderShipment(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderShipment")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}

export async function getSalesOrderCustomers(client: SupabaseClient<Database>) {
  return client.from("salesOrderCustomers").select("id, name");
}

export async function getSalesOrderLines(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .eq("salesOrderId", salesOrderId)
    .order("itemReadableId", { ascending: true });
}

export async function getSalesOrderLinesByItemId(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .eq("itemId", itemId)
    .order("orderDate", { ascending: false })
    .order("createdAt", { ascending: false });
}

export async function getSalesOrderLinesByItemIds(
  client: SupabaseClient<Database>,
  itemIds: string[]
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .in("itemId", itemIds)
    .order("orderDate", { ascending: false })
    .order("createdAt", { ascending: false })
    .limit(10);
}

export async function getSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client
    .from("salesOrderLines")
    .select("*")
    .eq("id", salesOrderLineId)
    .single();
}

export async function getSalesOrderLineShipments(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client
    .from("shipmentLine")
    .select("*, shipment(*), shelf(id, name)")
    .eq("lineId", salesOrderLineId)
    .gt("shippedQuantity", 0);
}

export async function getSalesRFQ(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("salesRfqs").select("*").eq("id", id).single();
}

export async function getSalesRFQFavorites(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client
    .from("salesRfqFavorite")
    .select("*")
    .eq("companyId", companyId)
    .eq("userId", userId);
}

export async function getSalesRFQs(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("salesRfqs")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.or(
      `rfqId.ilike.%${args.search}%,name.ilike.%${args.search}%,customerReference.ilike%${args.search}%`
    );
  }

  query = setGenericQueryFilters(query, args, [
    { column: "rfqId", ascending: false },
  ]);
  return query;
}

export async function getSalesRFQLine(
  client: SupabaseClient<Database>,
  lineId: string
) {
  return client.from("salesRfqLines").select("*").eq("id", lineId).single();
}

export async function getSalesRFQLines(
  client: SupabaseClient<Database>,
  salesRfqId: string
) {
  return client
    .from("salesRfqLines")
    .select("*")
    .eq("salesRfqId", salesRfqId)
    .order("customerPartId", { ascending: true });
}

export async function insertCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: z.infer<typeof customerContactValidator>;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      {
        ...customerContact.contact,
        isCustomer: true,
        companyId: customerContact.companyId,
      },
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
    .from("customerContact")
    .insert([
      {
        customerId: customerContact.customerId,
        contactId,
        customerLocationId: customerContact.customerLocationId,
        customFields: customerContact.customFields,
      },
    ])
    .select("id")
    .single();
}

export async function insertCustomerLocation(
  client: SupabaseClient<Database>,
  customerLocation: {
    customerId: string;
    companyId: string;
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
  const insertAddress = await client
    .from("address")
    .insert([
      { ...customerLocation.address, companyId: customerLocation.companyId },
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
    .from("customerLocation")
    .insert([
      {
        customerId: customerLocation.customerId,
        addressId,
        name: customerLocation.name,
        customFields: customerLocation.customFields,
      },
    ])
    .select("id")
    .single();
}

export async function insertSalesOrderLines(
  client: SupabaseClient<Database>,
  salesOrderLines:
    | (Omit<z.infer<typeof salesOrderLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })[]
) {
  return client.from("salesOrderLine").insert(salesOrderLines).select("id");
}

export async function finalizeQuote(
  client: SupabaseClient<Database>,
  quoteId: string,
  userId: string
) {
  const quoteUpdate = await client
    .from("quote")
    .update({
      status: "Sent",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId,
    })
    .eq("id", quoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  return client
    .from("quoteLine")
    .update({
      status: "Complete",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId,
    })
    .neq("status", "No Quote")
    .eq("quoteId", quoteId);
}

export async function releaseSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  userId: string
) {
  return client
    .from("salesOrder")
    .update({
      status: "To Ship and Invoice",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId,
    })
    .eq("id", salesOrderId);
}

export async function upsertCustomer(
  client: SupabaseClient<Database>,
  customer:
    | (Omit<z.infer<typeof customerValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in customer) {
    return client.from("customer").insert([customer]).select("*").single();
  }
  return client
    .from("customer")
    .update({
      ...sanitize(customer),
      updatedAt: today(getLocalTimeZone()).toString(),
    })
    .eq("id", customer.id)
    .select("id")
    .single();
}

export async function updateCustomerAccounting(
  client: SupabaseClient<Database>,
  customerAccounting: z.infer<typeof customerAccountingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("customer")
    .update(sanitize(customerAccounting))
    .eq("id", customerAccounting.id);
}

export async function updateCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    contactId: string;
    contact: z.infer<typeof customerContactValidator>;
    customerLocationId?: string;
    customFields?: Json;
  }
) {
  if (customerContact.customFields) {
    const customFieldUpdate = await client
      .from("customerContact")
      .update({
        customFields: customerContact.customFields,
        customerLocationId: customerContact.customerLocationId,
      })
      .eq("contactId", customerContact.contactId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  return client
    .from("contact")
    .update(sanitize(customerContact.contact))
    .eq("id", customerContact.contactId)
    .select("id")
    .single();
}

export async function updateCustomerLocation(
  client: SupabaseClient<Database>,
  customerLocation: {
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
  if (customerLocation.customFields) {
    const customFieldUpdate = await client
      .from("customerLocation")
      .update({
        name: customerLocation.name,
        customFields: customerLocation.customFields,
      })
      .eq("addressId", customerLocation.addressId);

    if (customFieldUpdate.error) {
      return customFieldUpdate;
    }
  }
  return client
    .from("address")
    .update(sanitize(customerLocation.address))
    .eq("id", customerLocation.addressId)
    .select("id")
    .single();
}
export async function updateCustomerPayment(
  client: SupabaseClient<Database>,
  customerPayment: z.infer<typeof customerPaymentValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("customerPayment")
    .update(sanitize(customerPayment))
    .eq("customerId", customerPayment.customerId);
}

export async function updateCustomerShipping(
  client: SupabaseClient<Database>,
  customerShipping: z.infer<typeof customerShippingValidator> & {
    updatedBy: string;
  }
) {
  return client
    .from("customerShipping")
    .update(sanitize(customerShipping))
    .eq("customerId", customerShipping.customerId);
}

export async function upsertCustomerStatus(
  client: SupabaseClient<Database>,
  customerStatus:
    | (Omit<z.infer<typeof customerStatusValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerStatusValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in customerStatus) {
    return client.from("customerStatus").insert([customerStatus]).select("id");
  } else {
    return client
      .from("customerStatus")
      .update(sanitize(customerStatus))
      .eq("id", customerStatus.id);
  }
}

export async function upsertCustomerType(
  client: SupabaseClient<Database>,
  customerType:
    | (Omit<z.infer<typeof customerTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof customerTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in customerType) {
    return client.from("customerType").insert([customerType]).select("id");
  } else {
    return client
      .from("customerType")
      .update(sanitize(customerType))
      .eq("id", customerType.id);
  }
}

export async function upsertNoQuoteReason(
  client: SupabaseClient<Database>,
  noQuoteReason:
    | (Omit<z.infer<typeof noQuoteReasonValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof noQuoteReasonValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in noQuoteReason) {
    return client.from("noQuoteReason").insert([noQuoteReason]).select("id");
  } else {
    return client
      .from("noQuoteReason")
      .update(sanitize(noQuoteReason))
      .eq("id", noQuoteReason.id);
  }
}

export async function updateSalesRFQFavorite(
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
      .from("salesRfqFavorite")
      .delete()
      .eq("rfqId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("salesRfqFavorite")
      .insert({ rfqId: id, userId: userId });
  }
}

export async function updateSalesRFQLineOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("salesRfqLine").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateQuoteExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString(),
  };

  return client.from("quote").update(update).eq("id", update.id);
}

export async function updateQuoteLinePrecision(
  client: SupabaseClient<Database>,
  quoteLineId: string,
  precision: number
) {
  return client
    .from("quoteLine")
    .update({ unitPricePrecision: precision })
    .eq("id", quoteLineId)
    .select("id")
    .single();
}

export async function updateSalesOrderExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString(),
  };

  return client.from("salesOrder").update(update).eq("id", update.id);
}

export async function updateQuoteFavorite(
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
      .from("quoteFavorite")
      .delete()
      .eq("quoteId", id)
      .eq("userId", userId);
  } else {
    return client.from("quoteFavorite").insert({ quoteId: id, userId: userId });
  }
}

export async function updateSalesRFQStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof salesRFQStatusType)[number];
    noQuoteReasonId: string | null;
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { noQuoteReasonId, status, ...rest } = update;

  // Only include noQuoteReasonId if it has a value to avoid foreign key constraint error
  // Set completedAt when status is Ready for Quote
  const updateData = {
    status,
    ...rest,
    ...(noQuoteReasonId ? { noQuoteReasonId } : {}),
    ...(status === "Ready for Quote"
      ? { completedDate: now(getLocalTimeZone()).toAbsoluteString() }
      : {}),
  };

  return client.from("salesRfq").update(updateData).eq("id", update.id);
}

export async function updateQuoteMaterialOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("quoteMaterial").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateQuoteOperationOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    order: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, order, updatedBy }) =>
    client.from("quoteOperation").update({ order, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateQuoteStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof quoteStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { status, ...rest } = update;

  // Set completedDate when status is Ready for Quote
  const updateData = {
    status,
    ...rest,
    ...(status === "Sent"
      ? { completedDate: now(getLocalTimeZone()).toAbsoluteString() }
      : {}),
  };
  return client.from("quote").update(updateData).eq("id", update.id);
}

export async function upsertMakeMethodFromQuoteLine(
  client: SupabaseClient<Database>,
  lineMethod: {
    itemId: string;
    quoteId: string;
    quoteLineId: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("get-method", {
    body: {
      type: "quoteLineToItem",
      sourceId: `${lineMethod.quoteId}:${lineMethod.quoteLineId}`,
      targetId: lineMethod.itemId,
      companyId: lineMethod.companyId,
      userId: lineMethod.userId,
    },
    region: FunctionRegion.UsEast1,
  });
}

export async function upsertMakeMethodFromQuoteMethod(
  client: SupabaseClient<Database>,
  quoteMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
  }
) {
  const { error } = await client.functions.invoke("get-method", {
    body: {
      type: "quoteMakeMethodToItem",
      sourceId: quoteMethod.sourceId,
      targetId: quoteMethod.targetId,
      companyId: quoteMethod.companyId,
      userId: quoteMethod.userId,
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

export async function upsertQuote(
  client: SupabaseClient<Database>,
  quote:
    | (Omit<z.infer<typeof quoteValidator>, "id" | "quoteId"> & {
        quoteId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteValidator>, "id" | "quoteId"> & {
        id: string;
        quoteId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in quote) {
    const [customerPayment, customerShipping, employee, opportunity] =
      await Promise.all([
        getCustomerPayment(client, quote.customerId),
        getCustomerShipping(client, quote.customerId),
        getEmployeeJob(client, quote.createdBy, quote.companyId),
        client
          .from("opportunity")
          .insert([
            { companyId: quote.companyId, customerId: quote.customerId },
          ])
          .select("id")
          .single(),
      ]);

    if (customerPayment.error) return customerPayment;
    if (customerShipping.error) return customerShipping;

    const {
      paymentTermId,
      invoiceCustomerId,
      invoiceCustomerContactId,
      invoiceCustomerLocationId,
    } = customerPayment.data;

    const { shippingMethodId, shippingTermId } = customerShipping.data;

    if (quote.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        quote.companyId,
        quote.currencyCode
      );
      if (currency.data) {
        quote.exchangeRate = currency.data.exchangeRate ?? undefined;
        quote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    } else {
      quote.exchangeRate = 1;
      quote.exchangeRateUpdatedAt = new Date().toISOString();
    }

    const locationId = employee?.data?.locationId ?? null;
    const insert = await client
      .from("quote")
      .insert([
        {
          ...quote,
          opportunityId: opportunity.data?.id,
        },
      ])
      .select("id, quoteId");
    if (insert.error) {
      return insert;
    }

    const quoteId = insert.data?.[0]?.id;
    if (!quoteId) return insert;

    const [shipment, payment, externalLink] = await Promise.all([
      client.from("quoteShipment").insert([
        {
          id: quoteId,
          locationId: locationId,
          shippingMethodId: shippingMethodId,
          shippingTermId: shippingTermId,
          companyId: quote.companyId,
        },
      ]),
      client.from("quotePayment").insert([
        {
          id: quoteId,
          invoiceCustomerId: invoiceCustomerId,
          invoiceCustomerContactId: invoiceCustomerContactId,
          invoiceCustomerLocationId: invoiceCustomerLocationId,
          paymentTermId: paymentTermId,
          companyId: quote.companyId,
        },
      ]),
      upsertExternalLink(client, {
        documentType: "Quote",
        documentId: quoteId,
        customerId: quote.customerId,
        expiresAt: quote.expirationDate,
        companyId: quote.companyId,
      }),
    ]);

    if (shipment.error) {
      await deleteQuote(client, quoteId);
      return payment;
    }
    if (payment.error) {
      await deleteQuote(client, quoteId);
      return payment;
    }
    if (opportunity.error) {
      await deleteQuote(client, quoteId);
      return opportunity;
    }
    if (externalLink.data) {
      await client
        .from("quote")
        .update({ externalLinkId: externalLink.data.id })
        .eq("id", quoteId);
    }

    return insert;
  } else {
    // Only update the exchange rate if the currency code has changed
    const existingQuote = await client
      .from("quote")
      .select("companyId, currencyCode")
      .eq("id", quote.id)
      .single();

    if (existingQuote.error) return existingQuote;

    const { companyId, currencyCode } = existingQuote.data;

    if (quote.currencyCode && currencyCode !== quote.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        companyId,
        quote.currencyCode
      );
      if (currency.data) {
        quote.exchangeRate = currency.data.exchangeRate ?? undefined;
        quote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }
    return client
      .from("quote")
      .update({
        ...sanitize(quote),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", quote.id);
  }
}

export async function upsertQuoteLine(
  client: SupabaseClient<Database>,
  quotationLine:
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quotationLine) {
    return client
      .from("quoteLine")
      .update(sanitize(quotationLine))
      .eq("id", quotationLine.id)
      .select("id")
      .single();
  }
  return client.from("quoteLine").insert([quotationLine]).select("*").single();
}

export async function upsertQuoteLineAdditionalCharges(
  client: SupabaseClient<Database>,
  lineId: string,
  update: {
    additionalCharges: z.infer<typeof quoteLineAdditionalChargesValidator>;
    updatedBy: string;
  }
) {
  return client.from("quoteLine").update(update).eq("id", lineId);
}

export async function upsertQuoteLinePrices(
  client: SupabaseClient<Database>,
  quoteId: string,
  lineId: string,
  quoteLinePrices: {
    quoteLineId: string;
    unitPrice: number;
    leadTime: number;
    discountPercent: number;
    quantity: number;
    createdBy: string;
  }[]
) {
  const existingPrices = await client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", lineId);
  if (existingPrices.error) {
    return existingPrices;
  }

  const deletePrices = await client
    .from("quoteLinePrice")
    .delete()
    .eq("quoteLineId", lineId);
  if (deletePrices.error) {
    return deletePrices;
  }

  const quoteExchangeRate = await client
    .from("quote")
    .select("id, exchangeRate")
    .eq("id", quoteId)
    .single();

  const quoteLineUnitPricePrecision = await client
    .from("quoteLine")
    .select("unitPricePrecision")
    .eq("id", lineId)
    .single();

  const pricesByQuantity = existingPrices.data.reduce<
    Record<
      number,
      {
        discountPercent: number;
        leadTime: number;
      }
    >
  >((acc, price) => {
    acc[price.quantity] = price;
    return acc;
  }, {});

  const pricesWithExistingDiscountsAndLeadTimes = quoteLinePrices.map((p) => {
    if (p.quantity in pricesByQuantity) {
      return {
        ...p,
        unitPrice: Number(
          // Round the unit price to the precision of the quote line
          p.unitPrice.toFixed(
            quoteLineUnitPricePrecision.data?.unitPricePrecision ?? 2
          )
        ),
        discountPercent: pricesByQuantity[p.quantity].discountPercent,
        leadTime: pricesByQuantity[p.quantity].leadTime,
        quoteId: quoteId,
        exchangeRate: quoteExchangeRate.data?.exchangeRate ?? 1,
      };
    }
    return {
      ...p,
      unitPrice: Number(
        // Round the unit price to the precision of the quote line
        p.unitPrice.toFixed(
          quoteLineUnitPricePrecision.data?.unitPricePrecision ?? 2
        )
      ),
      quoteId: quoteId,
      exchangeRate: quoteExchangeRate.data?.exchangeRate ?? 1,
    };
  });

  return client
    .from("quoteLinePrice")
    .insert(pricesWithExistingDiscountsAndLeadTimes);
}

export async function upsertQuoteLineMethod(
  client: SupabaseClient<Database>,
  lineMethod: {
    itemId: string;
    quoteId: string;
    quoteLineId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
  }
) {
  const body: {
    type: "itemToQuoteLine";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
  } = {
    type: "itemToQuoteLine",
    sourceId: lineMethod.itemId,
    targetId: `${lineMethod.quoteId}:${lineMethod.quoteLineId}`,
    companyId: lineMethod.companyId,
    userId: lineMethod.userId,
  };

  // Only add configuration if it exists
  if (lineMethod.configuration !== undefined) {
    body.configuration = lineMethod.configuration;
  }

  return client.functions.invoke("get-method", {
    body,
    region: FunctionRegion.UsEast1,
  });
}

export async function upsertQuoteMaterial(
  client: SupabaseClient<Database>,
  quoteMaterial:
    | (Omit<z.infer<typeof quoteMaterialValidator>, "id"> & {
        quoteId: string;
        quoteLineId: string;
        quoteOperationId?: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteMaterialValidator>, "id"> & {
        id: string;
        quoteId: string;
        quoteLineId: string;
        quoteOperationId?: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quoteMaterial) {
    return client
      .from("quoteMaterial")
      .update(sanitize(quoteMaterial))
      .eq("id", quoteMaterial.id)
      .select("id, methodType")
      .single();
  }
  return client
    .from("quoteMaterial")
    .insert([quoteMaterial])
    .select("id, methodType")
    .single();
}

export async function upsertQuoteMaterialMakeMethod(
  client: SupabaseClient<Database>,
  quoteMethod: {
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
  }
) {
  const body: {
    type: "itemToQuoteMakeMethod";
    sourceId: string;
    targetId: string;
    companyId: string;
    userId: string;
    configuration?: Record<string, unknown>;
  } = {
    type: "itemToQuoteMakeMethod",
    sourceId: quoteMethod.sourceId,
    targetId: quoteMethod.targetId,
    companyId: quoteMethod.companyId,
    userId: quoteMethod.userId,
  };

  // Only add configuration if it exists
  if (quoteMethod.configuration !== undefined) {
    body.configuration = quoteMethod.configuration;
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

export async function upsertQuoteOperation(
  client: SupabaseClient<Database>,
  operation:
    | (Omit<z.infer<typeof quoteOperationValidator>, "id"> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quoteOperationValidator> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quoteOperationValidator>, "id"> & {
        id: string;
        quoteId: string;
        quoteLineId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in operation) {
    return client
      .from("quoteOperation")
      .insert([operation])
      .select("id")
      .single();
  }
  return client
    .from("quoteOperation")
    .update(sanitize(operation))
    .eq("id", operation.id)
    .select("id")
    .single();
}

export async function upsertQuoteOperationStep(
  client: SupabaseClient<Database>,
  quoteOperationStep:
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
  if ("createdBy" in quoteOperationStep) {
    return client
      .from("quoteOperationStep")
      .insert(quoteOperationStep)
      .select("id")
      .single();
  }

  return client
    .from("quoteOperationStep")
    .update(sanitize(quoteOperationStep))
    .eq("id", quoteOperationStep.id)
    .select("id")
    .single();
}

export async function upsertQuoteOperationParameter(
  client: SupabaseClient<Database>,
  quoteOperationParameter:
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
  if ("createdBy" in quoteOperationParameter) {
    return client
      .from("quoteOperationParameter")
      .insert(quoteOperationParameter)
      .select("id")
      .single();
  }

  return client
    .from("quoteOperationParameter")
    .update(sanitize(quoteOperationParameter))
    .eq("id", quoteOperationParameter.id)
    .select("id")
    .single();
}

export async function upsertQuoteOperationTool(
  client: SupabaseClient<Database>,
  quoteOperationTool:
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
  if ("createdBy" in quoteOperationTool) {
    return client
      .from("quoteOperationTool")
      .insert(quoteOperationTool)
      .select("id")
      .single();
  }

  return client
    .from("quoteOperationTool")
    .update(sanitize(quoteOperationTool))
    .eq("id", quoteOperationTool.id)
    .select("id")
    .single();
}

export async function upsertQuotePayment(
  client: SupabaseClient<Database>,
  quotePayment:
    | (z.infer<typeof quotePaymentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof quotePaymentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quotePayment) {
    return client
      .from("quotePayment")
      .update(sanitize(quotePayment))
      .eq("id", quotePayment.id)
      .select("id")
      .single();
  }
  return client
    .from("quotePayment")
    .insert([quotePayment])
    .select("id")
    .single();
}

export async function upsertQuoteShipment(
  client: SupabaseClient<Database>,
  quoteShipment:
    | (z.infer<typeof quoteShipmentValidator> & {
        createdBy: string;
      })
    | (z.infer<typeof quoteShipmentValidator> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("id" in quoteShipment) {
    return client
      .from("quoteShipment")
      .update(sanitize(quoteShipment))
      .eq("id", quoteShipment.id)
      .select("id")
      .single();
  }
  return client
    .from("quoteShipment")
    .insert([quoteShipment])
    .select("id")
    .single();
}

export async function updateSalesOrderFavorite(
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
      .from("salesOrderFavorite")
      .delete()
      .eq("salesOrderId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("salesOrderFavorite")
      .insert({ salesOrderId: id, userId: userId });
  }
}

export async function updateSalesOrderStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof salesOrderStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { status, ...rest } = update;

  // Set completedDate when status is Confirmed
  const updateData = {
    status,
    ...rest,
    ...(["To Ship", "To Ship and Invoice"].includes(status)
      ? { completedDate: now(getLocalTimeZone()).toAbsoluteString() }
      : {}),
  };

  return client.from("salesOrder").update(updateData).eq("id", update.id);
}

export async function upsertSalesOrder(
  client: SupabaseClient<Database>,
  salesOrder:
    | (Omit<z.infer<typeof salesOrderValidator>, "id" | "salesOrderId"> & {
        salesOrderId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesOrderValidator>, "id" | "salesOrderId"> & {
        id: string;
        salesOrderId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesOrder) {
    // Only update the exchange rate if the currency code has changed
    const existingSalesOrder = await client
      .from("salesOrder")
      .select("companyId, currencyCode")
      .eq("id", salesOrder.id)
      .single();

    if (existingSalesOrder.error) return existingSalesOrder;

    const { companyId, currencyCode } = existingSalesOrder.data;

    if (salesOrder.currencyCode && currencyCode !== salesOrder.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        companyId,
        salesOrder.currencyCode
      );
      if (currency.data) {
        salesOrder.exchangeRate = currency.data.exchangeRate ?? undefined;
        salesOrder.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }
    return client
      .from("salesOrder")
      .update(sanitize(salesOrder))
      .eq("id", salesOrder.id)
      .select("id, salesOrderId");
  }

  const [customerPayment, customerShipping, employee, opportunity] =
    await Promise.all([
      getCustomerPayment(client, salesOrder.customerId),
      getCustomerShipping(client, salesOrder.customerId),
      getEmployeeJob(client, salesOrder.createdBy, salesOrder.companyId),
      client
        .from("opportunity")
        .insert([
          {
            companyId: salesOrder.companyId,
            customerId: salesOrder.customerId,
          },
        ])
        .select("id")
        .single(),
    ]);

  if (customerPayment.error) return customerPayment;
  if (customerShipping.error) return customerShipping;

  const {
    paymentTermId,
    invoiceCustomerId,
    invoiceCustomerContactId,
    invoiceCustomerLocationId,
  } = customerPayment.data;

  const { shippingMethodId, shippingTermId } = customerShipping.data;

  const locationId = employee?.data?.locationId ?? null;

  if (salesOrder.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      salesOrder.companyId,
      salesOrder.currencyCode
    );
    if (currency.data) {
      salesOrder.exchangeRate = currency.data.exchangeRate ?? undefined;
      salesOrder.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    salesOrder.exchangeRate = 1;
    salesOrder.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const { requestedDate, promisedDate, ...orderData } = salesOrder;

  const order = await client
    .from("salesOrder")
    .insert([{ ...orderData, opportunityId: opportunity.data?.id }])
    .select("id, salesOrderId");

  if (order.error) {
    return order;
  }

  if (!order.data || order.data.length === 0) {
    return {
      error: {
        message: "Sales order insert returned no data",
        details:
          "The insert operation completed but returned an empty result set",
      } as PostgrestError,
      data: null,
    };
  }

  const salesOrderId = order.data[0].id;

  const [shipment, payment] = await Promise.all([
    client.from("salesOrderShipment").insert([
      {
        id: salesOrderId,
        locationId: locationId,
        shippingMethodId: shippingMethodId,
        receiptRequestedDate: requestedDate,
        receiptPromisedDate: promisedDate,
        shippingTermId: shippingTermId,
        companyId: salesOrder.companyId,
      },
    ]),
    client.from("salesOrderPayment").insert([
      {
        id: salesOrderId,
        invoiceCustomerId: invoiceCustomerId,
        invoiceCustomerContactId: invoiceCustomerContactId,
        invoiceCustomerLocationId: invoiceCustomerLocationId,
        paymentTermId: paymentTermId,
        companyId: salesOrder.companyId,
      },
    ]),
  ]);

  if (shipment.error) {
    await deleteSalesOrder(client, salesOrderId);
    return shipment;
  }
  if (payment.error) {
    await deleteSalesOrder(client, salesOrderId);
    return payment;
  }
  if (opportunity.error) {
    await deleteSalesOrder(client, salesOrderId);
    return opportunity;
  }

  return order;
}

export async function upsertSalesOrderShipment(
  client: SupabaseClient<Database>,
  salesOrderShipment:
    | (z.infer<typeof salesOrderShipmentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesOrderShipmentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesOrderShipment) {
    return client
      .from("salesOrderShipment")
      .update(sanitize(salesOrderShipment))
      .eq("id", salesOrderShipment.id)
      .select("id")
      .single();
  }
  return client
    .from("salesOrderShipment")
    .insert([salesOrderShipment])
    .select("id")
    .single();
}

export async function upsertSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLine:
    | (Omit<z.infer<typeof salesOrderLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesOrderLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesOrderLine) {
    return client
      .from("salesOrderLine")
      .update(sanitize(salesOrderLine))
      .eq("id", salesOrderLine.id)
      .select("id")
      .single();
  }
  const salesOrder = await getSalesOrder(client, salesOrderLine.salesOrderId);
  if (salesOrder.error) return salesOrder;

  salesOrderLine.exchangeRate = salesOrder.data?.exchangeRate ?? 1;

  return client
    .from("salesOrderLine")
    .insert([salesOrderLine])
    .select("id")
    .single();
}

export async function upsertSalesOrderPayment(
  client: SupabaseClient<Database>,
  salesOrderPayment:
    | (z.infer<typeof salesOrderPaymentValidator> & {
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesOrderPaymentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesOrderPayment) {
    return client
      .from("salesOrderPayment")
      .update(sanitize(salesOrderPayment))
      .eq("id", salesOrderPayment.id)
      .select("id")
      .single();
  }
  return client
    .from("salesOrderPayment")
    .insert([salesOrderPayment])
    .select("id")
    .single();
}

export async function upsertSalesRFQ(
  client: SupabaseClient<Database>,
  rfq:
    | (Omit<z.infer<typeof salesRfqValidator>, "id" | "rfqId"> & {
        rfqId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesRfqValidator>, "id" | "rfqId"> & {
        id: string;
        rfqId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in rfq) {
    const opportunity = await client
      .from("opportunity")
      .insert([{ companyId: rfq.companyId, customerId: rfq.customerId }])
      .select("id")
      .single();

    if (opportunity.error) {
      return opportunity;
    }

    const insert = await client
      .from("salesRfq")
      .insert([
        {
          ...rfq,
          opportunityId: opportunity.data?.id,
        },
      ])
      .select("id, rfqId");
    if (insert.error) {
      return insert;
    }

    return insert;
  } else {
    return client
      .from("salesRfq")
      .update({
        ...sanitize(rfq),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", rfq.id);
  }
}

export async function upsertSalesRFQLine(
  client: SupabaseClient<Database>,

  salesRfqLine:
    | (Omit<z.infer<typeof salesRfqLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesRfqLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in salesRfqLine) {
    return client
      .from("salesRfqLine")
      .insert([salesRfqLine])
      .select("id")
      .single();
  }
  return client
    .from("salesRfqLine")
    .update(sanitize(salesRfqLine))
    .eq("id", salesRfqLine.id)
    .select("id")
    .single();
}
