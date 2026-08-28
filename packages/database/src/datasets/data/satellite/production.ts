import type {
  GenealogyAssemblySpec,
  GenealogyInputSpec,
  JobSpec,
  ProductionData,
  ShiftEventSpec
} from "../../types.ts";
import { satelliteAssembly } from "./assembly.ts";

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
    dueDateOffset: -167,
    releasedDateOffset: -297
  },
  {
    key: "ready",
    item: "SAT-1000",
    status: "Ready",
    quantity: 1,
    salesOrder: "so:polar",
    salesOrderLine: "soline:polar:sat",
    customer: "PolarView Earth",
    dueDateOffset: -153,
    releasedDateOffset: -251
  },
  {
    key: "planned",
    item: "BUS-STR-001",
    status: "Planned",
    quantity: 1,
    salesOrder: "so:planned",
    salesOrderLine: "soline:planned",
    customer: "NovaSat Networks",
    dueDateOffset: -90
  },
  {
    key: "draft",
    item: "EPS-001",
    status: "Draft",
    quantity: 1,
    salesOrder: "so:draft",
    salesOrderLine: "soline:draft",
    customer: "Apex Space Research",
    dueDateOffset: -125
  },
  {
    key: "paused",
    item: "ADCS-001",
    status: "Paused",
    quantity: 1,
    salesOrder: "so:paused",
    salesOrderLine: "soline:paused",
    customer: "ORBSEC Defense",
    dueDateOffset: -139,
    releasedDateOffset: -266
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

export const satelliteProduction: ProductionData = {
  assembly: satelliteAssembly,
  jobs: JOBS,
  shifts: SHIFTS,
  genealogyInputs: GENEALOGY_INPUTS,
  genealogyAssembly: GENEALOGY_ASSEMBLY,
  eventsJobKey: "in-progress",
  genealogyJobKey: "in-progress"
};
