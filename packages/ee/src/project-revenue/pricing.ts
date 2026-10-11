// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Cost Plus pricing (`PROJECT_REVENUE`). Pure and client-safe, so the
// generator and its tests agree. Spec: `.ai/specs/2026-10-09-project-billing.md`
// (*Billable items*), plan decision P10.

import type { Database } from "@carbon/database";
import { round } from "@carbon/utils";

type ProjectCostType = Database["public"]["Enums"]["projectCostType"];

/**
 * The price of one project ledger row on a Cost Plus line: cost × (1 + fee)
 * for every cost type. A labor row with hours is quantity = hours at the
 * derived hourly price; the amount stays exact. Any other row is quantity 1.
 */
export function priceCostPlusItem(args: {
  costType: ProjectCostType;
  cost: number;
  hours: number | null;
  feePercent: number;
}): { quantity: number; unitPrice: number; amount: number } {
  const amount = round(Number(args.cost) * (1 + Number(args.feePercent)));
  const hours = args.hours === null ? null : Number(args.hours);
  if (args.costType === "Labor" && hours !== null && hours !== 0) {
    return { quantity: hours, unitPrice: round(amount / hours), amount };
  }
  return { quantity: 1, unitPrice: amount, amount };
}
