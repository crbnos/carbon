import type { SalesReturnOrderData } from "./types";

/**
 * Merge-field variable map for a Sales Return Order (RMA). Tokens mirror
 * `SALES_RETURN_ORDER_MERGE_FIELDS` in template/merge.ts.
 */
export function buildSalesReturnOrderVars(
  data: Pick<
    SalesReturnOrderData,
    "salesReturnOrder" | "customerAddress" | "company" | "currencyCode"
  >
): Record<string, string> {
  const rma = data.salesReturnOrder;
  const customer = data.customerAddress;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "order.number": str(rma?.salesReturnOrderId),
    "order.date": str(rma?.orderDate),
    "order.expirationDate": str(rma?.expirationDate),
    "order.customerReference": str(rma?.customerReference),
    "order.currency": str(data.currencyCode),
    "customer.name": str(customer?.name),
    "customer.addressLine1": str(customer?.addressLine1),
    "customer.city": str(customer?.city),
    "customer.country": str(customer?.country),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode),
    "company.taxId": str(data.company?.taxId),
    "company.eori": str(data.company?.eori),
    "company.vatNumber": str(data.company?.vatNumber),
    "company.registrationNumber": str(data.company?.registrationNumber)
  };
}
