/** Sample data for previewing the Job Traveler template. Cast `any`. */
export const SAMPLE_JOB_TRAVELER = {
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
  job: {
    id: "job-1",
    jobId: "JOB-002310",
    itemReadableIdWithRevision: "WIDGET-100 / A",
    quantity: 100,
    unitOfMeasureCode: "EA",
    scrapQuantity: 5,
    startDate: "2026-06-01",
    dueDate: "2026-06-18",
    deadlineType: "Hard Deadline",
    salesOrderId: "so-1",
    salesOrderLineId: "sol-1",
    salesOrderReadableId: "SO-001188",
    customFields: {},
    notes: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Handle finished parts with gloves to avoid fingerprints on the anodized surface."
            }
          ]
        }
      ]
    }
  },
  jobMakeMethod: { id: "jmm-1", version: 2 },
  jobOperations: [
    {
      id: "op-1",
      order: 1,
      operationOrder: "After Previous",
      description: "CNC Mill — rough + finish",
      operationType: "Inside",
      setupTime: 0.5,
      setupUnit: "Hours",
      laborTime: 2,
      laborUnit: "Hours",
      machineTime: 1.5,
      machineUnit: "Hours",
      targetQuantity: 100,
      workInstruction: null,
      jobOperationStep: []
    },
    {
      id: "op-2",
      order: 2,
      operationOrder: "After Previous",
      description: "Deburr & inspect",
      operationType: "Inside",
      setupTime: 0,
      setupUnit: "Hours",
      laborTime: 0.75,
      laborUnit: "Hours",
      machineTime: 0,
      machineUnit: "Hours",
      targetQuantity: 100,
      workInstruction: null,
      jobOperationStep: []
    },
    {
      id: "op-3",
      order: 3,
      operationOrder: "After Previous",
      description: "Anodize (outside vendor)",
      operationType: "Outside",
      setupTime: 0,
      setupUnit: "Hours",
      laborTime: 0,
      laborUnit: "Hours",
      machineTime: 0,
      machineUnit: "Hours",
      targetQuantity: 100,
      workInstruction: null,
      jobOperationStep: []
    }
  ],
  customer: { id: "cust-1", name: "Globex Corporation" },
  item: {
    id: "item-1",
    name: "Precision Widget, anodized",
    readableIdWithRevision: "WIDGET-100 / A",
    itemTrackingType: "Batch"
  },
  batchNumber: "BATCH-44021",
  thumbnail: null,
  includeWorkInstructions: false
} as any;
