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
} from "../utils/sales-invoice";
import { getCurrencyFormatter } from "../utils/shared";
import {
  Header,
  Note,
  PartyDetails,
  ShipBillDetails,
  Template
} from "./components";

interface SalesInvoicePDFProps extends PDF {
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  salesInvoiceLines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][];
  salesInvoiceLocations: Database["public"]["Views"]["salesInvoiceLocations"]["Row"];
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];
  accountsReceivableBillingAddress?: AccountsReceivableBillingAddress | null;
  companySettings?:
    | Database["public"]["Tables"]["companySettings"]["Row"]
    | null;
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

const SalesInvoicePDF = ({
  accountsReceivableBillingAddress,
  company,
  companySettings,
  locale,
  meta,
  salesInvoice,
  salesInvoiceShipment,
  salesInvoiceLines,
  salesInvoiceLocations,
  terms,
  paymentTerms,
  shippingMethods,
  thumbnails,
  title = "Invoice"
}: SalesInvoicePDFProps) => {
  const {
    customerName,
    customerAddressLine1,
    customerAddressLine2,
    customerCity,
    customerStateProvince,
    customerPostalCode,
    customerCountryName,
    customerEori,
    invoiceCustomerName,
    invoiceAddressLine1,
    invoiceAddressLine2,
    invoiceCity,
    invoiceStateProvince,
    invoicePostalCode,
    invoiceCountryName,
    shipmentCustomerName,
    shipmentAddressLine1,
    shipmentAddressLine2,
    shipmentCity,
    shipmentStateProvince,
    shipmentPostalCode,
    shipmentCountryName
  } = salesInvoiceLocations;

  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode ?? "USD", locale);

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesInvoice?.paymentTermId
  );

  const shippingMethod = shippingMethods?.find(
    (method) => method.id === salesInvoiceShipment?.shippingMethodId
  );

  let rowIndex = 0;

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "sales invoice",
        subject: meta?.subject ?? "Invoice"
      }}
    >
      <Header
        company={company}
        title="Invoice"
        documentId={salesInvoice?.invoiceId}
        date={salesInvoice?.dateIssued}
        currencyCode={salesInvoice?.currencyCode}
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
          name: shipmentCustomerName,
          addressLine1: shipmentAddressLine1,
          addressLine2: shipmentAddressLine2,
          city: shipmentCity,
          stateProvince: shipmentStateProvince,
          postalCode: shipmentPostalCode,
          countryCode: shipmentCountryName
        }}
        billTo={{
          name: invoiceCustomerName,
          addressLine1: invoiceAddressLine1,
          addressLine2: invoiceAddressLine2,
          city: invoiceCity,
          stateProvince: invoiceStateProvince,
          postalCode: invoicePostalCode,
          countryCode: invoiceCountryName
        }}
      />

      {/* Invoice Details & Notes */}
      <View style={tw("border border-gray-200 mb-4")}>
        <View style={tw("flex flex-row")}>
          <View style={tw("w-1/2 p-3 border-r border-gray-200")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Invoice Details
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {salesInvoice?.dateIssued && (
                <Text>Date Issued: {formatDate(salesInvoice.dateIssued)}</Text>
              )}
              {salesInvoice?.dateDue && (
                <Text>Due Date: {formatDate(salesInvoice.dateDue)}</Text>
              )}
              {salesInvoice?.customerReference && (
                <Text>Customer Ref: {salesInvoice.customerReference}</Text>
              )}
              {paymentTerm && <Text>Payment Terms: {paymentTerm.name}</Text>}
              {shippingMethod && <Text>Shipping: {shippingMethod.name}</Text>}
              {salesInvoiceShipment?.shippingTermId && (
                <Text>
                  Shipping Terms: {salesInvoiceShipment.shippingTermId}
                </Text>
              )}
              {salesInvoiceShipment?.incoterm && (
                <Text>
                  Incoterm: {salesInvoiceShipment.incoterm}
                  {salesInvoiceShipment.incotermLocation
                    ? ` - ${salesInvoiceShipment.incotermLocation}`
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
              {Object.keys(salesInvoice?.externalNotes ?? {}).length > 0 ? (
                <Note
                  content={(salesInvoice.externalNotes ?? {}) as JSONContent}
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
        {salesInvoiceLines.map((line) => {
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
                {line.invoiceLineType !== "Comment" && totalTaxAndFees > 0 && (
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
                {line.invoiceLineType === "Comment"
                  ? ""
                  : `${line.quantity} ${line.unitOfMeasureCode ?? "EA"}`}
              </Text>
              <Text style={tw("w-1/6 text-right text-gray-600")}>
                {line.invoiceLineType === "Comment"
                  ? ""
                  : formatter.format(line.convertedUnitPrice ?? 0)}
              </Text>
              <Text style={tw("w-1/6 text-right text-gray-800 font-medium")}>
                {line.invoiceLineType === "Comment"
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
                salesInvoiceLines.reduce(
                  (sum, line) =>
                    sum + (line.quantity ?? 0) * (line.convertedUnitPrice ?? 0),
                  0
                )
              )}
            </Text>
          </View>

          {/* Add-Ons */}
          {salesInvoiceLines.some(
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
                  salesInvoiceLines.reduce(
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
            const lineShipping = salesInvoiceLines.reduce(
              (sum, line) => sum + (line.convertedShippingCost ?? 0),
              0
            );
            const invoiceShipping =
              (salesInvoiceShipment?.shippingCost ?? 0) *
              (salesInvoice.exchangeRate ?? 1);
            const totalShipping = lineShipping + invoiceShipping;
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
          {salesInvoiceLines.some((line) => (line.taxPercent ?? 0) > 0) && (
            <View
              style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
            >
              <View style={tw("w-4/6")} />
              <Text style={tw("w-1/6 text-right text-gray-600")}>Taxes</Text>
              <Text style={tw("w-1/6 text-right text-gray-800")}>
                {formatter.format(
                  salesInvoiceLines.reduce((sum, line) => {
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
              {formatter.format(
                getTotal(salesInvoiceLines, salesInvoice, salesInvoiceShipment)
              )}
            </Text>
          </View>
        </View>
      </View>

      <Note title="Standard Terms & Conditions" content={terms} />
    </Template>
  );
};

export default SalesInvoicePDF;
