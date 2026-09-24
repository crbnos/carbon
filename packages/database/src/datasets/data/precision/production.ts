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
    item: "HMA-4000",
    status: "In Progress",
    quantity: 6,
    quantityComplete: 2,
    salesOrder: "so:cedarvalley",
    salesOrderLine: "soline:cedarvalley:hma",
    customer: "Cedar Valley Hydraulics",
    deadlineType: "Hard Deadline",
    dueDateOffset: 6,
    releasedDateOffset: -160,
    priority: 3,
    assignee: "self",
    // The floor's real mixed state: the manifold build is done, the hydro
    // proof test is running, final inspection waits on it.
    operationOverrides: [
      { order: 1, status: "Done" },
      { order: 2, status: "In Progress", assignee: "self" },
      { order: 3, status: "Waiting" }
    ],
    quantities: [
      { order: 1, type: "Production", quantity: 1 },
      { order: 1, type: "Scrap", quantity: 2, scrapReason: "Quality" },
      { order: 2, type: "Rework", quantity: 1 }
    ],
    operationNotes: [
      {
        order: 1,
        note: "Manifold torqued to spec on the base frame — witness marks on all M10s, torque wrench cal sticker photographed for the Cedar Valley book."
      },
      {
        order: 2,
        note: "Hydro proof at 1.5x rated running on unit 4. Held 10 minutes, no drop on the gauge yet — leaving it on the stand through lunch."
      }
    ]
  },
  {
    key: "ready",
    item: "HMA-4000",
    status: "Ready",
    quantity: 2,
    salesOrder: "so:dominion",
    salesOrderLine: "soline:dominion:hma",
    customer: "Dominion Ag Equipment",
    deadlineType: "ASAP",
    dueDateOffset: 14,
    releasedDateOffset: -4,
    priority: 10
  },
  {
    key: "planned",
    item: "MCH-HSG-PUMP",
    status: "Planned",
    quantity: 12,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "Granite State Instruments",
    deadlineType: "Soft Deadline",
    dueDateOffset: 18,
    priority: 12
  },
  {
    key: "draft",
    item: "MCH-END-CAP",
    status: "Draft",
    quantity: 40,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Solstice Medical Devices",
    deadlineType: "No Deadline"
  },
  {
    key: "paused",
    item: "FAB-BASE-WLD",
    status: "Paused",
    quantity: 3,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "Cedar Valley Hydraulics",
    dueDateOffset: 9,
    releasedDateOffset: -130,
    priority: 6
  },
  {
    key: "completed",
    item: "ASM-VALVE-SUB",
    status: "Completed",
    quantity: 20,
    quantityComplete: 20,
    salesOrder: "so:completed",
    salesOrderLine: "soline:completed",
    customer: "Dominion Ag Equipment",
    dueDateOffset: -210,
    releasedDateOffset: -248,
    completedDateOffset: -214
  },
  {
    key: "closed",
    item: "MCH-SHAFT-DR",
    status: "Closed",
    quantity: 30,
    quantityComplete: 30,
    salesOrder: "so:closed",
    salesOrderLine: "soline:closed",
    customer: "Granite State Instruments",
    dueDateOffset: -240,
    releasedDateOffset: -277,
    completedDateOffset: -244
  },
  {
    key: "cancelled",
    item: "FAB-ENCL-PNL",
    status: "Cancelled",
    quantity: 8,
    salesOrder: "so:cancelled",
    salesOrderLine: "soline:cancelled",
    customer: "Solstice Medical Devices",
    dueDateOffset: -140,
    releasedDateOffset: -172
  },

  {
    key: "floor-flange",
    item: "MCH-FLANGE-SS",
    status: "In Progress",
    quantity: 12,
    salesOrder: "so:floor-dominion",
    salesOrderLine: "soline:floor-dominion:flange",
    customer: "Dominion Ag Equipment",
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
        running: { type: "Machine", startTimeOfDay: "07:30:00" }
      },
      { order: 3, status: "Waiting" }
    ]
  },
  {
    key: "floor-spacer",
    item: "MCH-SPACER-KIT",
    status: "In Progress",
    quantity: 20,
    salesOrder: "so:floor-dominion",
    salesOrderLine: "soline:floor-dominion:spacer",
    customer: "Dominion Ag Equipment",
    dueDateOffset: 5,
    releasedDateOffset: -2,
    priority: 4,
    // Turned yesterday; the spacers now sit in the running deburr batch.
    operationOverrides: [{ order: 1, status: "Done", assignee: "self" }]
  },
  {
    key: "floor-shaft",
    item: "MCH-SHAFT-DR",
    status: "In Progress",
    quantity: 6,
    salesOrder: "so:floor-cedar",
    salesOrderLine: "soline:floor-cedar:shaft",
    customer: "Cedar Valley Hydraulics",
    deadlineType: "Soft Deadline",
    dueDateOffset: 12,
    releasedDateOffset: -9,
    priority: 8,
    assignee: "self",
    operationOverrides: [
      {
        order: 1,
        status: "In Progress",
        assignee: "self",
        running: { type: "Setup", startTimeOfDay: "06:45:00" }
      },
      { order: 2, status: "Waiting" }
    ]
  },
  {
    key: "floor-panel",
    item: "FAB-ENCL-PNL",
    status: "In Progress",
    quantity: 8,
    salesOrder: "so:floor-dominion",
    salesOrderLine: "soline:floor-dominion:panel",
    customer: "Dominion Ag Equipment",
    dueDateOffset: 7,
    releasedDateOffset: -5,
    priority: 5,
    operationOverrides: [
      {
        order: 1,
        status: "In Progress",
        running: { type: "Labor", startTimeOfDay: "08:15:00" }
      },
      { order: 2, status: "Waiting" }
    ]
  },
  {
    key: "floor-endcap",
    item: "MCH-END-CAP",
    status: "Ready",
    quantity: 10,
    salesOrder: "so:floor-cedar",
    salesOrderLine: "soline:floor-cedar:endcap",
    customer: "Cedar Valley Hydraulics",
    deadlineType: "ASAP",
    dueDateOffset: 0,
    releasedDateOffset: -1,
    priority: 1,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-rod",
    item: "MCH-PISTON-ROD",
    status: "Ready",
    quantity: 4,
    salesOrder: "so:floor-dominion",
    salesOrderLine: "soline:floor-dominion:rod",
    customer: "Dominion Ag Equipment",
    dueDateOffset: 21,
    releasedDateOffset: -3,
    priority: 13
  },
  {
    key: "floor-valve",
    item: "ASM-VALVE-SUB",
    status: "Ready",
    quantity: 3,
    salesOrder: "so:floor-dominion",
    salesOrderLine: "soline:floor-dominion:valve",
    customer: "Dominion Ag Equipment",
    deadlineType: "Soft Deadline",
    dueDateOffset: 16,
    releasedDateOffset: -4,
    priority: 11,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  // Released with no deadline — Priorities' Unscheduled column.
  {
    key: "floor-manifold",
    item: "MCH-MANI-BLK",
    status: "Ready",
    quantity: 2,
    salesOrder: "so:floor-dominion",
    salesOrderLine: "soline:floor-dominion:manifold",
    customer: "Dominion Ag Equipment",
    deadlineType: "No Deadline",
    releasedDateOffset: -1,
    priority: 14
  },
  {
    key: "stock-endcap",
    item: "MCH-END-CAP",
    status: "In Progress",
    quantity: 24,
    dueDateOffset: 11,
    releasedDateOffset: -2,
    priority: 9,
    operationOverrides: [{ order: 1, status: "Done" }]
  },
  {
    key: "stock-housing",
    item: "MCH-HSG-PUMP",
    status: "Ready",
    quantity: 4,
    deadlineType: "Soft Deadline",
    dueDateOffset: 9,
    releasedDateOffset: -3,
    priority: 7,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "done-flange",
    item: "MCH-FLANGE-SS",
    status: "Completed",
    quantity: 8,
    quantityComplete: 8,
    salesOrder: "so:floor-cedar",
    salesOrderLine: "soline:floor-cedar:flange",
    customer: "Cedar Valley Hydraulics",
    dueDateOffset: -8,
    releasedDateOffset: -16,
    completedDateOffset: -11,
    loggedTime: { startOffset: -14, efficiency: 0.92 }
  },
  {
    key: "done-panel",
    item: "FAB-ENCL-PNL",
    status: "Completed",
    quantity: 6,
    quantityComplete: 6,
    salesOrder: "so:floor-cedar",
    salesOrderLine: "soline:floor-cedar:panel",
    customer: "Cedar Valley Hydraulics",
    dueDateOffset: -20,
    releasedDateOffset: -28,
    completedDateOffset: -24,
    loggedTime: { startOffset: -27, efficiency: 1.18 }
  },
  {
    key: "done-housing",
    item: "MCH-HSG-PUMP",
    status: "Completed",
    quantity: 2,
    quantityComplete: 2,
    salesOrder: "so:floor-cedar",
    salesOrderLine: "soline:floor-cedar:housing",
    customer: "Cedar Valley Hydraulics",
    dueDateOffset: -2,
    releasedDateOffset: -12,
    completedDateOffset: -4,
    loggedTime: { startOffset: -9, efficiency: 1.07 }
  }
];

