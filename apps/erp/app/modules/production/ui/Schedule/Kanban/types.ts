import { z } from "zod";
import { deadlineTypes, jobOperationStatus } from "../../../production.models";
import type { ProductionEvent } from "../../../types";

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

const itemValidator = z.object({
  id: z.string(),
  assignee: z.string().optional(),
  columnId: z.string(),
  columnType: z.string(),
  customerId: z.string().optional(),
  deadlineType: z.enum(deadlineTypes).optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(), // 2024-05-28
  duration: z.number().optional(), // miliseconds
  employeeIds: z.array(z.string()).optional(),
  itemDescription: z.string().optional(),
  itemReadableId: z.string(),
  jobId: z.string(),
  jobReadableId: z.string(),
  laborDuration: z.number().optional(),
  link: z.string().optional(),
  machineDuration: z.number().optional(),
  priority: z.number(),
  progress: z.number().optional(), // miliseconds
  quantity: z.number().optional(),
  quantityCompleted: z.number().optional(),
  quantityScrapped: z.number().optional(),
  salesOrderId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  salesOrderReadableId: z.string().optional(),
  setupDuration: z.number().optional(),
  status: z.enum(jobOperationStatus).optional(),
  subtitle: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailPath: z.string().optional(),
  title: z.string(),
});

export type Item = z.infer<typeof itemValidator>;

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
