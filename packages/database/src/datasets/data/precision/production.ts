import type {
  GenealogyAssemblySpec,
  GenealogyInputSpec,
  JobSpec,
  ProductionData,
  ShiftEventSpec
} from "../../types.ts";
import { precisionAssembly } from "./assembly.ts";

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
    dueDateOffset: -96,
    releasedDateOffset: -160
  },
  {
    key: "ready",
    item: "HMA-4000",
    status: "Ready",
    quantity: 2,
    salesOrder: "so:dominion",
    salesOrderLine: "soline:dominion:hma",
    customer: "Dominion Ag Equipment",
    dueDateOffset: -60,
    releasedDateOffset: -92
  },
  {
    key: "planned",
    item: "MCH-HSG-PUMP",
    status: "Planned",
    quantity: 12,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "Granite State Instruments",
    dueDateOffset: -30
  },
  {
    key: "draft",
    item: "MCH-END-CAP",
    status: "Draft",
    quantity: 40,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Solstice Medical Devices",
    dueDateOffset: -24
  },
  {
    key: "paused",
    item: "FAB-BASE-WLD",
    status: "Paused",
    quantity: 3,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "Cedar Valley Hydraulics",
    dueDateOffset: -70,
    releasedDateOffset: -130
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

export const precisionProduction: ProductionData = {
  assembly: precisionAssembly,
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress"
};
