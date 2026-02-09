import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { PDF } from "../types";
import { getLineDescription, getLineDescriptionDetails } from "../utils/quote";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Template } from "./components";

interface QuotePDFProps extends PDF {
  exchangeRate: number;
  quote: Database["public"]["Views"]["quotes"]["Row"];
  quoteLines: Database["public"]["Views"]["quoteLines"]["Row"][];
  quoteCustomerDetails: Database["public"]["Views"]["quoteCustomerDetails"]["Row"];
  quoteLinePrices: Database["public"]["Tables"]["quoteLinePrice"]["Row"][];
  payment?: Database["public"]["Tables"]["quotePayment"]["Row"] | null;
  shipment?: Database["public"]["Tables"]["quoteShipment"]["Row"] | null;
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails: Record<string, string | null>;
}

const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Inter", "Helvetica", "Arial", "sans-serif"]
    },
    extend: {
      colors: {
        gray: {
          50: "#f9fafb",
          200: "#e5e7eb",
          400: "#9ca3af",
          600: "#4b5563",
          800: "#1f2937"
        }
      }
    }
  }
});

const QuotePDF = ({
  company,
  locale,
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
  title = "Quote"
}: QuotePDFProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName,
    contactName,
    contactEmail
  } = quoteCustomerDetails;

  const currencyCode = quote.currencyCode ?? company.baseCurrencyCode;
  const shouldConvertCurrency =
    !!currencyCode && currencyCode !== company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);

  const pricesByLine = quoteLinePrices.reduce<
    Record<string, Database["public"]["Tables"]["quoteLinePrice"]["Row"][]>
  >((acc, price) => {
    if (!acc[price.quoteLineId]) {
      acc[price.quoteLineId] = [];
    }
    acc[price.quoteLineId].push(price);
    return acc;
  }, {});

  const paymentTerm = paymentTerms?.find(
    (pt) => pt.id === payment?.paymentTermId
  );

  const hasSinglePricePerLine = quoteLines.every(
    (line) => line.quantity.length === 1
  );

  // Check if any line has a lead time > 0
  const hasAnyLeadTime = quoteLines.some((line) => {
    if (line.status === "No Quote") return false;
    const prices = pricesByLine[line.id] ?? [];
    const price = prices.find((p) => p.quantity === line.quantity[0]);
    return price && price.leadTime > 0;
  });

  // Calculate column count for dynamic widths
  // Base columns: Qty, Unit Price, Total = 3
  // Optional: Tax & Fees (when multi-qty), Lead Time (when any has lead time)
  const columnCount =
    3 + (!hasSinglePricePerLine ? 1 : 0) + (hasAnyLeadTime ? 1 : 0);
  const colWidth =
    columnCount === 3 ? "w-1/3" : columnCount === 4 ? "w-1/4" : "w-1/5";

  const getMaxLeadTime = () => {
    let maxLeadTime = 0;
    for (const line of quoteLines) {
      if (line.status === "No Quote") continue;
      const prices = pricesByLine[line.id] ?? [];
      const price = prices.find((p) => p.quantity === line.quantity[0]);
      if (price && price.leadTime > maxLeadTime) {
        maxLeadTime = price.leadTime;
      }
    }
    return maxLeadTime;
  };

  const getTotalSubtotal = () => {
    return quoteLines.reduce((total, line) => {
      if (line.status === "No Quote") return total;
      const prices = pricesByLine[line.id] ?? [];
      const price = prices.find((p) => p.quantity === line.quantity[0]);
      return total + (price?.convertedNetExtendedPrice ?? 0);
    }, 0);
  };

  const getTotalShipping = () => {
    const lineShipping = quoteLines.reduce((total, line) => {
      if (line.status === "No Quote") return total;
      const prices = pricesByLine[line.id] ?? [];
      const price = prices.find((p) => p.quantity === line.quantity[0]);
      return total + (price?.convertedShippingCost ?? 0);
    }, 0);
    const quoteShipping = (shipment?.shippingCost ?? 0) * (exchangeRate ?? 1);
    return lineShipping + quoteShipping;
  };

  const getTotalFees = () => {
    return quoteLines.reduce((total, line) => {
      if (line.status === "No Quote") return total;
      const additionalCharges = line.additionalCharges ?? {};
      const quantity = line.quantity[0];
      const charges = Object.values(additionalCharges).reduce((acc, charge) => {
        let amount = charge.amounts?.[quantity] ?? 0;
        if (shouldConvertCurrency) {
          amount *= exchangeRate;
        }
        return acc + amount;
      }, 0);
      return total + charges;
    }, 0);
  };

  const getTotalTaxes = () => {
    return quoteLines.reduce((total, line) => {
      if (line.status === "No Quote") return total;
      const prices = pricesByLine[line.id] ?? [];
      const price = prices.find((p) => p.quantity === line.quantity[0]);
      const netExtendedPrice = price?.convertedNetExtendedPrice ?? 0;
      const additionalCharges = line.additionalCharges ?? {};
      const quantity = line.quantity[0];
      const fees = Object.values(additionalCharges).reduce((acc, charge) => {
        let amount = charge.amounts?.[quantity] ?? 0;
        if (shouldConvertCurrency) {
          amount *= exchangeRate;
        }
        return acc + amount;
      }, 0);
      const lineShipping = price?.convertedShippingCost ?? 0;
      const taxableAmount = netExtendedPrice + fees + lineShipping;
      return total + taxableAmount * (line.taxPercent ?? 0);
    }, 0);
  };

  const getTotal = () =>
    getTotalSubtotal() + getTotalShipping() + getTotalFees() + getTotalTaxes();

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch {
      return dateStr;
    }
  };

  const maxLeadTime = getMaxLeadTime();
  let rowIndex = 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "quote",
        subject: meta?.subject ?? "Quote"
      }}
    >
      <Header company={company} title="Quote" documentId={quote?.quoteId} />

      {/* Customer & Quote Details */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Customer
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {customerName && (
                <Text style={tw("font-bold")}>{customerName}</Text>
              )}
              {contactName && <Text>{contactName}</Text>}
              {contactEmail && <Text>{contactEmail}</Text>}
              {customerAddressLine1 && (
                <Text style={tw("mt-1")}>{customerAddressLine1}</Text>
              )}
              {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
              {(customerCity || customerStateProvince) && (
                <Text>
                  {formatCityStatePostalCode(
                    customerCity,
                    customerStateProvince,
                    null
                  )}
                </Text>
              )}
              {customerPostalCode && <Text>{customerPostalCode}</Text>}
              {customerCountryName && <Text>{customerCountryName}</Text>}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Quote Details
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              <Text>
                Date: {formatDate(today(getLocalTimeZone()).toString())}
              </Text>
              {quote.expirationDate && (
                <Text>Expires: {formatDate(quote.expirationDate)}</Text>
              )}
              {quote.customerReference && (
                <Text>Reference: {quote.customerReference}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Line Items Table */}
      <View style={tw("mb-4")}>
        {/* Header */}
        <View
          style={tw(
            "flex flex-row bg-gray-800 py-2 px-3 text-white text-[9px] font-bold"
          )}
        >
          <View style={tw("w-1/3")}>
            <Text>Description</Text>
          </View>
          <View style={tw("w-2/3 flex flex-row")}>
            <Text style={tw(`${colWidth} text-right pr-3`)}>Qty</Text>
            <Text style={tw(`${colWidth} text-right pr-3`)}>Unit Price</Text>
            {!hasSinglePricePerLine && (
              <Text style={tw(`${colWidth} text-right pr-3`)}>Tax & Fees</Text>
            )}
            {hasAnyLeadTime && (
              <Text style={tw(`${colWidth} text-right pr-3`)}>Lead Time</Text>
            )}
            <Text style={tw(`${colWidth} text-right`)}>Total</Text>
          </View>
        </View>

        {/* Rows */}
        {quoteLines.map((line) => {
          const unitPriceFormatter = getCurrencyFormatter(
            currencyCode,
            locale,
            line.unitPricePrecision
          );

          const additionalCharges = line.additionalCharges ?? {};

          return (
            <View key={line.id} wrap={false}>
              {line.status !== "No Quote" ? (
                line.quantity.map((quantity, index) => {
                  const prices = pricesByLine[line.id] ?? [];
                  const price = prices.find((p) => p.quantity === quantity);
                  const unitPrice = price?.convertedUnitPrice ?? 0;
                  const netExtendedPrice =
                    price?.convertedNetExtendedPrice ?? 0;
                  const isEven = rowIndex % 2 === 0;
                  rowIndex++;

                  const leadTime = price?.leadTime ?? 0;

                  // Calculate tax & fees for this quantity
                  const additionalCharge = Object.values(
                    additionalCharges
                  ).reduce((acc, charge) => {
                    let amount = charge.amounts?.[quantity] ?? 0;
                    if (shouldConvertCurrency) {
                      amount *= exchangeRate;
                    }
                    return acc + amount;
                  }, 0);
                  const shippingCost = price?.convertedShippingCost ?? 0;
                  const taxPercent = line.taxPercent ?? 0;
                  const totalBeforeTax =
                    netExtendedPrice + additionalCharge + shippingCost;
                  const taxAmount = totalBeforeTax * taxPercent;
                  const totalTaxAndFees =
                    additionalCharge + shippingCost + taxAmount;
                  const totalPrice = netExtendedPrice + totalTaxAndFees;

                  return (
                    <View
                      key={`${line.id}-${quantity}`}
                      style={tw(
                        `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${
                          isEven ? "bg-white" : "bg-gray-50"
                        }`
                      )}
                    >
                      <View style={tw("w-1/3 pr-2")}>
                        <Text style={tw("text-gray-800")}>
                          {getLineDescription(line)}
                        </Text>
                        <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                          {getLineDescriptionDetails(line)}
                        </Text>
                        {thumbnails && line.id in thumbnails && (
                          <View style={tw("mt-2")}>
                            <Image
                              src={thumbnails[line.id]!}
                              style={{ width: 60, height: 60 }}
                            />
                          </View>
                        )}
                      </View>
                      <View style={tw("w-2/3 flex flex-row")}>
                        <Text
                          style={tw(
                            `${colWidth} text-right text-gray-600 pr-3`
                          )}
                        >
                          {quantity} EA
                        </Text>
                        <Text
                          style={tw(
                            `${colWidth} text-right text-gray-600 pr-3`
                          )}
                        >
                          {unitPrice
                            ? unitPriceFormatter.format(unitPrice)
                            : "-"}
                        </Text>
                        {!hasSinglePricePerLine && (
                          <Text
                            style={tw(
                              `${colWidth} text-right text-gray-600 pr-3`
                            )}
                          >
                            {totalTaxAndFees > 0
                              ? formatter.format(totalTaxAndFees)
                              : "-"}
                          </Text>
                        )}
                        {hasAnyLeadTime && (
                          <Text
                            style={tw(
                              `${colWidth} text-right text-gray-600 pr-3`
                            )}
                          >
                            {leadTime > 0 ? `${leadTime} days` : "-"}
                          </Text>
                        )}
                        <Text
                          style={tw(
                            `${colWidth} text-right text-gray-800 font-medium`
                          )}
                        >
                          {hasSinglePricePerLine
                            ? netExtendedPrice > 0
                              ? formatter.format(netExtendedPrice)
                              : "-"
                            : totalPrice > 0
                              ? formatter.format(totalPrice)
                              : "-"}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View
                  style={tw(
                    `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${
                      rowIndex++ % 2 === 0 ? "bg-white" : "bg-gray-50"
                    }`
                  )}
                >
                  <View style={tw("w-1/3 pr-2")}>
                    <Text style={tw("text-gray-800")}>
                      {getLineDescription(line)}
                    </Text>
                    <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                      {getLineDescriptionDetails(line)}
                    </Text>
                  </View>
                  <View style={tw("w-2/3 flex flex-row")}>
                    <Text
                      style={tw(
                        `${colWidth} text-right text-gray-600 font-bold`
                      )}
                    >
                      No Quote
                    </Text>
                    <View style={tw("flex-1 text-right")}>
                      <Text style={tw("text-gray-400 text-[8px] text-right")}>
                        {line.noQuoteReason ?? ""}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          );
        })}

        {/* Summary - only show when single price per line */}
        {hasSinglePricePerLine && (
          <View>
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Subtotal</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(getTotalSubtotal())}
              </Text>
            </View>
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Shipping</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(getTotalShipping())}
              </Text>
            </View>
            {getTotalFees() > 0 && (
              <View
                style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
              >
                <View style={tw("w-4/6")} />
                <Text style={tw("w-1/6 text-right text-gray-600")}>Fees</Text>
                <Text style={tw("w-1/6 text-right text-gray-800")}>
                  {formatter.format(getTotalFees())}
                </Text>
              </View>
            )}
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Taxes</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(getTotalTaxes())}
              </Text>
            </View>
            <View style={tw("h-[1px] bg-gray-200")} />
            <View style={tw("flex flex-row py-2 px-3 text-[11px]")}>
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-800 font-bold")}>
                Total
              </Text>
              <Text style={tw("w-1/6 text-right text-gray-800 font-bold")}>
                {formatter.format(getTotal())}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Footer - Lead Time & Payment Terms */}
      {(maxLeadTime > 0 || paymentTerm) && (
        <View style={tw("flex flex-row gap-8 mb-4 text-[10px]")}>
          {maxLeadTime > 0 && (
            <View style={tw("flex flex-row")}>
              <Text style={tw("font-bold text-gray-800")}>
                Overall Lead Time:{" "}
              </Text>
              <Text style={tw("text-gray-600")}>
                {maxLeadTime} {maxLeadTime === 1 ? "day" : "days"}
              </Text>
            </View>
          )}
          {paymentTerm && (
            <View style={tw("flex flex-row")}>
              <Text style={tw("font-bold text-gray-800")}>Payment Terms: </Text>
              <Text style={tw("text-gray-600")}>{paymentTerm.name}</Text>
            </View>
          )}
        </View>
      )}

      {/* Notes & Terms */}
      <View style={tw("flex flex-col gap-3 w-full")}>
        {Object.keys(quote.externalNotes ?? {}).length > 0 && (
          <Note
            title="Notes"
            content={(quote.externalNotes ?? {}) as JSONContent}
          />
        )}
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default QuotePDF;
