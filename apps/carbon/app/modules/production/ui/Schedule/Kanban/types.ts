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
  showStatus: boolean;
  showSalesOrder: boolean;
  showThumbnail: boolean;
};

export type DraggableData = ColumnDragData | ItemDragData;

export type Event = Pick<
  ProductionEvent,
  "id" | "jobOperationId" | "duration" | "startTime" | "endTime"
>;

const itemValidator = z.object({
  id: z.string(),
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
  progress: z.number().optional(), // miliseconds
  status: z.enum(jobOperationStatus).optional(),
  salesOrderReadableId: z.string().optional(),
  salesOrderId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  setupDuration: z.number().optional(),
  laborDuration: z.number().optional(),
  machineDuration: z.number().optional(),
  thumbnailPath: z.string().optional(),
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
};
