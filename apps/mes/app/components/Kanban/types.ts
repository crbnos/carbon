import { z } from "zod";
import { deadlineTypes, jobOperationStatus } from "~/services/models";

export const columnValidator = z.object({
  id: z.string(),
  title: z.string(),
  active: z.boolean().optional(),
  type: z.array(z.string()),
});

export type Column = z.infer<typeof columnValidator>;

export interface ColumnDragData {
  type: "column";
  column: Column;
}

export type DisplaySettings = {
  showCustomer: boolean;
  showDescription: boolean;
  showDueDate: boolean;
  showDuration: boolean;
  showEmployee: boolean;
  showProgress: boolean;
  showStatus: boolean;
  showSalesOrder: boolean;
  showThumbnail: boolean;
};

export type DraggableData = ColumnDragData | ItemDragData;

const itemValidator = z.object({
  id: z.string(),
  assignee: z.string().optional(),
  columnId: z.string(),
  columnType: z.string(),
  title: z.string(),
  link: z.string().optional(),
  subtitle: z.string().optional(),
  priority: z.number(),
  customerId: z.string().optional(),
  employeeIds: z.array(z.string()).optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(), // 2024-05-28
  duration: z.number().optional(), // miliseconds
  deadlineType: z.enum(deadlineTypes).optional(),
  itemDescription: z.string().optional(),
  itemReadableId: z.string().optional(),
  jobReadableId: z.string().optional(),
  operationQuantity: z.number().optional(),
  progress: z.number().optional(), // miliseconds
  quantity: z.number().optional(),
  quantityCompleted: z.number().optional(),
  quantityScrapped: z.number().optional(),
  setupDuration: z.number().optional(), // milliseconds
  laborDuration: z.number().optional(), // milliseconds
  machineDuration: z.number().optional(), // milliseconds
  status: z.enum(jobOperationStatus).optional(),
  salesOrderReadableId: z.string().optional(),
  salesOrderId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailPath: z.string().optional(),
});

export type Item = z.infer<typeof itemValidator>;

export interface ItemDragData {
  type: "item";
  item: Item;
}

export enum ItemStatus {
  Canceled = "CANCELED",
  Done = "DONE",
  InProgress = "IN_PROGRESS",
  Paused = "PAUSED",
  Ready = "READY",
  Todo = "TODO",
  Waiting = "WAITING",
}

export enum ItemDeadline {
  ASAP = "ASAP",
  HardDeadline = "Hard Deadline",
  SoftDeadline = "Soft Deadline",
  NoDeadline = "No Deadline",
}

export enum ItemPriority {
  ASAP = "ASAP",
  High = "HIGH",
  Average = "AVERAGE",
  Low = "LOW",
}
