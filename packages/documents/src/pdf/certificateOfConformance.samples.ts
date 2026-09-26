/** Sample data for previewing the Certificate of Conformance template. Cast `any`. */
export const SAMPLE_CERTIFICATE_OF_CONFORMANCE = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    addressLine1: "100 Industrial Way",
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US",
    taxId: null,
    logoLight: null,
    logoLightIcon: null
  },
  locale: "en-US",
  certificate: {
    number: "COC000012-0",
    date: "2026-06-05",
    issued: false,
    reasonForUpdate: null,
    signer: { name: "Jane Doe", title: "Quality Manager" }
  },
  customer: {
    name: "Globex Aerospace",
    address: ["500 Commerce Blvd", "Chicago, IL 60601", "US"]
  },
  purchaseOrderNumber: "PO-88421",
  lines: [
    {
      itemNumber: "1 — GX-4471",
      quantity: "10 EA",
      description: "Actuator bracket, 7075-T6",
      revision: "C",
      traceability: [
        { id: "LOT-2026-0412", quantity: "6" },
        { id: "LOT-2026-0415", quantity: "4" }
      ],
      remarks: null
    },
    {
      itemNumber: "2 — HSG-220",
      quantity: "3 EA",
      description: "Sensor housing, anodized",
      revision: "N/C",
      traceability: [
        { id: "SN-000981", quantity: "1" },
        { id: "SN-000982", quantity: "1" },
        { id: "SN-000983", quantity: "1" }
      ],
      remarks: null
    }
  ],
  conformity: {
    shelfLife: [],
    fairs: ["FAI000004 — GX-4471 Rev C"],
    materialCertificates: [
      "Mill cert HT-77812 (Alcoa) — LOT-2026-0412",
      "Mill cert HT-77830 (Alcoa) — LOT-2026-0415"
    ],
    processCertificates: [],
    concessions: [],
    nonconformances: [],
    statements: [
      {
        name: "DFARS",
        content: "Specialty metals comply with DFARS 252.225-7009."
      },
      {
        name: "RoHS",
        content: "Product complies with Directive 2011/65/EU (RoHS)."
      }
    ],
    reasonForUpdate: null
  }
} as any;
