import type { Database } from "@carbon/database";
import { Text, View, Image } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTaxesAndFees,
  getLineTotal,
  getTotal,
} from "../utils/sales-order";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Summary, Template } from "./components";

interface SalesOrderPDFProps extends PDF {
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: Database["public"]["Views"]["salesOrderLocations"]["Row"];
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
}

// Initialize tailwind-styled-components
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

const SalesOrderPDF = ({
  company,
  locale,
  meta,
  salesOrder,
  salesOrderLines,
  salesOrderLocations,
  terms,
  paymentTerms,
  shippingMethods,
  thumbnails,
  title = "Sales Order",
}: SalesOrderPDFProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName,
    paymentCustomerName,
    paymentAddressLine1,
    paymentAddressLine2,
    paymentCity,
    paymentStateProvince,
    paymentPostalCode,
    paymentCountryName,
  } = salesOrderLocations;

  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "CarbonOS",
        keywords: meta?.keywords ?? "sales order",
        subject: meta?.subject ?? "Sales Order",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={[
            {
              label: "Date",
              value: salesOrder?.orderDate,
            },
            {
              label: "SO #",
              value: salesOrder?.salesOrderId,
            },
          ]}
        />
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Ship To</Text>
            <Text style={tw("text-sm")}>{customerName}</Text>
            {customerAddressLine1 && (
              <Text style={tw("text-sm")}>{customerAddressLine1}</Text>
            )}
            {customerAddressLine2 && (
              <Text style={tw("text-sm")}>{customerAddressLine2}</Text>
            )}
            <Text style={tw("text-sm")}>
              {formatCityStatePostalCode(
                customerCity,
                customerStateProvince,
                customerPostalCode
              )}
            </Text>
            <Text style={tw("text-sm")}>{customerCountryName}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Bill To</Text>
            <Text style={tw("text-sm")}>{paymentCustomerName}</Text>
            {paymentAddressLine1 && (
              <Text style={tw("text-sm")}>{paymentAddressLine1}</Text>
            )}
            {paymentAddressLine2 && (
              <Text style={tw("text-sm")}>{paymentAddressLine2}</Text>
            )}
            <Text style={tw("text-sm")}>
              {formatCityStatePostalCode(
                paymentCity,
                paymentStateProvince,
                paymentPostalCode
              )}
            </Text>
            <Text style={tw("text-sm")}>{paymentCountryName}</Text>
          </View>
        </View>
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Customer Order #</Text>
            <Text style={tw("text-sm")}>{salesOrder?.customerReference}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Requested Date</Text>
            <Text style={tw("text-sm")}>
              {salesOrder?.receiptRequestedDate}
            </Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Promised Date</Text>
            <Text style={tw("text-sm")}>{salesOrder?.receiptPromisedDate}</Text>
          </View>
        </View>
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Method</Text>
            <Text style={tw("text-sm")}>
              {
                shippingMethods.find(
                  (method) => method.id === salesOrder?.shippingMethodId
                )?.name
              }
            </Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Terms</Text>
            <Text style={tw("text-sm")}>{salesOrder?.shippingTermName}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Payment Terms</Text>
            <Text style={tw("text-sm")}>
              {
                paymentTerms.find(
                  (term) => term.id === salesOrder?.paymentTermId
                )?.name
              }
            </Text>
          </View>
        </View>
        <View style={tw("mb-5 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center mt-5 py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase"
            )}
          >
            <Text style={tw("w-5/12 text-left")}>Description</Text>
            <Text style={tw("w-1/6 text-right")}>Qty</Text>
            <Text style={tw("w-1/6 text-right")}>Price</Text>
            <Text style={tw("w-1/6 text-right")}>Tax & Fees</Text>
            <Text style={tw("w-1/6 text-right")}>Total</Text>
          </View>
          {salesOrderLines.map((line) => {
            return (
              <View
                style={tw(
                  "flex flex-row justify-between py-3 px-[6px] border-b border-gray-300"
                )}
                key={line.id}
              >
                <View style={tw("w-5/12")}>
                  <Text style={tw("font-bold mb-1")}>
                    {getLineDescription(line)}
                  </Text>
                  <Text style={tw("text-[9px] opacity-80")}>
                    {getLineDescriptionDetails(line)}
                  </Text>

                  {thumbnails &&
                    line.id in thumbnails &&
                    thumbnails[line.id] && (
                      <View style={tw("mt-2")}>
                        <Image
                          src={thumbnails[line.id]!}
                          style={tw("w-full h-auto")}
                        />
                      </View>
                    )}

                  <View style={tw("mt-1")}>
                    {Object.keys(line.externalNotes ?? {}).length > 0 && (
                      <Note
                        key={`${line.id}-notes`}
                        content={line.externalNotes as JSONContent}
                      />
                    )}
                  </View>
                </View>
                <Text style={tw("w-1/6 text-right")}>
                  {line.salesOrderLineType === "Comment"
                    ? ""
                    : `${line.saleQuantity} ${line.unitOfMeasureCode}`}
                </Text>
                <Text style={tw("w-1/6 text-right")}>
                  {line.salesOrderLineType === "Comment"
                    ? null
                    : formatter.format(line.convertedUnitPrice ?? 0)}
                </Text>
                <Text style={tw("w-1/6 text-right")}>
                  {line.salesOrderLineType === "Comment"
                    ? null
                    : formatter.format(getLineTaxesAndFees(line))}
                </Text>
                <Text style={tw("w-1/6 text-right")}>
                  {line.salesOrderLineType === "Comment"
                    ? null
                    : formatter.format(getLineTotal(line))}
                </Text>
              </View>
            );
          })}
          {salesOrder.shippingCost && (
            <View
              style={tw(
                "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold text-gray-500 uppercase"
              )}
            >
              <Text>Shipping</Text>
              <Text style={tw("text-black")}>
                {formatter.format(
                  (salesOrder.shippingCost ?? 0) *
                    (salesOrder.exchangeRate ?? 1)
                )}
              </Text>
            </View>
          )}
          <View
            style={tw(
              "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold uppercase"
            )}
          >
            <Text>Total</Text>
            <Text style={tw("font-bold text-black")}>
              {formatter.format(getTotal(salesOrderLines, salesOrder))}
            </Text>
          </View>
        </View>
        <View style={tw("flex flex-col gap-4 w-full")}>
          <Note
            title="Notes"
            content={(salesOrder.externalNotes ?? {}) as JSONContent}
          />
          <Note title="Standard Terms & Conditions" content={terms} />
        </View>
      </View>
    </Template>
  );
};

export default SalesOrderPDF;