// Two recent shifts, seven and six days before the anchor. One group per
// operation, in operation order.
export const SHIFTS: ShiftEventSpec[][] = [
  [
    {
      type: "Setup",
      startOffset: -7,
      startTimeOfDay: "12:00:00",
      endOffset: -7,
      endTimeOfDay: "12:40:00"
    },
    {
      type: "Labor",
      startOffset: -7,
      startTimeOfDay: "12:40:00",
      endOffset: -7,
      endTimeOfDay: "17:10:00"
    },
    {
      type: "Machine",
      startOffset: -7,
      startTimeOfDay: "12:40:00",
      endOffset: -7,
      endTimeOfDay: "17:10:00"
    }
  ],
  [
    {
      type: "Setup",
      startOffset: -6,
      startTimeOfDay: "12:00:00",
      endOffset: -6,
      endTimeOfDay: "12:25:00"
    },
    {
      type: "Labor",
      startOffset: -6,
      startTimeOfDay: "12:25:00",
      endOffset: -6,
      endTimeOfDay: "15:55:00"
    },
    {
      type: "Machine",
      startOffset: -6,
      startTimeOfDay: "12:25:00",
      endOffset: -6,
      endTimeOfDay: "15:55:00"
    }
  ]
];

// Tracked components consumed into the first unit. Item, lot/serial id, and how
// many of that lot went in — two heat lots of 6061 is what one HMA-4000's
// machined parts were cut from.
export const GENEALOGY_INPUTS: GenealogyInputSpec[] = [
  { item: "MAT-AL6061-BAR", readableId: "LOT-AL6061-2608", quantity: 26 },
  { item: "MAT-AL6061-BAR", readableId: "LOT-AL6061-2609", quantity: 18 },
  { item: "MAT-4140-BAR", readableId: "LOT-4140-2609", quantity: 14 },
  { item: "BRG-DBL-6205", readableId: "LOT-BRG-2609", quantity: 4 },
  { item: "CYL-HYD-40", readableId: "CYL40-SN-0091", quantity: 1 },
  { item: "CYL-HYD-40", readableId: "CYL40-SN-0092", quantity: 1 }
];

