/**
 * Sample data for previewing the Purchase Return Order (supplier return)
 * template. Cast to `any` — it only needs the fields the blocks read.
 */
export const SAMPLE_PURCHASE_RETURN_ORDER = {
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
  purchaseReturnOrder: {
    purchaseReturnOrderId: "PRO-000007",
    currencyCode: "USD",
    exchangeRate: 1,
    status: "Authorized",
    orderDate: "2026-06-01",
    expirationDate: "2026-07-01",
    supplierReference: "SUP-RMA-4471",
    externalNotes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Reference the supplier RMA number on all shipping documents."
            }
          ]
        }
      ]
    }
  },
  purchaseReturnOrderLines: [
    {
      id: "line-1",
      lineNumber: 1,
      quantity: 12,
      unitOfMeasureCode: "EA",
      unitPrice: 8.75,
      restockFeePercent: 0,
      item: {
        name: "Hex Cap Screw, M8 x 40",
        readableIdWithRevision: "SCREW-M8-40"
      },
      returnReason: { name: "Failed incoming inspection" }
    },
    {
      id: "line-2",
      lineNumber: 2,
      quantity: 2,
      unitOfMeasureCode: "EA",
      unitPrice: 145,
      restockFeePercent: 0.15,
      item: {
        name: "Servo Motor, 400W",
        readableIdWithRevision: "MOTOR-400W"
      },
      returnReason: { name: "Over-shipment" }
    }
  ],
  supplierAddress: {
    name: "Initech Components Ltd.",
    addressLine1: "42 Supplier Park",
    city: "Cleveland",
    stateProvince: "OH",
    postalCode: "44101",
    country: "United States"
  },
  shipFromAddress: {
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
            text: "Goods are returned per the supplier's return authorization. Credit is expected within 30 days of receipt."
          }
        ]
      }
    ]
  },
  locale: "en-US"
} as any;
