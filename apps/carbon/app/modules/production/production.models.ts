import { z } from "zod";
import { zfd } from "zod-form-data";
import { methodItemType } from "../shared";

export const deadlineTypes = [
  "No Deadline",
  "ASAP",
  "Soft Deadline",
  "Hard Deadline",
] as const;

export const jobStatus = [
  "Draft",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled",
] as const;

export const jobValidator = z.object({
  id: zfd.text(z.string().optional()),
  jobId: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  itemType: z.enum(methodItemType).optional(),
  customerId: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  dueDate: zfd.text(z.string().optional()),
  deadlineType: z.enum(deadlineTypes, {
    errorMap: () => ({ message: "Deadline type is required" }),
  }),
  locationId: z.string().min(1, { message: "Location is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  status: z
    .enum(jobStatus, {
      errorMap: () => ({ message: "Status is required" }),
    })
    .optional(),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  modelUploadId: zfd.text(z.string().optional()),
});
