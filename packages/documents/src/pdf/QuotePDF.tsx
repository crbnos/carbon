// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  quoteTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import { getQuoteDisplayId } from "../utils/quote";
import { getMoneyFormatter, resolveRegistrationLine } from "../utils/shared";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type { QuoteCustomerDetails, QuoteData } from "./blocks/quote";
import { buildQuoteVars, quoteBlockRegistry } from "./blocks/quote";

type QuoteLinePrice = Database["public"]["Tables"]["quoteLinePrice"]["Row"];

interface QuotePDFProps extends PDF {
  valueCollector?: ValueCollector;
  /** The day this prints, `YYYY-MM-DD`, in the company's time zone. */
  printDate: string;
  exchangeRate: number;
  quote: Database["public"]["Views"]["quotes"]["Row"];
  quoteLines: Database["public"]["Views"]["quoteLines"]["Row"][];
  quoteCustomerDetails: QuoteCustomerDetails;
  quoteLinePrices: QuoteLinePrice[];
  payment?: Database["public"]["Tables"]["quotePayment"]["Row"] | null;
  shipment?: Database["public"]["Tables"]["quoteShipment"]["Row"] | null;
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails: Record<string, string | null>;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
  /** Settlement decimals from the document currency's row; null/omitted falls back to 2. */
  currencyDecimals?: number | null;
}

const QuotePDF = ({
  valueCollector,
  company,
  companySettings,
  meta,
  exchangeRate,
  quote,
  quoteLines: allQuoteLines,
  quoteLinePrices: allQuoteLinePrices,
  quoteCustomerDetails,
  printDate,
  payment,
  paymentTerms,
  shipment,
  terms,
  thumbnails,
  locale,
  currencyDecimals,
  template,
  sections = {}
}: QuotePDFProps) => {
  const currencyCode = quote.currencyCode ?? company.baseCurrencyCode;
  const shouldConvertCurrency =
    !!currencyCode && currencyCode !== company.baseCurrencyCode;
  const numberFormatter = getMoneyFormatter(locale, currencyDecimals);

  // A No Quote line is the company's own decision not to bid — the customer
  // never sees it, its prices, or its lead time.
  // Quantity breaks are stored in entry order; the PDF renders them
  // least-to-most, and the single-quantity totals below use the smallest
  // break — matching the in-app summary and the share page, which sort too.
  const quoteLines = allQuoteLines
    .filter((line) => line.status !== "No Quote")
    .map((line) =>
      line.quantity
        ? { ...line, quantity: [...line.quantity].sort((a, b) => a - b) }
        : line
    );
  const quotedLineIds = new Set(quoteLines.map((line) => line.id));
  const quoteLinePrices = allQuoteLinePrices.filter((price) =>
    quotedLineIds.has(price.quoteLineId)
  );

  const pricesByLine = quoteLinePrices.reduce<Record<string, QuoteLinePrice[]>>(
    (acc, price) => {
      (acc[price.quoteLineId] ??= []).push(price);
      return acc;
    },
    {}
  );

  const priceForFirstQty = (line: (typeof quoteLines)[number]) => {
    const lineQuantity = line.quantity ?? [];
    const prices = line.id != null ? (pricesByLine[line.id] ?? []) : [];
    return prices.find((p) => p.quantity === lineQuantity[0]);
  };

  const hasSinglePricePerLine = quoteLines.every(
    (line) => (line.quantity ?? []).length === 1
  );
  const hasAnyLeadTime = quoteLines.some(
    (line) => (priceForFirstQty(line)?.leadTime ?? 0) > 0
  );

  let maxLeadTime = 0;
  for (const prices of Object.values(pricesByLine)) {
    for (const price of prices) {
      if (price && price.leadTime > maxLeadTime) maxLeadTime = price.leadTime;
    }
  }

  const subtotal = quoteLines.reduce((total, line) => {
    return total + (priceForFirstQty(line)?.convertedNetExtendedPrice ?? 0);
  }, 0);

  const shipping =
    quoteLines.reduce((total, line) => {
      return total + (priceForFirstQty(line)?.convertedShippingCost ?? 0);
    }, 0) +
    (shipment?.shippingCost ?? 0) * (exchangeRate ?? 1);

  const fees = quoteLines.reduce((total, line) => {
    const additionalCharges = line.additionalCharges ?? {};
    const quantity = (line.quantity ?? [])[0];
    const charges = Object.values(additionalCharges).reduce((acc, charge) => {
      let amount = quantity != null ? (charge.amounts?.[quantity] ?? 0) : 0;
      if (shouldConvertCurrency) amount *= exchangeRate;
      return acc + amount;
    }, 0);
    return total + charges;
  }, 0);

  const taxes = quoteLines.reduce((total, line) => {
    const price = priceForFirstQty(line);
    const netExtendedPrice = price?.convertedNetExtendedPrice ?? 0;
    const additionalCharges = line.additionalCharges ?? {};
    const quantity = (line.quantity ?? [])[0];
    const taxableFees = Object.values(additionalCharges).reduce(
      (acc, charge) => {
        if (charge.taxable === false) return acc;
        let amount = quantity != null ? (charge.amounts?.[quantity] ?? 0) : 0;
        if (shouldConvertCurrency) amount *= exchangeRate;
        return acc + amount;
      },
      0
    );
    const lineShipping = price?.convertedShippingCost ?? 0;
    const taxableAmount = netExtendedPrice + taxableFees + lineShipping;
    return total + taxableAmount * (line.taxPercent ?? 0);
  }, 0);

  const totals = {
    subtotal,
    shipping,
    fees,
    taxes,
    total: subtotal + shipping + fees + taxes
  };

  const resolved = resolveTemplate("quote", template);
  const { theme, settings, footerSectionId } = resolved;

  const values = documentValues(settings.valueEdits, valueCollector);
  const vars = values.document(
    buildQuoteVars({
      quote,
      quoteCustomerDetails,
      printDate,
      company,
      currencyCode,
      locale,
      payment,
      paymentTerms,
      shipment,
      maxLeadTime,
      totals,
      numberFormatter
    })
  );
  const chrome = documentChrome({
    texts: quoteTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { documentTitle, documentNumber, headerOptions } = chrome;

  const registration = resolveRegistrationLine({
    company,
    footerSectionId,
    sections,
    settings,
    vars
  });

  const data: QuoteData = {
    company,
    companySettings,
    locale,
    quote,
    quoteLines,
    quoteLinePrices,
    quoteCustomerDetails,
    printDate,
    payment,
    shipment,
    paymentTerms,
    terms,
    thumbnails,
    exchangeRate,
    shouldConvertCurrency,
    pricesByLine,
    hasSinglePricePerLine,
    hasAnyLeadTime,
    maxLeadTime,
    totals,
    theme,
    sections,
    currencyCode,
    numberFormatter,
    values,
    vars,
    headerOptions,
    documentTitle,
    documentNumber
  };

  const displayId = getQuoteDisplayId(quote);

  return (
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="quote"
      title={displayId ? `${documentTitle}: ${displayId}` : documentTitle}
      footerDocumentId={displayId || undefined}
      footerLabel={registration.label}
      showRegistrationLine={registration.show}
      registry={quoteBlockRegistry}
      data={data}
    />
  );
};

export default QuotePDF;
