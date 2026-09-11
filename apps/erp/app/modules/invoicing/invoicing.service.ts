import type { Database, Json } from "@carbon/database";
import { fetchAllFromTable, getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  allocatePaymentFunding,
  applyRate,
  assertCurrencyDecimals,
  assertExchangeRate,
  chunkArray,
  datetime,
  type FundingConsumptionRow,
  type FundingPaymentRow,
  type FundingRequest,
  type FundingSource,
  invoiceRemainingAmounts,
  isEffectiveSettlement,
  PAYABLE_POSTING_DESCRIPTIONS,
  RECEIVABLE_POSTING_DESCRIPTIONS,
  reduceInvoiceSettlements,
  remainingFundingSources,
  round,
  type SettlementBalanceRow,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction
} from "~/modules/purchasing";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getExchangeRate } from "../accounting/accounting.ee.service";
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

const PURCHASE_INVOICES_LIST_COLUMNS =
  "id,invoiceId,supplierId,invoiceSupplierId,supplierReference,postingDate,dateIssued,dateDue,datePaid,balance,assignee,createdBy,createdAt,updatedBy,updatedAt,customFields,companyId,thumbnailPath,itemType,orderTotal,status,paymentTermName" as const;

const SALES_INVOICES_LIST_COLUMNS =
  "id,invoiceId,status,customerId,customerReference,invoiceCustomerId,postingDate,dateIssued,dateDue,datePaid,balance,assignee,companyId,customFields,createdAt,createdBy,updatedAt,updatedBy,thumbnailPath,itemType,invoiceTotal,paymentTermName" as const;

/**
 * The payment term an invoice falls back to when none is specified — Net 30,
 * matching Stripe's default of 30 days until an invoice is due. Without it an
 * invoice with no payment term carried no due date at all, so it could never
 * read as overdue and never surfaced in AR/AP aging.
 *
 * Mirrors DEFAULT_PAYMENT_TERM in
 * packages/database/supabase/functions/shared/calculate-due-date.ts — keep the
 * two in sync.
 */
export const DEFAULT_PAYMENT_TERM: {
  daysDue: number;
  calculationMethod: Database["public"]["Enums"]["paymentTermCalculationMethod"];
} = { daysDue: 30, calculationMethod: "Net" };

/**
 * Compute an invoice's Due Date from its Issue Date and Payment Term.
 * Returns null only when the issue date is missing or can't be parsed — callers
 * fall back to a plain field update in that case. A missing payment term is NOT
 * a missing due date: an unset paymentTermId, or one whose row genuinely
 * doesn't exist for the company, falls back to DEFAULT_PAYMENT_TERM (Net 30).
 * A payment-term *query failure* is different: it throws, so callers abort
 * instead of writing the invoice with a stale dateDue. The read is scoped by
 * companyId for tenant isolation (defense in depth alongside RLS) and uses
 * maybeSingle so an absent row is data: null (not an error) — keeping "missing"
 * distinguishable from "failed".
 *
 * The term's calculationMethod decides the anchor for daysDue:
 * - "Net": daysDue days after the issue date.
 * - "End of Month": daysDue days after the end of the issue month.
 * - "Day of Month": due on day daysDue of the month — the first occurrence on
 *   or after the issue date, clamped to the month's length (31 → Feb 28).
 *
 * Mirrors calculateDueDate in
 * packages/database/supabase/functions/shared/calculate-due-date.ts (used when
 * posting invoices) — keep the two in sync.
 */
export async function computeInvoiceDateDue(
  client: SupabaseClient<Database>,
  args: {
    dateIssued: string | null | undefined;
    paymentTermId: string | null | undefined;
    companyId: string;
  }
): Promise<string | null> {
  const { dateIssued, paymentTermId, companyId } = args;
  if (!dateIssued) return null;

  const paymentTerm = paymentTermId
    ? await client
        .from("paymentTerm")
        .select("daysDue, calculationMethod")
        .eq("id", paymentTermId)
        .eq("companyId", companyId)
        .maybeSingle()
    : null;

  if (paymentTerm?.error) {
    throw new Error(
      `Failed to load payment term ${paymentTermId} while recomputing invoice due date: ${paymentTerm.error.message}`
    );
  }

  const { daysDue, calculationMethod } =
    paymentTerm?.data ?? DEFAULT_PAYMENT_TERM;

  try {
    const issued = parseDate(dateIssued);
    switch (calculationMethod) {
      case "End of Month":
        return endOfMonth(issued).add({ days: daysDue }).toString();
      case "Day of Month": {
        // set() clamps daysDue to the month's length
        const sameMonth = issued.set({ day: daysDue });
        return (
          sameMonth.compare(issued) >= 0
            ? sameMonth
            : issued.add({ months: 1 }).set({ day: daysDue })
        ).toString();
      }
      default:
        return issued.add({ days: daysDue }).toString();
    }
  } catch {
    return null;
  }
}

/**
 * Early-payment (cash) discount per invoice, for seeding a payment's
 * applications. A discount only applies when the payment lands within the
 * term's discount window (e.g. "2/10 net 30" → 2% only if paid within 10 days
 * of the issue date). Returns a Map keyed by invoice id; invoices with no term,
 * a zero discount percentage, a missing issue date, or a payment date past the
 * window map to 0.
 *
 * The discount is a settlement amount, so it rounds to the currency's decimals
 * via `applyRate` (`discountPercentage` is stored as points, e.g. 2 → 0.02).
 * The deadline uses the same calculationMethod anchoring as the due date (see
 * computeInvoiceDateDue) but with `daysDiscount` instead of `daysDue`. Terms are
 * batch-loaded in one query — never per invoice (N+1).
 */
