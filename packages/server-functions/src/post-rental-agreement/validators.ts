// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { z } from "zod";

/**
 * Payload contract and pure helpers for `post-rental-agreement`. No I/O and
 * no imports beyond zod, the generated types and the pure date / billing
 * modules, so the server function's decisions can be pinned without a
 * database.
 */

type Enums = Database["public"]["Enums"];

// Calendar dates travel as `YYYY-MM-DD` text end to end: the line and the
// billing periods store DATE columns, and a JavaScript Date would shift the
// day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

// companyId and userId come from the server function's context, not the input.
const scope = {
  rentalAgreementId: z.string().min(1)
};

/** Draft → Active: check every unit is available, classify each unit's
 *  accounting treatment, cut the first periods at each unit's rate. */
export const activateValidator = z.object({
  type: z.literal("activate"),
  ...scope
});

/** Where a sales-type unit goes when it comes back at the end of the term. */
export const RESIDUAL_DESTINATIONS = ["Fleet", "Inventory"] as const;
export type ResidualDestination = (typeof RESIDUAL_DESTINATIONS)[number];

/** One unit coming back, without the agreement: the fields a rental receipt
 *  line and the agreement's return action share. */
const unitReturnFields = {
  rentalAgreementLineId: z.string().min(1),
  returnedAt: calendarDate,
  meterIn: z.number().min(0).optional().nullable(),
  returnNotes: z.string().optional().nullable(),
  takeOutOfService: z.boolean().optional(),
  outOfServiceReason: z.string().optional().nullable(),
  residualDestination: z.enum(RESIDUAL_DESTINATIONS).optional().nullable()
};

export const unitReturnValidator = z
  .object(unitReturnFields)
  .refine(
    (data) => !data.takeOutOfService || !!data.outOfServiceReason?.trim(),
    {
      message: "A reason is required to take the unit out of service",
      path: ["outOfServiceReason"]
    }
  );

/** A Pending unit that never left the yard: stop its billing at
 *  `returnedAt` and free the unit, with no document (spec Q8). */
export const releaseValidator = z.object({
  type: z.literal("release"),
  rentalAgreementLineId: z.string().min(1),
  returnedAt: calendarDate,
  ...scope
});

/** Every unit is back (or sold) and everything is billed. */
export const closeValidator = z.object({
  type: z.literal("close"),
  ...scope
});

/** Nothing delivered and nothing billed: the agreement is void. */
export const cancelValidator = z.object({
  type: z.literal("cancel"),
  ...scope
});

export const payloadValidator = z.discriminatedUnion("type", [
  activateValidator,
  releaseValidator,
  closeValidator,
  cancelValidator
]);

export type RentalAgreementPayload = z.infer<typeof payloadValidator>;

/** A line holds its unit while it is in one of these statuses — the same set
 *  the `rentalAgreementLine_asset_live_idx` unique index and the
 *  `fleetAssets` view key on. */
export const LIVE_LINE_STATUSES: ReadonlyArray<
  Enums["rentalAgreementLineStatus"]
> = ["Pending", "On Rent"];

/** Line statuses a unit can be returned from. A Pending line was never
 *  delivered: returning it just stops its billing at the return date. */
export const RETURNABLE_LINE_STATUSES: ReadonlySet<
  Enums["rentalAgreementLineStatus"]
> = new Set(["Pending", "On Rent"] as const);

/** Line statuses an agreement can close with. */
export const CLOSABLE_LINE_STATUSES: ReadonlySet<
  Enums["rentalAgreementLineStatus"]
> = new Set(["Returned", "Sold"] as const);

/** Asset statuses a unit can go on rent from (spec §2 "Fleet register":
 *  Available means Active / Fully Depreciated with nothing else holding it —
 *  the view's `fleetStatus` alone reads a Draft asset as Available). */
export const RENTABLE_ASSET_STATUSES: ReadonlySet<Enums["fixedAssetStatus"]> =
  new Set(["Active", "Fully Depreciated"] as const);

/** Activation generates periods to the same horizon the daily billing pass
 *  rolls forward to (`billingHorizon`, @carbon/utils). */
export { billingHorizon as activationThrough } from "@carbon/utils";

