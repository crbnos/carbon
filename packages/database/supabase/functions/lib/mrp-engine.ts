// Pure MRP engine functions shared across Supabase edge functions.

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
  periods: { id: string }[];
  onHandByLocationItem: Map<string, number>;
  jobSupplyByLocationPeriodItem: Map<string, number>;
  topLevelContributors: Map<string, DemandContributor[]>;
};

export type BomExplosionOutput = {
  grossDemand: Map<string, number>;
  bomDerivedDemand: Map<string, number>;
  demandContributors: Map<string, DemandContributor[]>;
  // Items on (or strictly downstream of) a BOM cycle. They are planned as leaf
  // items — no demand explodes through them — and the caller should log them.
  cycleItemIds: Set<string>;
};

// Composite map keys join their parts with a control character. Ids are
// caller-supplied TEXT — bulk imports mint UUIDs with hyphens — so no printable
// delimiter is collision-safe. Joining on "-" truncated hyphenated item ids on
// parse and collapsed distinct (item, period) pairs into duplicate rows
// (Postgres 21000 on the batched upsert).
export const KEY_SEP = "\x1f";

export function splitKey(key: string): [string, string, string] {
  const parts = key.split(KEY_SEP);
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function makeKey(
  locationId: string,
  periodId: string,
  itemId: string
): string {
  return locationId + KEY_SEP + periodId + KEY_SEP + itemId;
}

export function makeLocationItemKey(
  locationId: string,
  itemId: string
): string {
  return locationId + KEY_SEP + itemId;
}

export function makeActualKey(
  itemId: string,
  locationId: string,
  periodId: string,
  sourceType: string
): string {
  return (
    itemId + KEY_SEP + locationId + KEY_SEP + periodId + KEY_SEP + sourceType
  );
}

export function splitActualKey(
  key: string
): [string, string, string, string] {
  const parts = key.split(KEY_SEP);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function effectiveReplenishment(
  repSys: ReplenishmentSystem | undefined
): "Buy" | "Make" | undefined {
  return repSys === "Buy and Make"
    ? "Buy"
    : (repSys as "Buy" | "Make" | undefined);
}

// Low-level code = the deepest level at which an item appears in any BOM,
// i.e. the longest root-to-item path. Computed as longest-path-in-a-DAG via
// Kahn's topological order: each BOM edge is relaxed exactly once, O(items +
// edges). The previous implementation enumerated every root-to-item PATH with
// a copied visited-set per child — worst-case exponential on shared
// subassemblies, and it silently truncated cycles, so a corrupt BOM planned
// quietly wrong instead of being reported.
export function computeLowLevelCodes(
  bomByItem: Map<string, BomChild[]>
): { llc: Map<string, number>; cycleItemIds: Set<string> } {
  const indegree = new Map<string, number>();
  const nodes = new Set<string>();

  for (const [parent, children] of bomByItem) {
    nodes.add(parent);
    if (!indegree.has(parent)) indegree.set(parent, 0);
    for (const child of children) {
      nodes.add(child.itemId);
      indegree.set(child.itemId, (indegree.get(child.itemId) ?? 0) + 1);
    }
  }

  const llc = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((indegree.get(n) ?? 0) === 0) {
      llc.set(n, 0);
      queue.push(n);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const item = queue[head++];
    const level = llc.get(item) ?? 0;
    for (const child of bomByItem.get(item) ?? []) {
      const next = level + 1;
      if (next > (llc.get(child.itemId) ?? -1)) llc.set(child.itemId, next);
      const remaining = (indegree.get(child.itemId) ?? 0) - 1;
      indegree.set(child.itemId, remaining);
      if (remaining === 0) queue.push(child.itemId);
    }
  }

  // Nodes never dequeued sit on (or strictly downstream of) a cycle — the
  // topological order cannot reach them. They get no level.
  const cycleItemIds = new Set<string>();
  if (queue.length < nodes.size) {
    for (const n of nodes) {
      if (!llc.has(n) || (indegree.get(n) ?? 0) > 0) cycleItemIds.add(n);
    }
  }

  return { llc, cycleItemIds };
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

  const { llc, cycleItemIds } = computeLowLevelCodes(bomByItem);

  // A cycle cannot be leveled (rose seeds -> rose -> bouquet -> rose seeds is
  // real production data). Failing the whole company's run for one corrupt
  // loop is worse than planning around it: treat cycle members as leaf items —
  // their own demand still nets and outputs, but nothing explodes THROUGH
  // them — and report them so the caller can log instead of planning quietly
  // wrong.
  //
  // Copy rather than mutate: bomByItem belongs to the caller, which built it
  // and may still read it.
  const explodableBom =
    cycleItemIds.size > 0
      ? new Map([...bomByItem].filter(([itemId]) => !cycleItemIds.has(itemId)))
      : bomByItem;

  // Cycle members get no level from the topological pass. Leaving them
  // unleveled would default them to level 0 (`llc.get(id) ?? 0`), so demand a
  // clean parent explodes onto them at a later level would never be netted
  // against on-hand — an overstated requirement. Plan them LAST instead.
  const maxCleanLevel = llc.size > 0 ? Math.max(...llc.values()) : 0;
  const cycleLevel = cycleItemIds.size > 0 ? maxCleanLevel + 1 : maxCleanLevel;
  for (const itemId of cycleItemIds) {
    llc.set(itemId, cycleLevel);
  }

  const maxLevel = cycleLevel;

  const periodIndexById = new Map(periods.map((p, i) => [p.id, i]));

  for (let level = 0; level <= maxLevel; level++) {
    // LLC layer: ensure every parent's netting is done before its children
    // get demand added — otherwise we'd miss BOM-derived demand mid-walk.
    const locItemsAtLevel = new Set<string>();
    for (const [key, qty] of grossDemand) {
      if (qty <= 0) continue;
      const [locationId, , itemId] = splitKey(key);
      if ((llc.get(itemId) ?? 0) === level) {
        locItemsAtLevel.add(makeLocationItemKey(locationId, itemId));
      }
    }

    for (const locItem of locItemsAtLevel) {
      const sepIdx = locItem.indexOf(KEY_SEP);
      const locationId = locItem.slice(0, sepIdx);
      const itemId = locItem.slice(sepIdx + 1);

      const effRepSys = effectiveReplenishment(
        replenishmentSystemByItem.get(itemId)
      );
      const invKey = makeLocationItemKey(locationId, itemId);
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

        const children = explodableBom.get(itemId) ?? [];
        for (const child of children) {
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

  return { grossDemand, bomDerivedDemand, demandContributors, cycleItemIds };
}
