import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { FileObject } from "@supabase/storage-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getEmployeeJob } from "~/modules/resources";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  customerContactValidator,
  customerPaymentValidator,
  customerShippingValidator,
  customerStatusValidator,
  customerTypeValidator,
  customerValidator,
  quotationAssemblyValidator,
  quotationOperationValidator,
  quotationPricingValidator,
  quoteLineValidator,
  quoteMaterialValidator,
  quoteValidator,
  salesOrderLineValidator,
  salesOrderPaymentValidator,
  salesOrderShipmentValidator,
  salesOrderValidator,
  salesRfqLineValidator,
  salesRfqValidator,
} from "./sales.models";

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

export async function convertQuoteToOrder(
  client: SupabaseClient<Database>,
  quoteId: string,
  userId: string
) {
  const quoteUpdate = await client
    .from("quote")
    .update({
      status: "Ordered",
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
    .eq("quoteId", quoteId);
}

export async function deleteCustomerContact(
  client: SupabaseClient<Database>,
  customerId: string,
  customerContactId: string
) {
  return client
    .from("customerContact")
    .delete()
    .eq("customerId", customerId)
    .eq("id", customerContactId);
}

export async function deleteCustomerLocation(
  client: SupabaseClient<Database>,
  customerId: string,
  customerLocationId: string
) {
  return client
    .from("customerLocation")
    .delete()
    .eq("customerId", customerId)
    .eq("id", customerLocationId);
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

export async function deleteSalesRFQLine(
  client: SupabaseClient<Database>,
  salesRFQLineId: string
) {
  return client.from("salesRfqLine").delete().eq("id", salesRFQLineId);
}

export async function getCustomer(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client.from("customer").select("*").eq("id", customerId).single();
}

export async function getCustomerContact(
  client: SupabaseClient<Database>,
  customerContactId: string
) {
  return client
    .from("customerContact")
    .select(
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, addressLine1, addressLine2, city, state, postalCode, country(id, name), birthday, notes)"
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
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, addressLine1, addressLine2, city, state, postalCode, country(id, name), birthday, notes), user(id, active)"
    )
    .eq("customerId", customerId);
}

export async function getCustomerLocation(
  client: SupabaseClient<Database>,
  customerContactId: string
) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, state, country(id, name), postalCode)"
    )
    .eq("id", customerContactId)
    .single();
}

export async function getCustomerLocations(
  client: SupabaseClient<Database>,
  customerId: string
) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, state, country(id, name), postalCode)"
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
  return client
    .from("customer")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
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

export async function getFilesByRfqId(
  client: SupabaseClient<Database>,
  rfqId: string,
  companyId: string
) {
  const lines = await client
    .from("salesRfqLine")
    .select("id")
    .eq("salesRfqId", rfqId);
  if (lines.error) {
    return lines;
  }
  const lineIds = lines.data?.map((line) => line.id);
  const fileQueries = lineIds.map((lineId) =>
    client.storage
      .from("private")
      .list(`${companyId}/sales-rfq/${rfqId}/${lineId}`)
  );
  const files = await Promise.all([...fileQueries]);

  return {
    data: {
      files: files.reduce<(FileObject & { salesRfqLineId: string | null })[]>(
        (acc, file, index) => {
          if (file.data) {
            return [
              ...acc,
              ...file.data?.map((f) => ({
                ...f,
                salesRfqLineId: lineIds[index],
              })),
            ];
          }
          return acc;
        },
        []
      ),
    },
  };
}

export async function getFilesByQuoteLineId(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteLineId: string
) {
  return client.storage
    .from("private")
    .list(`${companyId}/quote-line/${quoteLineId}`);
}

export async function getQuote(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quotes").select("*").eq("id", quoteId).single();
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
    { column: "favorite", ascending: false },
    { column: "id", ascending: false },
  ]);
  return query;
}

export async function getQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quoteMakeMethodId: string
) {
  return client
    .from("quoteMakeMethod")
    .select("*")
    .eq("id", quoteMakeMethodId)
    .single();
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

export async function getQuoteDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteId: string
) {
  return client.storage.from("private").list(`${companyId}/quote/${quoteId}`);
}

export async function getQuoteLine(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client.from("quoteLines").select("*").eq("id", quoteLineId).single();
}

