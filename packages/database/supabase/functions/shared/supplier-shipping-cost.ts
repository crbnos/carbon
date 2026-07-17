/**
 * Converts a supplier-currency `supplierShippingCost` to the company's base
 * currency.
 *
 * `currency.exchangeRate` stores foreign-units-per-base, so supplier -> base is
 * a DIVIDE. Every other consumer of `supplierShippingCost` already divides:
 *
 *   * the `purchaseOrderLine` / `purchaseInvoiceLine` / `supplierQuoteLinePrice`
 *     generated `shippingCost` columns, since 20250807094441
 *     (fix-purchasing-conversion-factor);
 *   * the header-level `purchaseOrders` / `purchaseInvoices` views, since
 *     20260702061504 (fix-supplier-shipping-cost-exchange-rate), preserved by
 *     20260702114500 and 20260702224219.
 *
 * post-receipt multiplied instead, which valued the same freight in the opposite
 * direction from the receipt's own line costs (`receiptLine.unitPrice` descends
 * from the already-divided `purchaseOrderLine.unitPrice`) and from the AP side.
 * The gap landed silently in `purchaseVarianceAccount`. This helper is the one
 * place the direction is decided.
 *
 * The zero-guard mirrors the SQL `CASE WHEN "exchangeRate" = 0 THEN 1 ELSE
 * "exchangeRate" END` so a bad rate can't divide by zero.
 */
export function getBaseCurrencyShippingCost(
  supplierShippingCost?: number | null,
  exchangeRate?: number | null
): number {
  return (supplierShippingCost ?? 0) / (exchangeRate || 1);
}
