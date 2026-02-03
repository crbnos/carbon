import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import { getPurchaseOrderStatus } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import type {
  PostgrestSingleResponse,
  SupabaseClient
} from "@supabase/supabase-js";
import { FunctionRegion } from "@supabase/supabase-js";
import type { z } from "zod";
import { getEmployeeJob } from "~/modules/people";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting/accounting.service";
import type { PurchaseInvoice } from "../invoicing/types";
import { upsertExternalLink } from "../shared/shared.service";
import type {
  purchaseOrderDeliveryValidator,
  purchaseOrderLineValidator,
  purchaseOrderPaymentValidator,
  purchaseOrderStatusType,
  purchaseOrderValidator,
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
  supplierStatusValidator,
  supplierTypeValidator,
  supplierValidator
} from "./purchasing.models";
import type { PurchaseOrder, PurchasingRFQ, SupplierQuote } from "./types";

export async function closePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string
) {
  return client
    .from("purchaseOrder")
    .update({
      closed: true,
      closedAt: today(getLocalTimeZone()).toString(),
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
    },
    region: FunctionRegion.UsEast1
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
  return client
    .from("supplierProcess")
    .delete()
    .eq("id", supplierProcessId)
    .single();
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

export async function deleteSupplierStatus(
  client: SupabaseClient<Database>,
  supplierStatusId: string
) {
  return client.from("supplierStatus").delete().eq("id", supplierStatusId);
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
      updatedAt: today(getLocalTimeZone()).toString(),
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
    .select("*", { count: "exact" })
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
    { column: "readableIdWithRevision", ascending: true }
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

  return (
    result.data?.map((f) => ({ ...f, bucket: "supplier-interaction-line" })) ??
    []
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
    .eq("supplierQuoteId", supplierQuoteId);
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
    query = query.eq("supplierStatusId", args.status);
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

export async function getSupplierStatus(
  client: SupabaseClient<Database>,
  supplierStatusId: string
) {
  return client
    .from("supplierStatus")
    .select("*")
    .eq("id", supplierStatusId)
    .single();
}

export async function getSupplierStatuses(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("supplierStatus")
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

export async function getSupplierStatusesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("supplierStatus")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
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
  const lines = await getPurchaseOrderLines(client, purchaseOrderId);
  const { status } = getPurchaseOrderStatus(lines.data || []);

  return client
    .from("purchaseOrder")
    .update({
      status,
      orderDate: today(getLocalTimeZone()).toString(),
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId
    })
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
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId
    })
    .eq("id", supplierQuoteId);

  if (quoteUpdate.error) {
    return quoteUpdate;
  }

  return { data: null, error: null };
}

export async function updatePurchaseOrder(
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

  const { shippingMethodId, shippingTermId } = supplierShipping.data;

  if (purchaseOrder.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      purchaseOrder.companyId,
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

  const locationId = purchaser?.data?.locationId ?? null;

  const order = await client
    .from("purchaseOrder")
    .insert([
      {
        ...purchaseOrder,
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
  return client
    .from("purchaseOrderLine")
    .insert([purchaseOrderLine])
    .select("id")
    .single();
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
      .select("id, name")
      .single();
  }
  return client
    .from("supplier")
    .update({
      ...sanitize(supplier),
      updatedAt: today(getLocalTimeZone()).toString()
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

export async function upsertSupplierQuote(
  client: SupabaseClient<Database>,
  supplierQuote:
    | (Omit<
        z.infer<typeof supplierQuoteValidator>,
        "id" | "supplierQuoteId"
      > & {
        supplierQuoteId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<
        z.infer<typeof supplierQuoteValidator>,
        "id" | "supplierQuoteId"
      > & {
        id: string;
        supplierQuoteId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierQuote) {
    if (supplierQuote.currencyCode) {
      const currency = await getCurrencyByCode(
        client,
        supplierQuote.companyId,
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

    const insert = await client
      .from("supplierQuote")
      .insert([
        {
          ...supplierQuote,
          status: supplierQuote.status ?? "Draft",
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
      .select("companyId, currencyCode, status")
      .eq("id", supplierQuote.id)
      .single();

    if (existingQuote.error) return existingQuote;

    const {
      companyId,
      currencyCode,
      status: existingStatus
    } = existingQuote.data;

    if (
      supplierQuote.currencyCode &&
      currencyCode !== supplierQuote.currencyCode
    ) {
      const currency = await getCurrencyByCode(
        client,
        companyId,
        supplierQuote.currencyCode
      );
      if (currency.data) {
        supplierQuote.exchangeRate = currency.data.exchangeRate ?? undefined;
        supplierQuote.exchangeRateUpdatedAt = new Date().toISOString();
      }
    }
    return client
      .from("supplierQuote")
      .update({
        ...sanitize(supplierQuote),
        status:
          supplierQuote.expirationDate &&
          today(getLocalTimeZone()).toString() > supplierQuote.expirationDate
            ? "Expired"
            : (supplierQuote.status ?? existingStatus ?? "Draft"),
        updatedAt: today(getLocalTimeZone()).toString()
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
  return client
    .from("supplierQuoteLine")
    .insert([supplierQuoteLine])
    .select("id")
    .single();
}

export async function upsertSupplierStatus(
  client: SupabaseClient<Database>,
  supplierStatus:
    | (Omit<z.infer<typeof supplierStatusValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof supplierStatusValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in supplierStatus) {
    return client
      .from("supplierStatus")
      .insert([supplierStatus])
      .select("id")
      .single();
  } else {
    return client
      .from("supplierStatus")
      .update(sanitize(supplierStatus))
      .eq("id", supplierStatus.id);
  }
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

export async function getPurchasingRFQSuppliers(
  client: SupabaseClient<Database>,
  purchasingRfqId: string
) {
  return client
    .from("purchasingRfqSupplier")
    .select("*, supplier:supplierId(id, name)")
    .eq("purchasingRfqId", purchasingRfqId);
}

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
) {
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier:supplierId (*))
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
) {
  // First get all RFQ IDs linked to this quote
  const { data: linkedRfqs, error: rfqError } = await client
    .from("purchasingRfqToSupplierQuote")
    .select("purchasingRfqId")
    .eq("supplierQuoteId", supplierQuoteId);

  if (rfqError || !linkedRfqs || linkedRfqs.length === 0) {
    return { data: [], error: rfqError };
  }

  const rfqIds = linkedRfqs.map((r) => r.purchasingRfqId);

  // Get all quotes linked to any of these RFQs (excluding current quote)
  return client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier:supplierId (*))
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
  const { data: links, error: linksError } = await client
    .from("purchasingRfqToSupplierQuote")
    .select(
      `
      supplierQuoteId,
      supplierQuote:supplierQuoteId (*, supplier:supplierId (*))
    `
    )
    .eq("purchasingRfqId", purchasingRfqId);

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
) {
  return client
    .from("purchasingRfqSupplier")
    .select("*, supplier:supplierId(id, name)")
    .eq("purchasingRfqId", purchasingRfqId);
}
