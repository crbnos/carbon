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
    item: "MTR-9000",
    status: "In Progress",
    quantity: 6,
    quantityComplete: 2,
    salesOrder: "so:ridgeline",
    salesOrderLine: "soline:ridgeline:mtr",
    customer: "Ridgeline Drive Systems",
    deadlineType: "Hard Deadline",
    dueDateOffset: 6,
    releasedDateOffset: -297,
    priority: 3,
    assignee: "self",
    // The floor's real mixed state: the build is done, the dyno is running,
    // the data-package review is waiting on it.
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
        note: "Bearing fit measured at 12 microns interference on units 1-3 — arbor press logs attached to the traveler for the Ridgeline data package."
      },
      {
        order: 2,
        note: "Loaded dyno run at 75% torque holding steady. Winding temp plateaued at 96C, well inside the Class H limit — thermal soak continues overnight."
      }
    ]
  },
  {
    key: "ready",
    item: "MTR-4500",
    status: "Ready",
    quantity: 4,
    salesOrder: "so:halcyon",
    salesOrderLine: "soline:halcyon:mtr",
    customer: "Halcyon Aerospace Actuation",
    deadlineType: "ASAP",
    dueDateOffset: 14,
    releasedDateOffset: -4,
    priority: 10
  },
  {
    key: "planned",
    item: "STA-9000",
    status: "Planned",
    quantity: 4,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "Cardinal Motorworks",
    deadlineType: "Soft Deadline",
    dueDateOffset: 18,
    priority: 12
  },
  {
    key: "draft",
    item: "HSG-9000",
    status: "Draft",
    quantity: 2,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Wabash Industrial Supply",
    deadlineType: "No Deadline"
  },
  {
    key: "paused",
    item: "ROT-9000",
    status: "Paused",
    quantity: 3,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "Ridgeline Drive Systems",
    dueDateOffset: 9,
    releasedDateOffset: -266,
    priority: 6
  },
  {
    key: "completed",
    item: "TRM-BOX-9000",
    status: "Completed",
    quantity: 8,
    quantityComplete: 8,
    salesOrder: "so:completed",
    salesOrderLine: "soline:completed",
    customer: "Halcyon Aerospace Actuation",
    dueDateOffset: -328,
    releasedDateOffset: -434,
    completedDateOffset: -332
  },
  {
    key: "closed",
    item: "COIL-9000",
    status: "Closed",
    quantity: 12,
    quantityComplete: 12,
    salesOrder: "so:closed",
    salesOrderLine: "soline:closed",
    customer: "Cardinal Motorworks",
    dueDateOffset: -363,
    releasedDateOffset: -454,
    completedDateOffset: -367
  },
  {
    key: "cancelled",
    item: "SHF-9000",
    status: "Cancelled",
    quantity: 6,
    salesOrder: "so:cancelled",
    salesOrderLine: "soline:cancelled",
    customer: "Wabash Industrial Supply",
    dueDateOffset: -314,
    releasedDateOffset: -337
  },

  // ── Floor load: short-routing stator, rotor and shaft work released over the
  // last few weeks, so every cell has a queue and something running today.
  {
    key: "floor-stator",
    item: "STA-4500",
    status: "In Progress",
    quantity: 4,
    salesOrder: "so:floor-ridgeline",
    salesOrderLine: "soline:floor-ridgeline:stator",
    customer: "Ridgeline Drive Systems",
    dueDateOffset: 2,
    releasedDateOffset: -6,
    priority: 2,
    assignee: "self",
    operationOverrides: [
      { order: 1, status: "Done" },
      { order: 2, status: "Done" },
      {
        order: 3,
        status: "In Progress",
        assignee: "self",
        running: { type: "Machine", startTimeOfDay: "07:30:00" }
      },
      { order: 4, status: "Waiting" }
    ]
  },
  {
    key: "floor-lam-rotor",
    item: "LAM-STK-ROT",
    status: "Ready",
    quantity: 12,
    salesOrder: "so:floor-halcyon",
    salesOrderLine: "soline:floor-halcyon:lam-rotor",
    customer: "Halcyon Aerospace Actuation",
    dueDateOffset: 5,
    releasedDateOffset: -2,
    priority: 4,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-shaft",
    item: "SHF-9000",
    status: "In Progress",
    quantity: 8,
    salesOrder: "so:floor-ridgeline",
    salesOrderLine: "soline:floor-ridgeline:shaft",
    customer: "Ridgeline Drive Systems",
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
    key: "floor-coil",
    item: "COIL-9000",
    status: "In Progress",
    quantity: 6,
    salesOrder: "so:floor-halcyon",
    salesOrderLine: "soline:floor-halcyon:coil",
    customer: "Halcyon Aerospace Actuation",
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
    key: "floor-termbox",
    item: "TRM-BOX-9000",
    status: "In Progress",
    quantity: 10,
    salesOrder: "so:floor-ridgeline",
    salesOrderLine: "soline:floor-ridgeline:termbox",
    customer: "Ridgeline Drive Systems",
    deadlineType: "ASAP",
    dueDateOffset: 0,
    releasedDateOffset: -1,
    priority: 1,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  {
    key: "floor-housing",
    item: "HSG-9000",
    status: "Ready",
    quantity: 4,
    salesOrder: "so:floor-halcyon",
    salesOrderLine: "soline:floor-halcyon:housing",
    customer: "Halcyon Aerospace Actuation",
    dueDateOffset: 21,
    releasedDateOffset: -3,
    priority: 13
  },
  {
    key: "floor-rotor",
    item: "ROT-9000",
    status: "Ready",
    quantity: 2,
    salesOrder: "so:floor-halcyon",
    salesOrderLine: "soline:floor-halcyon:rotor",
    customer: "Halcyon Aerospace Actuation",
    deadlineType: "Soft Deadline",
    dueDateOffset: 16,
    releasedDateOffset: -4,
    priority: 11,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  // Released with no deadline — Priorities' Unscheduled column.
  {
    key: "floor-lam-stator",
    item: "LAM-STK-STA",
    status: "Ready",
    quantity: 6,
    salesOrder: "so:floor-halcyon",
    salesOrderLine: "soline:floor-halcyon:lam-stator",
    customer: "Halcyon Aerospace Actuation",
    deadlineType: "No Deadline",
    releasedDateOffset: -1,
    priority: 14
  },
  // Make-to-stock: lamination stacks and terminal boxes for the next motor builds.
  {
    key: "stock-lam-stator",
    item: "LAM-STK-STA",
    status: "Ready",
    quantity: 16,
    dueDateOffset: 11,
    releasedDateOffset: -2,
    priority: 9
  },
  {
    key: "stock-termbox",
    item: "TRM-BOX-9000",
    status: "In Progress",
    quantity: 20,
    deadlineType: "Soft Deadline",
    dueDateOffset: 9,
    releasedDateOffset: -3,
    priority: 7,
    operationOverrides: [{ order: 1, assignee: "self" }]
  },
  // ── Recently completed — the completion-time and estimates-vs-actuals KPIs.
  {
    key: "done-coil",
    item: "COIL-9000",
    status: "Completed",
    quantity: 4,
    quantityComplete: 4,
    salesOrder: "so:floor-ridgeline",
    salesOrderLine: "soline:floor-ridgeline:coil",
    customer: "Ridgeline Drive Systems",
    dueDateOffset: -8,
    releasedDateOffset: -16,
    completedDateOffset: -11,
    loggedTime: { startOffset: -14, efficiency: 0.92 }
  },
  {
    key: "done-lam-rotor",
    item: "LAM-STK-ROT",
    status: "Completed",
    quantity: 10,
    quantityComplete: 10,
    salesOrder: "so:floor-ridgeline",
    salesOrderLine: "soline:floor-ridgeline:lam-rotor",
    customer: "Ridgeline Drive Systems",
    dueDateOffset: -20,
    releasedDateOffset: -28,
    completedDateOffset: -24,
    loggedTime: { startOffset: -27, efficiency: 1.18 }
  },
  {
    key: "done-rotor",
    item: "ROT-9000",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:floor-ridgeline",
    salesOrderLine: "soline:floor-ridgeline:rotor",
    customer: "Ridgeline Drive Systems",
    dueDateOffset: -2,
    releasedDateOffset: -12,
    completedDateOffset: -4,
    loggedTime: { startOffset: -9, efficiency: 1.07 }
  },
  // Make-to-stock: a service-pool motor whose rotor insertion is still ahead,
  // so the assembly bench has a build to play the 3D sequence on.
  {
    key: "stock-mtr",
    item: "MTR-9000",
    status: "Ready",
    quantity: 1,
    deadlineType: "Soft Deadline",
    dueDateOffset: 19,
    releasedDateOffset: -2,
    priority: 15
  }
];

// Two recent shifts, nine and eight days before the anchor. One group per
// operation, in operation order.
export const SHIFTS: ShiftEventSpec[][] = [
  [
    {
      type: "Setup",
      startOffset: -9,
      startTimeOfDay: "12:30:00",
      endOffset: -9,
      endTimeOfDay: "13:15:00"
    },
    {
      type: "Labor",
      startOffset: -9,
      startTimeOfDay: "13:15:00",
      endOffset: -9,
      endTimeOfDay: "17:15:00"
    },
    {
      type: "Machine",
      startOffset: -9,
      startTimeOfDay: "13:15:00",
      endOffset: -9,
      endTimeOfDay: "17:15:00"
    }
  ],
  [
    {
      type: "Setup",
      startOffset: -8,
      startTimeOfDay: "12:30:00",
      endOffset: -8,
      endTimeOfDay: "12:50:00"
    },
    {
      type: "Labor",
      startOffset: -8,
      startTimeOfDay: "12:50:00",
      endOffset: -8,
      endTimeOfDay: "15:50:00"
    },
    {
      type: "Machine",
      startOffset: -8,
      startTimeOfDay: "12:50:00",
      endOffset: -8,
      endTimeOfDay: "15:50:00"
    }
  ]
];

// Tracked components consumed into the first motor. Item, lot/serial id, and how
// many of that lot went in — one lamination lot rarely covers a whole stack.
export const GENEALOGY_INPUTS: GenealogyInputSpec[] = [
  { item: "MAT-LAM-M19", readableId: "LOT-M19-2604", quantity: 18 },
  { item: "MAT-LAM-M19", readableId: "LOT-M19-2605", quantity: 11 },
  { item: "MAT-CU-18AWG", readableId: "LOT-CU18-2606", quantity: 7 },
  { item: "MAG-NDFB-45", readableId: "LOT-MAG45-2605", quantity: 24 },
  { item: "ENC-INC-2048", readableId: "ENC2048-SN-0021", quantity: 1 }
];

export const GENEALOGY_ASSEMBLY: GenealogyAssemblySpec = {
  item: "MTR-9000",
  ref: "trackedEntity:mtr-0001",
  serial: {
    readableId: "MTR9000-SN-0001",
    quantity: 1,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentReadableId: "MTR-9000"
  },
  produce: {
    type: "Produce",
    sourceDocument: "Job Operation",
    sourceDocumentReadableId: "MTR-9000",
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

// Material staging for the in-progress MTR-9000 job. The completed list pulled
// the terminal-box and housing hardware to the assembly bench weeks ago; the
// open list is today's pull for the next motor, short on bearing grease.
export const PICKING_LISTS: PickingListSpec[] = [
  {
    key: "mtr-kit-1",
    status: "Completed",
    job: "in-progress",
    dateOffset: -20,
    lines: [
      {
        item: "FST-M6-SS",
        quantityRequired: 36,
        quantityPicked: 36,
        status: "Picked",
        fromShelf: "A1-L1"
      },
      {
        item: "FST-M10-SS",
        quantityRequired: 24,
        quantityPicked: 24,
        status: "Picked",
        fromShelf: "A1-L1"
      }
    ]
  },
  {
    key: "mtr-kit-2",
    status: "In Progress",
    job: "in-progress",
    dateOffset: -2,
    lines: [
      {
        item: "BRG-6308-C3",
        quantityRequired: 2,
        quantityPicked: 0,
        status: "Pending",
        fromShelf: "A2-L1"
      },
      {
        item: "CN-BRG-GREASE",
        quantityRequired: 1,
        quantityPicked: 0,
        status: "Short",
        fromShelf: "A2-L2"
      }
    ]
  }
];

export const motorProduction: ProductionData = {
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress",
  // The dyno operation (position 2) is the one overridden to In Progress.
  openEvent: { operationOrder: 2 },
  // The two terminal-box jobs ganged on one fixture at the turning cell.
  batch: {
    members: [
      { job: "floor-termbox", order: 1 },
      { job: "stock-termbox", order: 1 }
    ],
    running: { type: "Machine", startTimeOfDay: "07:00:00" }
  },
  rework: {
    quantity: 1,
    reason:
      "Loaded dyno run flagged bearing noise on unit 3 — return it to the assembly bench for a drive-end bearing re-fit.",
    targetOperationOrder: 1,
    triggeredAtOperationOrder: 2
  },
  pickingLists: PICKING_LISTS
};
