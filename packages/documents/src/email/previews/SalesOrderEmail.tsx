import type { Database } from "@carbon/database";
import SalesOrderEmail from "../SalesOrderEmail";

const company = {
  name: "Tombstone Machine Works",
  logoLightIcon: null,
  baseCurrencyCode: "USD"
} as unknown as Database["public"]["Views"]["companies"]["Row"];

const salesOrder = {
  salesOrderId: "SO-00123",
  paymentTermId: "payment-term-net-30",
  receiptRequestedDate: "2026-09-01",
  shippingCost: 85,
  exchangeRate: 1,
  externalNotes: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "All parts ship with certificates of conformance. Contact us before making any change requests after release."
          }
        ]
      }
    ]
  }
} as unknown as Database["public"]["Views"]["salesOrders"]["Row"];

const salesOrderLines = [
  {
    id: "so-line-1",
    salesOrderLineType: "Part",
    itemReadableId: "BRKT-6061",
    description: "6061-T6 Aluminum Bracket",
    customerPartId: "GLX-88451",
    customerPartRevision: "C",
    saleQuantity: 25,
    unitPrice: 68,
    convertedUnitPrice: 68,
    convertedAddOnCost: 0,
    convertedNonTaxableAddOnCost: 0,
    convertedShippingCost: 0,
    taxPercent: 0.075
  },
  {
    id: "so-line-2",
    salesOrderLineType: "Part",
    itemReadableId: "FAS-M8-125",
    description: "M8x1.25 Hex Bolt",
    customerPartId: null,
    customerPartRevision: null,
    saleQuantity: 500,
    unitPrice: 0.32,
    convertedUnitPrice: 0.32,
    convertedAddOnCost: 0,
    convertedNonTaxableAddOnCost: 0,
    convertedShippingCost: 0,
    taxPercent: 0.075
  },
  {
    id: "so-line-3",
    salesOrderLineType: "Comment",
    itemReadableId: null,
    description: "Expedite fees waived per agreement with Globex purchasing.",
    customerPartId: null,
    customerPartRevision: null,
    saleQuantity: null,
    unitPrice: null,
    convertedUnitPrice: null,
    convertedAddOnCost: null,
    convertedNonTaxableAddOnCost: null,
    convertedShippingCost: null,
    taxPercent: null
  }
] as unknown as Database["public"]["Views"]["salesOrderLines"]["Row"][];

const salesOrderLocations = {
  customerName: "Globex Inc.",
  customerAddressLine1: "1200 Industrial Parkway",
  customerAddressLine2: "Receiving Dock 3",
  customerCity: "Springfield",
  customerStateProvince: "IL",
  customerPostalCode: "62704",
  customerCountryName: "United States"
} as unknown as Database["public"]["Views"]["salesOrderLocations"]["Row"];

export default function SalesOrderEmailPreview() {
  return (
    <SalesOrderEmail
      company={company}
      locale="en-US"
      salesOrder={salesOrder}
      salesOrderLines={salesOrderLines}
      salesOrderLocations={salesOrderLocations}
      paymentTerms={[{ id: "payment-term-net-30", name: "Net 30" }]}
      recipient={{
        firstName: "Tom",
        lastName: "Sawyer",
        email: "tom.sawyer@globex.com"
      }}
      sender={{
        firstName: "Jane",
        lastName: "Doe",
        email: "jane.doe@tombstone.ms"
      }}
    />
  );
}
