// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  getLeaseEvents,
  getLeaseLines,
  getLeasePayments,
  getLeaseRelatedDocuments,
  getLeaseSchedule
} from "../../purchasing.service";

type Enums = Database["public"]["Enums"];

export type LeaseStatusType = Enums["leaseStatus"];
export type LeasePaymentStatusType = Enums["leasePaymentStatus"];
export type LeasePaymentTypeType = Enums["leasePaymentType"];
export type LesseeClassificationType = Enums["lesseeClassification"];
export type LeaseEventTypeType = Enums["leaseEventType"];

/** A lease as the `leases` view returns it: the row plus `supplierName`,
 *  `nextDueDate` and `currentLiability`. */
export type Lease = Database["public"]["Views"]["leases"]["Row"];

/** One leased asset: a separate lease component with its own payment,
 *  classification and measurement. */
export type LeaseLine = NonNullable<
  Awaited<ReturnType<typeof getLeaseLines>>["data"]
>[number];

export type LeaseLineStatusType = Enums["leaseLineStatus"];

export type LeasePayment = NonNullable<
  Awaited<ReturnType<typeof getLeasePayments>>["data"]
>[number];

export type LeaseScheduleLine = NonNullable<
  Awaited<ReturnType<typeof getLeaseSchedule>>["data"]
>[number];

export type LeaseEvent = NonNullable<
  Awaited<ReturnType<typeof getLeaseEvents>>["data"]
>[number];

type RelatedDocuments = NonNullable<
  Awaited<ReturnType<typeof getLeaseRelatedDocuments>>["data"]
>;
export type LeasePurchaseInvoice = RelatedDocuments["purchaseInvoices"][number];
export type LeaseJournal = RelatedDocuments["journals"][number];

/** The company's ASC 842 classification thresholds and the short-term
 *  election, as activation reads them. */
export type LeasePolicy = {
  majorPartPercent: number;
  substantiallyAllPercent: number;
  shortTermExpedient: boolean;
  /** A lease commenced before it opens with an opening balance. */
  accountingCutoverDate: string | null;
  /** The date that opening balance is struck on: the cutover, or the first
   *  open period after it (`post-lease` resolves it with
   *  `resolveAccountingPeriod`). The cutover when not given. */
  openingAsOf?: string | null;
};

/** The purchase invoice behind each invoiced payment row, keyed by the
 *  row's `purchaseInvoiceLineId`. */
export type LeasePaymentInvoiceLinks = Record<
  string,
  {
    id: string;
    invoiceId: string | null;
    status: Enums["purchaseInvoiceStatus"] | null;
  }
>;

/** The fixed assets the lease's events created, keyed by id. */
export type LeaseFixedAssets = Record<
  string,
  { id: string; fixedAssetId: string | null; name: string | null }
>;

/** The shell route's loader data, read by every section through
 *  `useRouteData(path.to.lease(id))`. */
export type LeaseRouteData = {
  lease: Lease;
  lines: LeaseLine[];
  payments: LeasePayment[];
  schedule: LeaseScheduleLine[];
  events: LeaseEvent[];
  purchaseInvoices: LeasePurchaseInvoice[];
  journals: LeaseJournal[];
  paymentInvoices: LeasePaymentInvoiceLinks;
  fixedAssets: LeaseFixedAssets;
  leasePolicy: LeasePolicy;
};
