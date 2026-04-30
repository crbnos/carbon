import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { AccountsPayableBillingAddress, PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTotal,
  getTotal
} from "../utils/purchase-order";
import { getCurrencyFormatter } from "../utils/shared";
import {
  Header,
  Note,
  PartyDetails,
  ShipBillDetails,
  Template
} from "./components";

interface PurchaseOrderPDFProps extends PDF {
  purchaseOrder: Database["public"]["Views"]["purchaseOrders"]["Row"];
  purchaseOrderLines: Database["public"]["Views"]["purchaseOrderLines"]["Row"][];
  purchaseOrderLocations: Database["public"]["Views"]["purchaseOrderLocations"]["Row"];
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  accountsPayableBillingAddress?: AccountsPayableBillingAddress | null;
  paymentTerms?: { id: string; name: string }[];
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

const PurchaseOrderPDF = ({
  accountsPayableBillingAddress,
  company,
  companySettings,
  meta,
  paymentTerms,
  purchaseOrder,
  purchaseOrderLines,
  purchaseOrderLocations,
  terms,
  thumbnails,
  locale,
  title = "Purchase Order"
}: PurchaseOrderPDFProps) => {
  const {
    supplierName,
    supplierAddressLine1,
    supplierAddressLine2,
    supplierCity,
    supplierStateProvince,
    supplierPostalCode,
    supplierCountryCode,
    deliveryName,
    deliveryAddressLine1,
    deliveryAddressLine2,
    deliveryCity,
    deliveryStateProvince,
    deliveryPostalCode,
    deliveryCountryCode,
    dropShipment,
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryCode
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
  const paymentTerm = paymentTerms?.find(
    (term) => term.id === purchaseOrder?.paymentTermId
  );

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
        date={purchaseOrder?.orderDate}
        currencyCode={purchaseOrder?.currencyCode}
        locale={locale}
      />

      <PartyDetails
        company={company}
        companyLabel="Buyer"
        counterParty={{
          name: supplierName,
          addressLine1: supplierAddressLine1,
          addressLine2: supplierAddressLine2,
          city: supplierCity,
          stateProvince: supplierStateProvince,
          postalCode: supplierPostalCode,
          countryCode: supplierCountryCode,
          taxId: purchaseOrderLocations.supplierTaxId,
          vatNumber: purchaseOrderLocations.supplierVatNumber,
          eori: purchaseOrderLocations.supplierEori,
          contactName: purchaseOrderLocations.supplierContactName,
          contactEmail: purchaseOrderLocations.supplierContactEmail
        }}
        counterPartyLabel="Supplier"
        createdByFullName={purchaseOrder.createdByFullName}
        createdByEmail={purchaseOrder.createdByEmail}
        accountsPayableEmail={companySettings?.accountsPayableEmail}
      />

      <ShipBillDetails
        shipTo={
          dropShipment
            ? {
                name: customerName,
                addressLine1: customerAddressLine1,
                addressLine2: customerAddressLine2,
                city: customerCity,
                stateProvince: customerStateProvince,
                postalCode: customerPostalCode,
                countryCode: customerCountryCode
              }
            : {
                name: deliveryName,
                addressLine1: deliveryAddressLine1,
                addressLine2: deliveryAddressLine2,
                city: deliveryCity,
                stateProvince: deliveryStateProvince,
                postalCode: deliveryPostalCode,
                countryCode: deliveryCountryCode
              }
        }
        billTo={
          accountsPayableBillingAddress
            ? {
                name: accountsPayableBillingAddress.name,
                addressLine1: accountsPayableBillingAddress.addressLine1,
                addressLine2: accountsPayableBillingAddress.addressLine2,
                city: accountsPayableBillingAddress.city,
                stateProvince: accountsPayableBillingAddress.state,
                postalCode: accountsPayableBillingAddress.postalCode,
                countryCode: accountsPayableBillingAddress.countryCode
              }
            : {
                name: company.name,
                addressLine1: company.addressLine1,
                addressLine2: company.addressLine2,
                city: company.city,
                stateProvince: company.stateProvince,
                postalCode: company.postalCode,
                countryCode: company.countryCode
              }
        }
      />

      {/* Order Details & Notes */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Order Details
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              <Text>
                Date: {formatDate(purchaseOrder?.orderDate, undefined, locale)}
              </Text>
              {purchaseOrder?.supplierReference && (
                <Text>Reference: {purchaseOrder.supplierReference}</Text>
              )}
              {purchaseOrder?.receiptRequestedDate && (
                <Text>
                  Requested Date:{" "}
                  {formatDate(
                    purchaseOrder.receiptRequestedDate,
                    undefined,
                    locale
                  )}
                </Text>
              )}
              {purchaseOrder?.receiptPromisedDate && (
                <Text>
                  Promised Date:{" "}
                  {formatDate(
                    purchaseOrder.receiptPromisedDate,
                    undefined,
                    locale
                  )}
                </Text>
              )}
              {paymentTerm && <Text>Payment Terms: {paymentTerm.name}</Text>}
              {purchaseOrder?.incoterm && (
                <Text>
                  Incoterm: {purchaseOrder.incoterm}
                  {purchaseOrder.incotermLocation
                    ? ` - ${purchaseOrder.incotermLocation}`
                    : ""}
                </Text>
              )}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Notes
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {Object.keys(purchaseOrder?.externalNotes ?? {}).length > 0 ? (
                <Note
                  content={(purchaseOrder.externalNotes ?? {}) as JSONContent}
                />
              ) : (
                <Text style={tw("text-gray-400")}>None</Text>
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
          <Text style={tw("w-[5%] text-center")}>#</Text>
          <Text style={tw("w-[33%]")}>Description</Text>
          <Text style={tw("w-[12%] text-right")}>Qty</Text>
          <Text style={tw("w-[10%] text-center")}>UOM</Text>
          <Text style={tw("w-[15%] text-right")}>Unit Price</Text>
          <Text style={tw("w-[12%] text-right")}>Tax</Text>
          <Text style={tw("w-[13%] text-right")}>Total</Text>
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
                  <Text style={tw("w-[5%] text-center text-gray-400")}>
                    {line.purchaseOrderLineType === "Comment" ? "" : rowIndex}
                  </Text>
                  <View style={tw("w-[33%] pr-2")}>
                    <Text style={tw("text-gray-800")}>
                      {getLineDescription(line)}
                    </Text>
                    <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                      {getLineDescriptionDetails(line)}
                    </Text>
                    {line.requestedDate &&
                      line.purchaseOrderLineType !== "Comment" && (
                        <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                          Required:{" "}
                          {formatDate(line.requestedDate, undefined, locale)}
                        </Text>
                      )}
                    {purchaseOrder.purchaseOrderType === "Outside Processing" &&
                      line.jobOperationDescription && (
                        <Text style={tw("text-[8px] text-gray-400 mt-0.5")}>
                          {line.jobOperationDescription}
                        </Text>
                      )}
                    {thumbnails &&
                      line.id &&
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
                  <Text style={tw("w-[12%] text-right text-gray-600")}>
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : line.purchaseQuantity}
                  </Text>
                  <Text style={tw("w-[10%] text-center text-gray-600")}>
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : line.purchaseUnitOfMeasureCode}
                  </Text>
                  <Text style={tw("w-[15%] text-right text-gray-600")}>
                    {line.purchaseOrderLineType === "Comment"
                      ? ""
                      : formatter.format(line.supplierUnitPrice ?? 0)}
                  </Text>
                  <View style={tw("w-[12%]")}>
                    {line.purchaseOrderLineType !== "Comment" && (
                      <View style={tw("flex flex-col items-end")}>
                        <Text style={tw("text-gray-600")}>
                          {formatter.format(line.supplierTaxAmount ?? 0)}
                        </Text>
                        {(line.taxPercent ?? 0) > 0 && (
                          <Text style={tw("text-[7px] text-gray-400")}>
                            {((line.taxPercent ?? 0) * 100).toFixed(0)}%
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                  <Text
                    style={tw("w-[13%] text-right text-gray-800 font-medium")}
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
            <View style={tw("w-[75%]")} />
            <Text style={tw("w-[12%] text-right text-gray-600")}>Subtotal</Text>
            <Text style={tw("w-[13%] text-right text-gray-800")}>
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
              <View style={tw("w-[75%]")} />
              <Text style={tw("w-[12%] text-right text-gray-600")}>
                Shipping
              </Text>
              <Text style={tw("w-[13%] text-right text-gray-800")}>
                {formatter.format(shippingCost)}
              </Text>
            </View>
          )}

          {/* Tax */}
          {taxAmount > 0 && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-[75%]")} />
              <Text style={tw("w-[12%] text-right text-gray-600")}>Tax</Text>
              <View style={tw("w-[13%] flex flex-col items-end")}>
                <Text style={tw("text-gray-800")}>
                  {formatter.format(taxAmount)}
                </Text>
                {(() => {
                  const taxPercent = purchaseOrderLines.find(
                    (line) => (line.taxPercent ?? 0) > 0
                  )?.taxPercent;
                  return taxPercent ? (
                    <Text style={tw("text-[7px] text-gray-400")}>
                      {(taxPercent * 100).toFixed(0)}%
                    </Text>
                  ) : null;
                })()}
              </View>
            </View>
          )}

          <View style={tw("h-[1px] bg-gray-200")} />
          <View style={tw("flex flex-row py-2 px-3 text-[11px]")}>
            <View style={tw("w-[75%]")} />
            <Text style={tw("w-[12%] text-right text-gray-800 font-bold")}>
              Total
            </Text>
            <Text style={tw("w-[13%] text-right text-gray-800 font-bold")}>
              {formatter.format(getTotal(purchaseOrderLines) + shippingCost)}
            </Text>
          </View>
        </View>
      </View>

      {/* Terms */}
      <Note title="Standard Terms & Conditions" content={terms} />
    </Template>
  );
};

export default PurchaseOrderPDF;
