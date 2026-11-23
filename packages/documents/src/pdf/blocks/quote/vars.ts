// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DEFAULT_CURRENCY_DECIMALS,
  formatDate,
  formatPercent,
  moneyFormatOptions,
  pluralize
} from "@carbon/utils";
import type { MergeToken, RowVars } from "../../../template";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getQuoteDisplayId
} from "../../../utils/quote";
import { addressVars, companyVars, incotermText, str } from "../textVars";
import type { QuoteData } from "./types";

type QuoteLine = QuoteData["quoteLines"][number];
/** One entry of `quoteLine.additionalCharges`, a JSON column. */
type QuoteCharge = {
  description: string;
  taxable?: boolean;
  amounts?: Record<number, number>;
};
const days = (count: number) => `${count} ${pluralize(count, "day")}`;

/** Merge-field variable map for a Quote. */
export function buildQuoteVars(
  data: Pick<
    QuoteData,
    | "quote"
    | "printDate"
    | "quoteCustomerDetails"
    | "company"
    | "currencyCode"
    | "locale"
    | "payment"
    | "paymentTerms"
    | "shipment"
    | "maxLeadTime"
    | "totals"
    | "numberFormatter"
  >
): Record<MergeToken<"quote">, string> {
  const q = data.quote;
  const c = data.quoteCustomerDetails;
  const shipment = data.shipment;
  const money = (v: number) => data.numberFormatter.format(v);
  const date = (v: string | null | undefined) =>
    formatDate(v, undefined, data.locale);

  return {
    "quote.number": q ? getQuoteDisplayId(q) : "",
    "quote.revision": str(q?.revisionId ?? 0),
    "quote.date": date(data.printDate),
    "quote.expirationDate": date(q?.expirationDate),
    "quote.customerReference": str(q?.customerReference),
    "quote.maxLeadTime": data.maxLeadTime > 0 ? days(data.maxLeadTime) : "",
    "quote.paymentTerms": str(
      data.paymentTerms?.find((pt) => pt.id === data.payment?.paymentTermId)
        ?.name
    ),
    "quote.incoterm": incotermText(
      shipment?.incoterm,
      shipment?.incotermLocation
    ),
    "quote.currency": str(data.currencyCode),
    "quote.subtotal": money(data.totals.subtotal),
    "quote.shipping": money(data.totals.shipping),
    "quote.fees": data.totals.fees > 0 ? money(data.totals.fees) : "",
    "quote.tax": money(data.totals.taxes),
    "quote.total": money(data.totals.total),
    ...addressVars("customer", {
      name: c?.customerName,
      addressLine1: c?.customerAddressLine1,
      addressLine2: c?.customerAddressLine2,
      city: c?.customerCity,
      stateProvince: c?.customerStateProvince,
      postalCode: c?.customerPostalCode,
      country: c?.customerCountryName ?? c?.customerCountryCode
    }),

    "customer.taxId": str(c?.customerTaxId),
    "customer.vatNumber": str(c?.customerVatNumber),
    "customer.eori": str(c?.customerEori),
    "customer.contactName": str(c?.contactName),
    "customer.contactEmail": str(c?.contactEmail),
    ...companyVars(data.company)
  };
}

/** Printed once, on its first quantity's row. */
export function buildQuoteLineVars(
  line: QuoteLine,
  rowNumber: number
): RowVars<"quote", "line"> {
  return {
    "line.number": String(rowNumber),
    "line.description": str(getLineDescription(line)),
    "line.details": str(getLineDescriptionDetails(line))
  };
}

type PriceAmountsData = Pick<
  QuoteData,
  "pricesByLine" | "shouldConvertCurrency" | "exchangeRate"
>;

const chargeAmount = (
  charge: QuoteCharge,
  quantity: number,
  data: Pick<QuoteData, "shouldConvertCurrency" | "exchangeRate">
) => {
  const amount = charge.amounts?.[quantity] ?? 0;
  return data.shouldConvertCurrency ? amount * data.exchangeRate : amount;
};

