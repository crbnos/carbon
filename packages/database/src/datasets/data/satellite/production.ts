import type {
  GenealogyAssemblySpec,
  GenealogyInputSpec,
  JobSpec,
  PickingListSpec,
  ProductionData,
  ShiftEventSpec
} from "../../types.ts";

export const JOBS: JobSpec[] = [
  {
    key: "in-progress",
    item: "SAT-1000",
    status: "In Progress",
    quantity: 3,
    quantityComplete: 1,
    salesOrder: "so:orbsec",
    salesOrderLine: "soline:orbsec:sat",
    customer: "ORBSEC Defense",
    deadlineType: "Hard Deadline",
    dueDateOffset: 6,
    releasedDateOffset: -297,
    priority: 3,
    assignee: "self",
    operationOverrides: [
      { order: 1, status: "Done" },
      { order: 2, status: "In Progress", assignee: "self" },
      { order: 3, status: "Waiting" }
    ],
    quantities: [
      { order: 1, type: "Production", quantity: 1 },
      { order: 1, type: "Scrap", quantity: 2, scrapReason: "Defective" },
      { order: 2, type: "Rework", quantity: 1 }
    ],
    operationNotes: [
      {
        order: 1,
        note: "Torque-striped all M6 bus fasteners after the second pass — witness marks photographed for the ORBSEC data package."
      },
      {
        order: 2,
        note: "TVAC cycle 3 of 8 running. Cold soak plateau holding at -25C, no anomalies on the battery heater loop."
      }
    ]
  },
  {
    key: "ready",
    item: "SAT-1000",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:polar",
    salesOrderLine: "soline:polar:sat",
    customer: "PolarView Earth",
    deadlineType: "ASAP",
    dueDateOffset: 14,
    releasedDateOffset: -4,
    priority: 10
  },
  {
    key: "planned",
    item: "BUS-STR-001",
    status: "Planned",
    quantity: 1,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "NovaSat Networks",
    deadlineType: "Soft Deadline",
    dueDateOffset: 18,
    priority: 12
  },
  {
    key: "draft",
    item: "EPS-001",
    status: "Draft",
    quantity: 1,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Apex Space Research",
    deadlineType: "No Deadline"
  },
  {
    key: "paused",
    item: "ADCS-001",
    status: "Paused",
    quantity: 1,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "ORBSEC Defense",
    dueDateOffset: 9,
    releasedDateOffset: -266,
    priority: 6
  },
  {
    key: "completed",
    item: "COMMS-001",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:completed",
    salesOrderLine: "soline:completed",
    customer: "PolarView Earth",
    dueDateOffset: -328,
    releasedDateOffset: -434,
    completedDateOffset: -332
  },
  {
    key: "closed",
    item: "PROP-001",
    status: "Closed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:closed",
    salesOrderLine: "soline:closed",
    customer: "NovaSat Networks",
    dueDateOffset: -363,
    releasedDateOffset: -454,
    completedDateOffset: -367
  },
  {
    key: "cancelled",
    item: "HARNESS-001",
    status: "Cancelled",
    quantity: 1,
    salesOrder: "so:cancelled",
    salesOrderLine: "soline:cancelled",
    customer: "Apex Space Research",
    dueDateOffset: -314,
    releasedDateOffset: -337
  },

  // Released over the last few weeks so every work center has a queue and something running today.
  {
    key: "floor-eps-pcb",
    item: "PCB-EPS-R1",
    status: "In Progress",
    quantity: 4,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:eps-pcb",
    customer: "NovaSat Networks",
    dueDateOffset: 2,
    releasedDateOffset: -6,
    priority: 2,
    assignee: "self",
    operationOverrides: [
      { order: 1, status: "Done" },
      {
        order: 2,
        status: "In Progress",
        assignee: "self",
        running: { type: "Labor", startTimeOfDay: "07:30:00" }
      },
      // The first potted boards are already on the QC bench (quality.inspections).
      { order: 3, status: "In Progress" }
    ]
  },
  {
    key: "floor-adcs-pcb",
    item: "PCB-ADCS-R1",
    status: "In Progress",
    quantity: 3,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:adcs-pcb",
    customer: "PolarView Earth",
    dueDateOffset: 5,
    releasedDateOffset: -2,
    priority: 4,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-bus",
    item: "BUS-STR-001",
    status: "In Progress",
    quantity: 1,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:bus",
    customer: "PolarView Earth",
    deadlineType: "Soft Deadline",
    dueDateOffset: 12,
    releasedDateOffset: -10,
    priority: 8,
    assignee: "self",
    operationOverrides: [
      {
        order: 1,
        status: "In Progress",
        assignee: "self",
        running: { type: "Machine", startTimeOfDay: "06:45:00" }
      },
      { order: 2, status: "Waiting" }
    ]
  },
  {
    key: "floor-saw",
    item: "SAW-001",
    status: "In Progress",
    quantity: 2,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:saw",
    customer: "PolarView Earth",
    dueDateOffset: 7,
    releasedDateOffset: -5,
    priority: 5,
    operationOverrides: [
      { order: 1, status: "Done" },
      {
        order: 2,
        status: "In Progress",
        running: { type: "Setup", startTimeOfDay: "08:15:00" }
      },
      { order: 3, status: "Waiting" }
    ]
  },
  {
    key: "floor-antenna",
    item: "ANT-PATCH-01",
    status: "Ready",
    quantity: 4,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:antenna",
    customer: "NovaSat Networks",
    deadlineType: "ASAP",
    dueDateOffset: 0,
    releasedDateOffset: -1,
    priority: 1,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-prop",
    item: "PROP-001",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:prop",
    customer: "PolarView Earth",
    dueDateOffset: 21,
    releasedDateOffset: -3,
    priority: 13
  },
  {
    key: "floor-comms",
    item: "COMMS-001",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:comms",
    customer: "PolarView Earth",
    deadlineType: "Soft Deadline",
    dueDateOffset: 16,
    releasedDateOffset: -4,
    priority: 11,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  // No deadline, so it lands in Priorities' Unscheduled column.
  {
    key: "floor-harness",
    item: "HARNESS-001",
    status: "Ready",
    quantity: 2,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:harness",
    customer: "PolarView Earth",
    deadlineType: "No Deadline",
    releasedDateOffset: -1,
    priority: 14
  },
  {
    key: "stock-eps-pcb",
    item: "PCB-EPS-R1",
    status: "In Progress",
    quantity: 6,
    dueDateOffset: 11,
    releasedDateOffset: -2,
    priority: 9
  },
  {
    key: "stock-harness",
    item: "HARNESS-001",
    status: "Ready",
    quantity: 4,
    deadlineType: "Soft Deadline",
    dueDateOffset: 9,
    releasedDateOffset: -3,
    priority: 7,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },

  // Feeds the completion-time and estimates-vs-actuals KPIs.
  {
    key: "done-adcs-pcb",
    item: "PCB-ADCS-R1",
    status: "Completed",
    quantity: 2,
    quantityComplete: 2,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:adcs-pcb",
    customer: "NovaSat Networks",
    dueDateOffset: -8,
    releasedDateOffset: -16,
    completedDateOffset: -11,
    loggedTime: { startOffset: -14, efficiency: 0.92 }
  },
  {
    key: "done-saw",
    item: "SAW-001",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:saw",
    customer: "NovaSat Networks",
    dueDateOffset: -20,
    releasedDateOffset: -30,
    completedDateOffset: -24,
    loggedTime: { startOffset: -28, efficiency: 1.18 }
  },
  {
    key: "done-bus",
    item: "BUS-STR-001",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:bus",
    customer: "NovaSat Networks",
    dueDateOffset: -2,
    releasedDateOffset: -12,
    completedDateOffset: -4,
    loggedTime: { startOffset: -9, efficiency: 1.07 }
  }
];

// Two recent shifts, nine and eight days before the anchor. One group per
// operation, in operation order.
export const SHIFTS: ShiftEventSpec[][] = [
  [
    {
      type: "Setup",
      startOffset: -9,
      startTimeOfDay: "13:00:00",
      endOffset: -9,
      endTimeOfDay: "13:45:00"
    },
    {
      type: "Labor",
      startOffset: -9,
      startTimeOfDay: "13:45:00",
      endOffset: -9,
      endTimeOfDay: "17:45:00"
    },
    {
      type: "Machine",
      startOffset: -9,
      startTimeOfDay: "13:45:00",
      endOffset: -9,
      endTimeOfDay: "17:45:00"
    }
  ],
  [
    {
      type: "Setup",
      startOffset: -8,
      startTimeOfDay: "13:00:00",
      endOffset: -8,
      endTimeOfDay: "13:20:00"
    },
    {
      type: "Labor",
      startOffset: -8,
      startTimeOfDay: "13:20:00",
      endOffset: -8,
      endTimeOfDay: "16:20:00"
    },
    {
      type: "Machine",
      startOffset: -8,
      startTimeOfDay: "13:20:00",
      endOffset: -8,
      endTimeOfDay: "16:20:00"
    }
  ]
];

// Tracked components consumed into the first satellite. Item, lot/serial id,
// and how many of that lot went in.
export const GENEALOGY_INPUTS: GenealogyInputSpec[] = [
  { item: "MAT-AL7075-PLT", readableId: "LOT-AL7075-2607", quantity: 4.5 },
  { item: "BAT-LIION-48V", readableId: "LOT-BAT-2606", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0041", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0042", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0043", quantity: 1 },
  { item: "RW-010", readableId: "RW010-SN-0044", quantity: 1 }
];

export const GENEALOGY_ASSEMBLY: GenealogyAssemblySpec = {
  item: "SAT-1000",
  ref: "trackedEntity:sat-0001",
  serial: {
    readableId: "SAT1000-SN-0001",
    quantity: 1,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentReadableId: "SAT-1000"
  },
  produce: {
    type: "Produce",
    sourceDocument: "Job Operation",
    sourceDocumentReadableId: "SAT-1000",
    quantity: 1
  },
  consume: {
    type: "Consume",
    sourceDocument: "Job Material",
    entityStatus: "Consumed",
    entitySourceDocument: "Item",
    parentQuantity: 1
  }
};

export const PICKING_LISTS: PickingListSpec[] = [
  {
    key: "sat-kit-1",
    status: "Completed",
    job: "in-progress",
    dateOffset: -20,
    lines: [
      {
        item: "FST-M4-TI",
        quantityRequired: 48,
        quantityPicked: 48,
        status: "Picked",
        fromShelf: "A1-L1"
      },
      {
        item: "FST-M6-A286",
        quantityRequired: 24,
        quantityPicked: 24,
        status: "Picked",
        fromShelf: "A1-L1"
      }
    ]
  },
  {
    key: "sat-kit-2",
    status: "In Progress",
    job: "in-progress",
    dateOffset: -2,
    lines: [
      {
        item: "BRG-6201",
        quantityRequired: 4,
        quantityPicked: 0,
        status: "Pending",
        fromShelf: "A1-L3"
      },
      {
        item: "CN-GREASE-001",
        quantityRequired: 1,
        quantityPicked: 0,
        status: "Short",
        fromShelf: "A1-L3"
      }
    ]
  }
];

export const satelliteProduction: ProductionData = {
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress",
  // Must match the operation overridden to In Progress.
  openEvent: { operationOrder: 2 },
  batch: {
    members: [
      { job: "floor-adcs-pcb", order: 1 },
      { job: "stock-eps-pcb", order: 1 }
    ],
    running: { type: "Machine", startTimeOfDay: "07:10:00" }
  },
  rework: {
    quantity: 1,
    reason:
      "Battery heater harness continuity failed at cold soak — return unit 2 to systems integration for connector rework.",
    targetOperationOrder: 1,
    triggeredAtOperationOrder: 2
  },
  pickingLists: PICKING_LISTS
};
