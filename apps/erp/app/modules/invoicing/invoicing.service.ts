import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLocalTimeZone, today } from "@internationalized/date";
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
  invoiceSettlementValidator,
  memoValidator,
  PaymentStatusType,
  paymentValidator,
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
    updatedBy: string;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString(),
    updatedBy: data.updatedBy,
    updatedAt: new Date().toISOString()
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
    datePaid?: string | null;
  }
) {
  // Partially Paid / Overdue are derived in the purchaseInvoices view from
  // invoiceSettlement. Base-status 'Paid' is the manual/legacy/Xero "settled"
  // signal honored by the views and aging/tie-out RPCs; the route enforces
  // that manual 'Paid' is only allowed when accounting is disabled.
  if (update.status === "Partially Paid" || update.status === "Overdue") {
    return {
      data: null,
      error: {
        message: `Cannot set status to ${update.status} directly — this status is derived from payment applications.`
      }
    };
  }

  return client.from("purchaseInvoice").update(update).eq("id", update.id);
}

export async function updateSalesInvoiceExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
    updatedBy: string;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString(),
    updatedBy: data.updatedBy,
    updatedAt: new Date().toISOString()
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
    datePaid?: string | null;
  }
) {
  // Partially Paid / Overdue are derived in the salesInvoices view from
  // invoiceSettlement. Base-status 'Paid' is the manual/legacy/Xero "settled"
  // signal honored by the views and aging/tie-out RPCs; the route enforces
  // that manual 'Paid' is only allowed when accounting is disabled.
  if (update.status === "Partially Paid" || update.status === "Overdue") {
    return {
      data: null,
      error: {
        message: `Cannot set status to ${update.status} directly — this status is derived from payment applications.`
      }
    };
  }

  return client.from("salesInvoice").update(update).eq("id", update.id);
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
    supplierShippingCost?: number;
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
    supplierShippingCost: input.supplierShippingCost ?? 0,
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

// ======================================================================
// Payments (AR receipts + AP disbursements + applications)
// ======================================================================

export async function getPayment(client: SupabaseClient<Database>, id: string) {
  return client.from("payment").select("*").eq("id", id).single();
}

export async function getPayments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    paymentType: "Receipt" | "Disbursement" | null;
    status: PaymentStatusType | null;
    customerId: string | null;
    supplierId: string | null;
    // Combined counterparty filter (customer OR supplier ids) from the table's
    // "Counterparty" filter, which sources options from both stores.
    counterpartyIds?: string[] | null;
  }
) {
  let query = client
    .from("payment")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("paymentId", `%${args.search}%`);
  }
  if (args.paymentType) {
    query = query.eq("paymentType", args.paymentType);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }
  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }
  if (args.counterpartyIds && args.counterpartyIds.length > 0) {
    // A payment carries either customerId or supplierId; match the selected
    // ids against both columns (customer/supplier id spaces don't overlap).
    const csv = args.counterpartyIds.join(",");
    query = query.or(`customerId.in.(${csv}),supplierId.in.(${csv})`);
  }

  // Default to newest first by the sequential paymentId (PAY-yyyy-mm-NNNNNN),
  // matching the sales/purchase invoice lists (invoiceId desc) and guaranteeing
  // the most recently created payment is at the top (paymentDate ties otherwise).
  query = setGenericQueryFilters(query, args, [
    { column: "paymentId", ascending: false }
  ]);
  return query;
}

export async function getInvoiceSettlements(
  client: SupabaseClient<Database>,
  companyId: string,
  paymentId: string
) {
  // Embed the invoice's human-readable id (salesInvoice/purchaseInvoice.invoiceId)
  // so the UI can show "AP000001" rather than the raw FK id.
  return client
    .from("invoiceSettlement")
    .select(
      "*, salesInvoice:targetSalesInvoiceId(invoiceId), purchaseInvoice:targetPurchaseInvoiceId(invoiceId)"
    )
    .eq("companyId", companyId)
    .eq("paymentId", paymentId)
    .order("appliedDate", { ascending: true });
}

// A settlement against an invoice can be sourced by either a cash payment or a
// credit/debit memo — both are invoiceSettlement rows. The panel shows them
// together, so the source is a tagged union.
export type InvoiceSettlementSource =
  | {
      type: "payment";
      id: string;
      readableId: string;
      status: string | null;
      date: string | null;
      currencyCode: string;
    }
  | {
      type: "memo";
      id: string;
      readableId: string;
      status: string | null;
      date: string | null;
      currencyCode: string;
      direction: string;
    };

export type InvoiceSettlementForInvoice = {
  id: string;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number | null;
  targetExchangeRate: number;
  sourceExchangeRate: number;
  appliedDate: string;
  source: InvoiceSettlementSource;
};

