import { z } from "zod";

export const columnValidator = z.object({
  id: z.string(),
  title: z.string(),
  active: z.boolean().optional(),
});

export type Column = z.infer<typeof columnValidator>;

export interface ColumnDragData {
  type: "column";
  column: Column;
}

export type DraggableData = ColumnDragData | ItemDragData;

const itemValidator = z.object({
  id: z.string(),
  columnId: z.string(),
  title: z.string(),
  customerId: z.string().optional(),
  employeeIds: z.array(z.string()).optional(),
  dueDate: z.string().optional(),
  deadlineType: z
    .enum(["ASAP", "HARD_DEADLINE", "SOFT_DEADLINE", "NO_DEADLINE"])
    .optional(),
  status: z
    .object({
      status: z
        .enum(["INFO", "WARNING", "ERROR", "SUCCESS", "DEFAULT"])
        .optional(),
      message: z.string(),
    })
    .optional(),
});

export type Item = z.infer<typeof itemValidator>;

export interface ItemDragData {
  type: "item";
  item: Item;
}

export enum ItemStatus {
  Info = "INFO",
  Warning = "WARNING",
  Error = "ERROR",
  Success = "SUCCESS",
  Default = "DEFAULT",
}

export enum ItemDeadline {
  ASAP = "ASAP",
  HardDeadline = "HARD_DEADLINE",
  SoftDeadline = "SOFT_DEADLINE",
  NoDeadline = "NO_DEADLINE",
}

export enum ItemPriority {
  ASAP = "ASAP",
  High = "HIGH",
  Average = "AVERAGE",
  Low = "LOW",
}
