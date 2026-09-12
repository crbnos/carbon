import type { PurchaseReturnOrderData } from "./types";

/**
 * Merge-field variable map for a Purchase Return Order. Tokens mirror
 * `PURCHASE_RETURN_ORDER_MERGE_FIELDS` in template/merge.ts.
 */
export function buildPurchaseReturnOrderVars(
  data: Pick<
    PurchaseReturnOrderData,
    "purchaseReturnOrder" | "supplierAddress" | "company" | "currencyCode"
  >
): Record<string, string> {
  const pro = data.purchaseReturnOrder;
  const supplier = data.supplierAddress;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "order.number": str(pro?.purchaseReturnOrderId),
    "order.date": str(pro?.orderDate),
    "order.expirationDate": str(pro?.expirationDate),
    "order.supplierReference": str(pro?.supplierReference),
    "order.currency": str(data.currencyCode),
    "supplier.name": str(supplier?.name),
    "supplier.addressLine1": str(supplier?.addressLine1),
    "supplier.city": str(supplier?.city),
    "supplier.country": str(supplier?.country),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
