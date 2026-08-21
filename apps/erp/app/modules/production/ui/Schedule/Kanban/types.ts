import { z } from "zod";
import {
  deadlineTypes,
  jobOperationStatus,
  jobStatus
} from "../../../production.models";
import type { ProductionEvent } from "../../../types";

export const columnValidator = z.object({
  id: z.string(),
  title: z.string(),
  active: z.boolean().optional(),
  type: z.array(z.string()),
  isBlocked: z.boolean().optional(),
  blockingDispatchId: z.string().optional(),
  blockingDispatchReadableId: z.string().optional()
});

export type Column = z.infer<typeof columnValidator>;

export interface ColumnDragData {
  type: "column";
  column: Column;
}

export type DisplaySettings = {
  emptyWorkCenters?: boolean;
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showEmployee: boolean;
  showMaterial?: boolean;
  showProgress: boolean;
  showQuantity: boolean;
  showStatus: boolean;
  showSalesOrder: boolean;
  showThumbnail: boolean;
};

export type DraggableData = ColumnDragData | ItemDragData;

export type Event = Pick<
  ProductionEvent,
  "id" | "jobOperationId" | "duration" | "startTime" | "endTime" | "employeeId"
>;

// Base item fields shared by both job and operation items
const baseItemValidator = z.object({
  id: z.string(),
  assignee: z.string().optional(),
  columnId: z.string(),
  columnType: z.string(),
  customerId: z.string().optional(),
  deadlineType: z.enum(deadlineTypes).optional(),
  description: z.string().optional(),
  dueDate: z.string().nullable().optional(), // 2024-05-28
  employeeIds: z.array(z.string()).optional(),
  itemDescription: z.string().optional(),
  itemReadableId: z.string(),
  jobId: z.string(),
  jobReadableId: z.string(),
  link: z.string().optional(),
  priority: z.number(),
  progress: z.number().optional(), // miliseconds
  reworkId: z.string().nullable().optional(),
  targetQuantity: z.number().optional(),
  quantity: z.number().optional(),
  quantityCompleted: z.number().optional(),
  quantityReworked: z.number().optional(),
  quantityScrapped: z.number().optional(),
  salesOrderId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  salesOrderReadableId: z.string().optional(),
  subtitle: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailPath: z.string().optional(),
  title: z.string()
});

// Operation item with operation-level status
const operationItemValidator = baseItemValidator.extend({
  duration: z.number().optional(), // miliseconds
  laborDuration: z.number().optional(),
  machineDuration: z.number().optional(),
  setupDuration: z.number().optional(),
  status: z.enum(jobOperationStatus).optional(),
  processBatchable: z.boolean().optional(),
  processName: z.string().optional(),
  jobOperationBatchId: z.string().nullable().optional(),
  batchReadableId: z.string().nullable().optional(),
  // "Substance Grade Dimension" strings from the operation's BOM lines —
  // the nesting-compatibility signal planners batch by.
  materialChips: z.array(z.string()).optional()
});

// Job item with job-level status
const jobItemValidator = baseItemValidator.extend({
  status: z.enum(jobStatus).optional(),
  completedDate: z.string().optional(),
  hasConflict: z.boolean().optional(),
  jobMakeMethodId: z.string()
});

export type OperationItem = z.infer<typeof operationItemValidator>;
export type JobItem = z.infer<typeof jobItemValidator>;

// An operation batch collapsed to one card on the schedule board. Explicit
// variant (not an ItemCard boolean): rendered by BatchItemCard, dragged across
// columns to reassign the batch's work center. `id` is the synthetic sortable
// id (`batch:<batchId>`); members keep their real ids.
export type BatchItem = Pick<
  z.infer<typeof baseItemValidator>,
  "id" | "columnId" | "columnType" | "priority" | "title"
> & {
  batchId: string;
  batchReadableId: string;
  batchStatus: "Active" | "Completing";
  members: OperationItem[];
};

export function isBatchItem(item: Item): item is BatchItem {
  return "batchId" in item;
}

export type Item = OperationItem | JobItem | BatchItem;

export interface ItemDragData {
  type: "item";
  item: Item;
}

export type Progress = {
  totalDuration: number;
  progress: number;
  active: boolean;
  employees?: Set<string>;
};
