import type { Database } from "@carbon/database";
import { Image, Text, View } from "@react-pdf/renderer";
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
} from "../utils/sales-invoice";
import { getCurrencyFormatter } from "../utils/shared";
import { Header, Note, Summary, Template } from "./components";

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
  title = "Invoice",
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
    invoiceCountryName,
  } = salesInvoiceLocations;

  const currencyCode = salesInvoice.currencyCode ?? company.baseCurrencyCode;
  const formatter = getCurrencyFormatter(currencyCode, locale);

  const summaryItems = [
    {
      label: "Date Issued",
      value: salesInvoice?.dateIssued,
    },
    {
      label: "Invoice #",
      value: salesInvoice?.invoiceId,
    },
  ];

  if (salesInvoice?.paymentTermId) {
    summaryItems.push({
      label: "Payment Terms",
      value: paymentTerms.find(
        (term) => term.id === salesInvoice?.paymentTermId
      )?.name,
    });
  }

  if (salesInvoice?.dateDue) {
    summaryItems.push({
      label: "Due Date",
      value: salesInvoice?.dateDue,
    });
  }

  return (
    <Template
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "sales invoice",
        subject: meta?.subject ?? "Invoice",
      }}
    >
      <View>
        <Header title={title} company={company} />
        <Summary company={company} items={summaryItems} />
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
            <Text style={tw("text-sm")}>{invoiceCustomerName}</Text>
            {invoiceAddressLine1 && (
              <Text style={tw("text-sm")}>{invoiceAddressLine1}</Text>
            )}
            {invoiceAddressLine2 && (
              <Text style={tw("text-sm")}>{invoiceAddressLine2}</Text>
            )}
            <Text style={tw("text-sm")}>
              {formatCityStatePostalCode(
                invoiceCity,
                invoiceStateProvince,
                invoicePostalCode
              )}
            </Text>
            <Text style={tw("text-sm")}>{invoiceCountryName}</Text>
          </View>
        </View>
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Customer Invoice #</Text>
            <Text style={tw("text-sm")}>{salesInvoice?.customerReference}</Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Due Date</Text>
            <Text style={tw("text-sm")}>{salesInvoice?.dateDue}</Text>
          </View>
        </View>
        <View style={tw("flex flex-row justify-between mb-5")}>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Method</Text>
            <Text style={tw("text-sm")}>
              {
                shippingMethods.find(
                  (method) =>
                    method.id === salesInvoiceShipment?.shippingMethodId
                )?.name
              }
            </Text>
          </View>
          <View style={tw("flex flex-col gap-1 w-1/3")}>
            <Text style={tw("text-gray-500 text-xs")}>Shipping Terms</Text>
            <Text style={tw("text-sm")}>
              {salesInvoiceShipment?.shippingTermId}
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
          {salesInvoiceLines.map((line) => {
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
                  {line.invoiceLineType === "Comment"
                    ? ""
                    : `${line.quantity} ${line.unitOfMeasureCode}`}
                </Text>
                <Text style={tw("w-1/6 text-right")}>
                  {line.invoiceLineType === "Comment"
                    ? null
                    : formatter.format(line.convertedUnitPrice ?? 0)}
                </Text>
                <Text style={tw("w-1/6 text-right")}>
                  {line.invoiceLineType === "Comment"
                    ? null
                    : formatter.format(getLineTaxesAndFees(line))}
                </Text>
                <Text style={tw("w-1/6 text-right")}>
                  {line.invoiceLineType === "Comment"
                    ? null
                    : formatter.format(getLineTotal(line))}
                </Text>
              </View>
            );
          })}
          {salesInvoiceShipment?.shippingCost && (
            <View
              style={tw(
                "flex flex-row justify-between items-center py-3 px-[6px] border-b border-gray-300 font-bold text-gray-500 uppercase"
              )}
            >
              <Text>Shipping</Text>
              <Text style={tw("text-black")}>
                {formatter.format(
                  (salesInvoiceShipment.shippingCost ?? 0) *
                    (salesInvoice.exchangeRate ?? 1)
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
              {formatter.format(
                getTotal(salesInvoiceLines, salesInvoice, salesInvoiceShipment)
              )}
            </Text>
          </View>
        </View>
        <View style={tw("flex flex-col gap-4 w-full")}>
          <Note
            title="Notes"
            content={(salesInvoice.externalNotes ?? {}) as JSONContent}
          />
          <Note title="Standard Terms & Conditions" content={terms} />
        </View>
      </View>
    </Template>
  );
};

export default SalesInvoicePDF;