// Posted settlements against a specific invoice — BOTH cash payments and applied
// credit/debit memos. Used by the "Applied" panel on the sales/purchase invoice
// detail page. Two-step query (settlements, then their parent payments/memos)
// dodges the supabase JS type depth limit a !inner join hits, and lets us drop
// settlements whose source is still Draft/Voided.
export async function getInvoiceSettlementsForInvoice(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase",
  invoiceId: string
): Promise<{
  data: InvoiceSettlementForInvoice[] | null;
  error: unknown;
}> {
  const column =
    side === "sales" ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId";
  const apps = await client
    .from("invoiceSettlement")
    .select(
      "id, paymentId, memoId, appliedViaPaymentId, appliedAmount, discountAmount, writeOffAmount, fxGainLossAmount, targetExchangeRate, sourceExchangeRate, appliedDate"
    )
    .eq("companyId", companyId)
    .eq(column, invoiceId)
    .order("appliedDate", { ascending: false });

  if (apps.error) return { data: null, error: apps.error };
  if (!apps.data || apps.data.length === 0) return { data: [], error: null };

  const paymentIds = apps.data
    .map((a) => a.paymentId)
    .filter((id): id is string => Boolean(id));
  const memoIds = apps.data
    .map((a) => (a as { memoId: string | null }).memoId)
    .filter((id): id is string => Boolean(id));

  const [payments, memos] = await Promise.all([
    paymentIds.length > 0
      ? client
          .from("payment")
          .select("id, paymentId, status, paymentDate, currencyCode")
          .in("id", paymentIds)
          .eq("status", "Posted")
      : Promise.resolve({ data: [], error: null }),
    memoIds.length > 0
      ? client
          .from("memo")
          .select(
            "id, memoId, status, postingDate, memoDate, currencyCode, direction"
          )
          .in("id", memoIds)
          .eq("status", "Posted")
      : Promise.resolve({ data: [], error: null })
  ]);

  if (payments.error) return { data: null, error: payments.error };
  if (memos.error) return { data: null, error: memos.error };

  // deno-lint-ignore no-explicit-any
  const paymentById = new Map(
    ((payments.data ?? []) as any[]).map((p) => [p.id, p])
  );
  // deno-lint-ignore no-explicit-any
  const memoById = new Map(((memos.data ?? []) as any[]).map((m) => [m.id, m]));

  // A credit applied through a payment is staged on that payment and only counts
  // once the payment is Posted (mirrors the invoice-balance view gating).
  const viaPaymentIds = apps.data
    .map(
      (a) => (a as { appliedViaPaymentId: string | null }).appliedViaPaymentId
    )
    .filter((id): id is string => Boolean(id));
  const postedViaPayments =
    viaPaymentIds.length > 0
      ? await client
          .from("payment")
          .select("id")
          .in("id", viaPaymentIds)
          .eq("status", "Posted")
      : { data: [] as { id: string }[], error: null };
  if (postedViaPayments.error)
    return { data: null, error: postedViaPayments.error };
  const postedViaSet = new Set(
    ((postedViaPayments.data ?? []) as { id: string }[]).map((p) => p.id)
  );

  const merged: InvoiceSettlementForInvoice[] = [];
  for (const a of apps.data) {
    const memoId = (a as { memoId: string | null }).memoId;
    let source: InvoiceSettlementSource | null = null;
    if (a.paymentId && paymentById.has(a.paymentId)) {
      const p = paymentById.get(a.paymentId);
      source = {
        type: "payment",
        id: p.id,
        readableId: p.paymentId,
        status: p.status,
        date: p.paymentDate,
        currencyCode: p.currencyCode
      };
    } else if (memoId && memoById.has(memoId)) {
      const viaId = (a as { appliedViaPaymentId: string | null })
        .appliedViaPaymentId;
      // Staged on a Draft payment — not applied yet, so omit it from the card.
      if (viaId && !postedViaSet.has(viaId)) continue;
      const m = memoById.get(memoId);
      source = {
        type: "memo",
        id: m.id,
        readableId: m.memoId,
        status: m.status,
        date: m.postingDate ?? m.memoDate,
        currencyCode: m.currencyCode,
        direction: m.direction
      };
    }
    // Skip settlements whose source isn't Posted (a Draft/Voided payment/memo).
    if (!source) continue;
    merged.push({
      id: a.id,
      appliedAmount: Number(a.appliedAmount),
      discountAmount: Number(a.discountAmount),
      writeOffAmount: Number(a.writeOffAmount),
      fxGainLossAmount:
        a.fxGainLossAmount == null ? null : Number(a.fxGainLossAmount),
      targetExchangeRate: Number(a.targetExchangeRate),
      sourceExchangeRate: Number(a.sourceExchangeRate),
      appliedDate: a.appliedDate,
      source
    });
  }

  return { data: merged, error: null };
}

// Where a posted credit/debit memo's balance went — the documents it has been
// applied to. The reverse of the invoice "Payments" panel: drives the "Applied To"
// card on the memo detail page so you can see at a glance which invoices a memo
// settled without opening each one. Target is a tagged union (sales/purchase
// invoice, or another memo when refunding a balance-increasing memo).
export type MemoApplication = {
  id: string;
  appliedAmount: number;
  appliedDate: string;
  target:
    | { type: "salesInvoice"; id: string; readableId: string }
    | { type: "purchaseInvoice"; id: string; readableId: string }
    | { type: "memo"; id: string; readableId: string };
};

