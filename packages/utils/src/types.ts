import { z } from "zod";

export enum Edition {
  Cloud = "cloud",
  Enterprise = "enterprise",
  Community = "community",
}

export type Mode = "light" | "dark";

export const modeValidator = z.object({
  mode: z.enum(["light", "dark", "system"]),
});

export type PickPartial<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

export interface TrackedEntityAttributes {
  "Batch Number"?: string;
  Customer?: string;
  Job?: string;
  "Job Make Method"?: string;
  "Purchase Order"?: string;
  "Purchase Order Line"?: string;
  "Receipt Line Index"?: number;
  "Receipt Line"?: string;
  Receipt?: string;
  "Sales Order"?: string;
  "Sales Order Line"?: string;
  Supplier?: string;
  "Serial Number"?: string;
  "Shipment Line Index"?: number;
  "Shipment Line"?: string;
  Shipment?: string;
  "Split Entity ID"?: string;
}

export interface TrackedActivityAttributes {
  "Consumed Quantity"?: number;
  "Job Make Method"?: string;
  "Job Material"?: string;
  "Job Operation"?: string;
  "Original Quantity"?: number;
  "Production Event"?: string;
  "Receipt Line"?: string;
  "Remaining Quantity"?: number;
  Employee?: string;
  Job?: string;
  Receipt?: string;
  "Work Center"?: string;
}
