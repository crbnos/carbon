// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Project billing on a customer contract line: bill rates, Time & Materials
// prices, funding, notices and invoice grouping. Pure, so posting, the
// invoicing source, the funding check and their tests agree.
// Spec: `.ai/specs/implemented/2026-10-09-project-billing.md` (Phase 4a)

import type { Database } from "@carbon/database";
import { equals, RoundingMode, round } from "@carbon/database/precision";
import { parseDate } from "@internationalized/date";
import { recurringHoldRebill } from "./contract-invoice-plan";
import type { InvoiceAutomation } from "./rental-invoice-plan";

type ProjectCostType = Database["public"]["Enums"]["projectCostType"];
type ContractBillingMethod =
  Database["public"]["Enums"]["contractBillingMethod"];

export const BILLABLE_REASON_NO_BILL_RATE = "No bill rate";
export const BILLABLE_REASON_NO_HOURS = "No hours";
export const BILLABLE_REASON_FUNDING_LIMIT = "Funding limit";

export const PROJECT_HOLD_CREDIT = "Includes a credit for a reversed charge";

/** `projectCostType` in enum order: the order of an invoice's non-labor lines. */
export const PROJECT_COST_TYPE_ORDER = [
  "Material",
  "Labor",
  "Machine",
  "Overhead",
  "Outside Processing",
  "Purchased Service",
  "Other Direct",
  "Material Variance",
  "Payback Variance",
  "Burden"
] as const satisfies readonly ProjectCostType[];

/** Cost types a Time & Materials line never bills: its bill rate is loaded. */
const LOADED_COST_TYPES: ReadonlySet<ProjectCostType> = new Set([
  "Machine",
  "Overhead",
  "Burden"
]);

type Dated = { effectiveFrom: string };

/** The newest row effective on `date` (`YYYY-MM-DD` string order). */
function newestOn<T extends Dated>(rows: T[], date: string): T | null {
  let found: T | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > date) continue;
    if (!found || row.effectiveFrom > found.effectiveFrom) found = row;
  }
  return found;
}

/**
 * The bill rate of one hour on `date`, most specific first: the contract
 * line's rate for the employee, then its rate for the labor category, then
 * the labor category's default bill rate. Null when none is set.
 */
export function resolveBillRate(args: {
  date: string;
  employeeId: string | null;
  laborCategoryId: string | null;
  contractRates: {
    employeeId: string | null;
    laborCategoryId: string | null;
    billRate: number;
    effectiveFrom: string;
  }[];
  categoryRates: {
    laborCategoryId: string;
    billRate: number | null;
    effectiveFrom: string;
  }[];
}): number | null {
  const { date, employeeId, laborCategoryId } = args;

  if (employeeId) {
    const rate = newestOn(
      args.contractRates.filter((r) => r.employeeId === employeeId),
      date
    );
    if (rate) return Number(rate.billRate);
  }

  if (laborCategoryId) {
    const rate = newestOn(
      args.contractRates.filter(
        (r) => r.employeeId === null && r.laborCategoryId === laborCategoryId
      ),
      date
    );
    if (rate) return Number(rate.billRate);

    const category = newestOn(
      args.categoryRates.filter((r) => r.laborCategoryId === laborCategoryId),
      date
    );
    if (category && category.billRate !== null) {
      return Number(category.billRate);
    }
  }

  return null;
}

export type PricedBillableItem = {
  quantity: number;
  unitPrice: number;
  amount: number;
  status: "Unbilled" | "On Hold";
  statusReason: string | null;
};

/**
 * The price of one project ledger row on a Time & Materials line. Labor is
 * hours × bill rate; every other billed cost is cost × (1 + handling). Machine,
 * overhead and burden are not billed (null): the bill rate already carries
 * them. A labor row with no hours or no rate is held, never billed at 0.
 */
export function priceTimeAndMaterialsItem(args: {
  costType: ProjectCostType;
  cost: number;
  hours: number | null;
  rate: number | null;
  materialHandlingPercent: number | null;
}): PricedBillableItem | null {
  const { costType } = args;
  if (LOADED_COST_TYPES.has(costType)) return null;

  if (costType === "Labor") {
    if (args.hours === null) {
      return {
        quantity: 1,
        unitPrice: 0,
        amount: 0,
        status: "On Hold",
        statusReason: BILLABLE_REASON_NO_HOURS
      };
    }
    const hours = Number(args.hours);
    if (args.rate === null) {
      return {
        quantity: hours,
        unitPrice: 0,
        amount: 0,
        status: "On Hold",
        statusReason: BILLABLE_REASON_NO_BILL_RATE
      };
    }
    const rate = Number(args.rate);
    return {
      quantity: hours,
      unitPrice: rate,
      amount: round(hours * rate),
      status: "Unbilled",
      statusReason: null
    };
  }

  const amount = round(
    Number(args.cost) * (1 + Number(args.materialHandlingPercent ?? 0))
  );
  return {
    quantity: 1,
    unitPrice: amount,
    amount,
    status: "Unbilled",
    statusReason: null
  };
}

