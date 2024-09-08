import type { Database } from "@carbon/database";
import { Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";

import type { JSONContent } from "@carbon/react";
import type { PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal,
} from "../utils/purchase-order";
import { formatAddress } from "../utils/shared";
import { Header, Note, Summary, Template } from "./components";

interface PurchaseOrderPDFProps extends PDF {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  terms: JSONContent;
}

// TODO: format currency based on settings
const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

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
    supplierState,
    supplierPostalCode,
    supplierCountryCode,
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryState,
    deliveryPostalCode,
    deliveryCountryCode,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerState,
    customerPostalCode,
    customerCountryCode,
  } = purchaseOrderLocations;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "CarbonOS",
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
          <View style={tw("flex flex-col w-1/3 text-sm gap-1")}>
            <Text style={tw("text-gray-500 text-xs")}>Supplier</Text>
            <Text>{supplierName}</Text>
            {supplierAddressLine1 && <Text>{supplierAddressLine1}</Text>}
            {supplierAddressLine2 && <Text>{supplierAddressLine2}</Text>}
            <Text>
              {formatAddress(supplierCity, supplierState, supplierPostalCode)}
            </Text>
            <Text>{supplierCountryCode}</Text>
          </View>
          {dropShipment ? (
            <View style={tw("flex flex-col text-sm gap-1 w-1/3")}>
              <Text style={tw("text-gray-500 text-xs")}>Ship To</Text>
              <Text>{customerName}</Text>
              {customerAddressLine1 && <Text>{customerAddressLine1}</Text>}
              {customerAddressLine2 && <Text>{customerAddressLine2}</Text>}
              <Text>
                {formatAddress(customerCity, customerState, customerPostalCode)}
              </Text>
              <Text>{customerCountryCode}</Text>
            </View>
          ) : (
            <View style={tw("flex flex-col text-sm gap-1 w-1/3")}>
              <Text style={tw("text-gray-500 text-xs")}>Ship To</Text>
              <Text>{deliveryName}</Text>
              {deliveryAddressLine1 && <Text>{deliveryAddressLine1}</Text>}
              {deliveryAddressLine2 && <Text>{deliveryAddressLine2}</Text>}
              <Text>
                {formatAddress(deliveryCity, deliveryState, deliveryPostalCode)}
              </Text>
              <Text>{deliveryCountryCode}</Text>
            </View>
          )}
        </View>
        <View style={tw("flex flex-row justify-between mb-5 text-sm")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Supplier Order #</Text>
            <Text>{purchaseOrder?.supplierReference}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Requested Date</Text>
            <Text>{purchaseOrder?.receiptRequestedDate}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Promised Date</Text>
            <Text>{purchaseOrder?.receiptPromisedDate}</Text>
          </View>
        </View>
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Method</Text>
            <Text>{purchaseOrder?.shippingMethodName}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Terms</Text>
            <Text>{purchaseOrder?.shippingTermName}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Payment Terms</Text>
            <Text>{purchaseOrder?.paymentTermName}</Text>
          </View>
        </View>
        <View style={tw("mb-5 text-xs")}>
          <View
            style={tw(
              "flex flex-row justify-between items-center py-1.5 px-[6px] border-t border-b border-gray-300 font-bold text-gray-500 uppercase"
            )}
          >
            <Text style={tw("w-1/2")}>Description</Text>
            <Text style={tw("w-1/6 text-right")}>Qty</Text>
            <Text style={tw("w-1/6 text-right")}>Price</Text>
            <Text style={tw("w-1/5 text-right")}>Total</Text>
          </View>
          {purchaseOrderLines.map((line) => (
            <View
              style={tw(
                "flex flex-row justify-between py-1.5 px-[6px] border-b border-gray-300"
              )}
              key={line.id}
            >
              <View style={tw("w-1/2")}>
                <Text style={tw("font-bold mb-1")}>
                  {getLineDescription(line)}
                </Text>
                <Text style={tw("text-[9px] opacity-80")}>
                  {getLineDescriptionDetails(line)}
                </Text>
              </View>
              <Text style={tw("w-1/6 text-right")}>
                {line.purchaseOrderLineType === "Comment"
                  ? ""
                  : `${line.purchaseQuantity} ${line.purchaseUnitOfMeasureCode}`}
              </Text>
              <Text style={tw("w-1/6 text-right")}>
                {line.purchaseOrderLineType === "Comment"
                  ? null
                  : formatter.format(line.unitPrice ?? 0)}
              </Text>
              <Text style={tw("w-1/5 text-right")}>
                {line.purchaseOrderLineType === "Comment"
                  ? null
                  : formatter.format(getLineTotal(line))}
              </Text>
            </View>
          ))}
          <View
            style={tw(
              "flex flex-row justify-between items-center py-1.5 px-[6px] border-b border-gray-300 font-bold text-gray-500 uppercase"
            )}
          >
            <Text>Total</Text>
            <Text style={tw("font-bold text-black")}>
              {formatter.format(getTotal(purchaseOrderLines))}
            </Text>
          </View>
        </View>
        {purchaseOrder?.notes && (
          <View style={tw("flex flex-row mb-5")}>
            <View style={tw("w-1/2")}>
              <Text style={tw("text-gray-500 text-xs")}>Notes</Text>
              <Text style={tw("text-sm")}>{purchaseOrder?.notes}</Text>
            </View>
          </View>
        )}
      </View>
      <View style={tw("flex flex-col gap-4 w-full")}>
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default PurchaseOrderPDF;
