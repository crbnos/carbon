import { z } from "zod";
import { zfd } from "zod-form-data";

export const methodItemType = [
  "Part",
  "Material",
  "Tool",
  "Fixture",
  "Consumable",
  "Service",
] as const;

export const methodOperationOrders = [
  "After Previous",
  "With Previous",
] as const;

export const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const methodType = ["Buy", "Make", "Pick"] as const;

export const noteValidator = z.object({
  id: zfd.text(z.string().optional()),
  documentId: z.string().min(1),
  note: z.string().min(1, { message: "Note is required" }),
});

export const operationTypes = ["Inside", "Outside"] as const;

export const processTypes = [
  "Inside",
  "Outside",
  "Inside and Outside",
] as const;
