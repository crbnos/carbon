import type { Database } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import type { PDF } from "../types";
import { getLineDescription, getLineDescriptionDetails } from "../utils/quote";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Summary, Template } from "./components";

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
      sans: ["Helvetica", "Arial", "sans-serif"],
    },
    extend: {
      colors: {
        gray: {
          500: "#7d7d7d",
        },
      },
    },
  },
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
  shippingMethods,
  terms,
  thumbnails,
  title = "Quote",
}: QuotePDFProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName,
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
    (paymentTerm) => paymentTerm.id === payment.paymentTermId
  );
  const shippingMethod = shippingMethods?.find(
    (method) => method.id === shipment.shippingMethodId
  );

  const hasSinglePricePerLine = quoteLines.every((line) => {
    return line.quantity.length === 1;
  });

  const getTotal = () => {
    return quoteLines.reduce((total, line) => {
      if (line.status === "No Quote") return total;

      const prices = pricesByLine[line.id] ?? [];
      const price = prices.find((price) => price.quantity === line.quantity[0]);

      const netExtendedPrice = price?.convertedNetExtendedPrice ?? 0;
      const additionalCharges = line.additionalCharges ?? {};
      const additionalChargesByQuantity = line.quantity.map((quantity) => {
        const charges = Object.values(additionalCharges).reduce(
          (acc, charge) => {
            let amount = charge.amounts?.[quantity] ?? 0;
            if (shouldConvertCurrency) {
              amount *= exchangeRate;
            }
            return acc + amount;
          },
          0
        );
        return charges;
      });
      const additionalChargePlusShipping =
        additionalChargesByQuantity[0] + (price?.convertedShippingCost ?? 0);
      const totalPrice =
        (netExtendedPrice + additionalChargePlusShipping) *
        (1 + line.taxPercent);

      return total + totalPrice;
    }, (shipment?.shippingCost ?? 0) * (exchangeRate ?? 1));
  };

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "quote",
        subject: meta?.subject ?? "Quote",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={[
            {
              label: "Ref #",
              value: quote?.customerReference,
            },
            {
              label: "Date",
              value: today(getLocalTimeZone()).toString(),
            },
            ...(shippingMethod
              ? [
                  {
                    label: "Shipping Method",
                    value: shippingMethod.name,
                  },
                ]
              : []),
            ...(paymentTerm
              ? [
                  {
                    label: "Payment Term",
                    value: paymentTerm.name,
                  },
                ]
              : []),
            ...(quote.expirationDate
              ? [
                  {
                    label: "Expires",
                    value: quote.expirationDate,
                  },
                ]
              : []),
            {
              label: "Quote #",
              value: quote?.quoteId,
            },
          ]}
        />
        <View style={tw("flex flex-row mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3 text-xs")}>
            <Text style={tw(" font-bold text-xs")}>Quote Submitted To</Text>
            <Text>{customerName}</Text>
            {customerAddressLine1 && <Text>{customerAddressLine1}</Text>}
            {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
            <Text>
              {formatCityStatePostalCode(
                customerCity,
                customerStateProvince,
                customerPostalCode
              )}
            </Text>
            <Text>{customerCountryName}</Text>
          </View>
        </View>

        <View style={tw("mb-5 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300  font-bold uppercase"
            )}
          >
            <View style={tw("w-1/3")}>
              <Text>Description</Text>
            </View>
            <View style={tw("w-2/3 flex flex-row")}>
              <Text style={tw("w-1/6 text-right")}>Qty</Text>
              <Text style={tw("w-1/6 text-right")}>Unit Price</Text>
              <Text style={tw("w-1/6 text-right")}>Discount</Text>
              <Text style={tw("w-1/6 text-right")}>Tax & Fees</Text>
              <Text style={tw("w-1/6 text-right")}>Lead Time</Text>
              <Text style={tw("w-1/6 text-right")}>Total Price</Text>
            </View>
          </View>

          {quoteLines.map((line) => {
            const additionalCharges = line.additionalCharges ?? {};
            const additionalChargesByQuantity = line.quantity.map(
              (quantity) => {
                const charges = Object.values(additionalCharges).reduce(
                  (acc, charge) => {
                    let amount = charge.amounts?.[quantity] ?? 0;
                    if (shouldConvertCurrency) {
                      amount *= exchangeRate;
                    }
                    return acc + amount;
                  },
                  0
                );
                return charges;
              }
            );

            const unitPriceFormatter = getCurrencyFormatter(
              currencyCode,
              locale,
              line.unitPricePrecision
            );

            return (
              <View
                style={tw(
                  "flex flex-col gap-2 py-3 px-[6px] border-b border-gray-300 mb-2"
                )}
                key={line.id}
              >
                <View style={tw("flex flex-row justify-between")}>
                  <View style={tw("w-1/3")}>
                    <View>
                      <Text style={tw("font-bold mb-1")}>
                        {getLineDescription(line)}
                      </Text>
                      <Text style={tw("text-[9px] opacity-80")}>
                        {getLineDescriptionDetails(line)}
                      </Text>
                    </View>

                    {thumbnails && line.id in thumbnails && (
                      <View style={tw("mt-2")}>
                        <Image
                          src={thumbnails[line.id]!}
                          style={tw("w-full h-auto")}
                        />
                      </View>
                    )}

                    {line.status !== "No Quote" &&
                      (Object.keys(additionalCharges).length > 0 ||
                        pricesByLine[line.id]?.some(
                          (price) => (price.shippingCost ?? 0) > 0
                        ) ||
                        line.taxPercent) && (
                        <View style={tw("mt-2.5")}>
                          <Text style={tw("text-[9px] font-bold")}>
                            Tax & Fees
                          </Text>
                          {pricesByLine[line.id]?.some(
                            (price) => (price.shippingCost ?? 0) > 0
                          ) && (
                            <Text style={tw("text-[9px] opacity-80")}>
                              - Shipping
                            </Text>
                          )}
                          {Object.values(additionalCharges)
                            .sort((a, b) =>
                              a.description.localeCompare(b.description)
                            )
                            .map((charge) => {
                              return charge.description ? (
                                <Text
                                  key={charge.description}
                                  style={tw("text-[9px] opacity-80")}
                                >
                                  - {charge.description}
                                </Text>
                              ) : null;
                            })}
                          {line.taxPercent && (
                            <Text style={tw("text-[9px] opacity-80")}>
                              - Tax ({line.taxPercent * 100}%)
                            </Text>
                          )}
                        </View>
                      )}
                  </View>
                  <View style={tw("flex flex-col w-2/3 gap-2")}>
                    {line.status !== "No Quote" ? (
                      line.quantity.map((quantity, index) => {
                        const prices = pricesByLine[line.id] ?? [];
                        const price = prices.find(
                          (price) => price.quantity === quantity
                        );
                        const unitPrice = price?.convertedUnitPrice ?? 0;
                        const netUnitPrice = price?.convertedNetUnitPrice ?? 0;
                        const netExtendedPrice =
                          price?.convertedNetExtendedPrice ?? 0;
                        const discountPercent = price?.discountPercent ?? 0;

                        const additionalCharge =
                          additionalChargesByQuantity[index] ?? 0;

                        const additionalChargePlusShipping =
                          additionalCharge +
                          (price?.convertedShippingCost ?? 0);

                        const taxPercent = line.taxPercent ?? 0;
                        const totalBeforeTax =
                          netExtendedPrice + additionalChargePlusShipping;
                        const taxAmount = totalBeforeTax * taxPercent;
                        const totalTaxAndFees =
                          additionalChargePlusShipping + taxAmount;

                        const totalPrice = netExtendedPrice + totalTaxAndFees;

                        return (
                          <View key={quantity} style={tw("flex flex-row")}>
                            <Text style={tw("w-1/6 text-right")}>
                              {quantity}
                            </Text>
                            <Text style={tw("w-1/6 text-right")}>
                              {unitPrice
                                ? unitPriceFormatter.format(unitPrice)
                                : "-"}
                            </Text>
                            <Text style={tw("w-1/6 text-right")}>
                              {discountPercent > 0
                                ? `${(discountPercent * 100).toFixed(1)}%`
                                : "-"}
                            </Text>
                            <Text style={tw("w-1/6 text-right")}>
                              {totalTaxAndFees > 0
                                ? formatter.format(totalTaxAndFees)
                                : "-"}
                            </Text>
                            <Text style={tw("w-1/6 text-right")}>
                              {price ? `${price.leadTime} days` : "-"}
                            </Text>
                            <Text style={tw("w-1/6 text-right")}>
                              {netUnitPrice
                                ? formatter.format(totalPrice)
                                : "-"}
                            </Text>
                          </View>
                        );
                      })
                    ) : (
                      <View>
                        <View style={tw("flex flex-row")}>
                          <Text style={tw("w-1/5 text-right font-bold")}>
                            No Quote
                          </Text>
                          <View style={tw("w-3/5 ml-auto")}>
                            {line.noQuoteReason && (
                              <Text style={tw("text-sm")}>
                                {line.noQuoteReason}
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
                {Object.keys(line.externalNotes ?? {}).length > 0 && (
                  <Note
                    key={`${line.id}-notes`}
                    content={line.externalNotes as JSONContent}
                  />
                )}
              </View>
            );
          })}
          {shipment?.shippingCost && (
            <View
              style={tw(
                "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold  uppercase"
              )}
            >
              <Text>Shipping</Text>
              <Text style={tw("text-black")}>
                {formatter.format(
                  (shipment.shippingCost ?? 0) * (exchangeRate ?? 1)
                )}
              </Text>
            </View>
          )}
          {hasSinglePricePerLine && (
            <View
              style={tw(
                "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold uppercase"
              )}
            >
              <Text>Total</Text>
              <Text style={tw("font-bold text-black")}>
                {formatter.format(getTotal())}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={tw("flex flex-col gap-4 w-full")}>
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
