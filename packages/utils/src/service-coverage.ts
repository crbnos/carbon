// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Who pays for a charge on a service order. Shared by the ERP service module and
// the posting server functions, so the order page and the journal agree.
// Spec: .ai/specs/2026-10-08-field-service.md (Coverage).

import type { Database } from "@carbon/database";

export type ServiceCoverage = Database["public"]["Enums"]["serviceCoverage"];
export type ServiceOrderType = Database["public"]["Enums"]["serviceOrderType"];
export type CoverageChargeType = "Time" | "Part" | "Expense";

/** A date is covered when it is on or before the warranty end (`YYYY-MM-DD`). */
function onOrBefore(date: string, end: string | null): boolean {
  return end !== null && date <= end;
}

/**
 * The coverage of one charge, decided when it posts:
 * 1. A Refurbishment works on company stock: every charge is Capitalized.
 * 2. Warranty, when time falls inside the asset's labor warranty, or a part
 *    inside the asset's parts warranty or the warranty of the installed
 *    component it replaces. An expense is never covered by warranty.
 * 3. Else Contract, when the order names a coverage contract.
 * 4. Else Billable.
 *
 * Dates are `YYYY-MM-DD` strings (the columns are DATE), so string order is
 * date order.
 */
export function resolveCoverage(args: {
  chargeType: CoverageChargeType;
  /** YYYY-MM-DD */
  serviceDate: string;
  orderType: ServiceOrderType;
  laborWarrantyEndDate: string | null;
  partsWarrantyEndDate: string | null;
  /** The parts warranty end of the node's installed component. */
  componentPartsWarrantyEndDate: string | null;
  hasCoverageContract: boolean;
}): ServiceCoverage {
  if (args.orderType === "Refurbishment") return "Capitalized";

  if (
    args.chargeType === "Time" &&
    onOrBefore(args.serviceDate, args.laborWarrantyEndDate)
  ) {
    return "Warranty";
  }

  if (
    args.chargeType === "Part" &&
    (onOrBefore(args.serviceDate, args.partsWarrantyEndDate) ||
      onOrBefore(args.serviceDate, args.componentPartsWarrantyEndDate))
  ) {
    return "Warranty";
  }

  if (args.hasCoverageContract) return "Contract";
  return "Billable";
}

/**
 * The ledger rows of a project that still stand: a row that is not a reversal
 * and that no other row reverses. A void, a timesheet correction, a part return
 * and an expense reversal each write a row whose `reversalOfId` names the row it
 * undoes. A coverage reclass reverses the old row and writes a new one, and the
 * new one stands until it is reversed in turn.
 */
export function openChargeIds(
  rows: ReadonlyArray<{ id: string; reversalOfId: string | null }>
): string[] {
  const reversed = new Set(
    rows
      .map((row) => row.reversalOfId)
      .filter((id): id is string => Boolean(id))
  );
  return rows
    .filter((row) => !row.reversalOfId && !reversed.has(row.id))
    .map((row) => row.id);
}
