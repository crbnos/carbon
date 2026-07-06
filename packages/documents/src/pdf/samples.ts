/**
 * Representative sample data for previewing a document template without a real
 * record. Co-located with the PDFs (the "sample" half of Bindery's
 * schema+sample idea; the "schema" half is the merge-field catalog in
 * template/merge.ts). Cast to `any` — it only needs the fields blocks read.
 */
export const SAMPLE_SALES_INVOICE = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    addressLine1: "1 Industrial Way",
    addressLine2: null,
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US",
    baseCurrencyCode: "USD",
    logoLightIcon: null,
    logoWatermark: null,
    eori: null
  },
  salesInvoice: {
    invoiceId: "INV-001042",
    currencyCode: "USD",
    exchangeRate: 1,
    dateIssued: "2026-06-01",
    dateDue: "2026-07-01",
    customerReference: "PO-88421",
    paymentTermId: "net30",
    externalNotes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Thank you for your business." }]
        }
      ]
    }
  },
  salesInvoiceLines: [
    {
      id: "line-1",
      invoiceLineType: "Part",
      itemReadableId: "WIDGET-100",
      description: "Precision Widget, anodized",
      quantity: 10,
      unitOfMeasureCode: "EA",
      convertedUnitPrice: 24.5,
      convertedAddOnCost: 0,
      convertedNonTaxableAddOnCost: 0,
      convertedShippingCost: 0,
      taxPercent: 0.06,
      externalNotes: {}
    },
    {
      id: "line-2",
      invoiceLineType: "Part",
      itemReadableId: "BRACKET-22",
      description: "Mounting Bracket",
      quantity: 4,
      unitOfMeasureCode: "EA",
      convertedUnitPrice: 12,
      convertedAddOnCost: 5,
      convertedNonTaxableAddOnCost: 0,
      convertedShippingCost: 0,
      taxPercent: 0.06,
      externalNotes: {}
    }
  ],
  salesInvoiceLocations: {
    customerName: "Globex Corporation",
    customerAddressLine1: "500 Commerce Blvd",
    customerCity: "Chicago",
    customerStateProvince: "IL",
    customerPostalCode: "60601",
    customerCountryName: "United States",
    invoiceCustomerName: "Globex Corporation",
    invoiceAddressLine1: "500 Commerce Blvd",
    invoiceCity: "Chicago",
    invoiceStateProvince: "IL",
    invoicePostalCode: "60601",
    invoiceCountryName: "United States"
  },
  salesInvoiceShipment: {
    shippingCost: 0,
    shippingMethodId: "ground"
  },
  paymentTerms: [{ id: "net30", name: "Net 30" }],
  shippingMethods: [{ id: "ground", name: "Ground" }],
  terms: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Payment due within 30 days. Late payments accrue 1.5% monthly interest."
          }
        ]
      }
    ]
  },
  locale: "en-US"
} as any;