/** A NUMERIC rate as the billing math reads it: null stays null (no rate),
 *  anything else is a number. */
export function toRate(
  value: number | string | null | undefined
): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** What `fleetAssets` says about one unit a line names. */
export type FleetUnit = {
  fixedAssetId: string;
  status: Enums["fixedAssetStatus"] | null;
  fleetStatus: string | null;
  outOfServiceReason: string | null;
  /** Row id of the agreement holding the unit's live line, if any. */
  liveAgreementId: string | null;
  /** Readable number of that agreement. */
  liveAgreementReadableId: string | null;
};

/**
 * Why a unit cannot go on rent under `agreementId`, or null when it can.
 * The agreement's OWN Draft line is already Pending (the column default), so
 * the view reads the unit as `Reserved` by this very agreement — that is the
 * one Reserved state that is available here.
 */
export function unitAvailabilityError(
  unit: FleetUnit,
  agreementId: string
): string | null {
  const name = unit.fixedAssetId;
  const heldBySelf = unit.liveAgreementId === agreementId;
  switch (unit.fleetStatus) {
    case "On Rent":
    case "Reserved":
      if (heldBySelf && unit.fleetStatus === "Reserved") break;
      return `${name} is ${unit.fleetStatus} on rental agreement ${
        unit.liveAgreementReadableId ?? unit.liveAgreementId ?? "unknown"
      }`;
    case "In Maintenance":
      return `${name} is out of service: ${
        unit.outOfServiceReason ?? "no reason given"
      }`;
    case "Available":
      break;
    default:
      return `${name} is ${unit.fleetStatus ?? "unavailable"}`;
  }
  if (unit.status === null || !RENTABLE_ASSET_STATUSES.has(unit.status)) {
    return `${name} is ${
      unit.status ?? "not registered"
    }; only an Active or Fully Depreciated asset can go on rent`;
  }
  return null;
}

/** Why a unit cannot be activated at its rate, or null: a unit at no rate
 *  would go on rent and bill nothing. */
export function unpricedUnitError(name: string, rate: number): string | null {
  return rate > 0
    ? null
    : `${name} has no rate; enter its rate before activating`;
}

/** Why a unit cannot be returned on `returnedAt`, or null: a return records
 *  what has happened, so it is never dated after the company's today — an
 *  operating return would otherwise cut billing short ahead of time, and a
 *  sales-type one would close the lease before its last month. */
export function futureReturnError(
  returnedAt: string,
  today: string
): string | null {
  // `YYYY-MM-DD` compares chronologically as text.
  return returnedAt > today ? "The return date cannot be in the future" : null;
}

/** Why an Active agreement cannot close, or null when it can. */
export function closeBlocker(args: {
  lineStatuses: Enums["rentalAgreementLineStatus"][];
  pendingPeriods: number;
  unbilledCharges: number;
}): string | null {
  if (args.lineStatuses.some((status) => !CLOSABLE_LINE_STATUSES.has(status))) {
    return "Every unit must be returned or sold before the agreement closes";
  }
  if (args.pendingPeriods > 0) {
    return "Every billing period must be invoiced before the agreement closes";
  }
  if (args.unbilledCharges > 0) {
    return "Every charge must be invoiced before the agreement closes";
  }
  return null;
}

/** Why an agreement cannot be cancelled, or null when it can. A Draft always
 *  can; an Active one only while nothing is on rent, sold, billed or
 *  recognized — cancelling drops the unbilled periods, so anything a later
 *  document already relies on must not exist. A sales-type line that has
 *  commenced has already sold the unit (derecognized, lease revenue booked):
 *  unwinding that is an early termination, which v1 leaves to a manual
 *  journal. */