/**
 * The estimate at completion: the override when one is set, else actual +
 * committed + whatever of the plan is not spent or committed yet.
 */
export function estimateAtCompletion(args: {
  plan: number;
  committed: number;
  actual: number;
  override?: number | null;
}): number {
  if (args.override !== null && args.override !== undefined) {
    return Number(args.override);
  }
  return (
    args.actual +
    args.committed +
    Math.max(args.plan - args.actual - args.committed, 0)
  );
}

/**
 * Plan, committed and actual of `rootId` and every descendant, from rows of
 * the `get_project_cost_summary` shape.
 */
export function sumSubtree(
  rows: {
    projectElementId: string | null;
    planMaterial: number;
    planLabor: number;
    planOther: number;
    committed: number;
    actual: number;
  }[],
  elements: { id: string; parentId: string | null }[],
  rootId: string
): { plan: number; committed: number; actual: number } {
  const children = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const siblings = children.get(element.parentId) ?? [];
    siblings.push(element.id);
    children.set(element.parentId, siblings);
  }

  const subtree = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (subtree.has(id)) continue;
    subtree.add(id);
    stack.push(...(children.get(id) ?? []));
  }

  const total = { plan: 0, committed: 0, actual: 0 };
  for (const row of rows) {
    if (!row.projectElementId || !subtree.has(row.projectElementId)) continue;
    total.plan +=
      Number(row.planMaterial) + Number(row.planLabor) + Number(row.planOther);
    total.committed += Number(row.committed);
    total.actual += Number(row.actual);
  }
  return total;
}

/**
 * The FAR 52.232-20/-22 funding test on `asOf`. Expected cost is the last 90
 * days' average daily cost over the notice window, capped at the plan's
 * remaining cost when the subtree has a plan. A notice is due again when the
 * funded cost it went out for changes.
 */
export function fundingNotice(args: {
  asOf: string;
  incurred: number;
  recentCost: number;
  remainingPlan: number | null;
  fundedCost: number;
  noticePercent: number;
  noticeWindowDays: number;
  thresholdNoticeFundedCost: number | null;
  runOutNoticeFundedCost: number | null;
}): {
  expected: number;
  runOutDate: string | null;
  threshold: boolean;
  runOut: boolean;
} {
  const incurred = Number(args.incurred);
  const fundedCost = Number(args.fundedCost);
  const averageDailyCost = Number(args.recentCost) / 90;

  let expected = round(averageDailyCost * args.noticeWindowDays);
  if (args.remainingPlan !== null) {
    expected = Math.min(expected, Math.max(Number(args.remainingPlan), 0));
  }
  expected = Math.max(expected, 0);

  const asOf = parseDate(args.asOf);
  let runOutDate: string | null = null;
  if (incurred >= fundedCost) {
    runOutDate = args.asOf;
  } else if (averageDailyCost > 0) {
    const days = round(
      (fundedCost - incurred) / averageDailyCost,
      0,
      RoundingMode.Up
    );
    runOutDate = asOf.add({ days }).toString();
  }

  const differs = (noticed: number | null) =>
    noticed === null || !equals(Number(noticed), fundedCost);

  const threshold =
    incurred + expected >= Number(args.noticePercent) * fundedCost &&
    differs(args.thresholdNoticeFundedCost);

  const windowEnd = asOf.add({ days: args.noticeWindowDays }).toString();
  const runOut =
    runOutDate !== null &&
    runOutDate <= windowEnd &&
    differs(args.runOutNoticeFundedCost);

  return { expected, runOutDate, threshold, runOut };
}

/**
 * The items one invoice takes within the line's funding. Items arrive in
 * posting date order, then id. Billing stops before the first item that would
 * take the billed amount above `fundedAmount`; that item and every later one
 * are held. A null `fundedAmount` takes every item.
 */
export function takeWithinFunding<T extends { amount: number }>(
  items: T[],
  args: { billed: number; fundedAmount: number | null }
): { take: T[]; held: T[] } {
  if (args.fundedAmount === null) return { take: [...items], held: [] };

  const funded = Number(args.fundedAmount);
  let billed = Number(args.billed);
  for (let i = 0; i < items.length; i++) {
    const next = round(billed + Number(items[i]!.amount));
    if (next > funded && !equals(next, funded)) {
      return { take: items.slice(0, i), held: items.slice(i) };
    }
    billed = next;
  }
  return { take: [...items], held: [] };
}

export type ProjectInvoicePlanItem = {
  id: string;
  costType: ProjectCostType;
  laborCategoryId: string | null;
  laborCategoryName: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  billingMethod: ContractBillingMethod;
  /** A burden item (Government Contracting): its pool. Null otherwise. */
  indirectPoolId?: string | null;
  poolName?: string | null;
};

export type ProjectInvoicePlanLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  itemIds: string[];
};

