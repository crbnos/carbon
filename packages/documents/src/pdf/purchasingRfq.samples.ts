// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Sample data for previewing the purchasing RFQ template. Cast to `any` — it
 * only needs the fields the blocks read.
 */
export const SAMPLE_PURCHASING_RFQ = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    addressLine1: "1 Industrial Way",
    addressLine2: null,
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US",
    phone: "(313) 555-0100",
    email: "purchasing@acme.example",
    website: "acme.example",
    baseCurrencyCode: "USD",
    logoLight: null,
    logoLightIcon: null,
    logoWatermark: null,
    eori: null,
    registrationNumber: null
  },
  purchasingRfq: {
    rfqId: "PRFQ000012",
    rfqDate: "2026-06-01",
    expirationDate: "2026-06-15",
    locationName: "Headquarters",
    notes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Please quote each quantity break and include freight to our dock."
            }
          ]
        }
      ]
    }
  },
  purchasingRfqLines: [
    {
      id: "line-1",
      itemReadableId: "A500-RECTTUBE-1.5X3X.188",
      description: 'A500 Gr B steel rectangular tube, 1.5" x 3" x .188"',
      quantity: [18500, 73900, 922800],
      purchaseUnitOfMeasureCode: "LB",
      externalNotes: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Mill certs required." }]
          }
        ]
      }
    },
    {
      id: "line-2",
      itemReadableId: "SCREW-M8-40",
      description: "Hex Cap Screw, M8 x 40",
      quantity: [500, 2000],
      purchaseUnitOfMeasureCode: "EA",
      externalNotes: null
    }
  ],
  shipToAddress: {
    name: "Headquarters",
    addressLine1: "1 Industrial Way",
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US"
  },
  contact: { name: "Jane Doe", email: "jane.doe@acme.example" },
  thumbnails: {},
  terms: {},
  locale: "en-US"
};