export function cancelBlocker(args: {
  status: Enums["rentalAgreementStatus"];
  lineStatuses: Enums["rentalAgreementLineStatus"][];
  invoicedPeriods: number;
  billedCharges: number;
  /** `revenueRecognitionSchedule` rows (accruals, interest) against the lines. */
  recognizedRows: number;
  /** Sales-type lines whose commencement was booked at activation. */
  commencedSalesTypeLines: number;
}): string | null {
  if (args.status === "Draft") return null;
  if (args.status !== "Active") {
    return `The agreement is ${args.status}`;
  }
  if (args.commencedSalesTypeLines > 0) {
    return "Ending a rental treated as a sale early is a manual journal";
  }
  if (args.lineStatuses.includes("On Rent")) {
    return "A unit is on rent; return it before cancelling the agreement";
  }
  if (args.lineStatuses.includes("Sold")) {
    return "A unit on this agreement was sold";
  }
  if (args.invoicedPeriods > 0 || args.billedCharges > 0) {
    return "The agreement has been invoiced; it can be closed, not cancelled";
  }
  if (args.recognizedRows > 0) {
    return "Rental income has been recognized on this agreement; it can be closed, not cancelled";
  }
  return null;
}

/** The unit's name in a refusal: its asset number, else its asset name, else the line id. */
export function unitLabel(
  asset: { fixedAssetId: string | null; name: string | null } | undefined,
  lineId: string
): string {
  return asset?.fixedAssetId || asset?.name || lineId;
}

/** Why a delivery cannot be dated `deliveredOn`, or null. */
export function futureDeliveryError(
  deliveredOn: string,
  today: string
): string | null {
  // `YYYY-MM-DD` compares chronologically as text.
  return deliveredOn > today
    ? "The delivery date cannot be in the future"
    : null;
}

/** Why a rental shipment cannot be voided, or null. `accrual` is the worst
 *  Accrual row of the unit: "Posted", "Draft run" (Planned with a runLineId), or null. */
export function rentalShipmentVoidBlocker(
  units: {
    label: string;
    status: Enums["rentalAgreementLineStatus"];
    accrual: "Posted" | "Draft run" | null;
  }[]
): string | null {
  const notOnRent = units.find((unit) => unit.status !== "On Rent");
  if (notOnRent) {
    return `${notOnRent.label} is ${notOnRent.status}; a rental shipment can be voided only while every unit is On Rent`;
  }
  for (const unit of units) {
    if (unit.accrual === "Posted") {
      return `A posted revenue recognition run holds accrued rent for ${unit.label}; the shipment cannot be voided`;
    }
    if (unit.accrual === "Draft run") {
      return `A draft revenue recognition run holds accrued rent for ${unit.label}; delete the run before voiding the shipment`;
    }
  }
  return null;
}

/** Why an agreement cannot close while a rental document is still open, or null. */
export function openRentalDocumentBlocker(args: {
  shipmentId: string | null; // readable id of an open shipment that has a line
  receiptId: string | null; // readable id of an open receipt that has a line
}): string | null {
  if (args.shipmentId) {
    return `Shipment ${args.shipmentId} is still open; post or delete it before closing the agreement`;
  }
  if (args.receiptId) {
    return `Receipt ${args.receiptId} is still open; post or delete it before closing the agreement`;
  }
  return null;
}

/** Why a unit on a rental receipt cannot be returned, or null.
 *  A receipt returns a Pending or an On Rent unit (spec Q8). */
export function receiptReturnError(
  label: string,
  status: Enums["rentalAgreementLineStatus"]
): string | null {
  return RETURNABLE_LINE_STATUSES.has(status)
    ? null
    : `${label} is ${status}; only a Pending or On Rent unit can be returned`;
}

/** Why a release date is refused, or null. */
export function futureReleaseError(
  releasedOn: string,
  today: string
): string | null {
  // `YYYY-MM-DD` compares chronologically as text.
  return releasedOn > today ? "The release date cannot be in the future" : null;
}

/** Why a unit cannot be released, or null (spec Q8, plan decisions P1 and P2). */
export function releaseBlocker(args: {
  label: string;
  status: Enums["rentalAgreementLineStatus"];
  classification: Enums["lessorClassification"] | null;
  openDocument: string | null; // e.g. "shipment SHP-000004" or "receipt RCV-000002"
}): string | null {
  if (args.status !== "Pending") {
    return `${args.label} is ${args.status}; only a Pending unit can be released`;
  }
  if (args.classification === "Sale") {
    return `${args.label} is treated as a sale; return it on a rental receipt instead`;
  }
  if (args.openDocument) {
    return `${args.label} is on ${args.openDocument}; remove it there before releasing the unit`;
  }
  return null;
}
