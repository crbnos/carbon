import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLocalTimeZone, now, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction
} from "~/modules/purchasing/purchasing.service.server";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting/accounting.service.server";
import { getEmployeeJob } from "../people/people.service.server";
import {
  getCustomerPayment,
  getCustomerShipping
} from "../sales/sales.service.server";
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
export const createPurchaseInvoiceFromPurchaseOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function createPurchaseInvoiceFromPurchaseOrder(
    purchaseOrderId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    return client.functions.invoke<{ id: string }>("convert", {
      body: {
        type: "purchaseOrderToPurchaseInvoice",
        id: purchaseOrderId,
        companyId,
        userId
      }
    });
  }
);

export const createSalesInvoiceFromSalesOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function createSalesInvoiceFromSalesOrder(salesOrderId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    return client.functions.invoke<{ id: string }>("convert", {
      body: {
        type: "salesOrderToSalesInvoice",
        id: salesOrderId,
        companyId,
        userId
      }
    });
  }
);

export const createSalesInvoiceFromShipment = mcpTool(
  {
    classification: "WRITE"
  },
  async function createSalesInvoiceFromShipment(shipmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
    return client.functions.invoke<{ id: string }>("convert", {
      body: {
        type: "shipmentToSalesInvoice",
        id: shipmentId,
        companyId,
        userId
      }
    });
  }
);

export const deletePurchaseInvoice = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePurchaseInvoice(purchaseInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deletePurchaseInvoiceLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePurchaseInvoiceLine(purchaseInvoiceLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseInvoiceLine")
      .delete()
      .eq("id", purchaseInvoiceLineId);
  }
);

export const deleteSalesInvoice = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSalesInvoice(salesInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const deleteSalesInvoiceLine = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSalesInvoiceLine(salesInvoiceLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("salesInvoiceLine")
      .delete()
      .eq("id", salesInvoiceLineId);
  }
);

export const getPurchaseInvoice = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseInvoice(purchaseInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseInvoices")
      .select("*")
      .eq("id", purchaseInvoiceId)
      .single();
  }
);

export const getPurchaseInvoices = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseInvoices(
    args: GenericQueryFilters & {
      search: string | null;
      supplierId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getPurchaseInvoiceDelivery = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseInvoiceDelivery(purchaseInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseInvoiceDelivery")
      .select("*")
      .eq("id", purchaseInvoiceId)
      .single();
  }
);

export const getPurchaseInvoiceLines = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseInvoiceLines(purchaseInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseInvoiceLines")
      .select("*")
      .eq("invoiceId", purchaseInvoiceId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true });
  }
);

export const getPurchaseInvoiceLine = mcpTool(
  {
    classification: "READ"
  },
  async function getPurchaseInvoiceLine(purchaseInvoiceLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("purchaseInvoiceLine")
      .select("*")
      .eq("id", purchaseInvoiceLineId)
      .single();
  }
);

export const getSalesInvoice = mcpTool(
  {
    classification: "READ"
  },
  async function getSalesInvoice(salesInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("salesInvoices")
      .select("*")
      .eq("id", salesInvoiceId)
      .single();
  }
);

export const getSalesInvoiceCustomerDetails = mcpTool(
  {
    classification: "READ"
  },
  async function getSalesInvoiceCustomerDetails(salesInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("salesInvoiceLocations")
      .select("*")
      .eq("id", salesInvoiceId)
      .single();
  }
);

