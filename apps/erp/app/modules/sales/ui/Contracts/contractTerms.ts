// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  ContractLineTerms,
  ContractPlannedInvoice,
  ContractTerms
} from "@carbon/utils";
import type {
  Contract,
  ContractCredit,
  ContractInvoice,
  ContractLine
} from "./types";

/** A contract row (the `customerContracts` view, whose columns are all
 *  nullable) as the pure planner's terms. */
export function toContractTerms(contract: Contract): ContractTerms {
  return {
    startDate: contract.startDate ?? "",
    endDate: contract.endDate ?? null,
    billingFrequency: contract.billingFrequency ?? "Month",
    billingAlignment: contract.billingAlignment ?? "Anniversary",
    billingTiming: contract.billingTiming ?? "Advance",
    firstInvoiceDate: contract.firstInvoiceDate ?? null,
    billedThrough: contract.billedThrough ?? null
  };
}

/** A contract line as the pure planner's line terms. `discountPercent` is
 *  the 0–1 fraction the column holds. */
export function toContractLineTerms(line: ContractLine): ContractLineTerms {
  return {
    id: line.id,
    kind: line.kind,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    rateUnit: line.rateUnit,
    discountPercent: Number(line.discountPercent),
    startDate: line.startDate,
    endDate: line.endDate
  };
}

/** One schedule row, wherever it came from: the live plan of an unedited
 *  Draft, a persisted planned invoice, or a cancellation credit (no invoice
 *  date — it is dated at the start of the period it credits). */
export type ContractScheduleRow = {
  lineId: string;
  invoiceDate: string;
  amount: number;
  isAdjustment: boolean;
};

export function scheduleRows({
  computedSchedule,
  schedule,
  credits
}: {
  computedSchedule: ContractPlannedInvoice[] | null;
  schedule: ContractInvoice[];
  credits: ContractCredit[];
}): ContractScheduleRow[] {
  if (computedSchedule) {
    return computedSchedule.flatMap((invoice) =>
      invoice.rows.map((row) => ({
        lineId: row.lineId,
        invoiceDate: invoice.invoiceDate,
        amount: row.amount,
        isAdjustment: row.isAdjustment
      }))
    );
  }
  return [
    ...schedule.flatMap((invoice) =>
      invoice.customerContractInvoiceLine.map((row) => ({
        lineId: row.customerContractLineId,
        invoiceDate: invoice.invoiceDate,
        amount: Number(row.amount),
        isAdjustment: row.isAdjustment
      }))
    ),
    ...credits.map((row) => ({
      lineId: row.customerContractLineId,
      invoiceDate: row.periodStart,
      amount: Number(row.amount),
      isAdjustment: row.isAdjustment
    }))
  ];
}