type QuoteMethod = NonNullable<
  Awaited<ReturnType<typeof getQuoteMethodTreeArray>>["data"]
>[number];
type QuoteMethodTreeItem = {
  id: string;
  data: QuoteMethod;
  children: QuoteMethodTreeItem[];
};

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
  return client.from("quoteLines").select("*").eq("quoteId", quoteId);
}

export async function getSalesOrderExternalDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  salesOrderId: string
) {
  return client.storage
    .from("private")
    .list(`${companyId}/sales/external/${salesOrderId}`);
}

/*export async function getSalesOrderInternalDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  salesOrderId: string
) {
  return client.storage
    .from("private")
    .list(`${companyId}/sales/internal/${salesOrderId}`);
}*/

export async function getQuoteLinePrice(
  client: SupabaseClient<Database>,
  quoteLineId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteLineId", quoteLineId)
    .single();
}

export async function getQuoteLinePricesByQuoteId(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client
    .from("quoteLinePrice")
    .select("*")
    .eq("quoteId", quoteId)
    .order("createdAt");
}

export async function getQuoteMaterials(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteMaterial").select("*").eq("quoteId", quoteId);
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

export async function getQuoteOperations(
  client: SupabaseClient<Database>,
  quoteId: string
) {
  return client.from("quoteOperation").select("*").eq("quoteId", quoteId);
}

export async function getSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client.from("salesOrders").select("*").eq("id", salesOrderId).single();
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
    { column: "favorite", ascending: false },
    { column: "salesOrderId", ascending: false },
  ]);

  return query;
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

/*export async function getSalesOrderLocations(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderLocations")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}*/

/*export async function getSalesOrderPayment(
  client: SupabaseClient<Database>,
  salesOrderId: string
) {
  return client
    .from("salesOrderPayment")
    .select("*")
    .eq("id", salesOrderId)
    .single();
}*/

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
    .order("createdAt", { ascending: true });
}

export async function getSalesOrderLine(
  client: SupabaseClient<Database>,
  salesOrderLineId: string
) {
  return client
    .from("salesOrderLine")
    .select("*")
    .eq("id", salesOrderLineId)
    .single();
}

export async function getSalesRFQ(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("salesRfqs").select("*").eq("id", id).single();
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
    { column: "favorite", ascending: false },
    { column: "id", ascending: false },
  ]);
  return query;
}

export async function getSalesRFQLines(
  client: SupabaseClient<Database>,
  salesRfqId: string
) {
  return client
    .from("salesRfqLines")
    .select("*")
    .eq("salesRfqId", salesRfqId)
    .order("order", { ascending: true });
}

export async function insertCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    customerId: string;
    companyId: string;
    contact: z.infer<typeof customerContactValidator>;
    customFields?: Json;
  }
) {
  const insertContact = await client
    .from("contact")
    .insert([
      { ...customerContact.contact, companyId: customerContact.companyId },
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
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      // countryId: string;
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
        customFields: customerLocation.customFields,
      },
    ])
    .select("id")
    .single();
}

