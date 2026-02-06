import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineSubtotal,
  getLineTotal,
  getTotal
} from "../utils/sales-order";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Template } from "./components";

interface SalesOrderPDFProps extends PDF {
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: Database["public"]["Views"]["salesOrderLocations"]["Row"];
  paymentTerms: { id: string; name: string }[];
  shippingMethods: { id: string; name: string }[];
  terms: JSONContent;
  thumbnails?: Record<string, string | null>;
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
  title = "Sales Order"
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
    paymentCountryName
  } = salesOrderLocations;

  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesOrder?.paymentTermId
  );

  const shippingMethod = shippingMethods?.find(
    (method) => method.id === salesOrder?.shippingMethodId
  );

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

  let rowIndex = 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "sales order",
        subject: meta?.subject ?? "Sales Order"
      }}
    >
      <Header
        company={company}
        title="Sales Order"
        documentId={salesOrder?.salesOrderId}
      />

      {/* Ship To & Bill To */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Ship To
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {customerName && (
                <Text style={tw("font-bold")}>{customerName}</Text>
              )}
              {customerAddressLine1 && (
                <Text style={tw("mt-1")}>{customerAddressLine1}</Text>
              )}
              {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
              {(customerCity ||
                customerStateProvince ||
                customerPostalCode) && (
                <Text>
                  {formatCityStatePostalCode(
                    customerCity,
                    customerStateProvince,
                    customerPostalCode
                  )}
                </Text>
              )}
              {customerCountryName && <Text>{customerCountryName}</Text>}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Bill To
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {paymentCustomerName && (
                <Text style={tw("font-bold")}>{paymentCustomerName}</Text>
              )}
              {paymentAddressLine1 && (
                <Text style={tw("mt-1")}>{paymentAddressLine1}</Text>
              )}
              {paymentAddressLine2 && <Text>{paymentAddressLine2}</Text>}
              {(paymentCity || paymentStateProvince || paymentPostalCode) && (
                <Text>
                  {formatCityStatePostalCode(
                    paymentCity,
                    paymentStateProvince,
                    paymentPostalCode
                  )}
                </Text>
              )}
              {paymentCountryName && <Text>{paymentCountryName}</Text>}
            </View>
          </View>
        </View>
      </View>

      {/* Order Details */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Order Details
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {salesOrder?.orderDate && (
                <Text>Date: {formatDate(salesOrder.orderDate)}</Text>
              )}
              {salesOrder?.customerReference && (
                <Text>Customer PO #: {salesOrder.customerReference}</Text>
              )}
              {salesOrder?.receiptRequestedDate && (
                <Text>
                  Requested: {formatDate(salesOrder.receiptRequestedDate)}
                </Text>
              )}
              {salesOrder?.receiptPromisedDate && (
                <Text>
                  Promised: {formatDate(salesOrder.receiptPromisedDate)}
                </Text>
              )}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Shipping & Payment
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {shippingMethod && <Text>Method: {shippingMethod.name}</Text>}
              {salesOrder?.shippingTermName && (
                <Text>Terms: {salesOrder.shippingTermName}</Text>
              )}
              {paymentTerm && <Text>Payment: {paymentTerm.name}</Text>}
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
          <Text style={tw("w-1/2")}>Description</Text>
          <Text style={tw("w-1/6 text-right")}>Qty</Text>
          <Text style={tw("w-1/6 text-right")}>Unit Price</Text>
          <Text style={tw("w-1/6 text-right")}>Total</Text>
        </View>

        {/* Rows */}
        {salesOrderLines.map((line) => {
          const isEven = rowIndex % 2 === 0;
          rowIndex++;

          return (
            <View
              key={line.id}
              style={tw(
                `flex flex-row py-2 px-3 border-b border-gray-200 text-[10px] ${
                  isEven ? "bg-white" : "bg-gray-50"
                }`
              )}
              wrap={false}
            >
              <View style={tw("w-1/2 pr-2")}>
                <Text style={tw("text-gray-800")}>
                  {getLineDescription(line)}
                </Text>
                <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                  {getLineDescriptionDetails(line)}
                </Text>
                {thumbnails && line.id in thumbnails && thumbnails[line.id] && (
                  <View style={tw("mt-1 w-16")}>
                    <Image
                      src={thumbnails[line.id]!}
                      style={tw("w-full h-auto")}
                    />
                  </View>
                )}
                {Object.keys(line.externalNotes ?? {}).length > 0 && (
                  <View style={tw("mt-1")}>
                    <Note
                      key={`${line.id}-notes`}
                      content={line.externalNotes as JSONContent}
                    />
                  </View>
                )}
              </View>
              <Text style={tw("w-1/6 text-right text-gray-600")}>
                {line.salesOrderLineType === "Comment"
                  ? ""
                  : `${line.saleQuantity} ${line.unitOfMeasureCode ?? "EA"}`}
              </Text>
              <Text style={tw("w-1/6 text-right text-gray-600")}>
                {line.salesOrderLineType === "Comment"
                  ? ""
                  : formatter.format(line.convertedUnitPrice ?? 0)}
              </Text>
              <Text style={tw("w-1/6 text-right text-gray-800 font-medium")}>
                {line.salesOrderLineType === "Comment"
                  ? ""
                  : formatter.format(getLineTotal(line))}
              </Text>
            </View>
          );
        })}

        {/* Summary */}
        <View>
          {/* Subtotal - before tax */}
          <View style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}>
            <View style={tw("w-4/6")} />
            <Text style={tw("w-1/6 text-right text-gray-600")}>Subtotal</Text>
            <Text style={tw("w-1/6 text-right text-gray-800")}>
              {formatter.format(
                salesOrderLines.reduce(
                  (sum, line) => sum + getLineSubtotal(line),
                  0
                )
              )}
            </Text>
          </View>

          {/* Shipping */}
          {salesOrder.shippingCost && salesOrder.shippingCost > 0 && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Shipping</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(
                  (salesOrder.shippingCost ?? 0) *
                    (salesOrder.exchangeRate ?? 1)
                )}
              </Text>
            </View>
          )}

          {/* Taxes */}
          {salesOrderLines.some((line) => (line.taxPercent ?? 0) > 0) && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Taxes</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(
                  salesOrderLines.reduce((sum, line) => {
                    const taxPercent = line.taxPercent ?? 0;
                    return sum + getLineSubtotal(line) * taxPercent;
                  }, 0)
                )}
              </Text>
            </View>
          )}

          <View style={tw("h-[1px] bg-gray-200")} />
          <View style={tw("flex flex-row py-2 px-3 text-[11px]")}>
            <View style={tw("w-4/6")} />
            <Text style={tw("w-1/6 text-right text-gray-800 font-bold")}>
              Total
            </Text>
            <Text style={tw("w-1/6 text-right text-gray-800 font-bold")}>
              {formatter.format(getTotal(salesOrderLines, salesOrder))}
            </Text>
          </View>
        </View>
      </View>

      {/* Notes & Terms */}
      <View style={tw("flex flex-col gap-3 w-full")}>
        {Object.keys(salesOrder.externalNotes ?? {}).length > 0 && (
          <Note
            title="Notes"
            content={(salesOrder.externalNotes ?? {}) as JSONContent}
          />
        )}
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default SalesOrderPDF;
