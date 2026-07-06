/** Sample data for previewing the Packing Slip template. Cast `any`. */
export const SAMPLE_PACKING_SLIP = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    countryCode: "US",
    city: "Detroit",
    taxId: null,
    logoLight: null,
    logoLightIcon: null
  },
  customer: { name: "Globex Corporation" },
  customerReference: "PO-88421",
  sourceDocument: "Sales Order",
  sourceDocumentId: "SO-001042",
  shipment: {
    shipmentId: "SHP-001042",
    postingDate: "2026-06-05",
    trackingNumber: "1Z999AA10123456784",
    externalNotes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Handle with care." }]
        }
      ]
    }
  },
  shipmentLines: [
    {
      id: "line-1",
      itemReadableId: "WIDGET-100",
      description: "Precision Widget, anodized",
      shippedQuantity: 10,
      orderQuantity: 10,
      unitOfMeasure: "EA"
    },
    {
      id: "line-2",
      itemReadableId: "BRACKET-22",
      description: "Mounting Bracket",
      shippedQuantity: 4,
      orderQuantity: 4,
      unitOfMeasure: "EA"
    }
  ],
  shippingAddress: {
    addressLine1: "500 Commerce Blvd",
    city: "Chicago",
    stateProvince: "IL",
    postalCode: "60601",
    countryCode: "US"
  },
  paymentTerm: { id: "net30", name: "Net 30" },
  shippingMethod: { id: "ground", name: "Ground" },
  terms: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Goods received in good condition." }]
      }
    ]
  },
  trackedEntities: [],
  thumbnails: {},
  locale: "en-US"
} as any;
