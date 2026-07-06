import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrencyByCode, getPaymentTermsList } from "~/modules/accounting";
import {
  getShippingMethodsList,
  getStockTransfer,
  getStockTransferLines
} from "~/modules/inventory";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment
} from "~/modules/invoicing";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getPurchasingTerms
} from "~/modules/purchasing";
import {
  getQuote,
  getQuoteCustomerDetails,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuotePayment,
  getQuoteShipment,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines,
  getSalesTerms
} from "~/modules/sales";
import {
  getAccountsPayableBillingAddress,
  getAccountsReceivableBillingAddress,
  getCompany,
  getCompanySettings
} from "~/modules/settings";

type Client = SupabaseClient<Database>;

export interface PreviewEntity {
  id: string;
  label: string;
}

/** Document types that support previewing against a real record. */
const LIST_CONFIG: Record<
  string,
  { view: string; idColumn: string } | undefined
> = {
  salesInvoice: { view: "salesInvoices", idColumn: "invoiceId" },
  salesOrder: { view: "salesOrders", idColumn: "salesOrderId" },
  purchaseOrder: { view: "purchaseOrders", idColumn: "purchaseOrderId" },
  quote: { view: "quotes", idColumn: "quoteId" },
  stockTransfer: { view: "stockTransfer", idColumn: "stockTransferId" }
};

/** Recent records of a document type, to populate the preview record picker. */
export async function listPreviewEntities(
  client: Client,
  companyId: string,
  documentType: string
): Promise<PreviewEntity[]> {
  const cfg = LIST_CONFIG[documentType];
  if (!cfg) return [];

  const { data } = await client
    .from(cfg.view as never)
    .select(`id, ${cfg.idColumn}`)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    // Just the latest handful — the picker is for sampling, not browsing.
    .limit(6);

  return ((data ?? []) as Record<string, string>[])
    .filter((row) => row.id)
    .map((row) => ({ id: row.id, label: row[cfg.idColumn] ?? row.id }));
}

const emptyThumbnails: Record<string, string | null> = {};

/**
 * Fetch the real data props a document's PDF needs for a record id, mirroring
 * the live PDF route loaders. Returns null when unsupported / not found, so the
 * preview falls back to sample data.
 */
export async function buildPreviewProps(
  client: Client,
  companyId: string,
  companyGroupId: string,
  documentType: string,
  id: string,
  locale: string
): Promise<Record<string, unknown> | null> {
  const [company, companySettings] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId)
  ]);
  if (!company.data) return null;
  const base = {
    company: company.data,
    companySettings: companySettings.data,
    locale,
    thumbnails: emptyThumbnails
  };

  switch (documentType) {
    case "salesInvoice": {
      const [
        invoice,
        lines,
        locations,
        shipment,
        terms,
        payment,
        shipping,
        ar
      ] = await Promise.all([
        getSalesInvoice(client, id),
        getSalesInvoiceLines(client, id),
        getSalesInvoiceCustomerDetails(client, id),
        getSalesInvoiceShipment(client, id),
        getSalesTerms(client, companyId),
        getPaymentTermsList(client, companyId),
        getShippingMethodsList(client, companyId),
        getAccountsReceivableBillingAddress(client, companyId)
      ]);
      if (!invoice.data) return null;
      return {
        ...base,
        salesInvoice: invoice.data,
        salesInvoiceLines: lines.data ?? [],
        salesInvoiceLocations: locations.data,
        salesInvoiceShipment: shipment.data,
        accountsReceivableBillingAddress: companySettings.data
          ?.accountsReceivableAddress
          ? ar.data
          : null,
        terms: (terms?.data?.salesTerms ?? {}) as JSONContent,
        paymentTerms: payment.data ?? [],
        shippingMethods: shipping.data ?? []
      };
    }
    case "salesOrder": {
      const [order, lines, locations, terms, payment, shipping, ar] =
        await Promise.all([
          getSalesOrder(client, id),
          getSalesOrderLines(client, id),
          getSalesOrderCustomerDetails(client, id),
          getSalesTerms(client, companyId),
          getPaymentTermsList(client, companyId),
          getShippingMethodsList(client, companyId),
          getAccountsReceivableBillingAddress(client, companyId)
        ]);
      if (!order.data) return null;
      return {
        ...base,
        salesOrder: order.data,
        salesOrderLines: lines.data ?? [],
        salesOrderLocations: locations.data,
        accountsReceivableBillingAddress: companySettings.data
          ?.accountsReceivableAddress
          ? ar.data
          : null,
        terms: (terms?.data?.salesTerms ?? {}) as JSONContent,
        paymentTerms: payment.data ?? [],
        shippingMethods: shipping.data ?? []
      };
    }
    case "purchaseOrder": {
      const [order, lines, locations, terms, payment, ap] = await Promise.all([
        getPurchaseOrder(client, id),
        getPurchaseOrderLines(client, id),
        getPurchaseOrderLocations(client, id),
        getPurchasingTerms(client, companyId),
        getPaymentTermsList(client, companyId),
        getAccountsPayableBillingAddress(client, companyId)
      ]);
      if (!order.data) return null;
      return {
        ...base,
        purchaseOrder: order.data,
        purchaseOrderLines: lines.data ?? [],
        purchaseOrderLocations: locations.data,
        accountsPayableBillingAddress: companySettings.data
          ?.accountsPayableAddress
          ? ap.data
          : null,
        terms: (terms?.data?.purchasingTerms ?? {}) as JSONContent,
        paymentTerms: payment.data ?? []
      };
    }
    case "quote": {
      const [
        quote,
        lines,
        prices,
        locations,
        payment,
        shipment,
        terms,
        paymentTerms,
        shipping
      ] = await Promise.all([
        getQuote(client, id),
        getQuoteLines(client, id),
        getQuoteLinePricesByQuoteId(client, id),
        getQuoteCustomerDetails(client, id),
        getQuotePayment(client, id),
        getQuoteShipment(client, id),
        getSalesTerms(client, companyId),
        getPaymentTermsList(client, companyId),
        getShippingMethodsList(client, companyId)
      ]);
      if (!quote.data) return null;
      let exchangeRate = 1;
      if (quote.data.currencyCode) {
        const currency = await getCurrencyByCode(
          client,
          companyGroupId,
          quote.data.currencyCode
        );
        if (currency.data?.exchangeRate)
          exchangeRate = currency.data.exchangeRate;
      }
      return {
        ...base,
        exchangeRate,
        quote: quote.data,
        quoteLines: lines.data ?? [],
        quoteLinePrices: prices.data ?? [],
        quoteCustomerDetails: locations.data,
        payment: payment?.data,
        shipment: shipment?.data,
        terms: (terms?.data?.salesTerms ?? {}) as JSONContent,
        paymentTerms: paymentTerms.data ?? [],
        shippingMethods: shipping.data ?? []
      };
    }
    case "stockTransfer": {
      const [transfer, lines] = await Promise.all([
        getStockTransfer(client, id),
        getStockTransferLines(client, id)
      ]);
      if (!transfer.data) return null;
      const location = await client
        .from("location")
        .select("*")
        .eq("id", transfer.data.locationId)
        .single();
      return {
        ...base,
        stockTransfer: transfer.data,
        stockTransferLines: lines.data ?? [],
        location: location.data
      };
    }
    default:
      return null;
  }
}
