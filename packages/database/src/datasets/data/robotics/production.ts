import type {
  GenealogyAssemblySpec,
  GenealogyInputSpec,
  JobSpec,
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
    dueDateOffset: -167,
    releasedDateOffset: -297
  },
  {
    key: "ready",
    item: "ROB-2000",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:northwind",
    salesOrderLine: "soline:northwind:rob",
    customer: "Northwind Electronics",
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
    dueDateOffset: -125
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

export const roboticsProduction: ProductionData = {
  assembly: roboticsAssembly,
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress"
};
