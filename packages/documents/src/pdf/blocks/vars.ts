import type { SalesInvoiceData } from "./types";

/**
 * Build the merge-field variable map for a Sales Invoice. Tokens here must stay
 * in sync with `SALES_INVOICE_MERGE_FIELDS` in template/merge.ts (the catalog
 * the editor offers). Missing values resolve to "" so a token never prints raw.
 */
export function buildSalesInvoiceVars(
  data: Pick<
    SalesInvoiceData,
    "salesInvoice" | "salesInvoiceLocations" | "company" | "currencyCode"
  >
): Record<string, string> {
  const inv = data.salesInvoice;
  const loc = data.salesInvoiceLocations;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "invoice.number": str(inv?.invoiceId),
    "invoice.dateIssued": str(inv?.dateIssued),
    "invoice.dateDue": str(inv?.dateDue),
    "invoice.customerReference": str(inv?.customerReference),
    "invoice.currency": str(data.currencyCode),
    "customer.name": str(loc?.invoiceCustomerName ?? loc?.customerName),
    "customer.addressLine1": str(
      loc?.invoiceAddressLine1 ?? loc?.customerAddressLine1
    ),
    "customer.city": str(loc?.invoiceCity ?? loc?.customerCity),
    "customer.country": str(
      loc?.invoiceCountryName ?? loc?.customerCountryName
    ),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode)
  };
}
