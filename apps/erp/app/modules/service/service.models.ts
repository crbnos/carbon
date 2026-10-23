// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Service: customer assets and their warranty.

import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { optionalTiptapDoc } from "../shared/shared.models";

type Enums = Database["public"]["Enums"];

export type CustomerAssetStatus = Enums["customerAssetStatus"];
export type ProjectBillableItemStatus = Enums["projectBillableItemStatus"];

export const customerAssetStatuses = [
  "In Service",
  "At Depot",
  "Returned"
] as const satisfies readonly CustomerAssetStatus[];

export const warrantyStatuses = [
  "In warranty",
  "Labor ended",
  "Expired"
] as const;
export type WarrantyStatus = (typeof warrantyStatuses)[number];

/**
 * The warranty of a customer asset on a day (`YYYY-MM-DD`; date strings
 * compare in calendar order). In warranty while the labor warranty runs,
 * Labor ended while only the parts warranty runs, else Expired.
 */
export function warrantyStatus(
  asset: {
    laborWarrantyEndDate: string | null;
    partsWarrantyEndDate: string | null;
  },
  today: string
): WarrantyStatus {
  if (asset.laborWarrantyEndDate && asset.laborWarrantyEndDate >= today) {
    return "In warranty";
  }
  if (asset.partsWarrantyEndDate && asset.partsWarrantyEndDate >= today) {
    return "Labor ended";
  }
  return "Expired";
}

const optionalDate = zfd.text(
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Enter a date" })
    .optional()
);

/** Registers a unit sold before Carbon: the item, its serial and owner. */
export const customerAssetValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item is required" }),
    serialNumber: z.string().trim().min(1, { message: "Serial is required" }),
    customerId: z.string().min(1, { message: "Customer is required" }),
    customerLocationId: zfd.text(z.string().optional()),
    shippedDate: optionalDate,
    laborWarrantyEndDate: optionalDate,
    partsWarrantyEndDate: optionalDate,
    notes: optionalTiptapDoc
  })
  .refine(
    (data) =>
      !data.laborWarrantyEndDate ||
      !data.shippedDate ||
      data.laborWarrantyEndDate >= data.shippedDate,
    {
      message: "The labor warranty cannot end before the ship date",
      path: ["laborWarrantyEndDate"]
    }
  )
  .refine(
    (data) =>
      !data.partsWarrantyEndDate ||
      !data.shippedDate ||
      data.partsWarrantyEndDate >= data.shippedDate,
    {
      message: "The parts warranty cannot end before the ship date",
      path: ["partsWarrantyEndDate"]
    }
  );

/** The fields of an asset a service manager edits: site, warranty, notes. */
export const customerAssetUpdateValidator = z.object({
  id: z.string().min(1, { message: "Asset is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  laborWarrantyEndDate: optionalDate,
  partsWarrantyEndDate: optionalDate,
  notes: optionalTiptapDoc
});