export async function getMemoApplications(
  client: SupabaseClient<Database>,
  memoId: string
): Promise<{ data: MemoApplication[] | null; error: unknown }> {
  // Embed the target documents' human-readable ids so the card can link out.
  const settlements = await client
    .from("invoiceSettlement")
    .select(
      "id, appliedAmount, appliedDate, appliedViaPaymentId, targetSalesInvoiceId, targetPurchaseInvoiceId, targetMemoId, salesInvoice:targetSalesInvoiceId(invoiceId), purchaseInvoice:targetPurchaseInvoiceId(invoiceId), targetMemo:targetMemoId(memoId)"
    )
    .eq("memoId", memoId)
    .order("appliedDate", { ascending: false });

  if (settlements.error) return { data: null, error: settlements.error };
  if (!settlements.data || settlements.data.length === 0)
    return { data: [], error: null };

  // A credit applied through a payment only takes effect once that payment is
  // Posted (mirrors getInvoiceSettlementsForInvoice and the balance views).
  const viaPaymentIds = (
    settlements.data as { appliedViaPaymentId: string | null }[]
  )
    .map((s) => s.appliedViaPaymentId)
    .filter((id): id is string => Boolean(id));
  const postedViaPayments =
    viaPaymentIds.length > 0
      ? await client
          .from("payment")
          .select("id")
          .in("id", viaPaymentIds)
          .eq("status", "Posted")
      : { data: [] as { id: string }[], error: null };
  if (postedViaPayments.error)
    return { data: null, error: postedViaPayments.error };
  const postedViaSet = new Set(
    ((postedViaPayments.data ?? []) as { id: string }[]).map((p) => p.id)
  );

  const rows: MemoApplication[] = [];
  // deno-lint-ignore no-explicit-any
  for (const s of settlements.data as any[]) {
    // Staged on a Draft payment — not applied yet, so omit it.
    if (s.appliedViaPaymentId && !postedViaSet.has(s.appliedViaPaymentId))
      continue;

    let target: MemoApplication["target"] | null = null;
    if (s.targetSalesInvoiceId) {
      target = {
        type: "salesInvoice",
        id: s.targetSalesInvoiceId,
        readableId: s.salesInvoice?.invoiceId ?? s.targetSalesInvoiceId
      };
    } else if (s.targetPurchaseInvoiceId) {
      target = {
        type: "purchaseInvoice",
        id: s.targetPurchaseInvoiceId,
        readableId: s.purchaseInvoice?.invoiceId ?? s.targetPurchaseInvoiceId
      };
    } else if (s.targetMemoId) {
      target = {
        type: "memo",
        id: s.targetMemoId,
        readableId: s.targetMemo?.memoId ?? s.targetMemoId
      };
    }
    if (!target) continue;

    rows.push({
      id: s.id,
      appliedAmount: Number(s.appliedAmount),
      appliedDate: s.appliedDate,
      target
    });
  }

  return { data: rows, error: null };
}

// Open sales invoices for a customer (active status and a positive
// balance). Drives the apply table on the AR payment detail.
export async function getOpenSalesInvoicesForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string
) {
  return client
    .from("salesInvoices")
    .select(
      "id, invoiceId, dateDue, currencyCode, exchangeRate, totalAmount, balance, status"
    )
    .eq("companyId", companyId)
    .eq("customerId", customerId)
    .in("status", ["Submitted", "Partially Paid", "Overdue"])
    .gt("balance", 0)
    .order("dateDue", { ascending: true });
}

export async function getOpenPurchaseInvoicesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string
) {
  return client
    .from("purchaseInvoices")
    .select(
      "id, invoiceId, dateDue, currencyCode, exchangeRate, totalAmount, balance, status"
    )
    .eq("companyId", companyId)
    .eq("supplierId", supplierId)
    .in("status", ["Open", "Partially Paid", "Overdue"])
    .gt("balance", 0)
    .order("dateDue", { ascending: true });
}

// The party's available on-account credit in BASE currency: the net unapplied
// cash across their posted payments (Σ cash − Σ applied). This is the pool a new
// payment may draw on when it applies more than its own cash. Mirrors the
// authoritative check in the post-payment edge function; returns 0 on any read
// error (conservative — posting re-validates under lock). Returns base currency;
// callers convert to the payment's currency for display via the exchange rate.
export async function getAvailableOnAccountCredit(
  client: SupabaseClient<Database>,
  companyId: string,
  party:
    | { paymentType: "Receipt"; customerId: string }
    | { paymentType: "Disbursement"; supplierId: string }
): Promise<number> {
  let query = client
    .from("payment")
    .select("id, totalAmount, exchangeRate")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .eq("paymentType", party.paymentType);
  query =
    party.paymentType === "Receipt"
      ? query.eq("customerId", party.customerId)
      : query.eq("supplierId", party.supplierId);

  const payments = await query;
  if (payments.error || !payments.data || payments.data.length === 0) return 0;

  const apps = await client
    .from("invoiceSettlement")
    .select("paymentId, appliedAmount, sourceExchangeRate")
    .eq("companyId", companyId)
    .in(
      "paymentId",
      payments.data.map((p) => p.id)
    );
  if (apps.error) return 0;

  const appliedBaseByPayment = new Map<string, number>();
  for (const a of apps.data ?? []) {
    if (!a.paymentId) continue;
    appliedBaseByPayment.set(
      a.paymentId,
      (appliedBaseByPayment.get(a.paymentId) ?? 0) +
        Number(a.appliedAmount) * Number(a.sourceExchangeRate)
    );
  }

  let baseCredit = 0;
  for (const p of payments.data) {
    baseCredit +=
      Number(p.totalAmount) * Number(p.exchangeRate) -
      (appliedBaseByPayment.get(p.id) ?? 0);
  }
  return Math.max(0, Math.round(baseCredit * 10000) / 10000);
}

