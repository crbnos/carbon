// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Representative sample data for previewing a document template without a real
 * record. Co-located with the PDFs (the "sample" half of Bindery's
 * schema+sample idea; the "schema" half is the merge-field catalog in
 * template/mergeFields.ts). Cast to `any` — it only needs the fields blocks read.
 */

/**
 * A two-component tax code (6% = 4% + 2%), so the quote and sales order samples
 * print a `taxComponent` row per component.
 */
export const SAMPLE_TAX_CODE = {
  id: "sample-tax-code",
  calculationType: "Normal",
  taxesShipping: false,
  invoiceMessage: null,
  taxCodeComponent: [
    ["sample-state", "State Tax", 0.04, 1],
    ["sample-city", "City Tax", 0.02, 2]
  ].map(([id, name, taxPercent, sequence]) => ({
    id,
    name,
    taxAuthorityId: null,
    taxPercent,
    recoverablePercent: 0,
    sequence,
    isCompound: false,
    taxReceivedAccountId: null,
    taxPaidAccountId: null,
    effectiveDate: null,
    expirationDate: null
  }))
};

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
    eori: null,
    registrationNumber: null
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
      discountPercent: 0.2,
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
      discountPercent: 0,
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
    invoiceCountryName: "United States",
    contactName: "Hank Scorpio",
    contactEmail: "hank@globex.example"
  },
  salesInvoiceShipment: {
    shippingCost: 0,
    shippingMethodId: "ground",
    shippingTermId: "fob"
  },
  // What `loadTaxSummary` returns for the lines above (6% of 249.00).
  taxSummary: [
    { name: "City Tax", rate: 0.02, base: 249, tax: 4.98 },
    { name: "State Tax", rate: 0.04, base: 249, tax: 9.96 }
  ],
  invoiceMessages: ["Sales tax charged at the combined state and city rate."],
  sellerRegistration: "MI-0001234",
  paymentTerms: [{ id: "net30", name: "Net 30" }],
  shippingMethods: [{ id: "ground", name: "Ground" }],
  shippingTerms: [{ id: "fob", name: "FOB Origin" }],
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