export async function computeEarlyPaymentDiscounts(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    asOfDate: string;
    currencyDecimals: number;
    invoices: {
      id: string;
      balance: number;
      dateIssued: string | null;
      paymentTermId: string | null;
    }[];
  }
): Promise<Map<string, number>> {
  const { companyId, asOfDate, currencyDecimals, invoices } = args;
  const result = new Map<string, number>(invoices.map((inv) => [inv.id, 0]));

  const termIds = [
    ...new Set(
      invoices
        .map((inv) => inv.paymentTermId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  if (termIds.length === 0) return result;

  const terms = await client
    .from("paymentTerm")
    .select("id, daysDiscount, discountPercentage, calculationMethod")
    .in("id", termIds)
    .eq("companyId", companyId);
  if (terms.error) {
    throw new Error(
      `Failed to load payment terms while computing early-payment discounts: ${terms.error.message}`
    );
  }
  const termById = new Map((terms.data ?? []).map((term) => [term.id, term]));

  let asOf: ReturnType<typeof parseDate>;
  try {
    asOf = parseDate(asOfDate);
  } catch {
    return result;
  }

  for (const inv of invoices) {
    if (!inv.paymentTermId || !inv.dateIssued) continue;
    const term = termById.get(inv.paymentTermId);
    if (!term) continue;
    const pct = Number(term.discountPercentage ?? 0);
    const days = Number(term.daysDiscount ?? 0);
    if (pct <= 0) continue;

    let issued: ReturnType<typeof parseDate>;
    try {
      issued = parseDate(inv.dateIssued);
    } catch {
      continue;
    }

    let deadline: ReturnType<typeof parseDate>;
    switch (term.calculationMethod) {
      case "End of Month":
        deadline = endOfMonth(issued).add({ days });
        break;
      case "Day of Month": {
        const sameMonth = issued.set({ day: days });
        deadline =
          sameMonth.compare(issued) >= 0
            ? sameMonth
            : issued.add({ months: 1 }).set({ day: days });
        break;
      }
      default:
        deadline = issued.add({ days });
    }

    // Past the discount window → the early-payment discount is no longer offered.
    if (asOf.compare(deadline) > 0) continue;

    result.set(
      inv.id,
      applyRate(Number(inv.balance), pct / 100, currencyDecimals)
    );
  }

  return result;
}

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
    .select(PURCHASE_INVOICES_LIST_COLUMNS, { count: LIST_COUNT })
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
    .select(SALES_INVOICES_LIST_COLUMNS, { count: LIST_COUNT })
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

  let exchangeRate = input.exchangeRate;
  let exchangeRateUpdatedAt =
    input.exchangeRateUpdatedAt ?? new Date().toISOString();

  if (input.currencyCode) {
    const rate = await getExchangeRate(
      client,
      input.companyId,
      input.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    exchangeRate = rate.data;
    exchangeRateUpdatedAt = new Date().toISOString();
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
      dateIssued:
        input.dateIssued ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
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
      updatedAt: datetime.timestamp()
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
        updatedAt: datetime.timestamp()
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
    const rate = await getExchangeRate(
      client,
      purchaseInvoice.companyId,
      purchaseInvoice.currencyCode
    );
    if (rate.error) return rate;
    purchaseInvoice.exchangeRate = rate.data;
    purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
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

  let exchangeRate = input.exchangeRate;
  let exchangeRateUpdatedAt =
    input.exchangeRateUpdatedAt ?? new Date().toISOString();

  if (input.currencyCode) {
    const rate = await getExchangeRate(
      client,
      input.companyId,
      input.currencyCode
    );
    if (rate.error) return { data: null, error: rate.error };
    exchangeRate = rate.data;
    exchangeRateUpdatedAt = new Date().toISOString();
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
      dateIssued:
        input.dateIssued ??
        datetime
          .today(await getCompanyTimeZone(client, input.companyId))
          .toString(),
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
      updatedAt: datetime.timestamp()
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
        updatedAt: datetime.timestamp()
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
    const rate = await getExchangeRate(
      client,
      salesInvoice.companyId,
      salesInvoice.currencyCode
    );
    if (rate.error) return rate;
    salesInvoice.exchangeRate = rate.data;
    salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
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

export async function getPayment(
  client: SupabaseClient<Database>,
  id: string,
  companyId?: string
) {
  let query = client.from("payment").select("*").eq("id", id);
  if (companyId) query = query.eq("companyId", companyId);
  return query.single();
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
  type Settlement = Database["public"]["Tables"]["invoiceSettlement"]["Row"] & {
    salesInvoice: { invoiceId: string } | null;
    purchaseInvoice: { invoiceId: string } | null;
    targetMemo: { memoId: string } | null;
  };
  return fetchAllFromTable<Settlement>(
    client,
    "invoiceSettlement",
    "*, salesInvoice:targetSalesInvoiceId(invoiceId), purchaseInvoice:targetPurchaseInvoiceId(invoiceId), targetMemo:targetMemoId(memoId)",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq("paymentId", paymentId)
        .order("appliedDate", { ascending: true })
        .order("id")
  );
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
  sourceAmount: number | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number | null;
  targetExchangeRate: number;
  sourceExchangeRate: number | null;
  appliedDate: string;
  source: InvoiceSettlementSource;
};

// Posted settlements against a specific invoice — BOTH cash payments and applied
// credit/debit memos. Used by the "Applied" panel on the sales/purchase invoice
// detail page. Page the embedded parents with their applications so large histories
// retain every source without oversized ID lookups.
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
  type Settlement = Pick<
    Database["public"]["Tables"]["invoiceSettlement"]["Row"],
    | "id"
    | "paymentId"
    | "memoId"
    | "appliedViaPaymentId"
    | "sourceAmount"
    | "appliedAmount"
    | "discountAmount"
    | "writeOffAmount"
    | "fxGainLossAmount"
    | "targetExchangeRate"
    | "sourceExchangeRate"
    | "appliedDate"
  > & {
    payment: Pick<
      Database["public"]["Tables"]["payment"]["Row"],
      "id" | "paymentId" | "status" | "paymentDate" | "currencyCode"
    > | null;
    memo: Pick<
      Database["public"]["Tables"]["memo"]["Row"],
      | "id"
      | "memoId"
      | "status"
      | "postingDate"
      | "memoDate"
      | "currencyCode"
      | "direction"
    > | null;
    appliedViaPayment: { status: string | null } | null;
  };
  const apps = await fetchAllFromTable<Settlement>(
    client,
    "invoiceSettlement",
    "id, paymentId, memoId, appliedViaPaymentId, sourceAmount, appliedAmount, discountAmount, writeOffAmount, fxGainLossAmount, targetExchangeRate, sourceExchangeRate, appliedDate, payment:payment!invoiceSettlement_paymentId_fkey(id,paymentId,status,paymentDate,currencyCode), memo:memo!invoiceSettlement_memoId_fkey(id,memoId,status,postingDate,memoDate,currencyCode,direction), appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status)",
    (query) =>
      query
        .eq("companyId", companyId)
        .eq(column, invoiceId)
        .order("appliedDate", { ascending: false })
        .order("id")
  );
  if (apps.error) return { data: null, error: apps.error };

  const merged: InvoiceSettlementForInvoice[] = [];
  for (const a of apps.data ?? []) {
    if (
      !isEffectiveSettlement({
        paymentId: a.paymentId,
        memoId: a.memoId,
        appliedViaPaymentId: a.appliedViaPaymentId,
        paymentStatus: a.payment?.status ?? null,
        memoStatus: a.memo?.status ?? null,
        viaStatus: a.appliedViaPayment?.status ?? null
      })
    )
      continue;
    let source: InvoiceSettlementSource | null = null;
    if (a.paymentId && a.payment) {
      const p = a.payment;
      source = {
        type: "payment",
        id: p.id,
        readableId: p.paymentId,
        status: p.status,
        date: p.paymentDate,
        currencyCode: p.currencyCode
      };
    } else if (a.memoId && a.memo) {
      const m = a.memo;
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
    if (!source) continue;
    merged.push({
      id: a.id,
      sourceAmount: a.sourceAmount,
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

  const bySource = new Map<string, InvoiceSettlementForInvoice>();
  for (const row of merged) {
    const key = `${row.source.type}:${row.source.id}:${row.appliedDate}`;
    const previous = bySource.get(key);
    if (!previous) {
      bySource.set(key, { ...row });
      continue;
    }
    previous.appliedAmount = round(previous.appliedAmount + row.appliedAmount);
    previous.discountAmount = round(
      previous.discountAmount + row.discountAmount
    );
    previous.writeOffAmount = round(
      previous.writeOffAmount + row.writeOffAmount
    );
    previous.sourceAmount =
      previous.sourceAmount == null || row.sourceAmount == null
        ? null
        : round(previous.sourceAmount + row.sourceAmount);
    previous.fxGainLossAmount = round(
      Number(previous.fxGainLossAmount ?? 0) + Number(row.fxGainLossAmount ?? 0)
    );
    if (previous.sourceExchangeRate !== row.sourceExchangeRate)
      previous.sourceExchangeRate = null;
  }
  return { data: [...bySource.values()], error: null };
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
  customerId: string,
  currencyCode?: string
) {
  return getOpenInvoicesForParty(
    client,
    companyId,
    true,
    customerId,
    currencyCode
  );
}
export async function getOpenPurchaseInvoicesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string,
  currencyCode?: string
) {
  return getOpenInvoicesForParty(
    client,
    companyId,
    false,
    supplierId,
    currencyCode
  );
}

async function getOpenInvoicesForParty(
  client: SupabaseClient<Database>,
  companyId: string,
  isAR: boolean,
  partyId: string,
  currencyCode?: string
) {
  type OpenInvoiceRow = Pick<
    Database["public"]["Views"]["salesInvoices" | "purchaseInvoices"]["Row"],
    | "id"
    | "invoiceId"
    // dateIssued + paymentTermId drive the early-payment discount window when a
    // payment is seeded from these invoices.
    | "dateIssued"
    | "dateDue"
    | "paymentTermId"
    | "currencyCode"
    | "exchangeRate"
    | "totalAmount"
    | "balance"
    | "status"
  >;
  type SettlementRow = SettlementBalanceRow & {
    paymentId: string | null;
    memoId: string | null;
    appliedViaPaymentId: string | null;
    payment: { status: string } | null;
    memo: { status: string } | null;
    appliedViaPayment: { status: string } | null;
  };
  type ControlRow = Pick<
    Database["public"]["Tables"]["journalLine"]["Row"],
    "documentId" | "amount"
  >;
  const [invoices, company] = await Promise.all([
    fetchAllFromTable<OpenInvoiceRow>(
      client,
      isAR ? "salesInvoices" : "purchaseInvoices",
      "id, invoiceId, dateIssued, dateDue, paymentTermId, currencyCode, exchangeRate, totalAmount, balance, status",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .in(
            "status",
            isAR
              ? ["Submitted", "Partially Paid", "Overdue"]
              : ["Open", "Partially Paid", "Overdue"]
          )
          .eq(isAR ? "customerId" : "supplierId", partyId);
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query.order("dateDue", { ascending: true }).order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (invoices.error) return { data: null, error: invoices.error };
  if (company.error || !company.data?.companyGroupId)
    return {
      data: null,
      error: { message: "Company currency configuration is missing" }
    };
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) return { data: null, error: currencies.error };
  const ids = invoices.data.map((i) => i.id!);
  const settlements: SettlementRow[] = [];
  const controls: ControlRow[] = [];
  // Bound filter URLs as well as response pages. A single invoice can itself
  // have more than one response page of control lines or settlements.
  for (const batch of chunkArray(ids, 100)) {
    const [batchSettlements, batchControls] = await Promise.all([
      fetchAllFromTable<SettlementRow>(
        client,
        "invoiceSettlement",
        "paymentId, memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, sourceAmount, appliedAmount, discountAmount, writeOffAmount, appliedViaPaymentId, payment:payment!invoiceSettlement_paymentId_fkey(status), memo:memo!invoiceSettlement_memoId_fkey(status), appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status)",
        (query) =>
          query
            .eq("companyId", companyId)
            .in(
              isAR ? "targetSalesInvoiceId" : "targetPurchaseInvoiceId",
              batch
            )
            .order("id")
      ),
      fetchAllFromTable<ControlRow>(
        client,
        "journalLine",
        "documentId, amount, journal:journalId!inner(status,sourceType,companyId)",
        (query) =>
          query
            .eq("companyId", companyId)
            .eq("journal.companyId", companyId)
            .eq("journal.status", "Posted")
            .eq(
              "journal.sourceType",
              isAR ? "Sales Invoice" : "Purchase Invoice"
            )
            .eq("documentType", "Invoice")
            .in(
              "description",
              isAR
                ? RECEIVABLE_POSTING_DESCRIPTIONS
                : PAYABLE_POSTING_DESCRIPTIONS
            )
            .in("documentId", batch)
            .order("id")
      )
    ]);
    const error = batchSettlements.error ?? batchControls.error;
    if (error) return { data: null, error };
    settlements.push(...(batchSettlements.data ?? []));
    controls.push(...(batchControls.data ?? []));
  }
  try {
    const decimals = new Map(
      (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
    );
    if (currencyCode) requireCurrencyDecimals(decimals, currencyCode);
    const effective = settlements.filter((s) =>
      isEffectiveSettlement({
        paymentId: s.paymentId,
        memoId: s.memoId,
        appliedViaPaymentId: s.appliedViaPaymentId,
        paymentStatus: s.payment?.status ?? null,
        memoStatus: s.memo?.status ?? null,
        viaStatus: s.appliedViaPayment?.status ?? null
      })
    );
    const controlAmounts = new Map<string, number>();
    for (const line of controls)
      if (line.documentId)
        controlAmounts.set(
          line.documentId,
          (controlAmounts.get(line.documentId) ?? 0) + Number(line.amount)
        );
    return {
      data: (invoices.data ?? [])
        .map((i) => {
          if (!i.id || !i.currencyCode)
            throw new Error("Invoice currency or identity is missing");
          const remaining = invoiceRemainingAmounts(
            i,
            effective,
            controlAmounts,
            requireCurrencyDecimals(decimals, i.currencyCode!),
            isAR
          );
          return {
            ...i,
            id: i.id,
            currencyCode: i.currencyCode,
            balance: remaining.remainingBase,
            remainingDocument: remaining.remainingDocument
          };
        })
        .filter((i) => i.remainingDocument > 0),
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Unable to load invoice balances"
      }
    };
  }
}

type PaymentParty =
  | { paymentType: "Receipt"; customerId: string }
  | { paymentType: "Disbursement"; supplierId: string };

function requireCurrencyDecimals(
  decimals: Map<string, number>,
  code: string
): number {
  const value = decimals.get(code);
  if (value == null || !Number.isInteger(value) || value < 0) {
    throw new Error(`Currency ${code} requires configured decimal places`);
  }
  assertCurrencyDecimals(value);
  return value;
}

export async function getPaymentCurrencyConfiguration(
  client: SupabaseClient<Database>,
  companyId: string,
  currencyCode: string
): Promise<{ baseCurrencyCode: string; currencyDecimals: number }> {
  const company = await client
    .from("company")
    .select("companyGroupId, baseCurrencyCode")
    .eq("id", companyId)
    .single();
  if (
    company.error ||
    !company.data?.companyGroupId ||
    !company.data.baseCurrencyCode
  ) {
    throw new Error("Company currency configuration is missing");
  }
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId)
    .eq("code", currencyCode);
  if (currencies.error) throw new Error(currencies.error.message);
  return {
    baseCurrencyCode: company.data.baseCurrencyCode,
    currencyDecimals: requireCurrencyDecimals(
      new Map((currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])),
      currencyCode
    )
  };
}

async function loadOnAccountSources(
  client: SupabaseClient<Database>,
  companyId: string,
  party: PaymentParty,
  currencyCode?: string
) {
  const [payments, company] = await Promise.all([
    fetchAllFromTable<FundingPaymentRow>(
      client,
      "payment",
      "id, totalAmount, exchangeRate, postingDate, paymentDate, currencyCode",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .eq("status", "Posted")
          .eq("paymentType", party.paymentType);
        query =
          party.paymentType === "Receipt"
            ? query.eq("customerId", party.customerId)
            : query.eq("supplierId", party.supplierId);
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query.order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (payments.error) throw new Error(payments.error.message);
  if (company.error || !company.data?.companyGroupId)
    throw new Error("Company currency configuration is missing");
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) throw new Error(currencies.error.message);
  const decimals = new Map(
    (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
  );
  if (currencyCode) requireCurrencyDecimals(decimals, currencyCode);
  if (!payments.data.length)
    return { sources: [] as FundingSource[], decimals };
  // Filter through the applying parent instead of sending an unbounded source-ID
  // list in the URL. Every valid use of prior funding has the same party/currency.
  const apps = await fetchAllFromTable<
    FundingConsumptionRow & { payment: { status: string } | null }
  >(
    client,
    "invoiceSettlement",
    "paymentId, sourcePaymentId, sourceAmount, appliedAmount, fxGainLossAmount, payment:payment!invoiceSettlement_paymentId_fkey!inner(status)",
    (query) => {
      query = query
        .eq("companyId", companyId)
        .eq("payment.companyId", companyId)
        .eq("payment.status", "Posted")
        .eq("payment.paymentType", party.paymentType);
      query =
        party.paymentType === "Receipt"
          ? query.eq("payment.customerId", party.customerId)
          : query.eq("payment.supplierId", party.supplierId);
      if (currencyCode) query = query.eq("payment.currencyCode", currencyCode);
      return query.order("id");
    }
  );
  if (apps.error) throw new Error(apps.error.message);
  const effective = (apps.data ?? []).filter(
    (a) => a.payment?.status === "Posted"
  );
  return {
    sources: remainingFundingSources(
      payments.data ?? [],
      effective,
      decimals,
      party.paymentType === "Receipt"
    ),
    decimals
  };
}

export async function getAvailableOnAccountCreditSources(
  client: SupabaseClient<Database>,
  companyId: string,
  party: PaymentParty,
  currencyCode: string
): Promise<{
  data: {
    sources: FundingSource[];
    availableDocumentAmount: number;
    availableBaseAmount: number;
  } | null;
  error: { message: string } | null;
}> {
  try {
    const { sources, decimals } = await loadOnAccountSources(
      client,
      companyId,
      party,
      currencyCode
    );
    return {
      data: {
        sources,
        availableDocumentAmount: toDocumentAmount(
          sources.reduce((sum, p) => sum + p.remainingDocument, 0),
          1,
          requireCurrencyDecimals(decimals, currencyCode)
        ),
        availableBaseAmount: round(
          sources.reduce((sum, p) => sum + p.remainingBase, 0)
        )
      },
      error: null
    };
  } catch (error) {
    return {
      data: null,
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Unable to load payment funding"
      }
    };
  }
}

/** Base-total contract for other readers; the composer uses typed document sources. */
export async function getAvailableOnAccountCredit(
  client: SupabaseClient<Database>,
  companyId: string,
  party: PaymentParty
): Promise<number> {
  try {
    const { sources } = await loadOnAccountSources(client, companyId, party);
    return round(sources.reduce((sum, p) => sum + p.remainingBase, 0));
  } catch {
    return 0;
  }
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
      .insert([
        {
          ...sanitize(payment),
          customerId: payment.customerId ?? null,
          supplierId: payment.supplierId ?? null
        }
      ])
      .select("id, paymentId")
      .single();
  }
  return client
    .from("payment")
    .update({
      ...sanitize(payment),
      customerId: payment.customerId ?? null,
      supplierId: payment.supplierId ?? null
    })
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
async function loadTransactionCurrency(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  code: string
) {
  const company = await db
    .selectFrom("company")
    .select(["companyGroupId", "baseCurrencyCode"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId)
    throw new Error("Company currency configuration is missing");
  const currencies = await db
    .selectFrom("currency")
    .select(["code", "decimalPlaces"])
    .where("companyGroupId", "=", company.companyGroupId)
    .execute();
  const decimals = new Map(currencies.map((c) => [c.code, c.decimalPlaces]));
  return {
    decimals,
    currencyDecimals: requireCurrencyDecimals(decimals, code)
  };
}

async function loadTransactionInvoices(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  ids: string[],
  isAR: boolean,
  currencyCode: string,
  partyId: string,
  decimals: number
) {
  const view = isAR ? "salesInvoices" : "purchaseInvoices";
  const targetColumn = isAR
    ? "invoiceSettlement.targetSalesInvoiceId"
    : "invoiceSettlement.targetPurchaseInvoiceId";
  const invoices = isAR
    ? await db
        .selectFrom("salesInvoice")
        .select([
          "id",
          "status",
          "exchangeRate",
          "currencyCode",
          "customerId as partyId"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .orderBy("id")
        .forUpdate()
        .execute()
    : await db
        .selectFrom("purchaseInvoice")
        .select([
          "id",
          "status",
          "exchangeRate",
          "currencyCode",
          "supplierId as partyId"
        ])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .orderBy("id")
        .forUpdate()
        .execute();
  for (const id of ids) {
    const invoice = invoices.find((i) => i.id === id);
    if (!invoice) throw new Error(`Invoice ${id} not found`);
    if (invoice.partyId !== partyId)
      throw new Error("A payment can only settle invoices for the same party");
    if (invoice.currencyCode !== currencyCode)
      throw new Error("Invoice and payment currency must match");
    if (
      !(
        isAR
          ? ["Submitted", "Partially Paid", "Overdue"]
          : ["Open", "Partially Paid", "Overdue"]
      ).includes(invoice.status)
    )
      throw new Error(`Invoice ${id} is not open`);
    assertExchangeRate(Number(invoice.exchangeRate));
  }
  const [totals, settlements, controls] = await Promise.all([
    db
      .selectFrom(view)
      .select(["id", "totalAmount", "exchangeRate"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute(),
    db
      .selectFrom("invoiceSettlement")
      .leftJoin(
        "payment as applyingPayment",
        "applyingPayment.id",
        "invoiceSettlement.paymentId"
      )
      .leftJoin(
        "memo as sourceMemo",
        "sourceMemo.id",
        "invoiceSettlement.memoId"
      )
      .leftJoin(
        "payment as viaPayment",
        "viaPayment.id",
        "invoiceSettlement.appliedViaPaymentId"
      )
      .select([
        "invoiceSettlement.targetSalesInvoiceId",
        "invoiceSettlement.targetPurchaseInvoiceId",
        "invoiceSettlement.sourceAmount",
        "invoiceSettlement.appliedAmount",
        "invoiceSettlement.discountAmount",
        "invoiceSettlement.writeOffAmount"
      ])
      .where("invoiceSettlement.companyId", "=", companyId)
      .where(targetColumn, "in", ids)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("applyingPayment.companyId", "=", companyId),
            eb("applyingPayment.status", "=", "Posted")
          ]),
          eb.and([
            eb("sourceMemo.companyId", "=", companyId),
            eb("sourceMemo.status", "=", "Posted"),
            eb.or([
              eb("invoiceSettlement.appliedViaPaymentId", "is", null),
              eb.and([
                eb("viaPayment.companyId", "=", companyId),
                eb("viaPayment.status", "=", "Posted")
              ])
            ])
          ])
        ])
      )
      .execute(),
    db
      .selectFrom("journalLine")
      .innerJoin("journal", "journal.id", "journalLine.journalId")
      .select(["journalLine.documentId", "journalLine.amount"])
      .where("journalLine.companyId", "=", companyId)
      .where("journal.companyId", "=", companyId)
      .where("journal.status", "=", "Posted")
      .where(
        "journal.sourceType",
        "=",
        isAR ? "Sales Invoice" : "Purchase Invoice"
      )
      .where("journalLine.documentType", "=", "Invoice")
      .where(
        "journalLine.description",
        "in",
        isAR ? RECEIVABLE_POSTING_DESCRIPTIONS : PAYABLE_POSTING_DESCRIPTIONS
      )
      .where("journalLine.documentId", "in", ids)
      .execute()
  ]);
  const controlAmounts = new Map<string, number>();
  for (const line of controls)
    if (line.documentId)
      controlAmounts.set(
        line.documentId,
        (controlAmounts.get(line.documentId) ?? 0) + Number(line.amount)
      );
  return new Map(
    totals.map((i) => [
      i.id!,
      {
        ...invoiceRemainingAmounts(
          i,
          settlements,
          controlAmounts,
          decimals,
          isAR
        ),
        exchangeRate: Number(i.exchangeRate)
      }
    ])
  );
}

/** Reserve both invoice applications and refunds against the same locked memo. */
async function loadTransactionMemoConsumption(
  trx: Kysely<KyselyDatabase>,
  companyId: string,
  memoIds: string[],
  excludePaymentId: string
) {
  return trx
    .selectFrom("invoiceSettlement")
    .leftJoin("payment as viaPayment", (join) =>
      join
        .onRef("viaPayment.id", "=", "invoiceSettlement.appliedViaPaymentId")
        .onRef("viaPayment.companyId", "=", "invoiceSettlement.companyId")
    )
    .leftJoin("payment as refund", (join) =>
      join
        .onRef("refund.id", "=", "invoiceSettlement.paymentId")
        .onRef("refund.companyId", "=", "invoiceSettlement.companyId")
    )
    .select([
      "invoiceSettlement.memoId",
      "invoiceSettlement.targetMemoId",
      "invoiceSettlement.sourceAmount",
      "invoiceSettlement.appliedAmount",
      "invoiceSettlement.fxGainLossAmount"
    ])
    .where("invoiceSettlement.companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb.and([
          eb("invoiceSettlement.memoId", "in", memoIds),
          eb.or([
            eb("invoiceSettlement.appliedViaPaymentId", "is", null),
            eb.and([
              eb(
                "invoiceSettlement.appliedViaPaymentId",
                "!=",
                excludePaymentId
              ),
              eb("viaPayment.status", "in", ["Draft", "Posted"])
            ])
          ])
        ]),
        eb.and([
          eb("invoiceSettlement.targetMemoId", "in", memoIds),
          eb("invoiceSettlement.paymentId", "!=", excludePaymentId),
          eb("refund.status", "in", ["Draft", "Posted"])
        ])
      ])
    )
    .execute();
}

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
      .selectAll()
      .where("id", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "Draft")
      throw new Error(
        "Applications can only be edited while the payment is Draft"
      );
    const { decimals, currencyDecimals } = await loadTransactionCurrency(
      trx,
      args.companyId,
      payment.currencyCode
    );
    assertExchangeRate(Number(payment.exchangeRate));
    const isAR = Boolean(payment.customerId);
    const cashIn = payment.paymentType === "Receipt";
    const isRefund = cashIn !== isAR;
    const partyId = isAR ? payment.customerId : payment.supplierId;
    if (!partyId || Boolean(payment.customerId) === Boolean(payment.supplierId))
      throw new Error("Payment must have exactly one customer or supplier");
    for (const app of args.applications) {
      if (
        app.sourceAmount != null &&
        toDocumentAmount(app.sourceAmount, 1, currencyDecimals) !==
          app.sourceAmount
      ) {
        throw new Error("Source amount exceeds document currency precision");
      }
      if ("sourcePaymentId" in app || "fxGainLossAmount" in app || app.memoId)
        throw new Error("Funding source and FX are server-authoritative");
      if (app.sourceExchangeRate !== Number(payment.exchangeRate))
        throw new Error("Source exchange rate does not match the payment");
      if (
        isRefund
          ? !app.targetMemoId ||
            app.targetSalesInvoiceId ||
            app.targetPurchaseInvoiceId ||
            app.discountAmount !== 0 ||
            app.writeOffAmount !== 0
          : app.targetMemoId ||
            (isAR
              ? !app.targetSalesInvoiceId || app.targetPurchaseInvoiceId
              : !app.targetPurchaseInvoiceId || app.targetSalesInvoiceId)
      )
        throw new Error(
          "Payments target same-side invoices; refunds target reducing memos without adjustments"
        );
    }
    if (isRefund) {
      const ids = [
        ...new Set(args.applications.map((app) => app.targetMemoId!))
      ].sort();
      const memos = ids.length
        ? await trx
            .selectFrom("memo")
            .selectAll()
            .where("companyId", "=", args.companyId)
            .where("id", "in", ids)
            .orderBy("id")
            .forUpdate()
            .execute()
        : [];
      if (memos.length !== ids.length)
        throw new Error("Refund memo not found in this company");
      for (const memo of memos) {
        if (
          memo.status !== "Posted" ||
          memo.direction !== (isAR ? "Credit" : "Debit") ||
          (isAR ? memo.customerId : memo.supplierId) !== partyId ||
          memo.currencyCode !== payment.currencyCode
        ) {
          throw new Error(
            "Refund target must be a posted reducing memo with matching party and currency"
          );
        }
      }
      const consumption = ids.length
        ? await loadTransactionMemoConsumption(
            trx,
            args.companyId,
            ids,
            payment.id
          )
        : [];
      const remaining = new Map(
        remainingFundingSources(
          memos.map((memo) => ({
            ...memo,
            totalAmount: memo.amount,
            paymentDate: memo.memoDate
          })),
          consumption.map((row) => ({
            ...row,
            paymentId: row.memoId ?? row.targetMemoId,
            sourcePaymentId: null,
            fxGainLossAmount: row.targetMemoId ? 0 : row.fxGainLossAmount
          })),
          decimals,
          isAR
        ).map((source) => [source.paymentId, source])
      );
      const requests = new Map<string, FundingRequest>();
      const dates = new Map<string, string>();
      for (const app of args.applications) {
        const memo = remaining.get(app.targetMemoId!);
        if (!memo) throw new Error("Memo has no remaining refund balance");
        if (app.targetExchangeRate !== memo.exchangeRate)
          throw new Error("Target exchange rate does not match the memo");
        const requested =
          app.sourceAmount ??
          (app.appliedAmount === memo.remainingBase
            ? memo.remainingDocument
            : toDocumentAmount(
                app.appliedAmount,
                memo.exchangeRate,
                currencyDecimals
              ));
        const request = requests.get(app.targetMemoId!) ?? {
          targetId: app.targetMemoId!,
          targetExchangeRate: memo.exchangeRate,
          remainingDocument: memo.remainingDocument,
          remainingBase: memo.remainingBase,
          requestedDocumentPrincipal: 0,
          discountAmount: 0,
          writeOffAmount: 0
        };
        request.requestedDocumentPrincipal = toDocumentAmount(
          request.requestedDocumentPrincipal + requested,
          1,
          currencyDecimals
        );
        requests.set(app.targetMemoId!, request);
        dates.set(app.targetMemoId!, app.appliedDate);
      }
      const allocation = allocatePaymentFunding({
        currentPayment: {
          paymentId: payment.id,
          postingDate: payment.paymentDate,
          exchangeRate: Number(payment.exchangeRate),
          remainingDocument: Number(payment.totalAmount),
          remainingBase: toBaseAmount(
            Number(payment.totalAmount),
            Number(payment.exchangeRate)
          )
        },
        priorSources: [],
        requests: [...requests.values()],
        currencyDecimals,
        isAR: cashIn
      });
      await trx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "=", payment.id)
        .where("companyId", "=", args.companyId)
        .execute();
      if (allocation.applications.length)
        await trx
          .insertInto("invoiceSettlement")
          .values(
            allocation.applications.map(({ targetId, ...application }) => ({
              ...application,
              paymentId: payment.id,
              targetMemoId: targetId,
              targetSalesInvoiceId: null,
              targetPurchaseInvoiceId: null,
              appliedDate: dates.get(targetId)!,
              createdBy: args.createdBy,
              companyId: args.companyId
            }))
          )
          .execute();
      return;
    }
    const ids = [
      ...new Set(
        args.applications.map(
          (a) => (isAR ? a.targetSalesInvoiceId : a.targetPurchaseInvoiceId)!
        )
      )
    ].sort();
    if (!ids.length) {
      await trx
        .deleteFrom("invoiceSettlement")
        .where("paymentId", "=", args.paymentId)
        .where("companyId", "=", args.companyId)
        .execute();
      return;
    }
    const invoices = await loadTransactionInvoices(
      trx,
      args.companyId,
      ids,
      isAR,
      payment.currencyCode,
      partyId,
      currencyDecimals
    );
    // Existing staged memos reserve target capacity while the cash half is edited.
    const staged = await trx
      .selectFrom("invoiceSettlement")
      .selectAll()
      .where("companyId", "=", args.companyId)
      .where("appliedViaPaymentId", "=", args.paymentId)
      .execute();
    const stagedMemoIds = [
      ...new Set(
        staged
          .map((row) => row.memoId)
          .filter((id): id is string => Boolean(id))
      )
    ].sort();
    const stagedMemos = stagedMemoIds.length
      ? await trx
          .selectFrom("memo")
          .select([
            "id",
            "status",
            "direction",
            "customerId",
            "supplierId",
            "currencyCode",
            "exchangeRate"
          ])
          .where("companyId", "=", args.companyId)
          .where("id", "in", stagedMemoIds)
          .orderBy("id")
          .forUpdate()
          .execute()
      : [];
    const stagedMemoById = new Map(stagedMemos.map((memo) => [memo.id, memo]));
    for (const row of staged) {
      const memo = row.memoId ? stagedMemoById.get(row.memoId) : undefined;
      if (
        !memo ||
        memo.status !== "Posted" ||
        memo.direction !== (isAR ? "Credit" : "Debit")
      ) {
        throw new Error("Staged applications must use a posted credit memo");
      }
      if (
        (isAR ? memo.customerId : memo.supplierId) !== partyId ||
        memo.currencyCode !== payment.currencyCode
      ) {
        throw new Error(
          "Staged credit and payment currency and party must match"
        );
      }
      const id = isAR ? row.targetSalesInvoiceId : row.targetPurchaseInvoiceId;
      const invoice = id ? invoices.get(id) : undefined;
      if (!invoice) continue;
      if (Number(memo.exchangeRate) !== invoice.exchangeRate)
        throw new Error("Staged credit and invoice exchange rates must match");
      const reserved = reduceInvoiceSettlements(
        [row],
        invoice.exchangeRate,
        currencyDecimals
      );
      invoice.remainingDocument = toDocumentAmount(
        invoice.remainingDocument - reserved.document,
        1,
        currencyDecimals
      );
      invoice.remainingBase = round(invoice.remainingBase - reserved.base);
    }
    let priorQuery = trx
      .selectFrom("payment")
      .selectAll()
      .where("companyId", "=", args.companyId)
      .where("status", "=", "Posted")
      .where("paymentType", "=", payment.paymentType)
      .where("currencyCode", "=", payment.currencyCode);
    priorQuery = isAR
      ? priorQuery.where("customerId", "=", partyId)
      : priorQuery.where("supplierId", "=", partyId);
    const priorPayments = await priorQuery.orderBy("id").forUpdate().execute();
    const sourceIds = priorPayments.map((p) => p.id);
    const consumption = sourceIds.length
      ? await trx
          .selectFrom("invoiceSettlement")
          .innerJoin(
            "payment as applyingPayment",
            "applyingPayment.id",
            "invoiceSettlement.paymentId"
          )
          .select([
            "invoiceSettlement.paymentId",
            "invoiceSettlement.sourcePaymentId",
            "invoiceSettlement.sourceAmount",
            "invoiceSettlement.appliedAmount",
            "invoiceSettlement.fxGainLossAmount"
          ])
          .where("invoiceSettlement.companyId", "=", args.companyId)
          .where("applyingPayment.companyId", "=", args.companyId)
          .where("applyingPayment.status", "=", "Posted")
          .where((eb) =>
            eb.or([
              eb("invoiceSettlement.sourcePaymentId", "in", sourceIds),
              eb("invoiceSettlement.paymentId", "in", sourceIds)
            ])
          )
          .execute()
      : [];
    const requests = new Map<string, FundingRequest>();
    const dates = new Map<string, string>();
    for (const app of args.applications) {
      const id = (
        isAR ? app.targetSalesInvoiceId : app.targetPurchaseInvoiceId
      )!;
      const invoice = invoices.get(id);
      if (!invoice) throw new Error(`Invoice ${id} balance not found`);
      if (app.targetExchangeRate !== invoice.exchangeRate)
        throw new Error("Target exchange rate does not match the invoice");
      const sourceAmount =
        app.sourceAmount ??
        (round(app.appliedAmount + app.discountAmount + app.writeOffAmount) ===
        invoice.remainingBase
          ? toDocumentAmount(
              invoice.remainingDocument -
                toDocumentAmount(
                  app.discountAmount + app.writeOffAmount,
                  invoice.exchangeRate,
                  currencyDecimals
                ),
              1,
              currencyDecimals
            )
          : toDocumentAmount(
              app.appliedAmount,
              invoice.exchangeRate,
              currencyDecimals
            ));
      const request = requests.get(id) ?? {
        targetId: id,
        targetExchangeRate: invoice.exchangeRate,
        remainingDocument: invoice.remainingDocument,
        remainingBase: invoice.remainingBase,
        requestedDocumentPrincipal: 0,
        discountAmount: 0,
        writeOffAmount: 0
      };
      request.requestedDocumentPrincipal = toDocumentAmount(
        request.requestedDocumentPrincipal + sourceAmount,
        1,
        currencyDecimals
      );
      request.discountAmount = round(
        request.discountAmount + app.discountAmount
      );
      request.writeOffAmount = round(
        request.writeOffAmount + app.writeOffAmount
      );
      requests.set(id, request);
      dates.set(id, app.appliedDate);
    }
    const result = allocatePaymentFunding({
      currentPayment: {
        paymentId: payment.id,
        postingDate: payment.paymentDate,
        exchangeRate: Number(payment.exchangeRate),
        remainingDocument: Number(payment.totalAmount),
        remainingBase: toBaseAmount(
          Number(payment.totalAmount),
          Number(payment.exchangeRate)
        )
      },
      priorSources: remainingFundingSources(
        priorPayments,
        consumption,
        decimals,
        isAR
      ),
      requests: [...requests.values()],
      currencyDecimals,
      isAR
    });
    await trx
      .deleteFrom("invoiceSettlement")
      .where("paymentId", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .execute();
    if (result.applications.length)
      await trx
        .insertInto("invoiceSettlement")
        .values(
          result.applications.map(({ targetId, ...a }) => ({
            ...a,
            paymentId: args.paymentId,
            companyId: args.companyId,
            createdBy: args.createdBy,
            targetSalesInvoiceId: isAR ? targetId : null,
            targetPurchaseInvoiceId: isAR ? null : targetId,
            appliedDate: dates.get(targetId)!
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
type AvailableMemoCredit = {
  id: string;
  memoId: string;
  direction: string;
  currencyCode: string;
  exchangeRate: number;
  amount: number;
  remaining: number;
  remainingDocument: number;
};

async function loadAvailableMemoCredits(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase",
  partyId?: string,
  excludePaymentId?: string,
  currencyCode?: string
): Promise<AvailableMemoCredit[]> {
  const [memos, company] = await Promise.all([
    fetchAllFromTable<
      Omit<AvailableMemoCredit, "remaining" | "remainingDocument"> & {
        memoDate: string;
        postingDate: string | null;
      }
    >(
      client,
      "memo",
      "id, memoId, direction, currencyCode, exchangeRate, amount, memoDate, postingDate",
      (query) => {
        query = query
          .eq("companyId", companyId)
          .eq("status", "Posted")
          .eq("direction", side === "sales" ? "Credit" : "Debit");
        if (partyId)
          query =
            side === "sales"
              ? query.eq("customerId", partyId)
              : query.eq("supplierId", partyId);
        if (currencyCode) query = query.eq("currencyCode", currencyCode);
        return query.order("id");
      }
    ),
    client.from("company").select("companyGroupId").eq("id", companyId).single()
  ]);
  if (memos.error) throw new Error(memos.error.message);
  if (company.error || !company.data?.companyGroupId)
    throw new Error("Company currency configuration is missing");
  const currencies = await client
    .from("currency")
    .select("code, decimalPlaces")
    .eq("companyGroupId", company.data.companyGroupId);
  if (currencies.error) throw new Error(currencies.error.message);
  const decimals = new Map(
    (currencies.data ?? []).map((c) => [c.code, c.decimalPlaces])
  );
  if (currencyCode) requireCurrencyDecimals(decimals, currencyCode);
  if (!memos.data?.length) return [];
  const apps = await fetchAllFromTable<{
    memoId: string | null;
    sourceAmount: number | null;
    appliedAmount: number;
    fxGainLossAmount: number | null;
    appliedViaPaymentId: string | null;
    appliedViaPayment: { status: string } | null;
  }>(
    client,
    "invoiceSettlement",
    "memoId, sourceAmount, appliedAmount, fxGainLossAmount, appliedViaPaymentId, appliedViaPayment:payment!invoiceSettlement_appliedViaPaymentId_fkey(status), memo:memo!invoiceSettlement_memoId_fkey!inner(status)",
    (query) => {
      query = query
        .eq("companyId", companyId)
        .eq("memo.companyId", companyId)
        .eq("memo.status", "Posted")
        .eq("memo.direction", side === "sales" ? "Credit" : "Debit");
      if (partyId)
        query =
          side === "sales"
            ? query.eq("memo.customerId", partyId)
            : query.eq("memo.supplierId", partyId);
      if (currencyCode) query = query.eq("memo.currencyCode", currencyCode);
      return query.order("id");
    }
  );
  if (apps.error) throw new Error(apps.error.message);
  const refunds = await fetchAllFromTable<{
    targetMemoId: string | null;
    paymentId: string | null;
    sourceAmount: number | null;
    appliedAmount: number;
    payment: { status: string } | null;
  }>(
    client,
    "invoiceSettlement",
    "targetMemoId, paymentId, sourceAmount, appliedAmount, payment:payment!invoiceSettlement_paymentId_fkey(status), targetMemo:memo!invoiceSettlement_targetMemoId_fkey!inner(status)",
    (query) => {
      query = query
        .eq("companyId", companyId)
        .eq("targetMemo.companyId", companyId)
        .eq("targetMemo.status", "Posted")
        .eq("targetMemo.direction", side === "sales" ? "Credit" : "Debit");
      if (partyId)
        query = query.eq(
          side === "sales" ? "targetMemo.customerId" : "targetMemo.supplierId",
          partyId
        );
      if (currencyCode)
        query = query.eq("targetMemo.currencyCode", currencyCode);
      return query.order("id");
    }
  );
  if (refunds.error) throw new Error(refunds.error.message);
  const reservedRefunds = refunds.data.filter(
    (row) =>
      row.targetMemoId &&
      !(excludePaymentId && row.paymentId === excludePaymentId) &&
      ["Draft", "Posted"].includes(row.payment?.status ?? "")
  );
  // Memo availability reserves competing Draft applications as well as Posted
  // ones; sharing the arithmetic must not change this eligibility policy.
  const reserved = apps.data.filter(
    (row) =>
      row.memoId &&
      !(excludePaymentId && row.appliedViaPaymentId === excludePaymentId) &&
      (!row.appliedViaPaymentId ||
        ["Draft", "Posted"].includes(row.appliedViaPayment?.status ?? ""))
  );
  const sources = remainingFundingSources(
    memos.data.map((memo) => ({
      ...memo,
      totalAmount: memo.amount,
      paymentDate: memo.memoDate
    })),
    [
      ...reserved.map((row) => ({
        ...row,
        paymentId: row.memoId,
        sourcePaymentId: null
      })),
      ...reservedRefunds.map((row) => ({
        ...row,
        paymentId: row.targetMemoId,
        sourcePaymentId: null,
        fxGainLossAmount: 0
      }))
    ],
    decimals,
    side === "sales"
  );
  const remaining = new Map(
    sources.map((source) => [source.paymentId, source])
  );
  return memos.data.flatMap((memo) => {
    const source = remaining.get(memo.id);
    return source
      ? [
          {
            id: memo.id,
            memoId: memo.memoId,
            direction: memo.direction,
            currencyCode: memo.currencyCode,
            exchangeRate: memo.exchangeRate,
            amount: toBaseAmount(
              Number(memo.amount),
              Number(memo.exchangeRate)
            ),
            remaining: source.remainingBase,
            remainingDocument: source.remainingDocument
          }
        ]
      : [];
  });
}

export async function getAvailableCreditsForParty(
  client: SupabaseClient<Database>,
  companyId: string,
  party:
    | { side: "sales"; customerId: string }
    | { side: "purchase"; supplierId: string },
  excludePaymentId?: string,
  currencyCode?: string
): Promise<{ data: AvailableMemoCredit[] | null; error: unknown }> {
  try {
    return {
      data: await loadAvailableMemoCredits(
        client,
        companyId,
        party.side,
        party.side === "sales" ? party.customerId : party.supplierId,
        excludePaymentId,
        currencyCode
      ),
      error: null
    };
  } catch (error) {
    return { data: null, error };
  }
}

export async function getCompanyHasOpenCredits(
  client: SupabaseClient<Database>,
  companyId: string,
  side: "sales" | "purchase"
): Promise<boolean> {
  try {
    return (await loadAvailableMemoCredits(client, companyId, side)).length > 0;
  } catch {
    return false;
  }
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
  side: "sales" | "purchase",
  companyId?: string
): Promise<{
  data:
    | {
        memoId: string;
        invoiceId: string;
        amount: number;
        sourceAmount: number | null;
      }[]
    | null;
  error: unknown;
}> {
  let query = client
    .from("invoiceSettlement")
    .select(
      "memoId, targetSalesInvoiceId, targetPurchaseInvoiceId, appliedAmount, sourceAmount"
    )
    .eq("appliedViaPaymentId", paymentId);
  if (companyId) query = query.eq("companyId", companyId);
  const apps = await query;
  if (apps.error) return { data: null, error: apps.error };
  const rows = (apps.data ?? []) as Array<{
    memoId: string | null;
    targetSalesInvoiceId: string | null;
    targetPurchaseInvoiceId: string | null;
    appliedAmount: number;
    sourceAmount: number | null;
  }>;
  const data = rows
    .map((r) => ({
      memoId: r.memoId ?? "",
      invoiceId:
        side === "sales"
          ? (r.targetSalesInvoiceId ?? "")
          : (r.targetPurchaseInvoiceId ?? ""),
      amount: Number(r.appliedAmount),
      sourceAmount: r.sourceAmount
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
    applications: {
      memoId: string;
      invoiceId: string;
      amount: number;
      sourceAmount?: number;
    }[];
  }
) {
  return db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .selectAll()
      .where("id", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "Draft")
      throw new Error(
        "Credit applications can only be edited while the payment is Draft"
      );
    const isAR = args.side === "sales";
    if ((payment.paymentType === "Receipt") !== isAR)
      throw new Error("Payment and invoice side must match");
    const partyId = isAR ? payment.customerId : payment.supplierId;
    if (!partyId) throw new Error("Payment party is required");
    const { currencyDecimals } = await loadTransactionCurrency(
      trx,
      args.companyId,
      payment.currencyCode
    );
    if (!args.applications.length) {
      await trx
        .deleteFrom("invoiceSettlement")
        .where("appliedViaPaymentId", "=", args.paymentId)
        .where("companyId", "=", args.companyId)
        .execute();
      return;
    }
    const ids = [...new Set(args.applications.map((a) => a.invoiceId))].sort();
    const memoIds = [...new Set(args.applications.map((a) => a.memoId))].sort();
    const invoices = await loadTransactionInvoices(
      trx,
      args.companyId,
      ids,
      isAR,
      payment.currencyCode,
      partyId,
      currencyDecimals
    );
    const memos = await trx
      .selectFrom("memo")
      .selectAll()
      .where("companyId", "=", args.companyId)
      .where("id", "in", memoIds)
      .orderBy("id")
      .forUpdate()
      .execute();
    const [prior, cash] = await Promise.all([
      loadTransactionMemoConsumption(
        trx,
        args.companyId,
        memoIds,
        args.paymentId
      ),
      trx
        .selectFrom("invoiceSettlement")
        .selectAll()
        .where("companyId", "=", args.companyId)
        .where("paymentId", "=", args.paymentId)
        .execute()
    ]);
    for (const row of cash) {
      const id = isAR ? row.targetSalesInvoiceId : row.targetPurchaseInvoiceId;
      const invoice = id ? invoices.get(id) : undefined;
      if (!invoice) continue;
      const reserved = reduceInvoiceSettlements(
        [row],
        invoice.exchangeRate,
        currencyDecimals
      );
      invoice.remainingDocument = toDocumentAmount(
        invoice.remainingDocument - reserved.document,
        1,
        currencyDecimals
      );
      invoice.remainingBase = round(invoice.remainingBase - reserved.base);
    }
    for (const id of memoIds) {
      const memo = memos.find((m) => m.id === id);
      if (!memo || memo.status !== "Posted")
        throw new Error("Only posted credits can be applied");
      if (memo.direction !== (isAR ? "Credit" : "Debit"))
        throw new Error("Memo direction does not reduce this invoice balance");
      if ((isAR ? memo.customerId : memo.supplierId) !== partyId)
        throw new Error("Memo and payment party must match");
      if (memo.currencyCode !== payment.currencyCode)
        throw new Error("Memo and payment currency must match");
    }
    const sources = new Map(
      remainingFundingSources(
        memos.map((memo) => ({
          ...memo,
          totalAmount: memo.amount,
          paymentDate: memo.memoDate
        })),
        prior.map((row) => ({
          ...row,
          paymentId: row.memoId ?? row.targetMemoId,
          sourcePaymentId: null,
          fxGainLossAmount: row.targetMemoId ? 0 : row.fxGainLossAmount
        })),
        new Map([[payment.currencyCode, currencyDecimals]]),
        isAR
      ).map((source) => [source.paymentId, source])
    );
    const values: Database["public"]["Tables"]["invoiceSettlement"]["Insert"][] =
      [];
    for (const app of args.applications) {
      const source = sources.get(app.memoId);
      if (!source) throw new Error("Credit has no remaining funding balance");
      const invoice = invoices.get(app.invoiceId);
      if (!invoice)
        throw new Error(`Invoice ${app.invoiceId} balance not found`);
      if (source.exchangeRate !== invoice.exchangeRate)
        throw new Error("Applying a credit requires matching exchange rates");
      if (!Number.isFinite(app.amount) || app.amount < 0)
        throw new Error("Applied amount must be nonnegative and finite");
      const sourceAmount =
        app.sourceAmount ??
        (app.amount === source.remainingBase
          ? source.remainingDocument
          : app.amount === invoice.remainingBase
            ? invoice.remainingDocument
            : toDocumentAmount(
                app.amount,
                invoice.exchangeRate,
                currencyDecimals
              ));
      if (sourceAmount <= 0)
        throw new Error("Applied document amount must be greater than zero");
      const result = allocatePaymentFunding({
        currentPayment: source,
        priorSources: [],
        currencyDecimals,
        isAR,
        requests: [
          {
            targetId: app.invoiceId,
            targetExchangeRate: invoice.exchangeRate,
            remainingDocument: invoice.remainingDocument,
            remainingBase: invoice.remainingBase,
            requestedDocumentPrincipal: sourceAmount,
            discountAmount: 0,
            writeOffAmount: 0
          }
        ]
      });
      const allocated = result.applications[0];
      sources.set(app.memoId, { ...source, ...result.sourceRemainders[0] });
      invoice.remainingDocument = toDocumentAmount(
        invoice.remainingDocument - sourceAmount,
        1,
        currencyDecimals
      );
      invoice.remainingBase = round(
        invoice.remainingBase - allocated.appliedAmount
      );
      values.push({
        memoId: app.memoId,
        appliedViaPaymentId: args.paymentId,
        companyId: args.companyId,
        createdBy: args.createdBy,
        targetSalesInvoiceId: isAR ? app.invoiceId : null,
        targetPurchaseInvoiceId: isAR ? null : app.invoiceId,
        sourceAmount: allocated.sourceAmount,
        appliedAmount: allocated.appliedAmount,
        discountAmount: 0,
        writeOffAmount: 0,
        sourceExchangeRate: source.exchangeRate,
        targetExchangeRate: invoice.exchangeRate,
        // Matching-snapshot memo applications are GL-neutral.
        fxGainLossAmount: 0,
        appliedDate: args.appliedDate
      });
    }
    await trx
      .deleteFrom("invoiceSettlement")
      .where("appliedViaPaymentId", "=", args.paymentId)
      .where("companyId", "=", args.companyId)
      .execute();
    if (values.length)
      await trx.insertInto("invoiceSettlement").values(values).execute();
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
