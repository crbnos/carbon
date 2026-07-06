/** Sample data for previewing the Stock Transfer template. Cast `any`. */
export const SAMPLE_STOCK_TRANSFER = {
  company: {
    id: "sample",
    name: "Acme Manufacturing Co.",
    addressLine1: "1 Industrial Way",
    city: "Detroit",
    stateProvince: "MI",
    postalCode: "48201",
    countryCode: "US",
    logoLight: null,
    logoLightIcon: null
  },
  stockTransfer: {
    stockTransferId: "ST-001042",
    createdAt: "2026-06-05",
    assignee: "Jordan Lee"
  },
  stockTransferLines: [
    {
      id: "line-1",
      itemReadableId: "WIDGET-100",
      itemDescription: "Precision Widget, anodized",
      quantity: 50,
      unitOfMeasure: "EA",
      fromStorageUnitName: "Bin A1",
      toStorageUnitName: "Bin B3",
      requiresSerialTracking: false,
      requiresBatchTracking: false
    },
    {
      id: "line-2",
      itemReadableId: "BRACKET-22",
      itemDescription: "Mounting Bracket",
      quantity: 20,
      unitOfMeasure: "EA",
      fromStorageUnitName: "Bin A2",
      toStorageUnitName: "Bin C1",
      requiresSerialTracking: false,
      requiresBatchTracking: false
    }
  ],
  location: { name: "Main Warehouse" },
  thumbnails: {},
  locale: "en-US"
} as any;