/** What one quantity of a line costs, before any formatting. */
export function getQuotePriceAmounts(
  line: QuoteLine,
  quantity: number,
  data: PriceAmountsData
) {
  const prices = line.id != null ? (data.pricesByLine[line.id] ?? []) : [];
  const price = prices.find((p) => p.quantity === quantity);
  const netExtendedPrice = price?.convertedNetExtendedPrice ?? 0;
  const shippingCost = price?.convertedShippingCost ?? 0;
  const charges: QuoteCharge[] = Object.values(line.additionalCharges ?? {});
  const additionalCharge = charges.reduce(
    (acc, charge) => acc + chargeAmount(charge, quantity, data),
    0
  );
  const taxableAdditionalCharge = charges.reduce(
    (acc, charge) =>
      charge.taxable === false
        ? acc
        : acc + chargeAmount(charge, quantity, data),
    0
  );
  const taxPercent = line.taxPercent ?? 0;
  const taxAmount =
    (netExtendedPrice + taxableAdditionalCharge + shippingCost) * taxPercent;
  const totalTaxAndFees = additionalCharge + shippingCost + taxAmount;

  return {
    unitPrice: price?.convertedUnitPrice ?? 0,
    leadTime: price?.leadTime ?? 0,
    netExtendedPrice,
    shippingCost,
    taxPercent,
    taxAmount,
    totalTaxAndFees,
    totalPrice: netExtendedPrice + totalTaxAndFees
  };
}

// A quote carries a PER-LINE unit-price precision (`quoteLine.unitPricePrecision`,
// constrained to 2/3/4), so it cannot reuse the document's `numberFormatter`.
// Index the few distinct precisions once instead of constructing one per row.
const unitPriceFormatters = new Map<string, Intl.NumberFormat>();
const unitPriceFormatter = (
  locale: string,
  precision: number | null | undefined
) => {
  const digits = precision ?? DEFAULT_CURRENCY_DECIMALS;
  const key = `${locale}:${digits}`;
  let formatter = unitPriceFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, moneyFormatOptions(digits));
    unitPriceFormatters.set(key, formatter);
  }
  return formatter;
};

/** One quantity of a line. */
export function buildQuotePriceVars(
  line: QuoteLine,
  quantity: number,
  data: PriceAmountsData &
    Pick<QuoteData, "hasSinglePricePerLine" | "numberFormatter" | "locale">
): RowVars<"quote", "price"> {
  const money = (v: number) => data.numberFormatter.format(v);
  const positive = (v: number) => (v > 0 ? money(v) : "-");
  const amounts = getQuotePriceAmounts(line, quantity, data);

  return {
    "price.quantity": String(quantity),
    "price.unitPrice": amounts.unitPrice
      ? unitPriceFormatter(data.locale, line.unitPricePrecision).format(
          amounts.unitPrice
        )
      : "-",
    "price.taxAndFees": positive(amounts.totalTaxAndFees),
    "price.leadTime": amounts.leadTime > 0 ? days(amounts.leadTime) : "-",
    "price.total": positive(
      data.hasSinglePricePerLine ? amounts.netExtendedPrice : amounts.totalPrice
    ),
    "price.shipping":
      amounts.shippingCost > 0 ? money(amounts.shippingCost) : "",
    "price.taxPercent":
      amounts.taxPercent > 0
        ? formatPercent(amounts.taxPercent, data.locale)
        : "",
    "price.tax": amounts.taxPercent > 0 ? money(amounts.taxAmount) : ""
  };
}

export function buildQuoteChargeVars(
  charge: QuoteCharge,
  quantity: number,
  data: Pick<
    QuoteData,
    "shouldConvertCurrency" | "exchangeRate" | "numberFormatter"
  >
): RowVars<"quote", "charge"> {
  return {
    "charge.description": str(charge.description),
    "charge.amount": data.numberFormatter.format(
      chargeAmount(charge, quantity, data)
    )
  };
}
