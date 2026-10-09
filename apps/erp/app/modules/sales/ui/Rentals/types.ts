// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  getRentableFleetAssets,
  getRentalAgreementCharges,
  getRentalAgreementDeposits,
  getRentalAgreementLines,
  getRentalAgreementRelatedDocuments,
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

/** A billed period's or charge's invoice, keyed by `salesInvoiceLineId`.
 *  `automationHoldReason` is set when the daily run left it as a draft. */
export type RentalInvoiceLinks = Record<
  string,
  {
    id: string;
    invoiceId: string | null;
    status: string | null;
    automationHoldReason: string | null;
  }
>;

/** What a Draft line is derecognized at, for the Activate preview: the
 *  fleet unit's book value. (It is priced at its own rate, on the line.) */
export type RentalLeaseLineInputs = {
  carryingAmount: number | null;
  acquisitionCost: number | null;
  accumulatedDepreciation: number | null;
};

type RelatedDocuments = NonNullable<
  Awaited<ReturnType<typeof getRentalAgreementRelatedDocuments>>["data"]
>;
export type RentalAgreementShipment = RelatedDocuments["shipments"][number];
export type RentalAgreementReceipt = RelatedDocuments["receipts"][number];

/** The shell route's loader data, read by every section through
 *  `useRouteData(path.to.rentalAgreement(id))`. */
export type RentalAgreementRouteData = {
  rentalAgreement: RentalAgreement;
  lines: RentalAgreementLine[];
  charges: RentalAgreementCharge[];
  periods: RentalBillingPeriod[];
  deposits: RentalAgreementDeposit[];
  shipments: RentalAgreementShipment[];
  receipts: RentalAgreementReceipt[];
  rentableAssets: RentableFleetAsset[];
  invoiceLinks: RentalInvoiceLinks;
  /** The customer contact's email; null when there is none to send to. */
  contactEmail: string | null;
  leasePolicy: LeasePolicy;
  /** Keyed by line id; Draft agreements only. */
  leaseInputs: Record<string, RentalLeaseLineInputs>;
};
