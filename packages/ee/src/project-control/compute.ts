// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { equals, round } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { IndirectPoolType } from "../indirect-rates/models";
import type { AcwpElement, EarnedValueTechnique } from "./models";

// The pure project control engine (Phase 5c): budget availability now, earned
// value in the functions below it. No database access, so the client-safe
// barrel can export it.

/** The element fields the budget check reads. */
export type ElementNode = {
  id: string;
  parentId: string | null;
  budget: number | null;
};

/**
 * The element itself, else its nearest ancestor with a budget. Null when none
 * has one. A budget of 0 is a budget. A parent loop stops the walk.
 */
export function nearestBudgetedAncestor(
  elementId: string,
  elements: ElementNode[]
): string | null {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set<string>();
  let current = byId.get(elementId);
  while (current && !seen.has(current.id)) {
    if (current.budget !== null) return current.id;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

/** The root and every descendant. */
export function subtreeIds(rootId: string, elements: ElementNode[]): string[] {
  const children = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const siblings = children.get(element.parentId) ?? [];
    siblings.push(element.id);
    children.set(element.parentId, siblings);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return ids;
}

/**
 * Compares a budget with its committed and actual cost plus a new amount.
 * The limit is the budget plus the tolerance, a fraction of the budget.
 */
export function budgetAvailability(input: {
  budget: number;
  committed: number;
  actual: number;
  newAmount: number;
  tolerancePercent: number;
}): { limit: number; projected: number; overBy: number; over: boolean } {
  const limit = input.budget * (1 + input.tolerancePercent);
  const projected = input.committed + input.actual + input.newAmount;
  const over = projected > limit && !equals(projected, limit);
  const overBy = Math.max(0, round(projected - limit));
  return { limit, projected, overBy, over };
}

// ── Earned value (decisions C7–C12, C17) ─────────────────────────────────

/** The days from `start` to `end`, both included. */
function daysInclusive(start: string, end: string): number {
  return parseDate(end).compare(parseDate(start)) + 1;
}

/** The 0/100 rule for BCWS: all of BAC once the period end reaches `end`. */
function zeroHundredPlanned(
  bac: number,
  end: string | null,
  periodEnd: string
): number {
  return end && periodEnd >= end ? bac : 0;
}

export type PlannedInput = {
  technique: EarnedValueTechnique;
  bac: number;
  /** The baseline dates, `YYYY-MM-DD`. */
  start: string | null;
  end: string | null;
  periodEnd: string;
  /** The baseline children of a Milestone work package (C9). */
  milestones: { budget: number; targetDate: string | null }[];
};

/**
 * The cumulative BCWS at `periodEnd` (C10). Dates are `YYYY-MM-DD`, so
 * string order is date order. A Milestone work package with budgeted
 * milestones places its BCWS by their target dates. Every other case needs
 * both baseline dates and returns 0 without them.
 */
export function plannedValue(input: PlannedInput): number {
  const { technique, bac, start, end, periodEnd } = input;

  if (technique === "Milestone") {
    const total = input.milestones.reduce((sum, m) => sum + m.budget, 0);
    if (total > 0) {
      const due = input.milestones
        .filter((m) => m.targetDate !== null && m.targetDate <= periodEnd)
        .reduce((sum, m) => sum + m.budget, 0);
      return round((bac * due) / total);
    }
  }

  if (!start || !end) return 0;

  switch (technique) {
    case "0/100":
    case "Milestone":
      return zeroHundredPlanned(bac, end, periodEnd);
    case "50/50":
      if (periodEnd >= end) return bac;
      return periodEnd >= start ? round(bac / 2) : 0;
    case "Percent Complete":
    case "Level of Effort":
    case "Apportioned": {
      const total = daysInclusive(start, end);
      if (total <= 0) return zeroHundredPlanned(bac, end, periodEnd);
      const elapsed = Math.min(
        Math.max(daysInclusive(start, periodEnd), 0),
        total
      );
      return round((bac * elapsed) / total);
    }
  }
}

export type EarnedInput = {
  technique: EarnedValueTechnique;
  bac: number;
  bcws: number;
  stateGroup: "Backlog" | "Unstarted" | "Started" | "Completed" | "Cancelled";
  /** `projectElement.earnedValuePercent`, a fraction (C8). */
  percent: number | null;
  milestones: { budget: number; completed: boolean }[];
  apportioned: { factor: number; baseBcwp: number } | null;
};

/** The cumulative BCWP (C10). */
export function earnedValue(input: EarnedInput): number {
  const { technique, bac, stateGroup } = input;
  const zeroHundred = stateGroup === "Completed" ? bac : 0;

  switch (technique) {
    case "0/100":
      return round(zeroHundred);
    case "50/50":
      if (stateGroup === "Completed") return round(bac);
      return stateGroup === "Started" ? round(bac / 2) : 0;
    case "Percent Complete":
      return round(bac * (input.percent ?? 0));
    case "Milestone": {
      const total = input.milestones.reduce((sum, m) => sum + m.budget, 0);
      if (total <= 0) return round(zeroHundred);
      const done = input.milestones
        .filter((m) => m.completed)
        .reduce((sum, m) => sum + m.budget, 0);
      return round((bac * done) / total);
    }
    case "Level of Effort":
      return round(input.bcws);
    case "Apportioned":
      return input.apportioned
        ? round(input.apportioned.factor * input.apportioned.baseBcwp)
        : 0;
  }
}

export type PerformanceIndexes = {
  cv: number;
  sv: number;
  cpi: number | null;
  spi: number | null;
  eac: number;
  vac: number;
};

/**
 * Cost and schedule variances, CPI and SPI at the internal scale, and EAC by
 * the CPI method (C17). Without ACWP, CPI has no value and EAC equals BAC.
 */
export function performanceIndexes(input: {
  bac: number;
  bcws: number;
  bcwp: number;
  acwp: number;
}): PerformanceIndexes {
  const { bac, bcws, bcwp, acwp } = input;
  const cpiExact = acwp === 0 ? null : bcwp / acwp;
  const spiExact = bcws === 0 ? null : bcwp / bcws;
  const eac =
    cpiExact === null || cpiExact === 0
      ? bac
      : round(acwp + (bac - bcwp) / cpiExact);
  return {
    cv: round(bcwp - acwp),
    sv: round(bcwp - bcws),
    cpi: cpiExact === null ? null : round(cpiExact),
    spi: spiExact === null ? null : round(spiExact),
    eac,
    vac: round(bac - eac)
  };
}

type ProjectCostType = Database["public"]["Enums"]["projectCostType"];

const ACWP_ELEMENT_BY_COST_TYPE: Record<
  Exclude<ProjectCostType, "Burden">,
  AcwpElement
> = {
  Labor: "Labor",
  Material: "Material",
  "Material Variance": "Material",
  "Payback Variance": "Material",
  "Outside Processing": "Subcontract",
  "Purchased Service": "Subcontract",
  Machine: "Other Direct",
  Overhead: "Other Direct",
  "Other Direct": "Other Direct"
};

/**
 * The ACWP element of cost of a ledger row (C11). A Burden row goes to G&A
 * for a G&A pool, else to Overhead. v1 does not split Travel.
 */
export function acwpElementFor(
  costType: ProjectCostType,
  poolType: IndirectPoolType | null
): AcwpElement {
  if (costType === "Burden") return poolType === "G&A" ? "G&A" : "Overhead";
  return ACWP_ELEMENT_BY_COST_TYPE[costType];
}

export type WorkPackageValues = {
  controlAccountId: string;
  bac: number;
  bcws: number;
  bcwp: number;
  acwp: number;
  acwpHours: number;
};

export type ControlAccountValues = WorkPackageValues & PerformanceIndexes;

/**
 * Sums the work packages of each control account, then adds the performance
 * indexes. Control accounts keep the order of their first work package.
 */
export function rollUpControlAccounts(
  packages: WorkPackageValues[]
): ControlAccountValues[] {
  const sums = new Map<string, WorkPackageValues>();
  for (const pkg of packages) {
    const sum = sums.get(pkg.controlAccountId) ?? {
      controlAccountId: pkg.controlAccountId,
      bac: 0,
      bcws: 0,
      bcwp: 0,
      acwp: 0,
      acwpHours: 0
    };
    sum.bac += pkg.bac;
    sum.bcws += pkg.bcws;
    sum.bcwp += pkg.bcwp;
    sum.acwp += pkg.acwp;
    sum.acwpHours += pkg.acwpHours;
    sums.set(pkg.controlAccountId, sum);
  }
  return [...sums.values()].map((sum) => {
    const totals = {
      controlAccountId: sum.controlAccountId,
      bac: round(sum.bac),
      bcws: round(sum.bcws),
      bcwp: round(sum.bcwp),
      acwp: round(sum.acwp),
      acwpHours: round(sum.acwpHours)
    };
    return { ...totals, ...performanceIndexes(totals) };
  });
}

export type MaterialReceipt = {
  projectElementId: string | null;
  itemId: string;
  postingDate: string;
  quantity: number;
  amount: number;
};

export type MaterialIssue = {
  itemId: string;
  postingDate: string;
  /** A positive quantity. */
  quantity: number;
};

/**
 * The material point of measurement Issue (C12). Per item, the issues on or
 * before `periodEnd` consume the receipts on or before it, oldest receipt
 * first, by quantity. Returns the recognized amount per element: the quantity
 * issued × the receipt's amount ÷ its quantity. The key of a receipt with no
 * element is null.
 */
export function holdUntilIssued(
  receipts: MaterialReceipt[],
  issues: MaterialIssue[],
  periodEnd: string
): Map<string | null, number> {
  const issuedByItem = new Map<string, number>();
  for (const issue of issues) {
    if (issue.postingDate > periodEnd) continue;
    issuedByItem.set(
      issue.itemId,
      (issuedByItem.get(issue.itemId) ?? 0) + issue.quantity
    );
  }

  const ordered = receipts
    .map((receipt, index) => ({ receipt, index }))
    .filter(({ receipt }) => receipt.postingDate <= periodEnd)
    .sort(
      (a, b) =>
        a.receipt.postingDate.localeCompare(b.receipt.postingDate) ||
        a.index - b.index
    );

  const recognized = new Map<string | null, number>();
  for (const { receipt } of ordered) {
    const left = issuedByItem.get(receipt.itemId) ?? 0;
    if (left <= 0 || receipt.quantity <= 0) continue;
    const taken = Math.min(left, receipt.quantity);
    issuedByItem.set(receipt.itemId, left - taken);
    const key = receipt.projectElementId;
    recognized.set(
      key,
      (recognized.get(key) ?? 0) + (taken * receipt.amount) / receipt.quantity
    );
  }
  for (const [key, amount] of recognized) recognized.set(key, round(amount));
  return recognized;
}
