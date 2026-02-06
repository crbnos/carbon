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
} from "../utils/sales-invoice";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Template } from "./components";

interface SalesInvoicePDFProps extends PDF {
  salesInvoice: Database["public"]["Views"]["salesInvoices"]["Row"];
  salesInvoiceLines: Database["public"]["Views"]["salesInvoiceLines"]["Row"][];
  salesInvoiceLocations: Database["public"]["Views"]["salesInvoiceLocations"]["Row"];
  salesInvoiceShipment: Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];
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
  company,
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
    invoiceCustomerName,
    invoiceAddressLine1,
    invoiceAddressLine2,
    invoiceCity,
    invoiceStateProvince,
    invoicePostalCode,
    invoiceCountryName
  } = salesInvoiceLocations;

  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);

  const paymentTerm = paymentTerms?.find(
    (term) => term.id === salesInvoice?.paymentTermId
  );

  const shippingMethod = shippingMethods?.find(
    (method) => method.id === salesInvoiceShipment?.shippingMethodId
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
        keywords: meta?.keywords ?? "sales invoice",
        subject: meta?.subject ?? "Invoice"
      }}
    >
      <Header
        company={company}
        title="Invoice"
        documentId={salesInvoice?.invoiceId}
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
              {invoiceCustomerName && (
                <Text style={tw("font-bold")}>{invoiceCustomerName}</Text>
              )}
              {invoiceAddressLine1 && (
                <Text style={tw("mt-1")}>{invoiceAddressLine1}</Text>
              )}
              {invoiceAddressLine2 && <Text>{invoiceAddressLine2}</Text>}
              {(invoiceCity || invoiceStateProvince || invoicePostalCode) && (
                <Text>
                  {formatCityStatePostalCode(
                    invoiceCity,
                    invoiceStateProvince,
                    invoicePostalCode
                  )}
                </Text>
              )}
              {invoiceCountryName && <Text>{invoiceCountryName}</Text>}
            </View>
          </View>
        </View>
      </View>

      {/* Invoice Details */}
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
            </View>
          </View>
          <View style={tw("w-1/2 p-3")}>
            <Text
              style={tw("text-[9px] font-bold text-gray-600 mb-1 uppercase")}
            >
              Shipping
            </Text>
            <View style={tw("text-[10px] text-gray-800")}>
              {shippingMethod && <Text>Method: {shippingMethod.name}</Text>}
              {salesInvoiceShipment?.shippingTermId && (
                <Text>Terms: {salesInvoiceShipment.shippingTermId}</Text>
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
          {/* Subtotal - before tax */}
          <View style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}>
            <View style={tw("w-4/6")} />
            <Text style={tw("w-1/6 text-right text-gray-600")}>Subtotal</Text>
            <Text style={tw("w-1/6 text-right text-gray-800")}>
              {formatter.format(
                salesInvoiceLines.reduce(
                  (sum, line) => sum + getLineSubtotal(line),
                  0
                )
              )}
            </Text>
          </View>

          {/* Shipping */}
          {salesInvoiceShipment?.shippingCost &&
            salesInvoiceShipment.shippingCost > 0 && (
              <View
                style={tw("flex flex-row py-1.5 px-3 bg-gray-50 text-[10px]")}
              >
                <View style={tw("w-4/6")} />
                <Text style={tw("w-1/6 text-right text-gray-600")}>
                  Shipping
                </Text>
                <Text style={tw("w-1/6 text-right text-gray-800")}>
                  {formatter.format(
                    (salesInvoiceShipment.shippingCost ?? 0) *
                      (salesInvoice.exchangeRate ?? 1)
                  )}
                </Text>
              </View>
            )}

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
              {formatter.format(
                getTotal(salesInvoiceLines, salesInvoice, salesInvoiceShipment)
              )}
            </Text>
          </View>
        </View>
      </View>

      {/* Notes & Terms */}
      <View style={tw("flex flex-col gap-3 w-full")}>
        {Object.keys(salesInvoice.externalNotes ?? {}).length > 0 && (
          <Note
            title="Notes"
            content={(salesInvoice.externalNotes ?? {}) as JSONContent}
          />
        )}
        <Note title="Standard Terms & Conditions" content={terms} />
      </View>
    </Template>
  );
};

export default SalesInvoicePDF;