export async function upsertPayment(
  client: SupabaseClient<Database>,
  payment:
    | (Omit<z.infer<typeof paymentValidator>, "id" | "paymentId"> & {
        paymentId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof paymentValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in payment) {
    return client
      .from("payment")
      .insert([sanitize(payment)])
      .select("id, paymentId")
      .single();
  }
  return client
    .from("payment")
    .update(sanitize(payment))
    .eq("id", payment.id)
    .select("id, paymentId")
    .single();
}

// RLS DELETE policy on payment restricts to status='Draft'.
export async function deletePayment(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("payment").delete().eq("id", id);
}

export async function upsertInvoiceSettlement(
  client: SupabaseClient<Database>,
  app:
    | (Omit<z.infer<typeof invoiceSettlementValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof invoiceSettlementValidator>, "id"> & {
        id: string;
      })
) {
  if ("createdBy" in app) {
    return client
      .from("invoiceSettlement")
      .insert([sanitize(app)])
      .select("id")
      .single();
  }
  return client
    .from("invoiceSettlement")
    .update(sanitize(app))
    .eq("id", app.id)
    .select("id")
    .single();
}

// RLS DELETE policy requires parent payment.status='Draft'.
export async function deleteInvoiceSettlement(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("invoiceSettlement").delete().eq("id", id);
}

// Replace-all for the apply table. The delete + insert run in a single
// transaction so a failed insert can never leave the payment with its
// applications wiped and nothing in their place. Kysely bypasses RLS, so we
// re-assert the payment is Draft inside the txn — the FOR UPDATE lock also
// serializes this against a concurrent post/void of the same payment.
export async function replaceInvoiceSettlements(
  db: Kysely<KyselyDatabase>,
  args: {
    paymentId: string;
    companyId: string;
    createdBy: string;
    applications: Omit<
      z.infer<typeof invoiceSettlementValidator>,
      "id" | "paymentId"
    >[];
  }
) {
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .select(["id", "status", "paymentType", "customerId", "supplierId"])
      .where("id", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!payment) {
      throw new Error("Payment not found");
    }
    if (payment.status !== "Draft") {
      throw new Error(
        "Applications can only be edited while the payment is Draft"
      );
    }

    await trx
      .deleteFrom("invoiceSettlement")
      .where("paymentId", "=", args.paymentId)
      .execute();

    if (args.applications.length === 0) return;

    // Guard the source→target relationship before inserting. Kysely bypasses
    // RLS, so this is the only enforcement point for the cash path: a Receipt
    // may only settle ITS customer's sales invoices, a Disbursement only ITS
    // supplier's purchase invoices. (Memo targets aren't persisted here — the
    // insert below maps only invoice targets — so reject them rather than write
    // an orphan row with every target FK null.)
    if (args.applications.some((a) => a.targetMemoId)) {
      throw new Error("Settling a memo from a payment is not supported here");
    }
    const isReceipt = payment.paymentType === "Receipt";
    const salesInvoiceIds = [
      ...new Set(
        args.applications
          .map((a) => a.targetSalesInvoiceId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const purchaseInvoiceIds = [
      ...new Set(
        args.applications
          .map((a) => a.targetPurchaseInvoiceId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (isReceipt && purchaseInvoiceIds.length > 0) {
      throw new Error("A receipt can only be applied to sales invoices");
    }
    if (!isReceipt && salesInvoiceIds.length > 0) {
      throw new Error(
        "A disbursement can only be applied to purchase invoices"
      );
    }
    if (salesInvoiceIds.length > 0) {
      const rows = await trx
        .selectFrom("salesInvoice")
        .select(["id", "customerId"])
        .where("id", "in", salesInvoiceIds)
        .where("companyId", "=", args.companyId)
        .execute();
      const customerById = new Map(rows.map((r) => [r.id, r.customerId]));
      for (const id of salesInvoiceIds) {
        if (!customerById.has(id))
          throw new Error(`Sales invoice ${id} not found`);
        if (customerById.get(id) !== payment.customerId)
          throw new Error(
            "A payment can only be applied to its own customer's invoices"
          );
      }
    }
    if (purchaseInvoiceIds.length > 0) {
      const rows = await trx
        .selectFrom("purchaseInvoice")
        .select(["id", "supplierId"])
        .where("id", "in", purchaseInvoiceIds)
        .where("companyId", "=", args.companyId)
        .execute();
      const supplierById = new Map(rows.map((r) => [r.id, r.supplierId]));
      for (const id of purchaseInvoiceIds) {
        if (!supplierById.has(id))
          throw new Error(`Purchase invoice ${id} not found`);
        if (supplierById.get(id) !== payment.supplierId)
          throw new Error(
            "A payment can only be applied to its own supplier's invoices"
          );
      }
    }

    await trx
      .insertInto("invoiceSettlement")
      .values(
        args.applications.map((a) => ({
          paymentId: args.paymentId,
          companyId: args.companyId,
          createdBy: args.createdBy,
          targetSalesInvoiceId: a.targetSalesInvoiceId ?? null,
          targetPurchaseInvoiceId: a.targetPurchaseInvoiceId ?? null,
          appliedAmount: a.appliedAmount,
          discountAmount: a.discountAmount,
          writeOffAmount: a.writeOffAmount,
          targetExchangeRate: a.targetExchangeRate,
          sourceExchangeRate: a.sourceExchangeRate,
          appliedDate: a.appliedDate
        }))
      )
      .execute();
  });
}

// Memos (credit/debit). A memo is payment-shaped: a party (customer XOR
// supplier), a signed amount against a reason GL account, and a set of
// invoiceSettlement applications (memo as SOURCE) to open invoices of the same
// party. Direction (Credit/Debit) is the discriminator; numbering uses the
// creditMemo / debitMemo sequences. Posting is handled by the post-memo edge
// function; the apply table is editable only while the memo is Draft.

export async function getMemo(client: SupabaseClient<Database>, id: string) {
  return client.from("memo").select("*").eq("id", id).single();
}

export async function getMemos(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    direction: "Credit" | "Debit" | null;
    status: "Draft" | "Posted" | "Voided" | null;
    counterpartyIds: string[] | null;
  }
) {
  let query = client
    .from("memo")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("memoId", `%${args.search}%`);
  }
  if (args.direction) {
    query = query.eq("direction", args.direction);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.counterpartyIds && args.counterpartyIds.length > 0) {
    // A memo carries either customerId or supplierId; match the selected ids
    // against both columns (customer/supplier id spaces don't overlap).
    const csv = args.counterpartyIds.join(",");
    query = query.or(`customerId.in.(${csv}),supplierId.in.(${csv})`);
  }

  // Newest first by creation date (not the readable memoId — Credit and Debit
  // share the table but use separate CR-/DR- sequences, so a memoId sort
  // interleaves them oddly).
  query = setGenericQueryFilters(query, args, [
    { column: "createdAt", ascending: false }
  ]);
  return query;
}

export async function upsertMemo(
  client: SupabaseClient<Database>,
  memo:
    | (Omit<z.infer<typeof memoValidator>, "id" | "memoId"> & {
        memoId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof memoValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in memo) {
    return client
      .from("memo")
      .insert([sanitize(memo)])
      .select("id, memoId")
      .single();
  }
  return client
    .from("memo")
    .update(sanitize(memo))
    .eq("id", memo.id)
    .select("id, memoId")
    .single();
}

// RLS DELETE policy on memo restricts to status='Draft'.
export async function deleteMemo(client: SupabaseClient<Database>, id: string) {
  return client.from("memo").delete().eq("id", id);
}

// The party's available credit to draw on when clearing invoices alongside cash:
// their POSTED, balance-reducing memos with credit remaining. A customer's Credit
// memos reduce AR (apply to sales invoices); a supplier's Debit memos reduce AP
// (apply to purchase invoices). `remaining` = amount − Σ already applied (memo as
// settlement source). Drives the credits section of the invoice "Receive Payment"
// composer.
export async function getAvailableCreditsForParty(
  client: SupabaseClient<Database>,
  companyId: string,
  party:
    | { side: "sales"; customerId: string }
    | { side: "purchase"; supplierId: string },
  // When editing a Draft payment's composer, that payment's own staged credits
  // should NOT count as used — they show as staged, not consumed.
  excludePaymentId?: string
): Promise<{
  data:
    | {
        id: string;
        memoId: string;
        direction: string;
        currencyCode: string;
        exchangeRate: number;
        amount: number;
        remaining: number;
      }[]
    | null;
  error: unknown;
}> {
  const direction = party.side === "sales" ? "Credit" : "Debit";
  let query = client
    .from("memo")
    .select("id, memoId, direction, currencyCode, exchangeRate, amount")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .eq("direction", direction);
  query =
    party.side === "sales"
      ? query.eq("customerId", party.customerId)
      : query.eq("supplierId", party.supplierId);

  const memos = await query;
  if (memos.error) return { data: null, error: memos.error };
  if (!memos.data || memos.data.length === 0) return { data: [], error: null };

  // deno-lint-ignore no-explicit-any
  const rows = memos.data as any[];
  const ids = rows.map((m) => m.id as string);
  const apps = await client
    .from("invoiceSettlement")
    .select(
      "memoId, appliedAmount, appliedViaPaymentId, appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status)"
    )
    .in("memoId", ids);
  if (apps.error) return { data: null, error: apps.error };

  const appliedByMemo = new Map<string, number>();
  for (const a of apps.data ?? []) {
    if (!a.memoId) continue;
    const viaId = (a as { appliedViaPaymentId: string | null })
      .appliedViaPaymentId;
    if (excludePaymentId && viaId === excludePaymentId) continue;
    // A voided applying payment releases its credit application — the
    // invoice balance reopens (the views stop counting the row), so the
    // memo's remaining must reopen with it. Draft still reserves.
    const viaStatus = (a as { appliedViaPayment: { status: string } | null })
      .appliedViaPayment?.status;
    if (viaId && viaStatus === "Voided") continue;
    appliedByMemo.set(
      a.memoId,
      (appliedByMemo.get(a.memoId) ?? 0) + Number(a.appliedAmount)
    );
  }

  const result = rows
    .map((m) => {
      const remaining =
        Math.round(
          (Number(m.amount) - (appliedByMemo.get(m.id) ?? 0)) * 10000
        ) / 10000;
      return {
        id: m.id as string,
        memoId: m.memoId as string,
        direction: m.direction as string,
        currencyCode: m.currencyCode as string,
        exchangeRate: Number(m.exchangeRate),
        amount: Number(m.amount),
        remaining
      };
    })
    .filter((m) => m.remaining > 0.0001);

  return { data: result, error: null };
}

// Does the company have ANY open credits to apply on this side? (sales → posted
// customer Credit memos; purchase → posted supplier Debit memos, each with credit
// remaining.) Cheap org-level gate for the invoice "Apply Credit" action — we
// don't surface it at all unless there's something to apply.
export async function getCompanyHasOpenCredits(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase"
): Promise<boolean> {
  const direction = side === "sales" ? "Credit" : "Debit";
  const memos = await client
    .from("memo")
    .select("id, amount")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .eq("direction", direction);
  if (memos.error || !memos.data || memos.data.length === 0) return false;

  // deno-lint-ignore no-explicit-any
  const rows = memos.data as any[];
  const ids = rows.map((m) => m.id as string);
  const apps = await client
    .from("invoiceSettlement")
    .select(
      "memoId, appliedAmount, appliedViaPaymentId, appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status)"
    )
    .in("memoId", ids);
  if (apps.error) return false;

  const appliedByMemo = new Map<string, number>();
  for (const a of apps.data ?? []) {
    if (!a.memoId) continue;
    // A voided applying payment releases its credit application.
    const viaStatus = (a as { appliedViaPayment: { status: string } | null })
      .appliedViaPayment?.status;
    if (a.appliedViaPaymentId && viaStatus === "Voided") continue;
    appliedByMemo.set(
      a.memoId,
      (appliedByMemo.get(a.memoId) ?? 0) + Number(a.appliedAmount)
    );
  }
  return rows.some(
    (m) => Number(m.amount) - (appliedByMemo.get(m.id) ?? 0) > 0.0001
  );
}

// Apply posted credits to invoices — additive insert of memo-sourced
// invoiceSettlement rows (the credits half of the "Receive Payment" composer).
// GL-neutral (the memos already posted their own journals), so no journal here;
// caps are validated under FOR UPDATE locks. Each application matches the memo's
// exchange rate to the invoice's (v1 requires equal rates — no cross-rate FX on
// credit application).
// The credit applications currently staged on a (Draft) payment — drives the
// composer's pre-fill so a staged credit stays visible and editable instead of
// silently vanishing from the available list.
export async function getStagedCreditsForPayment(
  client: SupabaseClient<Database>,
  paymentId: string,
  side: "sales" | "purchase"
): Promise<{
  data: { memoId: string; invoiceId: string; amount: number }[] | null;
  error: unknown;
}> {
  const apps = await client
    .from("invoiceSettlement")
    .select(
      "memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, appliedAmount"
    )
    .eq("appliedViaPaymentId", paymentId);
  if (apps.error) return { data: null, error: apps.error };
  const rows = (apps.data ?? []) as Array<{
    memoId: string | null;
    targetSalesInvoiceId: string | null;
    targetPurchaseInvoiceId: string | null;
    appliedAmount: number;
  }>;
  const data = rows
    .map((r) => ({
      memoId: r.memoId ?? "",
      invoiceId:
        side === "sales"
          ? (r.targetSalesInvoiceId ?? "")
          : (r.targetPurchaseInvoiceId ?? ""),
      amount: Number(r.appliedAmount)
    }))
    .filter((r) => r.memoId && r.invoiceId);
  return { data, error: null };
}

export async function applyCreditsToInvoices(
  db: Kysely<KyselyDatabase>,
  args: {
    paymentId: string;
    companyId: string;
    createdBy: string;
    appliedDate: string;
    side: "sales" | "purchase";
    applications: { memoId: string; invoiceId: string; amount: number }[];
  }
) {
  const isSales = args.side === "sales";
  const activeStatuses = isSales
    ? ["Submitted", "Partially Paid", "Overdue"]
    : ["Open", "Partially Paid", "Overdue"];

  return db.transaction().execute(async (trx) => {
    // Credit applications are STAGED on a Draft payment and only go live when it
    // posts (the invoice views gate memo settlements on appliedViaPaymentId's
    // payment status). The composer pre-fills the currently-staged set and submits
    // the FULL set each time, so this is a delete-then-insert REPLACE keyed on the
    // payment — exactly like cash applications (replaceInvoiceSettlements).
    const payment = await trx
      .selectFrom("payment")
      .select(["id", "status", "customerId", "supplierId"])
      .where("id", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "Draft") {
      throw new Error(
        "Credit applications can only be edited while the payment is Draft"
      );
    }
    // The party every memo and invoice in this batch must belong to: a payment's
    // credits can only clear ITS own party's invoices using ITS own party's
    // credit memos (a customer's credit can't settle another customer's invoice).
    const paymentParty = isSales ? payment.customerId : payment.supplierId;

    // Replace this payment's prior credit applications with the submitted set.
    await trx
      .deleteFrom("invoiceSettlement")
      .where("appliedViaPaymentId", "=", args.paymentId)
      .execute();

    if (args.applications.length === 0) return;

    const memoIds = [...new Set(args.applications.map((a) => a.memoId))];
    const invoiceIds = [...new Set(args.applications.map((a) => a.invoiceId))];

    // Lock the memos + read their remaining credit (amount - Σ applied elsewhere).
    const memos = await trx
      .selectFrom("memo")
      .select([
        "id",
        "status",
        "exchangeRate",
        "amount",
        "customerId",
        "supplierId"
      ])
      .where("id", "in", memoIds)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .execute();
    // A voided applying payment releases its credit application; Draft
    // still reserves (pessimistic, matches the composer's available list).
    const priorByMemo = await trx
      .selectFrom("invoiceSettlement")
      .leftJoin(
        "payment as vp",
        "vp.id",
        "invoiceSettlement.appliedViaPaymentId"
      )
      .select(["invoiceSettlement.memoId", "invoiceSettlement.appliedAmount"])
      .where("invoiceSettlement.memoId", "in", memoIds)
      .where((eb) =>
        eb.or([
          eb("invoiceSettlement.appliedViaPaymentId", "is", null),
          eb("vp.status", "!=", "Voided")
        ])
      )
      .execute();
    const priorApplied = new Map<string, number>();
    for (const p of priorByMemo) {
      if (!p.memoId) continue;
      priorApplied.set(
        p.memoId,
        (priorApplied.get(p.memoId) ?? 0) + Number(p.appliedAmount)
      );
    }
    const memoById = new Map(memos.map((m) => [m.id, m]));

    // Lock the invoices + read open balance + status from the view.
    const invoiceTable = isSales ? "salesInvoice" : "purchaseInvoice";
    const invoiceView = isSales ? "salesInvoices" : "purchaseInvoices";
    const lockedInvoices = await trx
      .selectFrom(invoiceTable)
      .select(["id", "invoiceId", "status", "exchangeRate"])
      .where("id", "in", invoiceIds)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .execute();
    const invoiceBalances = await trx
      .selectFrom(invoiceView)
      .select(["id", "balance"])
      .where("id", "in", invoiceIds)
      .execute();
    const balById = new Map(invoiceBalances.map((b) => [b.id, b]));
    const invById = new Map(lockedInvoices.map((i) => [i.id, i]));

    // Party of each targeted invoice (the column differs by side, so fetch
    // per-branch). Used below to reject applying a credit to an invoice that
    // belongs to a different party than the payment.
    const partyByInvoice = new Map<string, string | null>();
    if (isSales) {
      const rows = await trx
        .selectFrom("salesInvoice")
        .select(["id", "customerId"])
        .where("id", "in", invoiceIds)
        .where("companyId", "=", args.companyId)
        .execute();
      for (const r of rows) partyByInvoice.set(r.id, r.customerId);
    } else {
      const rows = await trx
        .selectFrom("purchaseInvoice")
        .select(["id", "supplierId"])
        .where("id", "in", invoiceIds)
        .where("companyId", "=", args.companyId)
        .execute();
      for (const r of rows) partyByInvoice.set(r.id, r.supplierId);
    }

    // This payment's own cash applications aren't in the live balance yet (the
    // payment is Draft) and its prior credits were just deleted above, so reserve
    // room for the cash when capping these credits.
    const cashApps = await trx
      .selectFrom("invoiceSettlement")
      .select([
        "targetSalesInvoiceId",
        "targetPurchaseInvoiceId",
        "appliedAmount",
        "discountAmount",
        "writeOffAmount"
      ])
      .where("paymentId", "=", args.paymentId)
      .execute();
    const cashByInvoice = new Map<string, number>();
    for (const c of cashApps) {
      const inv = isSales ? c.targetSalesInvoiceId : c.targetPurchaseInvoiceId;
      if (!inv) continue;
      cashByInvoice.set(
        inv,
        (cashByInvoice.get(inv) ?? 0) +
          Number(c.appliedAmount) +
          Number(c.discountAmount) +
          Number(c.writeOffAmount)
      );
    }

    // Validate each application, accumulating per-memo and per-invoice caps.
    const memoUse = new Map<string, number>();
    const invoiceUse = new Map<string, number>();
    for (const app of args.applications) {
      if (app.amount <= 0)
        throw new Error("Applied amount must be greater than 0");
      const memo = memoById.get(app.memoId);
      if (!memo) throw new Error(`Credit memo ${app.memoId} not found`);
      if (memo.status !== "Posted")
        throw new Error("Only posted credits can be applied");
      const memoParty = isSales ? memo.customerId : memo.supplierId;
      if (memoParty !== paymentParty)
        throw new Error(
          "A credit memo can only be applied through a payment for the same party"
        );
      const inv = invById.get(app.invoiceId);
      if (!inv) throw new Error(`Invoice ${app.invoiceId} not found`);
      const invoiceLabel = inv.invoiceId ?? app.invoiceId;
      if (partyByInvoice.get(app.invoiceId) !== paymentParty)
        throw new Error(
          `Invoice ${invoiceLabel} belongs to a different party than the payment`
        );
      if (!activeStatuses.includes(String(inv.status)))
        throw new Error(
          `Invoice ${invoiceLabel} is ${String(inv.status).toLowerCase()}, so no credit can be applied to it`
        );
      if (Number(memo.exchangeRate) !== Number(inv.exchangeRate))
        throw new Error(
          "Applying a credit requires matching exchange rates (cross-rate FX not yet supported)"
        );

      memoUse.set(app.memoId, (memoUse.get(app.memoId) ?? 0) + app.amount);
      invoiceUse.set(
        app.invoiceId,
        (invoiceUse.get(app.invoiceId) ?? 0) + app.amount
      );

      const memoRemaining =
        Number(memo.amount) - (priorApplied.get(app.memoId) ?? 0);
      if (memoUse.get(app.memoId)! > memoRemaining + 0.0001)
        throw new Error(
          `Applied (${memoUse.get(app.memoId)}) exceeds the credit's remaining balance (${memoRemaining})`
        );

      const invoiceOpen =
        Number(balById.get(app.invoiceId)?.balance ?? 0) -
        (cashByInvoice.get(app.invoiceId) ?? 0);
      if (invoiceUse.get(app.invoiceId)! > invoiceOpen + 0.0001)
        throw new Error(
          invoiceOpen <= 0.0001
            ? `Invoice ${invoiceLabel} has no open balance to apply credit to (it is already fully settled)`
            : `Credit applied to invoice ${invoiceLabel} (${invoiceUse.get(
                app.invoiceId
              )}) exceeds its open balance of ${invoiceOpen.toFixed(2)}`
        );
    }

    await trx
      .insertInto("invoiceSettlement")
      .values(
        args.applications.map((app) => ({
          memoId: app.memoId,
          appliedViaPaymentId: args.paymentId,
          companyId: args.companyId,
          createdBy: args.createdBy,
          targetSalesInvoiceId: isSales ? app.invoiceId : null,
          targetPurchaseInvoiceId: isSales ? null : app.invoiceId,
          appliedAmount: app.amount,
          discountAmount: 0,
          writeOffAmount: 0,
          sourceExchangeRate: Number(memoById.get(app.memoId)!.exchangeRate),
          targetExchangeRate: Number(invById.get(app.invoiceId)!.exchangeRate),
          appliedDate: args.appliedDate
        }))
      )
      .execute();
  });
}

// Tie-out RPCs (migration 20260519140000_ar-ap-tie-out)

export async function getArTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client
    .rpc("get_ar_tie_out", {
      _company_id: companyId,
      _as_of_date: asOfDate
    })
    .single();
}

export async function getApTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client
    .rpc("get_ap_tie_out", {
      _company_id: companyId,
      _as_of_date: asOfDate
    })
    .single();
}

export async function getArOpenByCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client.rpc("get_ar_open_by_customer", {
    _company_id: companyId,
    _as_of_date: asOfDate
  });
}

export async function getApOpenBySupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client.rpc("get_ap_open_by_supplier", {
    _company_id: companyId,
    _as_of_date: asOfDate
  });
}

// Aging RPCs (migration 20260519150000_ar-ap-aging)

export type AgingOptions = {
  agingMethod?: "dueDate" | "documentDate";
  bucketDays?: [number, number, number];
};

export async function getArAging(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string,
  options: AgingOptions = {}
) {
  const [b1, b2, b3] = options.bucketDays ?? [30, 60, 90];
  return client.rpc("get_ar_aging", {
    _company_id: companyId,
    _as_of_date: asOfDate,
    _aging_method: options.agingMethod ?? "dueDate",
    _bucket1: b1,
    _bucket2: b2,
    _bucket3: b3
  });
}

export async function getApAging(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string,
  options: AgingOptions = {}
) {
  const [b1, b2, b3] = options.bucketDays ?? [30, 60, 90];
  return client.rpc("get_ap_aging", {
    _company_id: companyId,
    _as_of_date: asOfDate,
    _aging_method: options.agingMethod ?? "dueDate",
    _bucket1: b1,
    _bucket2: b2,
    _bucket3: b3
  });
}
