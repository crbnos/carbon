import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction
} from "~/modules/purchasing";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting/accounting.service";
import { getEmployeeJob } from "../people/people.service";
import {
  getCustomerPayment,
  getCustomerShipping
} from "../sales/sales.service";
import type {
  purchaseInvoiceDeliveryValidator,
  purchaseInvoiceLineValidator,
  purchaseInvoiceStatusType,
  purchaseInvoiceValidator,
  salesInvoiceLineValidator,
  salesInvoiceShipmentValidator,
  salesInvoiceStatusType,
  salesInvoiceValidator
} from "./invoicing.models";

export async function createPurchaseInvoiceFromPurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  companyId: string,
  userId: string
) {
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "purchaseOrderToPurchaseInvoice",
      id: purchaseOrderId,
      companyId,
      userId
    }
  });
}

export async function createSalesInvoiceFromSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  companyId: string,
  userId: string
) {
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "salesOrderToSalesInvoice",
      id: salesOrderId,
      companyId,
      userId
    }
  });
}

export async function createSalesInvoiceFromShipment(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string,
  userId: string
) {
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "shipmentToSalesInvoice",
      id: shipmentId,
      companyId,
      userId
    }
  });
}

export async function deletePurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  // Check if invoice is in Draft status before deleting
  const invoice = await client
    .from("purchaseInvoice")
    .select("id, status")
    .eq("id", purchaseInvoiceId)
    .single();

  if (invoice.error) {
    return invoice;
  }

  if (invoice.data.status !== "Draft") {
    return {
      data: null,
      error: {
        message: `Cannot delete purchase invoice with status "${invoice.data.status}". Only Draft invoices can be deleted.`,
        code: "INVOICE_NOT_DRAFT"
      }
    };
  }

  return client.from("purchaseInvoice").delete().eq("id", purchaseInvoiceId);
}

export async function deletePurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLineId: string
) {
  return client
    .from("purchaseInvoiceLine")
    .delete()
    .eq("id", purchaseInvoiceLineId);
}

export async function deleteSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  // Check if invoice is in Draft status before deleting
  const invoice = await client
    .from("salesInvoice")
    .select("id, status")
    .eq("id", salesInvoiceId)
    .single();

  if (invoice.error) {
    return invoice;
  }

  if (invoice.data.status !== "Draft") {
    return {
      data: null,
      error: {
        message: `Cannot delete sales invoice with status "${invoice.data.status}". Only Draft invoices can be deleted.`,
        code: "INVOICE_NOT_DRAFT"
      }
    };
  }

  return client.from("salesInvoice").delete().eq("id", salesInvoiceId);
}

export async function deleteSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLineId: string
) {
  return client.from("salesInvoiceLine").delete().eq("id", salesInvoiceLineId);
}

export async function getPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoices")
    .select("*")
    .eq("id", purchaseInvoiceId)
    .single();
}

export async function getPurchaseInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseInvoices")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("invoiceId", `%${args.search}%`);
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "invoiceId", ascending: false }
  ]);
  return query;
}

export async function getPurchaseInvoiceDelivery(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceDelivery")
    .select("*")
    .eq("id", purchaseInvoiceId)
    .single();
}

export async function getPurchaseInvoiceLines(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceLines")
    .select("*")
    .eq("invoiceId", purchaseInvoiceId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getPurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLineId: string
) {
  return client
    .from("purchaseInvoiceLine")
    .select("*")
    .eq("id", purchaseInvoiceLineId)
    .single();
}

export async function getSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoices")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoiceCustomerDetails(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceLocations")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    customerId: string | null;
  }
) {
  let query = client
    .from("salesInvoices")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("invoiceId", `%${args.search}%`);
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "invoiceId", ascending: false }
  ]);
  return query;
}

export async function getSalesInvoiceShipment(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceShipment")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoiceLines(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceLines")
    .select("*")
    .eq("invoiceId", salesInvoiceId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLineId: string
) {
  return client
    .from("salesInvoiceLine")
    .select("*")
    .eq("id", salesInvoiceLineId)
    .single();
}

