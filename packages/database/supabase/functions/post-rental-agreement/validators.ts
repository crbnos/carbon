import z from "npm:zod@^4.5.4";
import type { Database } from "../lib/types.ts";
import type { RateLadder } from "../shared/rental-billing.ts";

/**
 * Payload contract and pure helpers for `post-rental-agreement`. No I/O and
 * no imports beyond zod, the generated types and the pure date / billing
 * modules, so `deno test` type-checks this module clean and the edge
 * function's decisions can be pinned without a database.
 */

type Enums = Database["public"]["Enums"];

// Calendar dates travel as `YYYY-MM-DD` text end to end: the line and the
// billing periods store DATE columns, and a JavaScript Date would shift the
// day by the runtime timezone.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

const scope = {
  companyId: z.string().min(1),
  userId: z.string().min(1),
  rentalAgreementId: z.string().min(1),
};

/** Draft → Active: validate the units, snapshot rates, cut the first periods. */
export const activateValidator = z.object({
  type: z.literal("activate"),
  ...scope,
});

/** Where a sales-type unit goes when it comes back at the end of the term. */
export const RESIDUAL_DESTINATIONS = ["Fleet", "Inventory"] as const;
export type ResidualDestination = (typeof RESIDUAL_DESTINATIONS)[number];

/** A unit comes back: re-cut its billing, optionally straight to maintenance.
 *  `residualDestination` is where a SALES-TYPE unit goes at the end of its
 *  term — a new Rental Fleet asset, or stock — and is required for such a
 *  line (the function refuses without it); an operating return ignores it. */
export const returnValidator = z
  .object({
    type: z.literal("return"),
    rentalAgreementLineId: z.string().min(1),
    returnedAt: calendarDate,
    meterIn: z.number().min(0).optional().nullable(),
    returnNotes: z.string().optional().nullable(),
    takeOutOfService: z.boolean().optional(),
    outOfServiceReason: z.string().optional().nullable(),
    residualDestination: z.enum(RESIDUAL_DESTINATIONS).optional().nullable(),
    ...scope,
  })
  .refine(
    (data) =>
      !data.takeOutOfService || !!data.outOfServiceReason?.trim(),
    {
      message: "A reason is required to take the unit out of service",
      path: ["outOfServiceReason"],
    },
  );

/** Every unit is back (or sold) and everything is billed. */
export const closeValidator = z.object({
  type: z.literal("close"),
  ...scope,
});

/** Nothing delivered and nothing billed: the agreement is void. */
export const cancelValidator = z.object({
  type: z.literal("cancel"),
  ...scope,
});

export const payloadValidator = z.discriminatedUnion("type", [
  activateValidator,
  returnValidator,
  closeValidator,
  cancelValidator,
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
export const RENTABLE_ASSET_STATUSES: ReadonlySet<
  Enums["fixedAssetStatus"]
> = new Set(["Active", "Fully Depreciated"] as const);

/** Activation generates periods to the same horizon the daily billing pass
 *  rolls forward to (`billingHorizon`, shared/rental-billing.ts). */
export { billingHorizon as activationThrough } from "../shared/rental-billing.ts";

/**
 * Why a line's snapshotted rates cannot bill its agreement's cycle, or null
 * when they can. A Calendar Month agreement prices every period off the month
 * tier; a 28 Days agreement needs at least one tier; a Fixed line needs the
 * tier it bills.
 */
export function rateLadderError(args: {
  cycle: Enums["rentalBillingCycle"];
  rateMode: Enums["rentalRateMode"];
  rateUnit: Enums["rentalRateUnit"] | null;
  rates: RateLadder;
}): string | null {
  const { cycle, rateMode, rateUnit, rates } = args;
  if (cycle === "Calendar Month" && rates.monthRate === null) {
    return "needs a month rate for a Calendar Month agreement";
  }
  if (
    cycle === "28 Days" &&
    rates.dayRate === null &&
    rates.weekRate === null &&
    rates.monthRate === null
  ) {
    return "needs at least one rental rate";
  }
  if (rateMode === "Fixed") {
    if (rateUnit === null) return "is Fixed but names no rate unit";
    const tier = rateUnit === "Day"
      ? rates.dayRate
      : rateUnit === "Week"
      ? rates.weekRate
      : rates.monthRate;
    if (tier === null) {
      return `bills the ${rateUnit.toLowerCase()} rate but the item has none`;
    }
  }
  return null;
}

/** A NUMERIC rate as the billing math reads it: null stays "tier not
 *  offered", anything else is a number. */
export function toRate(value: number | string | null | undefined): number | null {
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
  agreementId: string,
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

/** Why a unit cannot be returned on `returnedAt`, or null: a return records
 *  what has happened, so it is never dated after the company's today — an
 *  operating return would otherwise cut billing short ahead of time, and a
 *  sales-type one would close the lease before its last month. */
export function futureReturnError(
  returnedAt: string,
  today: string,
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
    return "Early termination of a sales-type lease is a manual journal";
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
