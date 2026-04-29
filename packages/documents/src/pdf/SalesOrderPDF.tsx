import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Image, Text, View } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import type { AccountsReceivableBillingAddress, PDF } from "../types";
import {
  getLineDescription,
  getLineDescriptionDetails,
  getLineTaxableSubtotal,
  getLineTotal,
  getTotal
} from "../utils/sales-order";
import { getCurrencyFormatter } from "../utils/shared";
import {
  Header,
  Note,
  PartyDetails,
  ShipBillDetails,
  Template
} from "./components";

interface SalesOrderPDFProps extends PDF {
  salesOrder: Database["public"]["Views"]["salesOrders"]["Row"];
  salesOrderLines: Database["public"]["Views"]["salesOrderLines"]["Row"][];
  salesOrderLocations: Database["public"]["Views"]["salesOrderLocations"]["Row"];
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
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
  accountsReceivableBillingAddress,
  company,
  companySettings,
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
    customerEori,
    paymentCustomerName,
    paymentAddressLine1,
    paymentAddressLine2,
    paymentCity,
    paymentStateProvince,
    paymentPostalCode,
    paymentCountryName
  } = salesOrderLocations;

  const currencyCode = salesOrder.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode ?? "USD", locale);

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesOrder?.paymentTermId
  );

  const shippingMethod = shippingMethods?.find(
    (method) => method.id === salesOrder?.shippingMethodId
  );

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
        date={salesOrder?.orderDate}
        currencyCode={salesOrder?.currencyCode}
      />

      <PartyDetails
        company={company}
        companyAddressOverride={
          accountsReceivableBillingAddress
            ? {
                name: accountsReceivableBillingAddress.name,
                addressLine1: accountsReceivableBillingAddress.addressLine1,
                addressLine2: accountsReceivableBillingAddress.addressLine2,
                city: accountsReceivableBillingAddress.city,
                stateProvince: accountsReceivableBillingAddress.state,
                postalCode: accountsReceivableBillingAddress.postalCode,
                countryCode: accountsReceivableBillingAddress.countryCode
              }
            : undefined
        }
        companyLabel="Seller"
        counterParty={{
          name: customerName,
          addressLine1: customerAddressLine1,
          addressLine2: customerAddressLine2,
          city: customerCity,
          stateProvince: customerStateProvince,
          postalCode: customerPostalCode,
          countryCode: customerCountryName,
          eori: customerEori
        }}
        counterPartyLabel="Buyer"
        accountsReceivableEmail={companySettings?.accountsReceivableEmail}
      />

      <ShipBillDetails
        shipTo={{
          name: customerName,
          addressLine1: customerAddressLine1,
          addressLine2: customerAddressLine2,
          city: customerCity,
          stateProvince: customerStateProvince,
          postalCode: customerPostalCode,
          countryCode: customerCountryName
        }}
        billTo={{
          name: paymentCustomerName,
          addressLine1: paymentAddressLine1,
          addressLine2: paymentAddressLine2,
          city: paymentCity,
          stateProvince: paymentStateProvince,
          postalCode: paymentPostalCode,
          countryCode: paymentCountryName
        }}
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
              {shippingMethod && <Text>Shipping: {shippingMethod.name}</Text>}
              {salesOrder?.shippingTermName && (
                <Text>Shipping Terms: {salesOrder.shippingTermName}</Text>
              )}
              {salesOrder?.incoterm && (
                <Text>
                  Incoterm: {salesOrder.incoterm}
                  {salesOrder.incotermLocation
                    ? ` - ${salesOrder.incotermLocation}`
                    : ""}
                </Text>
              )}
              {paymentTerm && <Text>Payment Terms: {paymentTerm.name}</Text>}
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Notes
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {Object.keys(salesOrder?.externalNotes ?? {}).length > 0 ? (
                <Note
                  content={(salesOrder.externalNotes ?? {}) as JSONContent}
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
          <Text style={tw("w-1/2")}>Description</Text>
          <Text style={tw("w-1/6 text-right")}>Qty</Text>
          <Text style={tw("w-1/6 text-right")}>Unit Price</Text>
          <Text style={tw("w-1/6 text-right")}>Total</Text>
        </View>

        {/* Rows */}
        {salesOrderLines.map((line) => {
          const isEven = rowIndex % 2 === 0;
          rowIndex++;

          const lineAddOnCost = line.convertedAddOnCost ?? 0;
          const lineNonTaxableAddOnCost =
            line.convertedNonTaxableAddOnCost ?? 0;
          const lineShippingCost = line.convertedShippingCost ?? 0;
          const lineTaxPercent = line.taxPercent ?? 0;
          const lineTaxAmount = getLineTaxableSubtotal(line) * lineTaxPercent;
          const totalTaxAndFees =
            lineAddOnCost +
            lineNonTaxableAddOnCost +
            lineShippingCost +
            lineTaxAmount;

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
                {Object.keys(line.externalNotes ?? {}).length > 0 && (
                  <View style={tw("mt-1")}>
                    <Note
                      key={`${line.id}-notes`}
                      content={line.externalNotes as JSONContent}
                    />
                  </View>
                )}
                {line.salesOrderLineType !== "Comment" &&
                  totalTaxAndFees > 0 && (
                    <View style={tw("mt-1")}>
                      <Text style={tw("text-[8px] text-gray-400 font-bold")}>
                        Tax & Fees
                      </Text>
                      {lineShippingCost > 0 && (
                        <Text style={tw("text-[8px] text-gray-400")}>
                          - Shipping
                        </Text>
                      )}
                      {lineAddOnCost > 0 && (
                        <Text style={tw("text-[8px] text-gray-400")}>
                          - Add-On
                        </Text>
                      )}
                      {lineNonTaxableAddOnCost > 0 && (
                        <Text style={tw("text-[8px] text-gray-400")}>
                          - Non-Taxable Add-On
                        </Text>
                      )}
                      {lineTaxPercent > 0 && (
                        <Text style={tw("text-[8px] text-gray-400")}>
                          - Tax ({(lineTaxPercent * 100).toFixed(0)}%)
                        </Text>
                      )}
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
          {/* Subtotal - extended price only */}
          <View style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}>
            <View style={tw("w-4/6")} />
            <Text style={tw("w-1/6 text-right text-gray-600")}>Subtotal</Text>
            <Text style={tw("w-1/6 text-right text-gray-800")}>
              {formatter.format(
                salesOrderLines.reduce(
                  (sum, line) =>
                    sum +
                    (line.saleQuantity ?? 0) * (line.convertedUnitPrice ?? 0),
                  0
                )
              )}
            </Text>
          </View>

          {/* Add-Ons */}
          {salesOrderLines.some(
            (line) =>
              (line.convertedAddOnCost ?? 0) > 0 ||
              (line.convertedNonTaxableAddOnCost ?? 0) > 0
          ) && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Add-Ons</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(
                  salesOrderLines.reduce(
                    (sum, line) =>
                      sum +
                      (line.convertedAddOnCost ?? 0) +
                      (line.convertedNonTaxableAddOnCost ?? 0),
                    0
                  )
                )}
              </Text>
            </View>
          )}

          {/* Shipping */}
          {(() => {
            const lineShipping = salesOrderLines.reduce(
              (sum, line) => sum + (line.convertedShippingCost ?? 0),
              0
            );
            const orderShipping =
              (salesOrder.shippingCost ?? 0) * (salesOrder.exchangeRate ?? 1);
            const totalShipping = lineShipping + orderShipping;
            return totalShipping > 0 ? (
              <View
                style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
              >
                <View style={tw("w-4/6")} />
                <Text style={tw("w-1/6 text-right text-gray-600")}>
                  Shipping
                </Text>
                <Text style={tw("w-1/6 text-right text-gray-800")}>
                  {formatter.format(totalShipping)}
                </Text>
              </View>
            ) : null;
          })()}

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
                    return sum + getLineTaxableSubtotal(line) * taxPercent;
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

      {/* Terms */}
      <Note title="Standard Terms & Conditions" content={terms} />
    </Template>
  );
};

export default SalesOrderPDF;
