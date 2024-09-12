import { z } from "zod";
import { zfd } from "zod-form-data";

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline",
] as const;

export const jobStatus = [
  "Draft",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled",
] as const;

export const jobValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    jobId: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item is required" }),
    customerId: zfd.text(z.string().optional()),
    dueDate: zfd.text(z.string().optional()),
    deadlineType: z.enum(deadlineTypes, {
      errorMap: () => ({ message: "Deadline type is required" }),
    }),
    locationId: z.string().min(1, { message: "Location is required" }),
    quantity: zfd.numeric(z.number().min(0)),
    scrapQuantity: zfd.numeric(z.number().min(0)),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of measure is required" }),
    modelUploadId: zfd.text(z.string().optional()),
  })
  .refine(
    (data) => {
      if (
        ["Hard Deadline", "Soft Deadline"].includes(data.deadlineType) &&
        !data.dueDate
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Due date is required",
      path: ["dueDate"],
    }
  );
