import type { PurchaseOrderData } from "./types";

/** Merge-field variable map for a Purchase Order. */
export function buildPurchaseOrderVars(
  data: Pick<
    PurchaseOrderData,
    "purchaseOrder" | "purchaseOrderLocations" | "company" | "currencyCode"
  >
): Record<string, string> {
  const po = data.purchaseOrder;
  const loc = data.purchaseOrderLocations;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "order.number": str(po?.purchaseOrderId),
    "order.date": str(po?.orderDate),
    "order.supplierReference": str(po?.supplierReference),
    "order.currency": str(data.currencyCode),
    "supplier.name": str(loc?.supplierName),
    "supplier.addressLine1": str(loc?.supplierAddressLine1),
    "supplier.city": str(loc?.supplierCity),
    "supplier.country": str(loc?.supplierCountryName),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode)
  };
}
