/**
 * Sample data for previewing the Sales Order template. Cast to `any` — it only
 * needs the fields the blocks read.
 */
export const SAMPLE_SALES_ORDER = {
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
    logoLight: null,
    logoLightIcon: null,
    logoWatermark: null,
    eori: null
  },
  salesOrder: {
    salesOrderId: "SO-001042",
    currencyCode: "USD",
    exchangeRate: 1,
    orderDate: "2026-06-01",
    receiptRequestedDate: "2026-06-20",
    customerReference: "PO-88421",
    paymentTermId: "net30",
    shippingMethodId: "ground",
    shippingCost: 0,
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
  salesOrderLines: [
    {
      id: "line-1",
      salesOrderLineType: "Part",
      itemReadableId: "WIDGET-100",
      description: "Precision Widget, anodized",
      saleQuantity: 10,
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
      salesOrderLineType: "Part",
      itemReadableId: "BRACKET-22",
      description: "Mounting Bracket",
      saleQuantity: 4,
      unitOfMeasureCode: "EA",
      convertedUnitPrice: 12,
      convertedAddOnCost: 5,
      convertedNonTaxableAddOnCost: 0,
      convertedShippingCost: 0,
      taxPercent: 0.06,
      externalNotes: {}
    }
  ],
  salesOrderLocations: {
    customerName: "Globex Corporation",
    customerAddressLine1: "500 Commerce Blvd",
    customerCity: "Chicago",
    customerStateProvince: "IL",
    customerPostalCode: "60601",
    customerCountryName: "United States"
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
