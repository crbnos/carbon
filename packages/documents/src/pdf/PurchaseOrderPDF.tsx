import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal
} from "../utils/purchase-order";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Template } from "./components";

interface PurchaseOrderPDFProps extends PDF {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
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

const PurchaseOrderPDF = ({
  company,
  locale,
  meta,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  terms,
  thumbnails,
  title = "Purchase Order"
}: PurchaseOrderPDFProps) => {
  const {
    supplierName,
    supplierAddressLine1,
    supplierAddressLine2,
    supplierCity,
    supplierStateProvince,
    supplierPostalCode,
    supplierCountryName,
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryStateProvince,
    deliveryPostalCode,
    deliveryCountryName,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName
  } = purchaseOrderLocations;

  const formatter = getCurrencyFormatter(
    purchaseOrder.currencyCode ?? company.baseCurrencyCode ?? "USD",
    locale
  );
  const taxAmount = purchaseOrderLines.reduce(
    (acc, line) => acc + (line.supplierTaxAmount ?? 0),
    0
  );

  const shippingCost = purchaseOrder?.supplierShippingCost ?? 0;

  let rowIndex = 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "purchase order",
        subject: meta?.subject ?? "Purchase Order"
      }}
    >
      <Header
        company={company}
        title="Purchase Order"
        documentId={purchaseOrder?.purchaseOrderId}
      />

      {/* Supplier & Ship To Details */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Supplier
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {supplierName && (
                <Text style={tw("font-bold")}>{supplierName}</Text>
              )}
              {supplierAddressLine1 && <Text>{supplierAddressLine1}</Text>}
              {supplierAddressLine2 && <Text>{supplierAddressLine2}</Text>}
              {(supplierCity ||
                supplierStateProvince ||
                supplierPostalCode) && (
                <Text>
                  {formatCityStatePostalCode(
                    supplierCity,
                    supplierStateProvince,
                    supplierPostalCode
                  )}
                </Text>
              )}
              {supplierCountryName && <Text>{supplierCountryName}</Text>}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Ship To
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {dropShipment ? (
                <>
                  {customerName && (
                    <Text style={tw("font-bold")}>{customerName}</Text>
                  )}
                  {customerAddressLine1 && <Text>{customerAddressLine1}</Text>}
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
                </>
              ) : (
                <>
                  {deliveryName && (
                    <Text style={tw("font-bold")}>{deliveryName}</Text>
                  )}
                  {deliveryAddressLine1 && <Text>{deliveryAddressLine1}</Text>}
                  {deliveryAddressLine2 && <Text>{deliveryAddressLine2}</Text>}
                  {(deliveryCity ||
                    deliveryStateProvince ||
                    deliveryPostalCode) && (
                    <Text>
                      {formatCityStatePostalCode(
                        deliveryCity,
                        deliveryStateProvince,
                        deliveryPostalCode
                      )}
                    </Text>
                  )}
                  {deliveryCountryName && <Text>{deliveryCountryName}</Text>}
                </>
              )}
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
              <Text>Date: {formatDate(purchaseOrder?.orderDate)}</Text>
              {purchaseOrder?.supplierReference && (
                <Text>Reference: {purchaseOrder.supplierReference}</Text>
              )}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Delivery
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {purchaseOrder?.receiptPromisedDate && (
                <Text>
                  Promised Date: {formatDate(purchaseOrder.receiptPromisedDate)}
                </Text>
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
          <Text style={tw("w-1/2")}>Description</Text>
          <Text style={tw("w-1/6 text-right")}>Qty</Text>
          <Text style={tw("w-1/6 text-right")}>Unit Price</Text>
          <Text style={tw("w-1/6 text-right")}>Total</Text>
        </View>

        {/* Rows */}
        {purchaseOrderLines.map((line) => {
          const isEven = rowIndex % 2 === 0;
          rowIndex++;

          return (
            <View key={line.id} wrap={false}>
              <View
                style={tw(
                  `flex flex-col py-2 px-3 border-b border-gray-200 text-[10px] ${
                    isEven ? "bg-white" : "bg-gray-50"
                  }`
                )}
              >
                <View style={tw("flex flex-row")}>
                  <View style={tw("w-1/2 pr-2")}>
                    <Text style={tw("text-gray-800")}>
                      {getLineDescription(line)}
                    </Text>
                    <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                      {getLineDescriptionDetails(line)}
                    </Text>
                    {purchaseOrder.purchaseOrderType === "Outside Processing" &&
                      line.jobOperationDescription && (
                        <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                          {line.jobOperationDescription}
                        </Text>
                      )}
                    {thumbnails &&
                      line.id in thumbnails &&
                      thumbnails[line.id] && (
                        <View style={tw("mt-1 w-16")}>
                          <Image
                            src={thumbnails[line.id]!}
                            style={tw("w-full h-auto")}
                          />
                        </View>
                      )}
                  </View>
                  <Text style={tw("w-1/6 text-right text-gray-600")}>
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : `${line.purchaseQuantity} ${line.purchaseUnitOfMeasureCode}`}
                  </Text>
                  <Text style={tw("w-1/6 text-right text-gray-600")}>
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : formatter.format(line.supplierUnitPrice ?? 0)}
                  </Text>
                  <Text
                    style={tw("w-1/6 text-right text-gray-800 font-medium")}
                  >
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : formatter.format(getLineTotal(line))}
                  </Text>
                </View>
              </View>
              {Object.keys(line.externalNotes ?? {}).length > 0 && (
                <View style={tw("px-3 py-2 border-b border-gray-200")}>
                  <Note
                    key={`${line.id}-notes`}
                    content={line.externalNotes as JSONContent}
                  />
                </View>
              )}
            </View>
          );
        })}

        {/* Summary */}
        <View>
          {/* Subtotal - before tax and shipping */}
          <View style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}>
            <View style={tw("w-4/6")} />
            <Text style={tw("w-1/6 text-right text-gray-600")}>Subtotal</Text>
            <Text style={tw("w-1/6 text-right text-gray-800")}>
              {formatter.format(
                purchaseOrderLines.reduce((sum, line) => {
                  if (line?.purchaseQuantity && line?.supplierUnitPrice) {
                    return sum + line.purchaseQuantity * line.supplierUnitPrice;
                  }
                  return sum;
                }, 0)
              )}
            </Text>
          </View>

          {/* Shipping */}
          {shippingCost > 0 && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Shipping</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(shippingCost)}
              </Text>
            </View>
          )}

          {/* Tax */}
          {taxAmount > 0 && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Tax</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(taxAmount)}
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
              {formatter.format(getTotal(purchaseOrderLines) + shippingCost)}
            </Text>
          </View>
        </View>
      </View>

      {/* Notes & Terms */}
      <View style={tw("flex flex-col gap-3 w-full")}>
        {Object.keys(purchaseOrder?.externalNotes ?? {}).length > 0 && (
          <Note
            title="Notes"
            content={(purchaseOrder.externalNotes ?? {}) as JSONContent}
          />
        )}
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default PurchaseOrderPDF;
