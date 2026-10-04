// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  ContractPlannedInvoice,
  ContractPositionMonth,
  RevenueMonth
} from "@carbon/utils";
import type {
  getContractAmendments,
  getContractInvoiceSchedule,
  getContractLines
} from "../../sales.service";

type Enums = Database["public"]["Enums"];

export type ContractStatusType = Enums["customerContractStatus"];
export type ContractType = Enums["customerContractType"];
export type ContractLineKind = Enums["customerContractLineKind"];
export type ContractInvoiceStatusType = Enums["contractInvoiceStatus"];

export type Contract = Database["public"]["Views"]["customerContracts"]["Row"];

export type ContractListItem = Contract;

export type ContractLine = NonNullable<
  Awaited<ReturnType<typeof getContractLines>>["data"]
>[number];

type ContractInvoiceScheduleData = NonNullable<
  Awaited<ReturnType<typeof getContractInvoiceSchedule>>["data"]
>;

/** A persisted planned invoice, with its lines. */
export type ContractInvoice = ContractInvoiceScheduleData["invoices"][number];

/** A schedule row on a cancellation credit memo rather than an invoice. */
export type ContractCredit = ContractInvoiceScheduleData["credits"][number];

export type ContractAmendment = NonNullable<
  Awaited<ReturnType<typeof getContractAmendments>>["data"]
>[number];

/** The Revenue section's preview (Phase A): each line's monthly revenue and
 *  the month-by-month invoiced / recognized / deferred position. */
export type ContractRevenue = {
  lines: RevenueMonth[];
  position: ContractPositionMonth[];
};

/** The shell route's loader data, read by every section through
 *  `useRouteData(path.to.contract(id))`. */
export type ContractRouteData = {
  contract: Contract;
  lines: ContractLine[];
  /** The persisted schedule; empty for an unedited Draft. */
  schedule: ContractInvoice[];
  credits: ContractCredit[];
  amendments: ContractAmendment[];
  /** The schedule planned live from the lines while a Draft has none
   *  persisted; null once it is persisted. */
  computedSchedule: ContractPlannedInvoice[] | null;
  /** Per line: computed total − Σ its scheduled amounts, for an edited Draft.
   *  A non-zero value offers Reset schedule. */
  residuals: Record<string, number>;
  revenue: ContractRevenue;
};
