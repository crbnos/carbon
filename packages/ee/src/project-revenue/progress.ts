// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Percent Complete revenue and the contract loss provision (`PROJECT_REVENUE`).
// Pure and client-safe, so the synthesizer and its tests agree. Spec:
// `.ai/specs/implemented/2026-10-09-project-billing.md` (*Revenue and WIP relief*), plan
// `.ai/plans/2026-10-09-project-billing-phase-4b.md` (decision R8).

import type { Database } from "@carbon/database";
import { round } from "@carbon/utils";

type ContractBillingMethod =
  Database["public"]["Enums"]["contractBillingMethod"];

/**
 * The transaction price a Percent Complete line recognizes against:
 * - Fixed: the line's scheduled total (its contract value);
 * - Cost Plus: the estimate at completion × (1 + fee), capped at the ceiling.
 * A Time & Materials line never uses Percent Complete (decision P6).
 */
export function percentCompletePrice(args: {
  billingMethod: ContractBillingMethod;
  /** Fixed: Σ the line's schedule rows. */
  scheduledTotal: number;
  estimateAtCompletion: number;
  feePercent: number | null;
  ceilingAmount: number | null;
}): number {
  switch (args.billingMethod) {
    case "Fixed":
      return round(args.scheduledTotal);
    case "Cost Plus": {
      const price = round(
        args.estimateAtCompletion * (1 + Number(args.feePercent ?? 0))
      );
      return args.ceilingAmount === null
        ? price
        : Math.min(price, round(args.ceilingAmount));
    }
    default:
      throw new Error(
        `A ${args.billingMethod} line cannot recognize revenue by Percent Complete`
      );
  }
}

/**
 * Cost-to-cost progress and the month's revenue, with a cumulative catch-up:
 * progress = actual ÷ EAC, capped at 1 (0 when the EAC is not positive);
 * earned to date = price × progress; the month = earned to date less what is
 * recognized before it. Earned to date uses the exact ratio; only the stored
 * `progress` is rounded, at internal scale.
 */
export function percentCompleteRevenue(args: {
  price: number;
  estimateAtCompletion: number;
  actualToDate: number;
  recognizedToDate: number;
}): { progress: number; earnedToDate: number; month: number } {
  const ratio =
    args.estimateAtCompletion > 0
      ? Math.min(Math.max(args.actualToDate / args.estimateAtCompletion, 0), 1)
      : 0;
  const earnedToDate = round(args.price * ratio);
  return {
    progress: round(ratio),
    earnedToDate,
    month: round(earnedToDate - args.recognizedToDate)
  };
}

/**
 * The loss provision balance a line must carry: (EAC − price) × (1 −
 * progress) when the estimate exceeds the price, else 0. The full forecast
 * loss shows at once: the cost-to-cost margin carries the part already
 * incurred, and the provision carries the rest (ASC 605-35-25-46).
 */
export function lossProvisionBalance(args: {
  price: number;
  estimateAtCompletion: number;
  progress: number;
}): number {
  if (args.estimateAtCompletion <= args.price) return 0;
  return round(
    (args.estimateAtCompletion - args.price) * (1 - Math.min(args.progress, 1))
  );
}
