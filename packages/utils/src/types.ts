import { z } from "zod";

export enum Edition {
  Cloud = "cloud",
  Enterprise = "enterprise",
  Community = "community",
  Test = "test"
}

export type Mode = "light" | "dark";

export const modeValidator = z.object({
  mode: z.enum(["light", "dark", "system"])
});

export enum Plan {
  Starter = "STARTER",
  Business = "BUSINESS",
  Partner = "PARTNER",
  Unknown = "UNKNOWN"
}

// DB stores partner tiers as `PARTNER-300/400/500` etc. Collapse them onto
// `Plan.Partner` so plan-gate checks (`requirement.includes(plan)`) match.
export function normalizePlanId(planId: string | null | undefined): Plan {
  if (!planId) return Plan.Unknown;
  if (planId.startsWith("PARTNER")) return Plan.Partner;
  return planId as Plan;
}

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
  "Stock Transfer Line"?: string;
  "Stock Transfer"?: string;
  expirationDate?: string;
}

export interface TrackedActivityAttributes {
  "Consumed Quantity"?: number;
  "Job Make Method"?: string;
  "Job Material"?: string;
  "Job Operation"?: string;
  "Job Operation Step"?: string;
  // 1-based unit the consume was for (assembly view), so batch-parent issues can be
  // attributed per-unit even though every unit shares one lot entity.
  Unit?: number;
  "Original Quantity"?: number;
  "Production Event"?: string;
  "Receipt Line"?: string;
  "Remaining Quantity"?: number;
  Employee?: string;
  Inspector?: string;
  Job?: string;
  Receipt?: string;
  "Work Center"?: string;
}