export const getSalesInvoices = mcpTool(
  {
    classification: "READ"
  },
  async function getSalesInvoices(
    args: GenericQueryFilters & {
      search: string | null;
      customerId: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getSalesInvoiceShipment = mcpTool(
  {
    classification: "READ"
  },
  async function getSalesInvoiceShipment(salesInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("salesInvoiceShipment")
      .select("*")
      .eq("id", salesInvoiceId)
      .single();
  }
);

export const getSalesInvoiceLines = mcpTool(
  {
    classification: "READ"
  },
  async function getSalesInvoiceLines(salesInvoiceId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("salesInvoiceLines")
      .select("*")
      .eq("invoiceId", salesInvoiceId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true });
  }
);

export const getSalesInvoiceLine = mcpTool(
  {
    classification: "READ"
  },
  async function getSalesInvoiceLine(salesInvoiceLineId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("salesInvoiceLine")
      .select("*")
      .eq("id", salesInvoiceLineId)
      .single();
  }
);

export const updatePurchaseInvoiceExchangeRate = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchaseInvoiceExchangeRate(data: {
    id: string;
    exchangeRate: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const update = {
      id: data.id,
      exchangeRate: data.exchangeRate,
      exchangeRateUpdatedAt: new Date().toISOString()
    };

    return client.from("purchaseInvoice").update(update).eq("id", update.id);
  }
);

export const updatePurchaseInvoiceStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchaseInvoiceStatus(update: {
    id: string;
    status: (typeof purchaseInvoiceStatusType)[number];
    assignee: null | undefined;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const { status, ...rest } = update;

    // Set completedDate when status is Confirmed
    const updateData = {
      status,
      ...rest,
      updatedBy: userId,
      ...(["Paid"].includes(status)
        ? { datePaid: now(getLocalTimeZone()).toAbsoluteString() }
        : {})
    };

    return client
      .from("purchaseInvoice")
      .update(updateData)
      .eq("id", update.id);
  }
);

export const updateSalesInvoiceExchangeRate = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSalesInvoiceExchangeRate(data: {
    id: string;
    exchangeRate: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const update = {
      id: data.id,
      exchangeRate: data.exchangeRate,
      exchangeRateUpdatedAt: new Date().toISOString()
    };

    return client.from("salesInvoice").update(update).eq("id", update.id);
  }
);

export const updateSalesInvoiceStatus = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSalesInvoiceStatus(update: {
    id: string;
    status: (typeof salesInvoiceStatusType)[number];
    assignee: null | undefined;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    const { status, ...rest } = update;

    const updateData = {
      status,
      ...rest,
      updatedBy: userId,
      ...(["Paid"].includes(status)
        ? { datePaid: now(getLocalTimeZone()).toAbsoluteString() }
        : {})
    };

    return client.from("salesInvoice").update(updateData).eq("id", update.id);
  }
);

export const upsertPurchaseInvoice = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseInvoice(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
        insertSupplierInteraction(purchaseInvoice.supplierId),
        getSupplierPayment(purchaseInvoice.supplierId),
        getSupplierShipping(purchaseInvoice.supplierId),
        getEmployeeJob(userId)
      ]);

    if (supplierInteraction.error) return supplierInteraction;
    if (supplierPayment.error) return supplierPayment;
    if (supplierShipping.error) return supplierShipping;

    const { paymentTermId, invoiceSupplierId } = supplierPayment.data;

    const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
      supplierShipping.data;

    if (purchaseInvoice.currencyCode) {
      const currency = await getCurrencyByCode(
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
        companyId: companyId
      }
    ]);

    if (delivery.error) {
      await client.from("purchaseInvoice").delete().eq("id", invoiceId);
      return delivery;
    }

    return invoice;
  }
);

export const upsertPurchaseInvoiceDelivery = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseInvoiceDelivery(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertPurchaseInvoiceLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPurchaseInvoiceLine(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

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

export const upsertSalesInvoice = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSalesInvoice(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
              companyId: companyId,
              customerId: salesInvoice.customerId
            }
          ])
          .select("id")
          .single(),
        getCustomerPayment(salesInvoice.customerId),
        getCustomerShipping(salesInvoice.customerId),
        getEmployeeJob(userId)
      ]);

    if (opportunity.error) return opportunity;
    if (customerPayment.error) return customerPayment;
    if (customerShipping.error) return customerShipping;

    const { paymentTermId, invoiceCustomerId } = customerPayment.data;
    const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
      customerShipping.data;

    if (salesInvoice.currencyCode) {
      const currency = await getCurrencyByCode(
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

    const { companyGroupId: _companyGroupId, ...salesInvoiceData } =
      salesInvoice;

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
        companyId: companyId,
        createdBy: userId
      }
    ]);

    if (delivery.error) {
      await client.from("salesInvoice").delete().eq("id", invoiceId);
      return delivery;
    }

    return invoice;
  }
);

export const upsertSalesInvoiceShipment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSalesInvoiceShipment(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertSalesInvoiceLine = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertSalesInvoiceLine(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

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
