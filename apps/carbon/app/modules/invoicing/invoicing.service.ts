import type { Database, Json } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getSupplierPayment } from "~/modules/purchasing";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  purchaseInvoiceLineValidator,
  purchaseInvoiceValidator,
} from "./invoicing.models";

export async function deletePurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  // TODO: this should be a transaction that checks whether it is posted
  // and then sets the status of the purchase order back to
  // "To Receive and Invoice" | "To Invoice"
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
    { column: "invoiceId", ascending: false },
  ]);
  return query;
}

export async function getPurchaseInvoiceLines(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceLine")
    .select("*")
    .eq("invoiceId", purchaseInvoiceId)
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

export async function upsertPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoice:
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
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
        updatedAt: today(getLocalTimeZone()).toString(),
      })
      .eq("id", purchaseInvoice.id)
      .select("id, invoiceId");
  }

  const [supplierPayment] = await Promise.all([
    getSupplierPayment(client, purchaseInvoice.supplierId),
  ]);

  if (supplierPayment.error) return supplierPayment;

  const { paymentTermId } = supplierPayment.data;

  const invoice = await client
    .from("purchaseInvoice")
    .insert([
      {
        ...purchaseInvoice,
        invoiceSupplierId:
          purchaseInvoice.invoiceSupplierId ?? purchaseInvoice.supplierId ?? "",
        currencyCode: purchaseInvoice.currencyCode ?? "USD",
        paymentTermId: purchaseInvoice.paymentTermId ?? paymentTermId,
      },
    ])
    .select("id, invoiceId");

  return invoice;
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

  return client
    .from("purchaseInvoiceLine")
    .insert([
      {
        ...purchaseInvoiceLine,
        currencyCode: purchaseInvoiceLine.currencyCode ?? "USD",
      },
    ])
    .select("id")
    .single();
}
