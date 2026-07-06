import type { SalesOrderData } from "./types";

/**
 * Merge-field variable map for a Sales Order. Tokens mirror
 * `SALES_ORDER_MERGE_FIELDS` in template/merge.ts.
 */
export function buildSalesOrderVars(
  data: Pick<
    SalesOrderData,
    "salesOrder" | "salesOrderLocations" | "company" | "currencyCode"
  >
): Record<string, string> {
  const so = data.salesOrder;
  const loc = data.salesOrderLocations;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "order.number": str(so?.salesOrderId),
    "order.date": str(so?.orderDate),
    "order.customerReference": str(so?.customerReference),
    "order.currency": str(data.currencyCode),
    "customer.name": str(loc?.customerName),
    "customer.addressLine1": str(loc?.customerAddressLine1),
    "customer.city": str(loc?.customerCity),
    "customer.country": str(loc?.customerCountryName),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode)
  };
}
