/** Sample data for previewing the Issue template. Cast `any`. */
export const SAMPLE_ISSUE = {
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
  nonConformance: {
    id: "nc-1",
    nonConformanceId: "NCR-000241",
    name: "Surface finish out of spec",
    status: "In Progress",
    nonConformanceTypeId: "nct-1",
    createdBy: "user-1",
    openDate: "2026-06-02",
    closeDate: null,
    customFields: {},
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Anodized surface shows visible streaking on 12 of 100 parts. Suspected rack contact points during the anodize bath."
            }
          ]
        }
      ]
    }
  },
  nonConformanceTypes: [
    { id: "nct-1", name: "Cosmetic Defect" },
    { id: "nct-2", name: "Dimensional" }
  ],
  actionTasks: [
    {
      id: "task-1",
      sortOrder: 1,
      actionTypeId: "ra-1",
      assignee: "user-1",
      completedDate: "2026-06-04",
      supplier: null,
      notes: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Re-racked affected parts and re-anodized."
              }
            ]
          }
        ]
      }
    },
    {
      id: "task-2",
      sortOrder: 2,
      actionTypeId: "ra-2",
      assignee: null,
      completedDate: null,
      supplier: { name: "Apex Anodizing" },
      notes: {}
    }
  ],
  requiredActions: [
    { id: "ra-1", name: "Corrective Action" },
    { id: "ra-2", name: "Containment" }
  ],
  reviewers: [
    {
      id: "rev-1",
      title: "Quality Manager",
      status: "Approved",
      notes: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Disposition: use as-is after rework." }
            ]
          }
        ]
      }
    },
    { id: "rev-2", title: "Engineering", status: "Pending", notes: {} }
  ],
  items: [],
  associations: {
    items: [
      {
        id: "a-1",
        documentReadableId: "WIDGET-100",
        disposition: "Rework",
        quantity: 12
      }
    ],
    customers: [{ id: "a-2", documentReadableId: "Globex Corporation" }],
    suppliers: [],
    jobOperations: [{ id: "a-3", documentReadableId: "JOB-002310 / Op 30" }],
    purchaseOrderLines: [],
    salesOrderLines: [{ id: "a-4", documentReadableId: "SO-001188" }],
    shipmentLines: [],
    receiptLines: [],
    trackedEntities: []
  },
  assignees: { "user-1": "Dana Cruz" },
  jobOperationStepRecords: [],
  operationToJobId: {}
} as any;