export const GENEALOGY_ASSEMBLY: GenealogyAssemblySpec = {
  item: "HMA-4000",
  ref: "trackedEntity:hma-0001",
  serial: {
    readableId: "HMA4000-SN-0001",
    quantity: 1,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentReadableId: "HMA-4000"
  },
  produce: {
    type: "Produce",
    sourceDocument: "Job Operation",
    sourceDocumentReadableId: "HMA-4000",
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
    key: "hma-kit-1",
    status: "Completed",
    job: "in-progress",
    dateOffset: -20,
    lines: [
      {
        item: "INS-HELI-M6",
        quantityRequired: 24,
        quantityPicked: 24,
        status: "Picked",
        fromShelf: "B1-L2"
      },
      {
        item: "SEAL-ORING-224",
        quantityRequired: 16,
        quantityPicked: 16,
        status: "Picked",
        fromShelf: "B2-L1"
      }
    ]
  },
  {
    key: "hma-kit-2",
    status: "In Progress",
    job: "in-progress",
    dateOffset: -2,
    lines: [
      {
        item: "BRG-NDL-HK1512",
        quantityRequired: 12,
        quantityPicked: 0,
        status: "Pending",
        fromShelf: "B1-L3"
      },
      {
        item: "BSH-BRZ-2012",
        quantityRequired: 12,
        quantityPicked: 0,
        status: "Short",
        fromShelf: "B2-L2"
      }
    ]
  }
];

export const precisionProduction: ProductionData = {
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress",
  // The hydro proof test (position 2) is the one overridden to In Progress.
  openEvent: { operationOrder: 2 },
  batch: {
    members: [
      { job: "floor-spacer", order: 2 },
      { job: "stock-endcap", order: 2 }
    ],
    running: { type: "Machine", startTimeOfDay: "07:20:00" }
  },
  rework: {
    quantity: 1,
    reason:
      "Manifold-to-housing joint seeped at 1.5x proof — send unit 4 back to the bench to reseat the O-rings and retorque the joint.",
    targetOperationOrder: 1,
    triggeredAtOperationOrder: 2
  },
  pickingLists: PICKING_LISTS
};
