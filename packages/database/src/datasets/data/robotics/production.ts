import type {
  GenealogyAssemblySpec,
  GenealogyInputSpec,
  JobSpec,
  PickingListSpec,
  ProductionData,
  ShiftEventSpec
} from "../../types.ts";
import { roboticsAssembly } from "./assembly.ts";

export const JOBS: JobSpec[] = [
  {
    key: "in-progress",
    item: "ROB-2000",
    status: "In Progress",
    quantity: 3,
    quantityComplete: 1,
    salesOrder: "so:lakeshore",
    salesOrderLine: "soline:lakeshore:rob",
    customer: "Lakeshore Automotive",
    deadlineType: "Hard Deadline",
    dueDateOffset: -167,
    releasedDateOffset: -297,
    // The floor's real mixed state: integration done, burn-in running, final
    // acceptance waiting on it.
    operationOverrides: [
      { order: 1, status: "Done" },
      { order: 2, status: "In Progress" },
      { order: 3, status: "Waiting" }
    ],
    quantities: [
      { order: 1, type: "Production", quantity: 1 },
      { order: 1, type: "Scrap", quantity: 2, scrapReason: "Damaged" },
      { order: 2, type: "Rework", quantity: 1 }
    ],
    operationNotes: [
      {
        order: 1,
        note: "Base-to-link dowels seated on the second press — torque-striped all J1 fasteners and logged the values in the Lakeshore acceptance packet."
      },
      {
        order: 2,
        note: "Burn-in hour 14 of 24. Repeatability holding at ±0.02 mm on the test cube, J2 drive temp steady at 41C."
      }
    ]
  },
  {
    key: "ready",
    item: "ROB-2000",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:northwind",
    salesOrderLine: "soline:northwind:rob",
    customer: "Northwind Electronics",
    deadlineType: "ASAP",
    dueDateOffset: -153,
    releasedDateOffset: -251
  },
  {
    key: "planned",
    item: "ARM-BASE-001",
    status: "Planned",
    quantity: 1,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "Cascade Integration Group",
    deadlineType: "Soft Deadline",
    dueDateOffset: -90
  },
  {
    key: "draft",
    item: "CTRL-100",
    status: "Draft",
    quantity: 1,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Alpine Research Institute",
    deadlineType: "No Deadline"
  },
  {
    key: "paused",
    item: "ARM-WRIST-001",
    status: "Paused",
    quantity: 1,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "Lakeshore Automotive",
    dueDateOffset: -139,
    releasedDateOffset: -266
  },
  {
    key: "completed",
    item: "GRP-2F-80",
    status: "Completed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:completed",
    salesOrderLine: "soline:completed",
    customer: "Northwind Electronics",
    dueDateOffset: -328,
    releasedDateOffset: -434,
    completedDateOffset: -332
  },
  {
    key: "closed",
    item: "ARM-LINK-001",
    status: "Closed",
    quantity: 1,
    quantityComplete: 1,
    salesOrder: "so:closed",
    salesOrderLine: "soline:closed",
    customer: "Cascade Integration Group",
    dueDateOffset: -363,
    releasedDateOffset: -454,
    completedDateOffset: -367
  },
  {
    key: "cancelled",
    item: "HRN-ARM-001",
    status: "Cancelled",
    quantity: 1,
    salesOrder: "so:cancelled",
    salesOrderLine: "soline:cancelled",
    customer: "Alpine Research Institute",
    dueDateOffset: -314,
    releasedDateOffset: -337
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

// Tracked components consumed into the first arm. Item, lot/serial id, and how
// many of that lot went in — three 750W motors is what one ROB-2000 rolls up to.
export const GENEALOGY_INPUTS: GenealogyInputSpec[] = [
  { item: "MAT-AL6061-BIL", readableId: "LOT-AL6061-2606", quantity: 22 },
  { item: "MAT-AL6061-BIL", readableId: "LOT-AL6061-2607", quantity: 17 },
  { item: "ENC-ABS-19", readableId: "LOT-ENC-2606", quantity: 5 },
  { item: "MOT-AC-750W", readableId: "MOT750-SN-0041", quantity: 1 },
  { item: "MOT-AC-750W", readableId: "MOT750-SN-0042", quantity: 1 },
  { item: "MOT-AC-750W", readableId: "MOT750-SN-0043", quantity: 1 }
];

export const GENEALOGY_ASSEMBLY: GenealogyAssemblySpec = {
  item: "ROB-2000",
  ref: "trackedEntity:rob-0001",
  serial: {
    readableId: "ROB2000-SN-0001",
    quantity: 1,
    status: "Available",
    sourceDocument: "Job",
    sourceDocumentReadableId: "ROB-2000"
  },
  produce: {
    type: "Produce",
    sourceDocument: "Job Operation",
    sourceDocumentReadableId: "ROB-2000",
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

// Material staging for the in-progress ROB-2000 job. The completed list moved
// the base-joint hardware kit to the integration cell weeks ago; the open list
// is today's pull for the next arm, short on gear grease.
export const PICKING_LISTS: PickingListSpec[] = [
  {
    key: "rob-kit-1",
    status: "Completed",
    job: "in-progress",
    dateOffset: -20,
    lines: [
      {
        item: "FST-M8-SS",
        quantityRequired: 24,
        quantityPicked: 24,
        status: "Picked",
        fromShelf: "A1-L1"
      },
      {
        item: "MAT-CONN-M23",
        quantityRequired: 6,
        quantityPicked: 6,
        status: "Picked",
        fromShelf: "A1-L2"
      }
    ]
  },
  {
    key: "rob-kit-2",
    status: "In Progress",
    job: "in-progress",
    dateOffset: -2,
    lines: [
      {
        item: "BRG-CRB-100",
        quantityRequired: 4,
        quantityPicked: 0,
        status: "Pending",
        fromShelf: "A2-L3"
      },
      {
        item: "CN-GREASE-EP",
        quantityRequired: 1,
        quantityPicked: 0,
        status: "Short",
        fromShelf: "A1-L2"
      }
    ]
  }
];

export const roboticsProduction: ProductionData = {
  assembly: roboticsAssembly,
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress",
  // The burn-in operation (position 2) is the one overridden to In Progress.
  openEvent: { operationOrder: 2 },
  batch: { operationOrder: 1 },
  rework: {
    quantity: 1,
    reason:
      "J4 wrist repeatability drifted past ±0.03 mm at burn-in hour 9 — return unit 2 to integration for wrist re-shim and encoder re-mate.",
    targetOperationOrder: 1,
    triggeredAtOperationOrder: 2
  },
  pickingLists: PICKING_LISTS
};