export async function updatePurchaseInvoiceExchangeRate(
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

  return client.from("purchaseInvoice").update(update).eq("id", update.id);
}

export async function updatePurchaseInvoiceStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof purchaseInvoiceStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { status, ...rest } = update;

  // Set completedDate when status is Confirmed
  const updateData = {
    status,
    ...rest,
    ...(["Paid"].includes(status)
      ? { datePaid: now(getLocalTimeZone()).toAbsoluteString() }
      : {})
  };

  return client.from("purchaseInvoice").update(updateData).eq("id", update.id);
}

export async function updateSalesInvoiceExchangeRate(
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

  return client.from("salesInvoice").update(update).eq("id", update.id);
}

export async function updateSalesInvoiceStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof salesInvoiceStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  const { status, ...rest } = update;

  const updateData = {
    status,
    ...rest,
    ...(["Paid"].includes(status)
      ? { datePaid: now(getLocalTimeZone()).toAbsoluteString() }
      : {})
  };

  return client.from("salesInvoice").update(updateData).eq("id", update.id);
}

export async function insertPurchaseInvoice(
  client: SupabaseClient<Database>,
  input: {
    supplierId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    invoiceId?: string;
    supplierReference?: string;
    paymentTermId?: string;
    currencyCode?: string;
    locationId?: string;
    invoiceSupplierId?: string;
    invoiceSupplierContactId?: string;
    invoiceSupplierLocationId?: string;
    dateIssued?: string;
    dateDue?: string;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; invoiceId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let invoiceId: string;
  if (input.invoiceId) {
    invoiceId = input.invoiceId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "purchaseInvoice",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate purchaseInvoice sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    invoiceId = seq.data;
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

  const { paymentTermId, invoiceSupplierId } = supplierPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  let exchangeRate = input.exchangeRate ?? 1;
  let exchangeRateUpdatedAt =
    input.exchangeRateUpdatedAt ?? new Date().toISOString();

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

  const invoice = await client
    .from("purchaseInvoice")
    .insert({
      invoiceId,
      supplierId: input.supplierId,
      supplierReference: input.supplierReference ?? null,
      invoiceSupplierId:
        input.invoiceSupplierId ?? invoiceSupplierId ?? input.supplierId,
      invoiceSupplierContactId: input.invoiceSupplierContactId ?? null,
      invoiceSupplierLocationId: input.invoiceSupplierLocationId ?? null,
      supplierInteractionId: supplierInteraction.data?.id,
      currencyCode: input.currencyCode ?? "USD",
      exchangeRate,
      exchangeRateUpdatedAt,
      paymentTermId: input.paymentTermId ?? paymentTermId,
      dateIssued: input.dateIssued ?? today(getLocalTimeZone()).toString(),
      dateDue: input.dateDue ?? null,
      locationId,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, invoiceId")
    .single();

  if (invoice.error) return { data: null, error: invoice.error };

  const delivery = await client.from("purchaseInvoiceDelivery").insert({
    id: invoice.data.id,
    locationId,
    shippingMethodId,
    shippingTermId,
    incoterm,
    incotermLocation,
    companyId: input.companyId
  });

  if (delivery.error) {
    await client.from("purchaseInvoice").delete().eq("id", invoice.data.id);
    return { data: null, error: delivery.error };
  }

  return {
    data: { id: invoice.data.id, invoiceId: invoice.data.invoiceId },
    error: null
  };
}

export async function updatePurchaseInvoice(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    invoiceId?: string;
    supplierId?: string;
    supplierReference?: string | null;
    paymentTermId?: string | null;
    currencyCode?: string;
    locationId?: string;
    invoiceSupplierId?: string | null;
    invoiceSupplierContactId?: string | null;
    invoiceSupplierLocationId?: string | null;
    dateIssued?: string | null;
    dateDue?: string | null;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("purchaseInvoice")
    .update({
      ...sanitize(rest),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

/** @deprecated Use insertPurchaseInvoice for new invoices, updatePurchaseInvoice for existing invoices */
export async function upsertPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoice:
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        id: string;
        invoiceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseInvoice) {
    return client
      .from("purchaseInvoice")
      .update({
        ...sanitize(purchaseInvoice),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", purchaseInvoice.id)
      .select("id, invoiceId");
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(
        client,
        purchaseInvoice.companyId,
        purchaseInvoice.supplierId
      ),
      getSupplierPayment(client, purchaseInvoice.supplierId),
      getSupplierShipping(client, purchaseInvoice.supplierId),
      getEmployeeJob(
        client,
        purchaseInvoice.createdBy,
        purchaseInvoice.companyId
      )
    ]);

  if (supplierInteraction.error) return supplierInteraction;
  if (supplierPayment.error) return supplierPayment;
  if (supplierShipping.error) return supplierShipping;

  const { paymentTermId, invoiceSupplierId } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  if (purchaseInvoice.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      purchaseInvoice.companyGroupId,
      purchaseInvoice.currencyCode
    );
    if (currency.data) {
      purchaseInvoice.exchangeRate = currency.data.exchangeRate ?? undefined;
      purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    purchaseInvoice.exchangeRate = 1;
    purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    purchaseInvoice.locationId ?? purchaser?.data?.locationId ?? null;

  const { companyGroupId: _companyGroupId, ...purchaseInvoiceData } =
    purchaseInvoice;

  const invoice = await client
    .from("purchaseInvoice")
    .insert([
      {
        ...purchaseInvoiceData,
        invoiceSupplierId: invoiceSupplierId ?? purchaseInvoice.supplierId,
        supplierInteractionId: supplierInteraction.data?.id,
        currencyCode: purchaseInvoice.currencyCode ?? "USD",
        paymentTermId: purchaseInvoice.paymentTermId ?? paymentTermId
      }
    ])
    .select("id, invoiceId");

  if (invoice.error) return invoice;

  const invoiceId = invoice.data[0].id;

  const delivery = await client.from("purchaseInvoiceDelivery").insert([
    {
      id: invoiceId,
      locationId: locationId,
      shippingMethodId: shippingMethodId,
      shippingTermId: shippingTermId,
      incoterm: incoterm,
      incotermLocation: incotermLocation,
      companyId: purchaseInvoice.companyId
    }
  ]);

  if (delivery.error) {
    await client.from("purchaseInvoice").delete().eq("id", invoiceId);
    return delivery;
  }

  return invoice;
}

export async function upsertPurchaseInvoiceDelivery(
  client: SupabaseClient<Database>,
  purchaseInvoiceDelivery:
    | (z.infer<typeof purchaseInvoiceDeliveryValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof purchaseInvoiceDeliveryValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseInvoiceDelivery) {
    return client
      .from("purchaseInvoiceDelivery")
      .update(sanitize(purchaseInvoiceDelivery))
      .eq("id", purchaseInvoiceDelivery.id)
      .select("id")
      .single();
  }
  return client
    .from("purchaseInvoiceDelivery")
    .insert([purchaseInvoiceDelivery])
    .select("id")
    .single();
}

export async function upsertPurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLine:
    | (Omit<z.infer<typeof purchaseInvoiceLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseInvoiceLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseInvoiceLine) {
    return client
      .from("purchaseInvoiceLine")
      .update(sanitize(purchaseInvoiceLine))
      .eq("id", purchaseInvoiceLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("purchaseInvoiceLine")
    .select("sortOrder")
    .eq("invoiceId", purchaseInvoiceLine.invoiceId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("purchaseInvoiceLine")
    .insert([{ ...purchaseInvoiceLine, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updatePurchaseInvoiceLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchaseInvoiceLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function insertSalesInvoice(
  client: SupabaseClient<Database>,
  input: {
    customerId: string;
    companyId: string;
    companyGroupId: string;
    createdBy: string;
    invoiceId?: string;
    customerReference?: string;
    paymentTermId?: string;
    currencyCode?: string;
    locationId?: string;
    invoiceCustomerId?: string;
    invoiceCustomerContactId?: string;
    invoiceCustomerLocationId?: string;
    dateIssued?: string;
    dateDue?: string;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string; invoiceId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let invoiceId: string;
  if (input.invoiceId) {
    invoiceId = input.invoiceId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "salesInvoice",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate salesInvoice sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    invoiceId = seq.data;
  }

  const [opportunity, customerPayment, customerShipping, salesPerson] =
    await Promise.all([
      client
        .from("opportunity")
        .insert({
          companyId: input.companyId,
          customerId: input.customerId
        })
        .select("id")
        .single(),
      getCustomerPayment(client, input.customerId),
      getCustomerShipping(client, input.customerId),
      getEmployeeJob(client, input.createdBy, input.companyId)
    ]);

  if (opportunity.error) return { data: null, error: opportunity.error };
  if (customerPayment.error)
    return { data: null, error: customerPayment.error };
  if (customerShipping.error)
    return { data: null, error: customerShipping.error };

  const { paymentTermId, invoiceCustomerId } = customerPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  let exchangeRate = input.exchangeRate ?? 1;
  let exchangeRateUpdatedAt =
    input.exchangeRateUpdatedAt ?? new Date().toISOString();

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

  const locationId = input.locationId ?? salesPerson?.data?.locationId ?? null;

  const invoice = await client
    .from("salesInvoice")
    .insert({
      invoiceId,
      customerId: input.customerId,
      customerReference: input.customerReference ?? null,
      invoiceCustomerId:
        input.invoiceCustomerId ?? invoiceCustomerId ?? input.customerId,
      invoiceCustomerContactId: input.invoiceCustomerContactId ?? null,
      invoiceCustomerLocationId: input.invoiceCustomerLocationId ?? null,
      opportunityId: opportunity.data?.id,
      currencyCode: input.currencyCode ?? "USD",
      exchangeRate,
      exchangeRateUpdatedAt,
      paymentTermId: input.paymentTermId ?? paymentTermId,
      dateIssued: input.dateIssued ?? today(getLocalTimeZone()).toString(),
      dateDue: input.dateDue ?? null,
      locationId,
      customFields: input.customFields,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, invoiceId")
    .single();

  if (invoice.error) return { data: null, error: invoice.error };

  const delivery = await client.from("salesInvoiceShipment").insert({
    id: invoice.data.id,
    locationId,
    shippingMethodId,
    shippingTermId,
    incoterm,
    incotermLocation,
    companyId: input.companyId,
    createdBy: input.createdBy
  });

  if (delivery.error) {
    await client.from("salesInvoice").delete().eq("id", invoice.data.id);
    return { data: null, error: delivery.error };
  }

  return {
    data: { id: invoice.data.id, invoiceId: invoice.data.invoiceId },
    error: null
  };
}

export async function updateSalesInvoice(
  client: SupabaseClient<Database>,
  input: {
    id: string;
    updatedBy: string;
    invoiceId?: string;
    customerId?: string;
    customerReference?: string | null;
    paymentTermId?: string | null;
    currencyCode?: string;
    locationId?: string;
    invoiceCustomerId?: string | null;
    invoiceCustomerContactId?: string | null;
    invoiceCustomerLocationId?: string | null;
    dateIssued?: string | null;
    dateDue?: string | null;
    exchangeRate?: number;
    exchangeRateUpdatedAt?: string;
    customFields?: Json;
  }
): Promise<{
  data: { id: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  const { id, ...rest } = input;
  const result = await client
    .from("salesInvoice")
    .update({
      ...sanitize(rest),
      updatedAt: today(getLocalTimeZone()).toString()
    })
    .eq("id", id)
    .select("id")
    .single();

  if (result.error) return { data: null, error: result.error };
  return { data: { id: result.data.id }, error: null };
}

/** @deprecated Use insertSalesInvoice for new invoices, updateSalesInvoice for existing invoices */
export async function upsertSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoice:
    | (Omit<z.infer<typeof salesInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesInvoiceValidator>, "id" | "invoiceId"> & {
        id: string;
        invoiceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoice) {
    return client
      .from("salesInvoice")
      .update({
        ...sanitize(salesInvoice),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", salesInvoice.id)
      .select("id, invoiceId");
  }

  const [opportunity, customerPayment, customerShipping, salesPerson] =
    await Promise.all([
      client
        .from("opportunity")
        .insert([
          {
            companyId: salesInvoice.companyId,
            customerId: salesInvoice.customerId
          }
        ])
        .select("id")
        .single(),
      getCustomerPayment(client, salesInvoice.customerId),
      getCustomerShipping(client, salesInvoice.customerId),
      getEmployeeJob(client, salesInvoice.createdBy, salesInvoice.companyId)
    ]);

  if (opportunity.error) return opportunity;
  if (customerPayment.error) return customerPayment;
  if (customerShipping.error) return customerShipping;

  const { paymentTermId, invoiceCustomerId } = customerPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  if (salesInvoice.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      salesInvoice.companyGroupId,
      salesInvoice.currencyCode
    );
    if (currency.data) {
      salesInvoice.exchangeRate = currency.data.exchangeRate ?? undefined;
      salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    salesInvoice.exchangeRate = 1;
    salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    salesInvoice.locationId ?? salesPerson?.data?.locationId ?? null;

  const { companyGroupId: _companyGroupId, ...salesInvoiceData } = salesInvoice;

  const invoice = await client
    .from("salesInvoice")
    .insert([
      {
        ...salesInvoiceData,
        invoiceCustomerId: invoiceCustomerId ?? salesInvoice.customerId,
        opportunityId: opportunity.data?.id,
        currencyCode: salesInvoice.currencyCode ?? "USD",
        paymentTermId: salesInvoice.paymentTermId ?? paymentTermId
      }
    ])
    .select("id, invoiceId");

  if (invoice.error) return invoice;

  const invoiceId = invoice.data[0].id;

  const delivery = await client.from("salesInvoiceShipment").insert([
    {
      id: invoiceId,
      locationId: locationId,
      shippingMethodId: shippingMethodId,
      shippingTermId: shippingTermId,
      incoterm: incoterm,
      incotermLocation: incotermLocation,
      companyId: salesInvoice.companyId,
      createdBy: salesInvoice.createdBy
    }
  ]);

  if (delivery.error) {
    await client.from("salesInvoice").delete().eq("id", invoiceId);
    return delivery;
  }

  return invoice;
}

export async function upsertSalesInvoiceShipment(
  client: SupabaseClient<Database>,
  salesInvoiceShipment:
    | (z.infer<typeof salesInvoiceShipmentValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesInvoiceShipmentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoiceShipment) {
    return client
      .from("salesInvoiceShipment")
      .update(sanitize(salesInvoiceShipment))
      .eq("id", salesInvoiceShipment.id)
      .select("id")
      .single();
  }
  return client
    .from("salesInvoiceShipment")
    .insert([salesInvoiceShipment])
    .select("id")
    .single();
}

export async function upsertSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLine:
    | (Omit<z.infer<typeof salesInvoiceLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesInvoiceLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoiceLine) {
    return client
      .from("salesInvoiceLine")
      .update(sanitize(salesInvoiceLine))
      .eq("id", salesInvoiceLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("salesInvoiceLine")
    .select("sortOrder")
    .eq("invoiceId", salesInvoiceLine.invoiceId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("salesInvoiceLine")
    .insert([{ ...salesInvoiceLine, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updateSalesInvoiceLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("salesInvoiceLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}
