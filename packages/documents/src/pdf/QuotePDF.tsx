import type { Database } from "@carbon/database";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import type { PDF } from "../types";
import { getLineDescription, getLineDescriptionDetails } from "../utils/quote";
import { Header, Note, Summary, Template } from "./components";

interface QuotePDFProps extends PDF {
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

// TODO: format currency based on settings
const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

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
  meta,
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

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "CarbonOS",
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
            <Text style={tw("text-gray-500 font-bold text-xs")}>
              Quote Submitted To
            </Text>
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
              "flex flex-row justify-between items-center py-1.5 px-[6px] border-t border-b border-gray-300 text-gray-500 font-bold uppercase"
            )}
          >
            <View style={tw("w-2/5")}>
              <Text>Description</Text>
            </View>
            <View style={tw("w-3/5 flex flex-row")}>
              <Text style={tw("w-1/5 text-right")}>Qty</Text>
              <Text style={tw("w-1/5 text-right")}>Unit Price</Text>
              <Text style={tw("w-1/5 text-right")}>Add-Ons</Text>
              <Text style={tw("w-1/5 text-right")}>Lead Time</Text>
              <Text style={tw("w-1/5 text-right")}>Extended Price</Text>
            </View>
          </View>

          {quoteLines.map((line) => {
            const additionalCharges = line.additionalCharges ?? {};
            const additionalChargesByQuantity = line.quantity.map(
              (quantity) => {
                const charges = Object.values(additionalCharges).reduce(
                  (acc, charge) => {
                    const amount = charge.amounts?.[quantity] ?? 0;
                    return acc + amount;
                  },
                  0
                );
                return charges;
              }
            );

            return (
              <View
                style={tw(
                  "flex flex-row justify-between py-1.5 px-[6px] border-b border-gray-300 mb-2"
                )}
                key={line.id}
              >
                <View style={tw("w-2/5")}>
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

                  {Object.keys(additionalCharges).length > 0 && (
                    <View style={tw("mt-2.5")}>
                      <Text style={tw("text-[9px] font-bold")}>
                        Additional Charges
                      </Text>
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
                    </View>
                  )}
                </View>
                <View style={tw("flex flex-col w-3/5 gap-2")}>
                  {line.quantity.map((quantity, index) => {
                    const prices = pricesByLine[line.id] ?? [];
                    const price = prices.find(
                      (price) => price.quantity === quantity
                    );
                    const netPrice =
                      price?.unitPrice *
                      (1 - (price?.discountPercent ?? 0) / 100);

                    const additionalCharge =
                      additionalChargesByQuantity[index] ?? 0;

                    return (
                      <View key={quantity} style={tw("flex flex-row")}>
                        <Text style={tw("w-1/5 text-right")}>{quantity}</Text>
                        <Text style={tw("w-1/5 text-right")}>
                          {netPrice ? formatter.format(netPrice) : "-"}
                        </Text>
                        <Text style={tw("w-1/5 text-right")}>
                          {additionalCharge
                            ? formatter.format(additionalCharge)
                            : "-"}
                        </Text>
                        <Text style={tw("w-1/5 text-right")}>
                          {price ? `${price.leadTime} days` : "-"}
                        </Text>
                        <Text style={tw("w-1/5 text-right")}>
                          {netPrice
                            ? formatter.format(
                                netPrice * quantity + additionalCharge
                              )
                            : "-"}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </View>
      <View style={tw("flex flex-col gap-4 w-full")}>
        <Note
          title="Notes"
          content={(quote.externalNotes ?? {}) as JSONContent}
        />
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default QuotePDF;
