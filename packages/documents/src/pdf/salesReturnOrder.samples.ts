/**
 * Sample data for previewing the Sales Return Order (RMA) template. Cast to
 * `any` — it only needs the fields the blocks read.
 */
export const SAMPLE_SALES_RETURN_ORDER = {
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
    eori: null,
    registrationNumber: null
  },
  salesReturnOrder: {
    salesReturnOrderId: "RMA-000012",
    currencyCode: "USD",
    exchangeRate: 1,
    status: "Authorized",
    orderDate: "2026-06-01",
    expirationDate: "2026-07-01",
    customerReference: "CR-2201",
    externalNotes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Please include this RMA number on all packages."
            }
          ]
        }
      ]
    }
  },
  salesReturnOrderLines: [
    {
      id: "line-1",
      lineNumber: 1,
      quantity: 4,
      unitOfMeasureCode: "EA",
      unitPrice: 24.5,
      restockFeePercent: 0,
      item: {
        name: "Precision Widget, anodized",
        readableIdWithRevision: "WIDGET-100"
      },
      returnReason: { name: "Defective" }
    },
    {
      id: "line-2",
      lineNumber: 2,
      quantity: 1,
      unitOfMeasureCode: "EA",
      unitPrice: 12,
      restockFeePercent: 0.1,
      item: {
        name: "Mounting Bracket",
        readableIdWithRevision: "BRACKET-22"
      },
      returnReason: { name: "Wrong item shipped" }
    }
  ],
  customerAddress: {
    name: "Globex Corporation",
    addressLine1: "500 Commerce Blvd",
    city: "Chicago",
    stateProvince: "IL",
    postalCode: "60601",
    country: "United States"
  },
  returnToAddress: {
    name: "Acme Manufacturing Co. — Main Plant",
    addressLine1: "1 Industrial Way",
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US"
  },
  terms: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Returned goods must be received within 30 days of authorization. Items must be in original packaging."
          }
        ]
      }
    ]
  },
  locale: "en-US"
} as any;
