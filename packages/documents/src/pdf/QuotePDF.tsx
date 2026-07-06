import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import { composeRegistrationLine } from "../utils/footer";
import type { QuoteCustomerDetails, QuoteData } from "./blocks/quote";
import { buildQuoteVars, quoteBlockRegistry } from "./blocks/quote";
import { Template } from "./components";

type QuoteLinePrice = Database["public"]["Tables"]["quoteLinePrice"]["Row"];

interface QuotePDFProps extends PDF {
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
}

const QuotePDF = ({
  company,
  companySettings,
  meta,
  exchangeRate,
  quote,
  quoteLines,
  quoteLinePrices,
  quoteCustomerDetails,
  payment,
  paymentTerms,
  shipment,
  terms,
  thumbnails,
  locale,
  template,
  sections = {},
  title = "Quote"
}: QuotePDFProps) => {
  const currencyCode = quote.currencyCode ?? company.baseCurrencyCode;
  const shouldConvertCurrency =
    !!currencyCode && currencyCode !== company.baseCurrencyCode;
  const numberFormatter = new Intl.NumberFormat(locale, {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const registrationLine = composeRegistrationLine({
    companyName: company.name,
    country: company.countryCode,
    eori: company.eori
  });

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
  const hasAnyLeadTime = quoteLines.some((line) => {
    if (line.status === "No Quote") return false;
    return (priceForFirstQty(line)?.leadTime ?? 0) > 0;
  });

  const columnCount =
    3 + (!hasSinglePricePerLine ? 1 : 0) + (hasAnyLeadTime ? 1 : 0);
  const colWidth =
    columnCount === 3 ? "w-1/3" : columnCount === 4 ? "w-1/4" : "w-1/5";

  let maxLeadTime = 0;
  for (const prices of Object.values(pricesByLine)) {
    for (const price of prices) {
      if (price && price.leadTime > maxLeadTime) maxLeadTime = price.leadTime;
    }
  }

  const subtotal = quoteLines.reduce((total, line) => {
    if (line.status === "No Quote") return total;
    return total + (priceForFirstQty(line)?.convertedNetExtendedPrice ?? 0);
  }, 0);

  const shipping =
    quoteLines.reduce((total, line) => {
      if (line.status === "No Quote") return total;
      return total + (priceForFirstQty(line)?.convertedShippingCost ?? 0);
    }, 0) +
    (shipment?.shippingCost ?? 0) * (exchangeRate ?? 1);

  const fees = quoteLines.reduce((total, line) => {
    if (line.status === "No Quote") return total;
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
    if (line.status === "No Quote") return total;
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

  const { blocks, theme, settings, headerSectionId, footerSectionId } =
    resolveTemplate("quote", template);

  const vars = buildQuoteVars({
    quote,
    quoteCustomerDetails,
    company,
    currencyCode
  });

  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(headerSectionId ? (sections[headerSectionId]?.config ?? {}) : {})
  };

  const data: QuoteData = {
    company,
    companySettings,
    locale,
    quote,
    quoteLines,
    quoteLinePrices,
    quoteCustomerDetails,
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
    colWidth,
    maxLeadTime,
    totals,
    theme,
    sections,
    currencyCode,
    numberFormatter,
    vars,
    headerOptions
  };

  const headerSection = headerSectionId
    ? sections[headerSectionId]?.content
    : undefined;
  const footerSection = footerSectionId
    ? sections[footerSectionId]?.content
    : undefined;
  const headerContent = headerSection
    ? interpolateContent(headerSection, vars)
    : undefined;
  const footerContent = footerSection
    ? interpolateContent(footerSection, vars)
    : undefined;

  const showHeader = headerSectionId !== null;
  const showFooter = footerSectionId !== null;
  const visibleBlocks = blocks.filter(
    (block) => block.visible && !(block.type === "header" && !showHeader)
  );

  return (
    <Template
      theme={theme}
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "quote",
        subject: meta?.subject ?? "Quote"
      }}
      footerDocumentId={quote?.quoteId}
      footerLabel={registrationLine ?? undefined}
      showFooter={showFooter}
      showPageNumbers={settings.showPageNumbers}
      pageNumberFormat={settings.pageNumberFormat}
      showRegistrationLine={settings.showRegistrationLine}
      fontFamily={settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
    >
      {visibleBlocks.map((block) => {
        const render = quoteBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default QuotePDF;
