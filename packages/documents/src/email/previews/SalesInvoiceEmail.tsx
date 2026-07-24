import type { Database } from "@carbon/database";
import SalesInvoiceEmail from "../SalesInvoiceEmail";

const company = {
  name: "Tombstone Machine Works",
  logoLightIcon: null,
  baseCurrencyCode: "USD"
} as unknown as Database["public"]["Views"]["companies"]["Row"];

const salesInvoice = {
  invoiceId: "INV-00087",
  paymentTermId: "payment-term-net-30",
  dateDue: "2026-08-23",
  currencyCode: "USD",
  exchangeRate: 1,
  externalNotes: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Please remit payment to the account listed on the attached invoice and reference INV-00087."
          }
        ]
      }
    ]
  }
} as unknown as Database["public"]["Views"]["salesInvoices"]["Row"];

const salesInvoiceLines = [
  {
    id: "invoice-line-1",
    invoiceLineType: "Part",
    itemReadableId: "BRKT-6061",
    description: "6061-T6 Aluminum Bracket",
    quantity: 25,
    convertedUnitPrice: 68,
    convertedAddOnCost: 0,
    convertedNonTaxableAddOnCost: 0,
    convertedShippingCost: 0,
    taxPercent: 0.075
  },
  {
    id: "invoice-line-2",
    invoiceLineType: "Part",
    itemReadableId: "FAS-M8-125",
    description: "M8x1.25 Hex Bolt",
    quantity: 500,
    convertedUnitPrice: 0.32,
    convertedAddOnCost: 0,
    convertedNonTaxableAddOnCost: 0,
    convertedShippingCost: 0,
    taxPercent: 0.075
  },
  {
    id: "invoice-line-3",
    invoiceLineType: "Comment",
    itemReadableId: null,
    description: "Thank you for your business.",
    quantity: null,
    convertedUnitPrice: null,
    convertedAddOnCost: null,
    convertedNonTaxableAddOnCost: null,
    convertedShippingCost: null,
    taxPercent: null
  }
] as unknown as Database["public"]["Views"]["salesInvoiceLines"]["Row"][];

const salesInvoiceLocations = {
  invoiceCustomerName: "Globex Inc.",
  invoiceAddressLine1: "1200 Industrial Parkway",
  invoiceAddressLine2: "Suite 400",
  invoiceCity: "Springfield",
  invoiceStateProvince: "IL",
  invoicePostalCode: "62704",
  invoiceCountryName: "United States"
} as unknown as Database["public"]["Views"]["salesInvoiceLocations"]["Row"];

const salesInvoiceShipment = {
  shippingCost: 45
} as unknown as Database["public"]["Tables"]["salesInvoiceShipment"]["Row"];

export default function SalesInvoiceEmailPreview() {
  return (
    <SalesInvoiceEmail
      company={company}
      locale="en-US"
      salesInvoice={salesInvoice}
      salesInvoiceLines={salesInvoiceLines}
      salesInvoiceLocations={salesInvoiceLocations}
      salesInvoiceShipment={salesInvoiceShipment}
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
