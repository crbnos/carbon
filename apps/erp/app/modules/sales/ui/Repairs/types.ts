import type {
  getRepairOrderCharges,
  getRepairOrderLines
} from "~/modules/sales";

// Derived from the service reads the route actually performs — changing a
// select() then shows up here as a type error rather than as a runtime
// surprise in the table.
export type RepairOrderLine = NonNullable<
  Awaited<ReturnType<typeof getRepairOrderLines>>["data"]
>[number];

export type RepairOrderCharge = NonNullable<
  Awaited<ReturnType<typeof getRepairOrderCharges>>["data"]
>[number];
