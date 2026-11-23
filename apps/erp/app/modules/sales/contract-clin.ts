// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Invoice by CLIN (DFARS 252.204-7006): a project billing invoice shows a
// separate amount per contract line item number, and allocates each CLIN's
// amount to its ACRNs, oldest funds first (PGI 204.7108). Pure, so the
// invoice and its test agree.
// Plan: .ai/plans/2026-10-09-government-contracting-phase-5a.md (Task 27).
// Used by `createProjectBillingInvoices` (sales.service.ts).

import { round } from "@carbon/database/precision";
import { allocateToAcrns, moneyFormatOptions } from "@carbon/utils";

/** One ACRN of a contract line: what it funds and what it has billed. */
export type AcrnPosition = {
  acrn: string;
  firstFundedDate: string;
  funded: number;
  billed: number;
};

export type ClinContractLine = {
  id: string;
  lineItemNumber: string | null;
  /** The line's description, else its item's name. */
  description: string;
};

export type ClinSection<L> =
  | { type: "comment"; description: string }
  | { type: "line"; line: L };

export type ClinAllocation = {
  customerContractLineId: string;
  acrn: string;
  amount: number;
};

/**
 * Orders a project billing invoice by CLIN.
 *
 * 1. The planned lines are grouped by contract line.
 * 2. The groups are ordered by `lineItemNumber`. Groups with no number come
 *    last, in their current order.
 * 3. A numbered group gets a comment line before it:
 *    "CLIN 0001AA — <description>: <amount>", with the ACRN split.
 * 4. A numbered group's amount is allocated to its ACRNs with
 *    `allocateToAcrns`.
 *
 * With no number on any line, the lines come back unchanged and nothing is
 * allocated.
 */
export function planClinSections<
  L extends {
    customerContractLineId: string;
    quantity: number;
    unitPrice: number;
  }
>(
  lines: L[],
  contractLines: ClinContractLine[],
  acrnsByLine: Map<string, AcrnPosition[]>,
  options: { decimalPlaces: number }
): { sections: ClinSection<L>[]; allocations: ClinAllocation[] } {
  const lineById = new Map(contractLines.map((line) => [line.id, line]));
  const format = new Intl.NumberFormat(
    "en-US",
    moneyFormatOptions(options.decimalPlaces)
  );

  const groups: { contractLineId: string; lines: L[] }[] = [];
  const groupByLine = new Map<string, { contractLineId: string; lines: L[] }>();
  for (const line of lines) {
    let group = groupByLine.get(line.customerContractLineId);
    if (!group) {
      group = { contractLineId: line.customerContractLineId, lines: [] };
      groupByLine.set(line.customerContractLineId, group);
      groups.push(group);
    }
    group.lines.push(line);
  }

  const numberOf = (group: { contractLineId: string }) =>
    lineById.get(group.contractLineId)?.lineItemNumber ?? null;
  const numbered = groups
    .filter((group) => numberOf(group) !== null)
    .sort((a, b) => numberOf(a)!.localeCompare(numberOf(b)!));
  const unnumbered = groups.filter((group) => numberOf(group) === null);

  const sections: ClinSection<L>[] = [];
  const allocations: ClinAllocation[] = [];
  for (const group of numbered) {
    const contractLine = lineById.get(group.contractLineId)!;
    // The group's net, as `insertDraftContractInvoice` totals its lines.
    const amount = round(
      group.lines.reduce(
        (sum, line) => sum + round(line.quantity * line.unitPrice),
        0
      )
    );
    const { allocations: split, unallocated } = allocateToAcrns(
      amount,
      acrnsByLine.get(group.contractLineId) ?? []
    );
    const parts = split.map(
      (allocation) =>
        `ACRN ${allocation.acrn} ${format.format(allocation.amount)}`
    );
    if (split.length > 0 && unallocated !== 0) {
      parts.push(`Unallocated ${format.format(unallocated)}`);
    }
    const acrnText = parts.length > 0 ? ` (${parts.join("; ")})` : "";
    sections.push({
      type: "comment",
      description: `CLIN ${contractLine.lineItemNumber} — ${contractLine.description}: ${format.format(amount)}${acrnText}`
    });
    for (const line of group.lines) sections.push({ type: "line", line });
    for (const allocation of split) {
      allocations.push({
        customerContractLineId: group.contractLineId,
        acrn: allocation.acrn,
        amount: allocation.amount
      });
    }
  }
  for (const group of unnumbered) {
    for (const line of group.lines) sections.push({ type: "line", line });
  }

  return { sections, allocations };
}

/**
 * Each line's ACRN positions: the funding of each ACRN (cost + fee, first
 * funded date) less what invoices that are not Voided allocated to it.
 */
export function acrnPositions(
  funding: {
    customerContractLineId: string;
    acrn: string;
    fundedDate: string;
    fundedCost: number;
    fundedFee: number;
  }[],
  billed: { customerContractLineId: string; acrn: string; amount: number }[]
): Map<string, AcrnPosition[]> {
  const byLine = new Map<string, Map<string, AcrnPosition>>();
  for (const row of funding) {
    let acrns = byLine.get(row.customerContractLineId);
    if (!acrns) {
      acrns = new Map();
      byLine.set(row.customerContractLineId, acrns);
    }
    const position = acrns.get(row.acrn);
    const funded = Number(row.fundedCost) + Number(row.fundedFee);
    if (!position) {
      acrns.set(row.acrn, {
        acrn: row.acrn,
        firstFundedDate: row.fundedDate,
        funded,
        billed: 0
      });
    } else {
      position.funded += funded;
      if (row.fundedDate < position.firstFundedDate) {
        position.firstFundedDate = row.fundedDate;
      }
    }
  }
  for (const row of billed) {
    const position = byLine.get(row.customerContractLineId)?.get(row.acrn);
    if (position) position.billed += Number(row.amount);
  }
  return new Map(
    [...byLine].map(([lineId, acrns]) => [lineId, [...acrns.values()]])
  );
}
