/** Sample data for previewing the Quote template. Cast `any`. */
export const SAMPLE_QUOTE = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    addressLine1: "1 Industrial Way",
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
  exchangeRate: 1,
  quote: {
    quoteId: "QUO-001042",
    currencyCode: "USD",
    expirationDate: "2026-07-01",
    customerReference: "RFQ-88421",
    externalNotes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Pricing valid for 30 days." }]
        }
      ]
    }
  },
  quoteLines: [
    {
      id: "line-1",
      status: "Active",
      itemReadableId: "WIDGET-100",
      description: "Precision Widget, anodized",
      quantity: [10],
      unitPricePrecision: 2,
      taxPercent: 0.06,
      additionalCharges: {},
      externalNotes: {}
    },
    {
      id: "line-2",
      status: "Active",
      itemReadableId: "BRACKET-22",
      description: "Mounting Bracket",
      quantity: [4],
      unitPricePrecision: 2,
      taxPercent: 0.06,
      additionalCharges: {},
      externalNotes: {}
    },
    {
      // Long title + description — exercises the Line Items text overflow
      // option (wrap grows the row; truncate clamps each to one line).
      id: "line-3",
      status: "Active",
      itemReadableId:
        "ASSEMBLY-HOUSING-ANODIZED-LONG-PART-NUMBER-FOR-OVERFLOW-0001",
      description:
        "Fully machined precision aluminium housing assembly with anodized finish, integrated mounting flange, and laser-etched serial marking — used to verify line-item text wrap versus truncate behaviour",
      quantity: [2],
      unitPricePrecision: 2,
      taxPercent: 0.06,
      additionalCharges: {},
      externalNotes: {}
    }
  ],
  quoteLinePrices: [
    {
      quoteLineId: "line-1",
      quantity: 10,
      convertedUnitPrice: 24.5,
      convertedNetExtendedPrice: 245,
      convertedShippingCost: 0,
      leadTime: 14
    },
    {
      quoteLineId: "line-2",
      quantity: 4,
      convertedUnitPrice: 12,
      convertedNetExtendedPrice: 48,
      convertedShippingCost: 0,
      leadTime: 7
    },
    {
      quoteLineId: "line-3",
      quantity: 2,
      convertedUnitPrice: 120,
      convertedNetExtendedPrice: 240,
      convertedShippingCost: 0,
      leadTime: 21
    }
  ],
  quoteCustomerDetails: {
    customerName: "Globex Corporation",
    customerAddressLine1: "500 Commerce Blvd",
    customerCity: "Chicago",
    customerStateProvince: "IL",
    customerPostalCode: "60601",
    customerCountryName: "United States"
  },
  payment: { paymentTermId: "net30" },
  shipment: { shippingCost: 0 },
  paymentTerms: [{ id: "net30", name: "Net 30" }],
  shippingMethods: [],
  terms: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Prices exclude applicable duties and taxes." }
        ]
      }
    ]
  },
  thumbnails: {},
  locale: "en-US"
} as any;
