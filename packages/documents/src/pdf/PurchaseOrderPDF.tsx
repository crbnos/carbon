import type { Database } from "@carbon/database";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

import type { JSONContent } from "@carbon/react";
import { formatCityStatePostalCode } from "@carbon/utils";
import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal,
} from "../utils/purchase-order";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Summary, Template } from "./components";

interface PurchaseOrderPDFProps extends PDF {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  terms: JSONContent;
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

const PurchaseOrderPDF = ({
  company,
  locale,
  meta,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  terms,
  title = "Purchase Order",
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
    customerCountryName,
  } = purchaseOrderLocations;

  console.log({ purchaseOrderLines });

  const formatter = getCurrencyFormatter(
    purchaseOrder.currencyCode ?? company.baseCurrencyCode ?? "USD",
    locale
  );
  const taxAmount = purchaseOrderLines.reduce(
    (acc, line) => acc + (line.supplierTaxAmount ?? 0),
    0
  );

  const shippingCost = purchaseOrder?.supplierShippingCost ?? 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "purchase order",
        subject: meta?.subject ?? "Purchase Order",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary
          company={company}
          items={[
            {
              label: "Date",
              value: purchaseOrder?.orderDate,
            },
            {
              label: "PO #",
              value: purchaseOrder?.purchaseOrderId,
            },
          ]}
        />
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col w-1/3 text-sm gap-2")}>
            <Text style={tw("text-gray-500 text-xs")}>Supplier</Text>
            <Text>{supplierName}</Text>
            {supplierAddressLine1 && <Text>{supplierAddressLine1}</Text>}
            {supplierAddressLine2 && <Text>{supplierAddressLine2}</Text>}
            <Text>
              {formatCityStatePostalCode(
                supplierCity,
                supplierStateProvince,
                supplierPostalCode
              )}
            </Text>
            <Text>{supplierCountryName}</Text>
          </View>
          {dropShipment ? (
            <View style={tw("flex flex-col text-sm gap-1 w-1/3")}>
              <Text style={tw("text-gray-500 text-xs")}>Ship To</Text>
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
          ) : (
            <View style={tw("flex flex-col text-sm gap-1 w-1/3")}>
              <Text style={tw("text-gray-500 text-xs")}>Ship To</Text>
              <Text>{deliveryName}</Text>
              {deliveryAddressLine1 && <Text>{deliveryAddressLine1}</Text>}
              {deliveryAddressLine2 && <Text>{deliveryAddressLine2}</Text>}
              <Text>
                {formatCityStatePostalCode(
                  deliveryCity,
                  deliveryStateProvince,
                  deliveryPostalCode
                )}
              </Text>
              <Text>{deliveryCountryName}</Text>
            </View>
          )}
        </View>
        <View style={tw("flex flex-row justify-between mb-5 text-sm")}>
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Reference #</Text>
            <Text>{purchaseOrder?.supplierReference}</Text>
          </View>
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            {/* <Text style={tw("text-gray-500 text-xs")}>Requested Date</Text>
            <Text>{purchaseOrder?.receiptRequestedDate}</Text> */}
          </View>
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Promised Date</Text>
            <Text>{purchaseOrder?.receiptPromisedDate}</Text>
          </View>
        </View>
        {/* <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Method</Text>
            <Text>{purchaseOrder?.shippingMethodName}</Text>
          </View>
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Terms</Text>
            <Text>{purchaseOrder?.shippingTermName}</Text>
          </View>
          <View style={tw("flex flex-col gap-2 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Payment Terms</Text>
            <Text>{purchaseOrder?.paymentTermName}</Text>
          </View>
        </View> */}
        <View style={tw("mb-5 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center mt-5 py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase"
            )}
          >
            <Text style={tw("w-[35%]")}>Description</Text>
            <Text style={tw("w-[15%] text-right")}>Qty</Text>
            <Text style={tw("w-[15%] text-right")}>Unit Price</Text>
            <Text style={tw("w-[15%] text-right")}>Shipping</Text>
            <Text style={tw("w-[20%] text-right")}>Total</Text>
          </View>
          {purchaseOrderLines.map((line) => (
            <View
              style={tw(
                "flex flex-col w-full gap-4 py-3 px-[6px] border-b border-gray-300"
              )}
              key={line.id}
            >
              <View style={tw("flex flex-row justify-between")}>
                <View style={tw("w-[35%]")}>
                  <Text style={tw("font-bold mb-1")}>
                    {getLineDescription(line)}
                  </Text>
                  <Text style={tw("text-[9px] opacity-80")}>
                    {getLineDescriptionDetails(line)}
                  </Text>
                </View>
                <Text style={tw("w-[15%] text-right")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? ""
                    : `${line.purchaseQuantity} ${line.purchaseUnitOfMeasureCode}`}
                </Text>
                <Text style={tw("w-[15%] text-right")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? null
                    : formatter.format(line.supplierUnitPrice ?? 0)}
                </Text>
                <Text style={tw("w-[15%] text-right")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? null
                    : formatter.format(line.supplierShippingCost ?? 0)}
                </Text>
                <Text style={tw("w-[20%] text-right")}>
                  {line.purchaseOrderLineType === "Comment"
                    ? null
                    : formatter.format(getLineTotal(line))}
                </Text>
              </View>
              {Object.keys(line.externalNotes ?? {}).length > 0 && (
                <Note
                  key={`${line.id}-notes`}
                  content={line.externalNotes as JSONContent}
                />
              )}
            </View>
          ))}
          {taxAmount > 0 && (
            <View
              style={tw(
                "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold uppercase"
              )}
            >
              <Text>Tax</Text>
              <Text style={tw("font-normal text-gray-500")}>
                {formatter.format(taxAmount)}
              </Text>
            </View>
          )}
          {shippingCost > 0 && (
            <View
              style={tw(
                "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold uppercase"
              )}
            >
              <Text>Shipping</Text>
              <Text style={tw("font-normal text-gray-500")}>
                {formatter.format(shippingCost)}
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
              {formatter.format(getTotal(purchaseOrderLines) + shippingCost)}
            </Text>
          </View>
        </View>
        {purchaseOrder?.externalNotes && (
          <Note
            title="Notes"
            content={(purchaseOrder.externalNotes ?? {}) as JSONContent}
          />
        )}
      </View>
      <View style={tw("flex flex-col gap-4 w-full")}>
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default PurchaseOrderPDF;
