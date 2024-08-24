import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getEmployeeJob } from "~/modules/people";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  purchaseOrderDeliveryValidator,
  purchaseOrderLineValidator,
  purchaseOrderPaymentValidator,
  purchaseOrderValidator,
  supplierAccountingValidator,
  supplierContactValidator,
  supplierPaymentValidator,
  supplierProcessValidator,
  supplierShippingValidator,
  supplierStatusValidator,
  supplierTypeValidator,
  supplierValidator,
} from "./purchasing.models";

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
      closedBy: userId,
    })
    .eq("id", purchaseOrderId)
    .select("id")
    .single();
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
  return client
    .from("supplierContact")
    .delete()
    .eq("supplierId", supplierId)
    .eq("id", supplierContactId);
}

export async function deleteSupplierLocation(
  client: SupabaseClient<Database>,
  supplierId: string,
  supplierLocationId: string
) {
  return client
    .from("supplierLocation")
    .delete()
    .eq("supplierId", supplierId)
    .eq("id", supplierLocationId);
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

export async function getPurchaseOrderExternalDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
) {
  return client.storage
    .from("private")
    .list(`${companyId}/purchasing/external/${purchaseOrderId}`);
}

export async function getPurchaseOrderInternalDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  purchaseOrderId: string
) {
  return client.storage
    .from("private")
    .list(`${companyId}/purchasing/internal/${purchaseOrderId}`);
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
    { column: "favorite", ascending: false },
    { column: "purchaseOrderId", ascending: false },
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
    .from("purchaseOrderLine")
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

export async function getSupplier(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client.from("supplier").select("*").eq("id", supplierId).single();
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
      "*, contact(id, firstName, lastName, email, mobilePhone, homePhone, workPhone, fax, title, notes), user(id, active)"
    )
    .eq("supplierId", supplierId);
}

export async function getSupplierLocations(
  client: SupabaseClient<Database>,
  supplierId: string
) {
  return client
    .from("supplierLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, state, country(id, name), postalCode)"
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
      "*, address(id, addressLine1, addressLine2, city, state, country(id, name), postalCode)"
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
      count: "exact",
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
    { column: "name", ascending: true },
  ]);
  return query;
}

export async function getSuppliersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("supplier")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
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
      { column: "name", ascending: true },
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
      { column: "name", ascending: true },
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
      { ...supplierContact.contact, companyId: supplierContact.companyId },
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
        customFields: supplierContact.customFields,
      },
    ])
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
      state?: string;
      postalCode?: string;
      // countryId: string;
    };
    customFields?: Json;
  }
) {
  const insertAddress = await client
    .from("address")
    .insert([
      { ...supplierLocation.address, companyId: supplierLocation.companyId },
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
        customFields: supplierLocation.customFields,
      },
    ])
    .select("id")
    .single();
}

export async function releasePurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  userId: string
) {
  return client
    .from("purchaseOrder")
    .update({
      status: "To Receive and Invoice",
      updatedAt: today(getLocalTimeZone()).toString(),
      updatedBy: userId,
    })
    .eq("id", purchaseOrderId);
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
    return client.from("supplier").insert([supplier]).select("*").single();
  }
  return client
    .from("supplier")
    .update({
      ...sanitize(supplier),
      updatedAt: today(getLocalTimeZone()).toString(),
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
        supplierLocationId: supplierContact.supplierLocationId,
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
      state?: string;
      // countryId: string;
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
        customFields: supplierLocation.customFields,
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
      })
) {
  if ("id" in purchaseOrder) {
    return client
      .from("purchaseOrder")
      .update(sanitize(purchaseOrder))
      .eq("id", purchaseOrder.id)
      .select("id, purchaseOrderId");
  }

  const [supplierPayment, supplierShipping, purchaser] = await Promise.all([
    getSupplierPayment(client, purchaseOrder.supplierId),
    getSupplierShipping(client, purchaseOrder.supplierId),
    getEmployeeJob(client, purchaseOrder.createdBy, purchaseOrder.companyId),
  ]);

  if (supplierPayment.error) return supplierPayment;
  if (supplierShipping.error) return supplierShipping;

  const {
    currencyCode,
    paymentTermId,
    invoiceSupplierId,
    invoiceSupplierContactId,
    invoiceSupplierLocationId,
  } = supplierPayment.data;

  const { shippingMethodId, shippingTermId } = supplierShipping.data;

  const locationId = purchaser?.data?.locationId ?? null;

  const order = await client
    .from("purchaseOrder")
    .insert([{ ...purchaseOrder }])
    .select("id, purchaseOrderId");

  if (order.error) return order;

  const purchaseOrderId = order.data[0].id;

  const [delivery, payment] = await Promise.all([
    client.from("purchaseOrderDelivery").insert([
      {
        id: purchaseOrderId,
        locationId: locationId,
        shippingMethodId: shippingMethodId,
        shippingTermId: shippingTermId,
        companyId: purchaseOrder.companyId,
      },
    ]),
    client.from("purchaseOrderPayment").insert([
      {
        id: purchaseOrderId,
        currencyCode: currencyCode ?? "USD",
        invoiceSupplierId: invoiceSupplierId,
        invoiceSupplierContactId: invoiceSupplierContactId,
        invoiceSupplierLocationId: invoiceSupplierLocationId,
        paymentTermId: paymentTermId,
        companyId: purchaseOrder.companyId,
      },
    ]),
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
