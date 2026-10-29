// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A drawn signature for the template preview, so the Approval block shows. */
const SAMPLE_SIGNATURE =
  "data:image/png;base64,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";

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
    eori: null,
    registrationNumber: null
  },
  purchaseOrder: {
    purchaseOrderId: "PO-001042",
    revisionId: 0,
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
      supplierShippingCost: 5,
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
  approval: {
    approvedBy: "Jordan Lee",
    approvedDate: "2026-06-02",
    signature: SAMPLE_SIGNATURE
  },
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