export async function insertQuoteLinePrice(
  client: SupabaseClient<Database>,
  quoteLinePrice: {
    quoteId: string;
    quoteLineId: string;
    quantity?: number;
    markupPercent?: number;
    unitCost?: number;
    createdBy: string;
  }
) {
  const quoteLine = await getQuoteLine(client, quoteLinePrice.quoteLineId);
  if (quoteLine.error) {
    return quoteLine;
  }

  let unitCost = 0;

  if (quoteLine.data?.methodType !== "Make") {
    const itemId = quoteLine.data?.itemId;
    if (!itemId) {
      throw new Error("itemId not found");
    }
    const [itemCost] = await Promise.all([
      client.from("itemCost").select("unitCost").eq("itemId", itemId).single(),
    ]);

    if (itemCost.error) {
      return itemCost;
    }

    unitCost = itemCost.data?.unitCost;
  }

  const totalCost = unitCost * (quoteLinePrice.quantity ?? 0);

  return client.from("quoteLinePrice").insert([
    {
      ...quoteLinePrice,
      unitCost,
      extendedPrice:
        totalCost + totalCost * ((quoteLinePrice?.markupPercent ?? 0) / 100),
    },
  ]);
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

export async function releaseQuote(
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
      status: "Confirmed",
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

export async function updateCustomerContact(
  client: SupabaseClient<Database>,
  customerContact: {
    contactId: string;
    contact: z.infer<typeof customerContactValidator>;
    customFields?: Json;
  }
) {
  if (customerContact.customFields) {
    const customFieldUpdate = await client
      .from("customerContact")
      .update({ customFields: customerContact.customFields })
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
    address: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      // countryId: string;
      postalCode?: string;
    };
    customFields?: Json;
  }
) {
  if (customerLocation.customFields) {
    const customFieldUpdate = await client
      .from("customerLocation")
      .update({ customFields: customerLocation.customFields })
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
    return client.from("quote").insert([quote]).select("id, quoteId");
  } else {
    return client
      .from("quote")
      .update({
        ...sanitize(quote),
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", quote.id);
  }
}

export async function upsertQuoteMakeMethod(
  client: SupabaseClient<Database>,
  quotationAssembly:
    | (Omit<z.infer<typeof quotationAssemblyValidator>, "id"> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quotationAssemblyValidator>, "id"> & {
        id: string;
        quoteId: string;
        quoteLineId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quotationAssembly) {
    return client
      .from("quoteMakeMethod")
      .update(sanitize(quotationAssembly))
      .eq("id", quotationAssembly.id)
      .select("id")
      .single();
  }
  return client
    .from("quoteMakeMethod")
    .insert([quotationAssembly])
    .select("id")
    .single();
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

export async function updateQuoteLinePrice(
  client: SupabaseClient<Database>,
  quoteLinePrice: z.infer<typeof quotationPricingValidator> & {
    quoteId: string;
    quoteLineId: string;
    updatedBy: string;
  }
) {
  return client
    .from("quoteLinePrice")
    .update(sanitize(quoteLinePrice))
    .eq("quoteLineId", quoteLinePrice.quoteLineId);
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
      .select("id")
      .single();
  }
  return client
    .from("quoteMaterial")
    .insert([quoteMaterial])
    .select("id")
    .single();
}

export async function upsertQuoteOperation(
  client: SupabaseClient<Database>,
  quotationOperation:
    | (Omit<z.infer<typeof quotationOperationValidator>, "id"> & {
        quoteId: string;
        quoteLineId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof quotationOperationValidator>, "id"> & {
        id: string;
        quoteId: string;
        quoteLineId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in quotationOperation) {
    return client
      .from("quoteOperation")
      .update(sanitize(quotationOperation))
      .eq("id", quotationOperation.id)
      .select("id")
      .single();
  }
  return client
    .from("quoteOperation")
    .insert([quotationOperation])
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
    return client
      .from("salesOrder")
      .update(sanitize(salesOrder))
      .eq("id", salesOrder.id)
      .select("id, salesOrderId");
  }

  const [customerPayment, customerShipping, employee] = await Promise.all([
    getCustomerPayment(client, salesOrder.customerId),
    getCustomerShipping(client, salesOrder.customerId),
    getEmployeeJob(client, salesOrder.createdBy, salesOrder.companyId),
  ]);

  if (customerPayment.error) return customerPayment;
  if (customerShipping.error) return customerShipping;

  const {
    currencyCode,
    paymentTermId,
    invoiceCustomerId,
    invoiceCustomerContactId,
    invoiceCustomerLocationId,
  } = customerPayment.data;

  const { shippingMethodId, shippingTermId } = customerShipping.data;

  const locationId = employee?.data?.locationId ?? null;

  const order = await client
    .from("salesOrder")
    .insert([{ ...salesOrder }])
    .select("id, salesOrderId");

  if (order.error) return order;

  const salesOrderId = order.data[0].id;

  const [shipment, payment] = await Promise.all([
    client.from("salesOrderShipment").insert([
      {
        id: salesOrderId,
        locationId: locationId,
        shippingMethodId: shippingMethodId,
        shippingTermId: shippingTermId,
        companyId: salesOrder.companyId,
      },
    ]),
    client.from("salesOrderPayment").insert([
      {
        id: salesOrderId,
        currencyCode: currencyCode ?? "USD",
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
    return payment;
  }
  if (payment.error) {
    await deleteSalesOrder(client, salesOrderId);
    return payment;
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
    return client.from("salesRfq").insert([rfq]).select("id, rfqId");
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
    | (z.infer<typeof salesRfqLineValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesRfqLineValidator> & {
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
