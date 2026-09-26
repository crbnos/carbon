import type { Database } from "@carbon/database";
import type { RateLadder } from "@carbon/utils";
import type {
  getRentableFleetAssets,
  getRentalAgreementCharges,
  getRentalAgreementDeposits,
  getRentalAgreementLines,
  getRentalBillingPeriods
} from "../../sales.service";
import type { LeasePolicy } from "../../sales.utils";

type Enums = Database["public"]["Enums"];

export type RentalAgreementStatusType = Enums["rentalAgreementStatus"];
export type RentalAgreementLineStatusType = Enums["rentalAgreementLineStatus"];
export type RentalBillingPeriodStatusType = Enums["rentalBillingPeriodStatus"];

export type RentalAgreement =
  Database["public"]["Views"]["rentalAgreements"]["Row"];

export type RentalAgreementListItem = RentalAgreement;

export type RentalAgreementLine = NonNullable<
  Awaited<ReturnType<typeof getRentalAgreementLines>>["data"]
>[number];

export type RentalAgreementCharge = NonNullable<
  Awaited<ReturnType<typeof getRentalAgreementCharges>>["data"]
>[number];

export type RentalBillingPeriod = NonNullable<
  Awaited<ReturnType<typeof getRentalBillingPeriods>>["data"]
>[number];

export type RentalAgreementDeposit = NonNullable<
  Awaited<ReturnType<typeof getRentalAgreementDeposits>>["data"]
>[number];

export type RentableFleetAsset = NonNullable<
  Awaited<ReturnType<typeof getRentableFleetAssets>>["data"]
>[number];

/** A billed period's or charge's invoice, keyed by `salesInvoiceLineId`. */
export type RentalInvoiceLinks = Record<
  string,
  { id: string; invoiceId: string | null }
>;

/** What a Draft line is priced and derecognized at, for the Activate
 *  preview: the item's current rate ladder and the fleet unit's book value. */
export type RentalLeaseLineInputs = {
  ladder: RateLadder | null;
  carryingAmount: number | null;
  acquisitionCost: number | null;
  accumulatedDepreciation: number | null;
};

/** The shell route's loader data, read by every section through
 *  `useRouteData(path.to.rentalAgreement(id))`. */
export type RentalAgreementRouteData = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  charges: RentalAgreementCharge[];
  periods: RentalBillingPeriod[];
  deposits: RentalAgreementDeposit[];
  rentableAssets: RentableFleetAsset[];
  invoiceLinks: RentalInvoiceLinks;
  leasePolicy: LeasePolicy;
  /** Keyed by line id; Draft agreements only. */
  leaseInputs: Record<string, RentalLeaseLineInputs>;
};
