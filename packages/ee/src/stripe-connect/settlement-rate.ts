// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The exchange rate to book a Stripe Connect payment at, in Carbon's direction
 * (foreign units per base unit), from the rate Stripe settled the charge at.
 *
 * Stripe's `balance_transaction.exchange_rate` is the other way round:
 * settlement-currency units per charge-currency unit. It describes the cash in
 * base currency only when Stripe settled into the base currency, and then
 * Carbon's rate is its inverse. Settled into any other currency, it says
 * nothing about base currency, so this returns `null` and the caller books the
 * payment at the invoice's own rate.
 */
export function carbonSettlementRate(params: {
  stripeRate: number | null;
  settlementCurrency: string | null;
  baseCurrency: string | null;
}): number | null {
  const { stripeRate, settlementCurrency, baseCurrency } = params;
  if (!stripeRate || stripeRate <= 0 || !settlementCurrency || !baseCurrency) {
    return null;
  }
  if (settlementCurrency.toUpperCase() !== baseCurrency.toUpperCase()) {
    return null;
  }
  return 1 / stripeRate;
}
