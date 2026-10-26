// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
    item: "ISR4-AV",
    status: "In Progress",
    quantity: 3,
    quantityComplete: 1,
    salesOrder: "so:orbsec",
    salesOrderLine: "soline:orbsec:sat",
    customer: "Army Small UAS Program Office",
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
        note: "Torque-striped all M5 hinge-block fasteners after the second pass — witness marks photographed for the Army end-item data package."
      },
      {
        order: 2,
        note: "Temperature cycle 3 of 6 running. Cold soak holding at -32 °C, no faults on the battery heater loop."
      }
    ]
  },
  {
    key: "ready",
    item: "ISR4-AV",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:polar",
    salesOrderLine: "soline:polar:sat",
    customer: "State Emergency Response Agency",
    deadlineType: "ASAP",
    dueDateOffset: 14,
    releasedDateOffset: -4,
    priority: 10
  },
  {
    key: "planned",
    item: "AFR-100",
    status: "Planned",
    quantity: 1,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "Northgate Defense Systems",
    deadlineType: "Soft Deadline",
    dueDateOffset: 18,
    priority: 12
  },
  {
    key: "draft",
    item: "BAT-700",
    status: "Draft",
    quantity: 1,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Special Operations Aviation Command",
    deadlineType: "No Deadline"
  },
  {
    key: "paused",
    item: "AVN-500",
    status: "Paused",
    quantity: 1,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "Army Small UAS Program Office",
    dueDateOffset: 9,
    releasedDateOffset: -266,
    priority: 6
  },
  {
    key: "completed",
    item: "COM-800",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:completed",
    salesOrderLine: "soline:completed",
    customer: "Defense Innovation Pilot Office",
    dueDateOffset: -328,
    releasedDateOffset: -434,
    completedDateOffset: -332
  },
  {
    key: "closed",
    item: "ARM-200",
    status: "Closed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:closed",
    salesOrderLine: "soline:closed",
    customer: "Northgate Defense Systems",
    dueDateOffset: -363,
    releasedDateOffset: -454,
    completedDateOffset: -367
  },
  {
    key: "cancelled",
    item: "HRN-100",
    status: "Cancelled",
    quantity: 1,
    salesOrder: "so:cancelled",
    salesOrderLine: "soline:cancelled",
    customer: "Special Operations Aviation Command",
    dueDateOffset: -314,
    releasedDateOffset: -337
  },

  // Released over the last few weeks so every work center has a queue and something running today.
  {
    key: "floor-eps-pcb",
    item: "PCB-PDB-R1",
    status: "In Progress",
    quantity: 4,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:eps-pcb",
    customer: "Northgate Defense Systems",
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
    item: "PCB-FCB-R1",
    status: "In Progress",
    quantity: 3,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:adcs-pcb",
    customer: "State Emergency Response Agency",
    dueDateOffset: 5,
    releasedDateOffset: -2,
    priority: 4,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-bus",
    item: "AFR-100",
    status: "In Progress",
    quantity: 1,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:bus",
    customer: "State Emergency Response Agency",
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
    item: "BAT-TRAY-710",
    status: "In Progress",
    quantity: 2,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:saw",
    customer: "State Emergency Response Agency",
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
    item: "ANT-BLADE-01",
    status: "Ready",
    quantity: 4,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:antenna",
    customer: "Northgate Defense Systems",
    deadlineType: "ASAP",
    dueDateOffset: 0,
    releasedDateOffset: -1,
    priority: 1,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-prop",
    item: "ARM-200",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:prop",
    customer: "State Emergency Response Agency",
    dueDateOffset: 21,
    releasedDateOffset: -3,
    priority: 13
  },
  {
    key: "floor-comms",
    item: "COM-800",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:comms",
    customer: "State Emergency Response Agency",
    deadlineType: "Soft Deadline",
    dueDateOffset: 16,
    releasedDateOffset: -4,
    priority: 11,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  // No deadline, so it lands in Priorities' Unscheduled column.
  {
    key: "floor-harness",
    item: "HRN-100",
    status: "Ready",
    quantity: 2,
    salesOrder: "so:floor-polar",
    salesOrderLine: "soline:floor-polar:harness",
    customer: "State Emergency Response Agency",
    deadlineType: "No Deadline",
    releasedDateOffset: -1,
    priority: 14
  },
  {
    key: "stock-eps-pcb",
    item: "PCB-PDB-R1",
    status: "In Progress",
    quantity: 6,
    dueDateOffset: 11,
    releasedDateOffset: -2,
    priority: 9
  },
  {
    key: "stock-harness",
    item: "HRN-100",
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
    item: "PCB-FCB-R1",
    status: "Completed",
    quantity: 2,
    quantityComplete: 2,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:adcs-pcb",
    customer: "Northgate Defense Systems",
    dueDateOffset: -8,
    releasedDateOffset: -16,
    completedDateOffset: -11,
    loggedTime: { startOffset: -14, efficiency: 0.92 }
  },
  {
    key: "done-saw",
    item: "BAT-TRAY-710",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:saw",
    customer: "Northgate Defense Systems",
    dueDateOffset: -20,
    releasedDateOffset: -30,
    completedDateOffset: -24,
    loggedTime: { startOffset: -28, efficiency: 1.18 }
  },
  {
    key: "done-bus",
    item: "AFR-100",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:floor-novasat",
    salesOrderLine: "soline:floor-novasat:bus",
    customer: "Northgate Defense Systems",
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

// Tracked components consumed into the first air vehicle. Item, lot/serial id,
// and how many of that lot went in.
export const GENEALOGY_INPUTS: GenealogyInputSpec[] = [
  { item: "MAT-AL7075-PLT", readableId: "LOT-AL7075-2607", quantity: 4.5 },
  { item: "BAT-SMART-11AH", readableId: "LOT-BAT-2606", quantity: 1 },
  { item: "ESC-80A-NDAA", readableId: "ESC80-SN-0041", quantity: 1 },
  { item: "ESC-80A-NDAA", readableId: "ESC80-SN-0042", quantity: 1 },
  { item: "ESC-80A-NDAA", readableId: "ESC80-SN-0043", quantity: 1 },
  { item: "ESC-80A-NDAA", readableId: "ESC80-SN-0044", quantity: 1 }
];

export const GENEALOGY_ASSEMBLY: GenealogyAssemblySpec = {
  item: "ISR4-AV",
  ref: "trackedEntity:sat-0001",
  serial: {
    readableId: "HUS-AV-0001",
    quantity: 1,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentReadableId: "ISR4-AV"
  },
  produce: {
    type: "Produce",
    sourceDocument: "Job Operation",
    sourceDocumentReadableId: "ISR4-AV",
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
        item: "FST-M3-TI",
        quantityRequired: 48,
        quantityPicked: 48,
        status: "Picked",
        fromShelf: "A1-L1"
      },
      {
        item: "FST-M5-A286",
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
        item: "ISO-DAMP-M3",
        quantityRequired: 4,
        quantityPicked: 0,
        status: "Pending",
        fromShelf: "A1-L3"
      },
      {
        item: "CN-THREADLOCK",
        quantityRequired: 1,
        quantityPicked: 0,
        status: "Short",
        fromShelf: "A1-L3"
      }
    ]
  }
];

export const defenseProduction: ProductionData = {
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
      "Battery heater harness continuity failed at cold soak — return air vehicle 2 to integration for connector rework.",
    targetOperationOrder: 1,
    triggeredAtOperationOrder: 2
  },
  pickingLists: PICKING_LISTS
};
