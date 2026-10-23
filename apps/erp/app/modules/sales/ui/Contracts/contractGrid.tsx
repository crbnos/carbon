// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import type { z } from "zod";
import {
  contractLineBillingFormValues,
  type customerContractLineValidator,
  newContractLineBillingValues
} from "../../sales.models";
import type { Contract, ContractLine } from "./types";

type ContractLineFormValues = z.infer<typeof customerContractLineValidator>;

/** A contract line as a column header or a row label: its description, else
 *  its service item's name. */
export function contractLineName(line: ContractLine) {
  return line.description || line.item?.name || line.itemId;
}

/** The editable cells' column key for the line at `index`. Line ids are not
 *  used: the Table treats a key with `_` as a nested path. */
export const lineColumnKey = (index: number) => `line${index}`;

/** A stored line as the line form's values: discount, tax and the billing
 *  percents in percent points. */
export function contractLineFormValues(
  line: ContractLine
): ContractLineFormValues {
  return {
    id: line.id,
    customerContractId: line.customerContractId,
    revenueType: line.revenueType,
    itemId: line.itemId,
    description: line.description ?? undefined,
    quantity: Number(line.quantity),
    rate: Number(line.rate),
    rateUnit: line.rateUnit ?? undefined,
    discountPercent: round(Number(line.discountPercent) * 100),
    discountEndsOn: line.discountEndsOn ?? undefined,
    taxPercent: round(Number(line.taxPercent) * 100),
    startDate: line.startDate,
    endDate: line.endDate ?? undefined,
    goLiveDate: line.goLiveDate ?? undefined,
    revenueMethod: line.revenueMethod,
    revenueStartDate: line.revenueStartDate ?? undefined,
    revenueEndDate: line.revenueEndDate ?? undefined,
    projectId: line.projectId ?? undefined,
    lineItemNumber: line.lineItemNumber ?? undefined,
    parentLineId: line.parentLineId ?? undefined,
    ...contractLineBillingFormValues(line)
  };
}

/** A new line's values. A service contract's line is Recurring, billed per
 *  the contract's frequency; a project contract's line is a One-time Time &
 *  Materials line on the contract's project. */
export function newContractLineFormValues(
  contract: Contract
): ContractLineFormValues {
  const isProject = contract.billingBasis === "Project";
  return {
    customerContractId: contract.id!,
    revenueType: isProject ? "One-time" : "Recurring",
    itemId: "",
    description: "",
    quantity: 1,
    rate: 0,
    // Every billing frequency is also a rate unit.
    rateUnit: isProject ? undefined : (contract.billingFrequency ?? "Month"),
    discountPercent: 0,
    taxPercent: 0,
    startDate: contract.startDate ?? "",
    revenueMethod: isProject ? "Right to Invoice" : "Daily",
    projectId: contract.projectId ?? undefined,
    ...newContractLineBillingValues,
    billingMethod: isProject ? "Time & Materials" : "Fixed"
  };
}