/**
 * Groups billable items into invoice lines. Time & Materials labor groups by
 * labor category and unit price (quantity = hours); Cost Plus labor by labor
 * category (quantity 1); every other cost by cost type (quantity 1). Burden
 * items group by pool ("Indirect costs: <pool>", quantity 1), after every
 * other line. One line per rate keeps the invoice total equal to the items'
 * total. A group that nets to 0 hours is quantity 1 at its amount.
 */
export function planProjectInvoiceLines(
  items: ProjectInvoicePlanItem[]
): ProjectInvoicePlanLine[] {
  type Group = {
    kind: "labor" | "other" | "burden";
    sortName: string;
    sortPrice: number;
    costOrder: number;
    hourly: boolean;
    description: (hours: number) => string;
    hours: number;
    amount: number;
    unitPrice: number;
    itemIds: string[];
  };
  const groups = new Map<string, Group>();

  for (const item of items) {
    const amount = Number(item.amount);
    const quantity = Number(item.quantity);
    if (item.indirectPoolId) {
      const key = `burden:${item.indirectPoolId}`;
      const poolName = item.poolName ?? item.indirectPoolId;
      const group = groups.get(key) ?? {
        kind: "burden",
        sortName: poolName,
        sortPrice: 0,
        costOrder: 0,
        hourly: false,
        description: () => `Indirect costs: ${poolName}`,
        hours: 0,
        amount: 0,
        unitPrice: 0,
        itemIds: []
      };
      group.amount += amount;
      group.itemIds.push(item.id);
      groups.set(key, group);
    } else if (item.costType === "Labor") {
      const name = item.laborCategoryName ?? "Labor";
      const category = item.laborCategoryId ?? "";
      const hourly = item.billingMethod === "Time & Materials";
      const unitPrice = Number(item.unitPrice);
      const key = hourly
        ? `labor:tm:${category}:${unitPrice}`
        : `labor:cp:${category}`;
      const group = groups.get(key) ?? {
        kind: "labor",
        sortName: name,
        sortPrice: hourly ? unitPrice : 0,
        costOrder: 0,
        hourly,
        description: (hours: number) =>
          hourly ? name : `${name} — ${round(hours)} h`,
        hours: 0,
        amount: 0,
        unitPrice,
        itemIds: []
      };
      group.hours += quantity;
      group.amount += amount;
      group.itemIds.push(item.id);
      groups.set(key, group);
    } else {
      const key = `other:${item.costType}`;
      const group = groups.get(key) ?? {
        kind: "other",
        sortName: item.costType,
        sortPrice: 0,
        costOrder: PROJECT_COST_TYPE_ORDER.indexOf(item.costType),
        hourly: false,
        description: () => item.costType,
        hours: 0,
        amount: 0,
        unitPrice: 0,
        itemIds: []
      };
      group.amount += amount;
      group.itemIds.push(item.id);
      groups.set(key, group);
    }
  }

  const kindOrder = { labor: 0, other: 1, burden: 2 } as const;
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    if (a.kind === "burden") return a.sortName.localeCompare(b.sortName);
    if (a.kind === "labor") {
      const byName = a.sortName.localeCompare(b.sortName);
      return byName !== 0 ? byName : a.sortPrice - b.sortPrice;
    }
    return a.costOrder - b.costOrder;
  });

  return ordered.map((group) => {
    const hours = round(group.hours);
    const amount = round(group.amount);
    if (group.hourly && !equals(hours, 0)) {
      return {
        description: group.description(hours),
        quantity: hours,
        unitPrice: group.unitPrice,
        itemIds: group.itemIds
      };
    }
    return {
      description: group.description(hours),
      quantity: 1,
      unitPrice: amount,
      itemIds: group.itemIds
    };
  });
}

/**
 * The hold for one drafted project billing invoice. Draft Only → null. A
 * re-bill of a voided invoice wins over a credit for a reversed charge.
 */
export function projectInvoiceHold(
  mode: InvoiceAutomation,
  items: { amount: number; voidedInvoiceReadableId: string | null }[]
): string | null {
  if (mode === "Draft Only") return null;

  const voided = [
    ...new Set(
      items
        .map((item) => item.voidedInvoiceReadableId)
        .filter((id): id is string => !!id)
    )
  ];
  if (voided.length > 0) return recurringHoldRebill(voided);

  return items.some((item) => Number(item.amount) < 0)
    ? PROJECT_HOLD_CREDIT
    : null;
}

/**
 * The ledger rows that still need a billable item. A row with an item is
 * done. A reversal never gets one here: when its original has an item,
 * posting already reversed that item; when neither has one, the pair cancels
 * and the original is skipped too.
 */
export function selectRowsToBill<
  T extends { id: string; reversalOfId: string | null }
>(rows: T[], itemByLedgerId: { has(ledgerId: string): boolean }): T[] {
  const reversed = new Set(
    rows
      .map((row) => row.reversalOfId)
      .filter((id): id is string => id !== null)
  );
  return rows.filter((row) => {
    if (itemByLedgerId.has(row.id)) return false;
    if (row.reversalOfId !== null) return false;
    if (reversed.has(row.id)) return false;
    return true;
  });
}
