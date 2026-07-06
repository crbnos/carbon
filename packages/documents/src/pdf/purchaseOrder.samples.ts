/** Sample data for previewing the Purchase Order template. Cast `any`. */
export const SAMPLE_PURCHASE_ORDER = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    addressLine1: "1 Industrial Way",
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US",
    baseCurrencyCode: "USD",
    vatNumber: null,
    logoLight: null,
    logoLightIcon: null,
    logoWatermark: null,
    eori: null
  },
  purchaseOrder: {
    purchaseOrderId: "PO-001042",
    currencyCode: "USD",
    orderDate: "2026-06-01",
    supplierReference: "Q-55120",
    paymentTermId: "net30",
    supplierShippingCost: 0,
    purchaseOrderType: "Purchase",
    externalNotes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Please confirm lead times." }]
        }
      ]
    }
  },
  purchaseOrderLines: [
    {
      id: "line-1",
      purchaseOrderLineType: "Part",
      itemReadableId: "STEEL-BAR-50",
      description: "Steel Bar, 50mm",
      purchaseQuantity: 100,
      purchaseUnitOfMeasureCode: "EA",
      supplierUnitPrice: 5.22,
      supplierTaxAmount: 78.3,
      taxPercent: 0.15,
      requiredDate: "2026-06-20",
      externalNotes: {}
    },
    {
      id: "line-2",
      purchaseOrderLineType: "Part",
      itemReadableId: "BOLT-M8",
      description: "M8 Bolt, zinc",
      purchaseQuantity: 500,
      purchaseUnitOfMeasureCode: "EA",
      supplierUnitPrice: 0.12,
      supplierTaxAmount: 9,
      taxPercent: 0.15,
      requiredDate: "2026-06-20",
      externalNotes: {}
    }
  ],
  purchaseOrderLocations: {
    supplierName: "Steelworks Ltd",
    supplierAddressLine1: "200 Foundry Rd",
    supplierCity: "Pittsburgh",
    supplierStateProvince: "PA",
    supplierPostalCode: "15201",
    supplierCountryName: "United States",
    deliveryName: "Acme Manufacturing Co.",
    deliveryAddressLine1: "1 Industrial Way",
    deliveryCity: "Detroit",
    deliveryStateProvince: "MI",
    deliveryPostalCode: "48201",
    deliveryCountryName: "United States",
    dropShipment: false,
    companyCountryName: "United States"
  },
  paymentTerms: [{ id: "net30", name: "Net 30" }],
  terms: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Goods remain the property of the buyer until inspection and acceptance."
          }
        ]
      }
    ]
  },
  locale: "en-US"
} as any;
