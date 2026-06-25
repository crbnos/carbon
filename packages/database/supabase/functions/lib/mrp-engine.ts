// Pure MRP engine functions shared across Supabase edge functions.
// The same algorithm is independently available (with unit tests) at
// packages/mrp/src/engine.ts.

export type MethodType =
  | "Make to Order"
  | "Pull from Inventory"
  | "Purchase to Order";

export type ReplenishmentSystem = "Buy" | "Make" | "Buy and Make";

export type BomChild = {
  itemId: string;
  quantity: number;
  methodType: MethodType;
  // Set when this child was substituted by supersession (the original/old item).
  redirectedFromItemId?: string;
  // BOM line-item effectivity ("YYYY-MM-DD"); NULL = always effective. The line
  // is only exploded for builds whose period falls within [from, to].
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

type DemandContributorBase = {
  parentItemId: string;
  quantity: number;
  // The discontinued part this demand was redirected from, if any.
  redirectedFromItemId?: string;
};

export type DemandContributor =
  | (DemandContributorBase & {
      sourceType: "Job Material";
      jobId: string;
    })
  | (DemandContributorBase & {
      sourceType: "Sales Order";
      salesOrderLineId: string;
    })
  | (DemandContributorBase & {
      sourceType: "Demand Projection";
      demandProjectionId: string;
    });

export type BomExplosionInput = {
  grossDemand: Map<string, number>;
  bomByItem: Map<string, BomChild[]>;
  replenishmentSystemByItem: Map<string, ReplenishmentSystem>;
  leadTimeByItem: Map<string, number>;
  periods: { id: string; startDate?: string }[];
  onHandByLocationItem: Map<string, number>;
  jobSupplyByLocationPeriodItem: Map<string, number>;
  topLevelContributors: Map<string, DemandContributor[]>;
};

export type BomExplosionOutput = {
  grossDemand: Map<string, number>;
  bomDerivedDemand: Map<string, number>;
  demandContributors: Map<string, DemandContributor[]>;
};

export function splitKey(key: string): [string, string, string] {
  const parts = key.split("-");
  return [parts[0]!, parts[1]!, parts.slice(2).join("-")];
}

export function makeKey(
  locationId: string,
  periodId: string,
  itemId: string
): string {
  return `${locationId}-${periodId}-${itemId}`;
}

function effectiveReplenishment(
  repSys: ReplenishmentSystem | undefined
): "Buy" | "Make" | undefined {
  return repSys === "Buy and Make"
    ? "Buy"
    : (repSys as "Buy" | "Make" | undefined);
}

export function computeLowLevelCodes(
  bomByItem: Map<string, BomChild[]>
): Map<string, number> {
  const llc = new Map<string, number>();

  function assignLevel(
    itemId: string,
    level: number,
    visited: Set<string>
  ): void {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    const currentLLC = llc.get(itemId) ?? -1;
    if (level > currentLLC) {
      llc.set(itemId, level);
    }

    const children = bomByItem.get(itemId) ?? [];
    for (const child of children) {
      assignLevel(child.itemId, level + 1, new Set(visited));
    }
  }

  for (const itemId of bomByItem.keys()) {
    assignLevel(itemId, 0, new Set());
  }

  return llc;
}

export function explodeBom(input: BomExplosionInput): BomExplosionOutput {
  const {
    bomByItem,
    replenishmentSystemByItem,
    leadTimeByItem,
    periods,
    topLevelContributors,
  } = input;

  const grossDemand = new Map(input.grossDemand);
  const onHandByLocationItem = new Map(input.onHandByLocationItem);
  const jobSupply = input.jobSupplyByLocationPeriodItem;

  const bomDerivedDemand = new Map<string, number>();
  const demandContributors = new Map<string, DemandContributor[]>();

  const llc = computeLowLevelCodes(bomByItem);
  const maxLevel = llc.size > 0 ? Math.max(...llc.values()) : 0;

  const periodIndexById = new Map(periods.map((p, i) => [p.id, i]));

  for (let level = 0; level <= maxLevel; level++) {
    // LLC layer: ensure every parent's netting is done before its children
    // get demand added — otherwise we'd miss BOM-derived demand mid-walk.
    const locItemsAtLevel = new Set<string>();
    for (const [key, qty] of grossDemand) {
      if (qty <= 0) continue;
      const [locationId, , itemId] = splitKey(key);
      if ((llc.get(itemId) ?? 0) === level) {
        locItemsAtLevel.add(`${locationId}|${itemId}`);
      }
    }

    for (const locItem of locItemsAtLevel) {
      const sepIdx = locItem.indexOf("|");
      const locationId = locItem.slice(0, sepIdx);
      const itemId = locItem.slice(sepIdx + 1);

      const effRepSys = effectiveReplenishment(
        replenishmentSystemByItem.get(itemId)
      );
      const invKey = `${locationId}-${itemId}`;
      // Running balance for this (location, item) across the planning
      // horizon: starts at on-hand, +supply as each period passes,
      // −demand as we hit it. Floored at 0 because any shortfall is
      // converted into child demand below.
      let running = onHandByLocationItem.get(invKey) ?? 0;

      for (const period of periods) {
        const periodKey = makeKey(locationId, period.id, itemId);
        running += jobSupply.get(periodKey) ?? 0;

        const grossQty = grossDemand.get(periodKey) ?? 0;
        if (grossQty <= 0) continue;

        const netRequirement = Math.max(0, grossQty - Math.max(0, running));
        running = Math.max(0, running - grossQty);

        // Buy items never explode — their shortfall surfaces directly in
        // demandForecast / quantityToOrder via the caller.
        if (netRequirement <= 0 || effRepSys !== "Make") continue;

        const children = bomByItem.get(itemId) ?? [];
        for (const child of children) {
          // BOM line-item effectivity: skip a line whose effective range does
          // not cover this build period (string "YYYY-MM-DD" comparison).
          const buildDate = period.startDate;
          if (
            buildDate &&
            ((child.effectiveFrom && buildDate < child.effectiveFrom) ||
              (child.effectiveTo && buildDate > child.effectiveTo))
          ) {
            continue;
          }

          const childEffRepSys = effectiveReplenishment(
            replenishmentSystemByItem.get(child.itemId)
          );

          // MTO + Make = "subjob will be auto-spawned at parent release";
          // skip the forecast write to avoid double-counting once it exists.
          const isInlineProduction =
            child.methodType === "Make to Order" && childEffRepSys === "Make";

          const childQty = child.quantity * netRequirement;
          const childLeadTimeDays = leadTimeByItem.get(child.itemId) ?? 7;
          const childLeadTimeWeeks = Math.ceil(childLeadTimeDays / 7);

          // Pull the child demand earlier by lead time so the order/job
          // arrives in time for the parent's period; floor at period[0].
          const currentPeriodIndex = periodIndexById.get(period.id) ?? 0;
          const targetPeriodIndex = Math.max(
            0,
            currentPeriodIndex - childLeadTimeWeeks
          );
          const targetPeriod = periods[targetPeriodIndex];
          if (!targetPeriod) continue;

          const childKey = makeKey(locationId, targetPeriod.id, child.itemId);
          grossDemand.set(
            childKey,
            (grossDemand.get(childKey) ?? 0) + childQty
          );
          if (!isInlineProduction) {
            bomDerivedDemand.set(
              childKey,
              (bomDerivedDemand.get(childKey) ?? 0) + childQty
            );
          }

          const parentContributors = [
            ...(demandContributors.get(periodKey) ?? []),
            ...(topLevelContributors.get(periodKey) ?? []),
          ];
          if (parentContributors.length > 0) {
            const childContributors = demandContributors.get(childKey) ?? [];
            for (const pc of parentContributors) {
              childContributors.push({
                ...pc,
                quantity: pc.quantity * child.quantity,
                // A substituted child carries the old part it replaced so the
                // demand can be shown as "redirected from <old part>".
                redirectedFromItemId:
                  child.redirectedFromItemId ?? pc.redirectedFromItemId,
              });
            }
            demandContributors.set(childKey, childContributors);
          }
        }
      }

      // Persist the trailing balance so the next LLC layer (or a later
      // call) sees the consumed/produced state of this item.
      onHandByLocationItem.set(invKey, running);
    }
  }

  return { grossDemand, bomDerivedDemand, demandContributors };
}
