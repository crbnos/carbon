// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure MRP engine functions shared by MRP (@carbon/planning) and get-method.

import {
  allocateCommonSurplus,
  type SegmentQuantity,
  trueSurplusByPeriod
} from "./mrp-netting-sequence.ts";
import { RoundingMode, round } from "./precision.ts";
import {
  consumableInWholeAssemblies,
  type Redirect
} from "./supersession-pick.ts";

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
  // The netting segment of the demand ('' is common, the default).
  segmentId?: string;
  // The discontinued part this demand was redirected from, if any.
  redirectedFromItemId?: string;
  perAssemblyQuantity?: number;
  // Projects Phase 3: the member project and element a group segment's
  // demand is for, and the date it is needed (YYYY-MM-DD). A child
  // contributor copies them from its parent contributor.
  projectId?: string;
  projectElementId?: string;
  needDate?: string;
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
    })
  | (DemandContributorBase & {
      sourceType: "Project Material";
      projectElementMaterialId: string;
    })
  | (DemandContributorBase & {
      // An open borrow: demand on the borrower. It writes no lineage row.
      sourceType: "Project Borrow";
      projectBorrowId: string;
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
  consumeFirstRedirect?: Map<string, Redirect>;
  /**
   * Location-item keys (`makeLocationItemKey`, common segment) whose project
   * segments must not draw common surplus: `itemPlanning` turns
   * `allowCommonSupplyForProjects` off. Absent: every item may draw.
   */
  commonSurplusBlocked?: Set<string>;
  /** How many periods a common surplus looks ahead. Absent: every period. */
  horizonPeriods?: number;
  /**
   * The BOM before the supersession swap. Project segments explode through
   * it, because supersession applies to the common segment only. Absent:
   * every segment explodes through `bomByItem`.
   */
  segmentBomByItem?: Map<string, BomChild[]>;
  /**
   * Projects Phase 3: the planning group segments. In a group segment a
   * parent's contributors are scaled to its net requirement before they pass
   * to its children, so the children's contributors attribute only what is
   * still short. Absent: no segment is a group.
   */
  groupSegments?: ReadonlySet<string>;
};

export type BomExplosionOutput = {
  grossDemand: Map<string, number>;
  bomDerivedDemand: Map<string, number>;
  demandContributors: Map<string, DemandContributor[]>;
  // Items on (or strictly downstream of) a BOM cycle. They are planned as leaf
  // items — no demand explodes through them — and the caller should log them.
  cycleItemIds: Set<string>;
  // What each project segment draws from the common segment's true surplus,
  // keyed by makeKey(location, period, item, segment). Planning actions turn
  // each draw into a Transfer.
  commonSurplusDraws: Map<string, number>;
};

// Composite map keys join their parts with a control character. Ids are
// caller-supplied TEXT — bulk imports mint UUIDs with hyphens — so no printable
// delimiter is collision-safe. Joining on "-" truncated hyphenated item ids on
// parse and collapsed distinct (item, period) pairs into duplicate rows
// (Postgres 21000 on the batched upsert).
export const KEY_SEP = "\x1f";

// The netting segment is the last part of every key (Projects Phase 2b): ''
// is common, a project id is a project with project stock. A key built
// without a segment is in the common segment.
export const COMMON_SEGMENT = "";

export function makeKey(
  locationId: string,
  periodId: string,
  itemId: string,
  segmentId: string = COMMON_SEGMENT
): string {
  return (
    locationId + KEY_SEP + periodId + KEY_SEP + itemId + KEY_SEP + segmentId
  );
}

export function splitKey(key: string): [string, string, string, string] {
  const parts = key.split(KEY_SEP);
  return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? COMMON_SEGMENT];
}

export function makeLocationItemKey(
  locationId: string,
  itemId: string,
  segmentId: string = COMMON_SEGMENT
): string {
  return locationId + KEY_SEP + itemId + KEY_SEP + segmentId;
}

export function splitLocationItemKey(key: string): [string, string, string] {
  const parts = key.split(KEY_SEP);
  return [parts[0]!, parts[1]!, parts[2] ?? COMMON_SEGMENT];
}

export function makeActualKey(
  itemId: string,
  locationId: string,
  periodId: string,
  sourceType: string,
  segmentId: string = COMMON_SEGMENT
): string {
  return (
    itemId +
    KEY_SEP +
    locationId +
    KEY_SEP +
    periodId +
    KEY_SEP +
    sourceType +
    KEY_SEP +
    segmentId
  );
}

export function splitActualKey(
  key: string
): [string, string, string, string, string] {
  const parts = key.split(KEY_SEP);
  return [
    parts[0]!,
    parts[1]!,
    parts[2]!,
    parts[3]!,
    parts[4] ?? COMMON_SEGMENT
  ];
}

export function effectiveReplenishment(
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
export function computeLowLevelCodes(bomByItem: Map<string, BomChild[]>): {
  llc: Map<string, number>;
  cycleItemIds: Set<string>;
} {
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
    // `head < queue.length` guarantees this is defined; the `!` satisfies
    // noUncheckedIndexedAccess under the Node typecheck (this file is now
    // Node-consumed via @carbon/database/mrp-engine).
    const item = queue[head++]!;
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
    topLevelContributors
  } = input;

  const grossDemand = new Map(input.grossDemand);
  const onHandByLocationItem = new Map(input.onHandByLocationItem);
  const jobSupply = input.jobSupplyByLocationPeriodItem;

  const bomDerivedDemand = new Map<string, number>();
  const demandContributors = new Map<string, DemandContributor[]>();
  const consumeFirstRedirect =
    input.consumeFirstRedirect ?? new Map<string, Redirect>();

  const segmentBomByItem = input.segmentBomByItem;
  const commonSurplusBlocked = input.commonSurplusBlocked ?? new Set<string>();
  const horizonPeriods = input.horizonPeriods ?? periods.length;
  const commonSurplusDraws = new Map<string, number>();
  const groupSegments = input.groupSegments ?? new Set<string>();

  // The pre-swap BOM's edges level too: a project segment explodes through
  // it, so an item it names must be planned after every parent there.
  const withSegmentEdges = (() => {
    if (!segmentBomByItem) return bomByItem;
    const withEdges = new Map(bomByItem);
    for (const [parent, children] of segmentBomByItem) {
      withEdges.set(parent, [...(withEdges.get(parent) ?? []), ...children]);
    }
    return withEdges;
  })();

  const levelingBom =
    consumeFirstRedirect.size === 0
      ? withSegmentEdges
      : (() => {
          const withEdges = new Map(withSegmentEdges);
          for (const [oldItemId, { to }] of consumeFirstRedirect) {
            withEdges.set(oldItemId, [
              ...(withEdges.get(oldItemId) ?? []),
              { itemId: to, quantity: 0, methodType: "Pull from Inventory" }
            ]);
          }
          return withEdges;
        })();

  const { llc, cycleItemIds } = computeLowLevelCodes(levelingBom);

  // A cycle cannot be leveled (rose seeds -> rose -> bouquet -> rose seeds is
  // real production data). Failing the whole company's run for one corrupt
  // loop is worse than planning around it: treat cycle members as leaf items —
  // their own demand still nets and outputs, but nothing explodes THROUGH
  // them — and report them so the caller can log instead of planning quietly
  // wrong.
  //
  // Copy rather than mutate: bomByItem belongs to the caller, which built it
  // and may still read it.
  const withoutCycles = (bom: Map<string, BomChild[]>) =>
    cycleItemIds.size > 0
      ? new Map([...bom].filter(([itemId]) => !cycleItemIds.has(itemId)))
      : bom;
  const explodableBom = withoutCycles(bomByItem);
  const explodableSegmentBom = segmentBomByItem
    ? withoutCycles(segmentBomByItem)
    : explodableBom;

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

  // Nets one (location, item, segment) across the horizon and explodes its
  // shortfall. `draws` (by period index) is common surplus the segment takes
  // as on-hand in that period.
  const netAndExplode = (
    locationId: string,
    itemId: string,
    segmentId: string,
    draws?: Map<number, number>
  ) => {
    // Supersession applies to the common segment only (spec decision 24).
    const isCommon = segmentId === COMMON_SEGMENT;
    const explodable = isCommon ? explodableBom : explodableSegmentBom;
    const effRepSys = effectiveReplenishment(
      replenishmentSystemByItem.get(itemId)
    );
    const invKey = makeLocationItemKey(locationId, itemId, segmentId);
    // Running balance for this (location, item) across the planning
    // horizon: starts at on-hand, +supply as each period passes,
    // −demand as we hit it. Floored at 0 because any shortfall is
    // converted into child demand below.
    let running = onHandByLocationItem.get(invKey) ?? 0;

    for (const [index, period] of periods.entries()) {
      const periodKey = makeKey(locationId, period.id, itemId, segmentId);
      running += jobSupply.get(periodKey) ?? 0;
      running += draws?.get(index) ?? 0;

      const grossQty = grossDemand.get(periodKey) ?? 0;
      if (grossQty <= 0) continue;

      const redirect = isCommon ? consumeFirstRedirect.get(itemId) : undefined;
      if (redirect) {
        const weeks = (id: string) =>
          round((leadTimeByItem.get(id) ?? 7) / 7, 0, RoundingMode.Up);
        const currentPeriodIndex = periodIndexById.get(period.id) ?? 0;
        const successorPeriodIndex = Math.max(
          0,
          Math.min(
            currentPeriodIndex,
            currentPeriodIndex + weeks(itemId) - weeks(redirect.to)
          )
        );
        const successorPeriod = periods[successorPeriodIndex] ?? period;
        running = redirectConsumeFirstShortfall({
          itemId,
          periodKey,
          successorKey: makeKey(
            locationId,
            successorPeriod.id,
            redirect.to,
            segmentId
          ),
          factor: redirect.factor,
          grossQty,
          running,
          successorIsMake:
            effectiveReplenishment(
              replenishmentSystemByItem.get(redirect.to)
            ) === "Make",
          bomByItem,
          grossDemand,
          bomDerivedDemand,
          demandContributors
        });
        continue;
      }

      const netRequirement = Math.max(0, grossQty - Math.max(0, running));
      running = Math.max(0, running - grossQty);

      // Buy items never explode — their shortfall surfaces directly in
      // demandForecast / quantityToOrder via the caller.
      if (netRequirement <= 0 || effRepSys !== "Make") continue;

      const children = explodable.get(itemId) ?? [];
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

        const childKey = makeKey(
          locationId,
          targetPeriod.id,
          child.itemId,
          segmentId
        );
        grossDemand.set(childKey, (grossDemand.get(childKey) ?? 0) + childQty);
        if (!isInlineProduction) {
          bomDerivedDemand.set(
            childKey,
            (bomDerivedDemand.get(childKey) ?? 0) + childQty
          );
        }

        const parentContributors = [
          ...(demandContributors.get(periodKey) ?? []),
          ...(topLevelContributors.get(periodKey) ?? [])
        ];
        if (parentContributors.length > 0) {
          const childContributors = demandContributors.get(childKey) ?? [];
          // Contributors are gross. In a group segment, each member keeps
          // its share of the net requirement only: on-hand and supply have
          // covered the rest. Other segments keep their gross contributors.
          const netShare = groupSegments.has(segmentId)
            ? netRequirement / grossQty
            : 1;
          for (const pc of parentContributors) {
            childContributors.push({
              ...pc,
              quantity: pc.quantity * netShare * child.quantity,
              // A substituted child carries the old part it replaced so the
              // demand can be shown as "redirected from <old part>".
              redirectedFromItemId:
                child.redirectedFromItemId ?? pc.redirectedFromItemId,
              perAssemblyQuantity: child.quantity
            });
          }
          demandContributors.set(childKey, childContributors);
        }
      }
    }

    // Persist the trailing balance so the next LLC layer (or a later
    // call) sees the consumed/produced state of this item.
    onHandByLocationItem.set(invKey, running);
  };

  // A project segment's shortfall per period after its own on-hand and
  // supply: what it could take from common surplus. Nothing is changed.
  const segmentNeeds = (
    locationId: string,
    itemId: string,
    segmentId: string
  ): SegmentQuantity[] => {
    const needs: SegmentQuantity[] = [];
    let running =
      onHandByLocationItem.get(
        makeLocationItemKey(locationId, itemId, segmentId)
      ) ?? 0;
    for (const [index, period] of periods.entries()) {
      const periodKey = makeKey(locationId, period.id, itemId, segmentId);
      running += jobSupply.get(periodKey) ?? 0;
      const grossQty = grossDemand.get(periodKey) ?? 0;
      if (grossQty <= 0) continue;
      const need = Math.max(0, grossQty - Math.max(0, running));
      running = Math.max(0, running - grossQty);
      if (need > 0)
        needs.push({ segmentId, periodIndex: index, quantity: need });
    }
    return needs;
  };

  for (let level = 0; level <= maxLevel; level++) {
    // LLC layer: ensure every parent's netting is done before its children
    // get demand added — otherwise we'd miss BOM-derived demand mid-walk.
    const locItemsAtLevel = new Set<string>();
    for (const [key, qty] of grossDemand) {
      if (qty <= 0) continue;
      const [locationId, , itemId, segmentId] = splitKey(key);
      if ((llc.get(itemId) ?? 0) === level) {
        locItemsAtLevel.add(makeLocationItemKey(locationId, itemId, segmentId));
      }
    }

    // The common segment nets first, so its demand is final when a project
    // segment of the same item measures the common surplus. Project segments
    // follow, grouped by location and item, in segment id order.
    const segmentsByLocationItem = new Map<string, string[]>();
    for (const locItem of locItemsAtLevel) {
      // A parent's segment is its children's: demand in segment S explodes
      // into segment S.
      const [locationId, itemId, segmentId] = splitLocationItemKey(locItem);
      if (segmentId === COMMON_SEGMENT) {
        netAndExplode(locationId, itemId, segmentId);
        continue;
      }
      const commonKey = makeLocationItemKey(locationId, itemId);
      const segments = segmentsByLocationItem.get(commonKey) ?? [];
      segments.push(segmentId);
      segmentsByLocationItem.set(commonKey, segments);
    }

    for (const [commonKey, segments] of segmentsByLocationItem) {
      segments.sort();
      const [locationId, itemId] = splitLocationItemKey(commonKey);

      // Own segment first, then the common segment's true surplus (on-hand
      // that common demand does not need within the horizon), in one
      // allocation for every segment of this item and location.
      const drawsBySegment = new Map<string, Map<number, number>>();
      if (!commonSurplusBlocked.has(commonKey)) {
        const needs = segments.flatMap((segmentId) =>
          segmentNeeds(locationId, itemId, segmentId)
        );
        const commonOnHand = input.onHandByLocationItem.get(commonKey) ?? 0;
        if (needs.length > 0 && commonOnHand > 0) {
          const commonDemand = periods.map(
            (period) =>
              grossDemand.get(makeKey(locationId, period.id, itemId)) ?? 0
          );
          const { draws } = allocateCommonSurplus({
            surplusByPeriod: surplusWithinHorizon(
              commonOnHand,
              commonDemand,
              horizonPeriods
            ),
            needs
          });
          for (const draw of draws) {
            const period = periods[draw.periodIndex];
            if (!period) continue;
            const bySegment =
              drawsBySegment.get(draw.segmentId) ?? new Map<number, number>();
            bySegment.set(
              draw.periodIndex,
              (bySegment.get(draw.periodIndex) ?? 0) + draw.quantity
            );
            drawsBySegment.set(draw.segmentId, bySegment);
            const drawKey = makeKey(
              locationId,
              period.id,
              itemId,
              draw.segmentId
            );
            commonSurplusDraws.set(
              drawKey,
              (commonSurplusDraws.get(drawKey) ?? 0) + draw.quantity
            );
          }
        }
      }

      // Then new supply: the remainder after the draw nets and explodes.
      for (const segmentId of segments) {
        netAndExplode(
          locationId,
          itemId,
          segmentId,
          drawsBySegment.get(segmentId)
        );
      }
    }
  }

  return {
    grossDemand,
    bomDerivedDemand,
    demandContributors,
    cycleItemIds,
    commonSurplusDraws
  };
}

/**
 * The common segment's true surplus per period, looking `horizonPeriods`
 * periods ahead: demand beyond the horizon does not hold stock back.
 */
function surplusWithinHorizon(
  onHand: number,
  demandByPeriod: number[],
  horizonPeriods: number
): number[] {
  if (horizonPeriods >= demandByPeriod.length) {
    return trueSurplusByPeriod(onHand, demandByPeriod);
  }
  return demandByPeriod.map(
    (_, t) =>
      trueSurplusByPeriod(onHand, demandByPeriod.slice(0, t + horizonPeriods))[
        t
      ] ?? 0
  );
}

export function netConsumeFirstContributors(args: {
  itemId: string;
  contributors: DemandContributor[];
  grossQty: number;
  running: number;
  factor: number;
  perAssemblyOf: (c: DemandContributor) => number;
}): {
  kept: DemandContributor[];
  moved: DemandContributor[];
  consumed: number;
  running: number;
} {
  const { itemId, contributors, grossQty, factor, perAssemblyOf } = args;
  let running = Math.max(0, args.running);
  const kept: DemandContributor[] = [];
  const moved: DemandContributor[] = [];
  let attributed = 0;
  let consumed = 0;
  for (const c of contributors) {
    const take = Math.min(
      c.quantity,
      consumableInWholeAssemblies(running, perAssemblyOf(c))
    );
    running -= take;
    attributed += c.quantity;
    consumed += take;
    if (take > 0) kept.push({ ...c, quantity: take });
    if (c.quantity - take > 0) {
      moved.push({
        ...c,
        quantity: (c.quantity - take) * factor,
        redirectedFromItemId: c.redirectedFromItemId ?? itemId,
        perAssemblyQuantity:
          c.perAssemblyQuantity == null
            ? undefined
            : c.perAssemblyQuantity * factor
      });
    }
  }
  const unattributed = Math.max(0, grossQty - attributed);
  const unitTake = Math.min(running, unattributed);
  running -= unitTake;
  consumed += unitTake;
  return { kept, moved, consumed, running };
}

function redirectConsumeFirstShortfall(args: {
  itemId: string;
  periodKey: string;
  successorKey: string;
  factor: number;
  grossQty: number;
  running: number;
  successorIsMake: boolean;
  bomByItem: Map<string, BomChild[]>;
  grossDemand: Map<string, number>;
  bomDerivedDemand: Map<string, number>;
  demandContributors: Map<string, DemandContributor[]>;
}): number {
  const {
    itemId,
    periodKey,
    successorKey,
    factor,
    grossQty,
    successorIsMake,
    bomByItem,
    grossDemand,
    bomDerivedDemand,
    demandContributors
  } = args;

  const contributors = demandContributors.get(periodKey) ?? [];
  const { kept, moved, consumed, running } = netConsumeFirstContributors({
    itemId,
    contributors,
    grossQty,
    running: args.running,
    factor,
    perAssemblyOf: (c) =>
      c.perAssemblyQuantity ??
      bomByItem.get(c.parentItemId)?.find((child) => child.itemId === itemId)
        ?.quantity ??
      0
  });

  const shortfall = grossQty - consumed;
  if (shortfall <= 0) return running;

  const keptShare = consumed / grossQty;
  const derivedOld = bomDerivedDemand.get(periodKey) ?? 0;
  const keptDerived = derivedOld * keptShare;
  if (keptDerived > 0) {
    bomDerivedDemand.set(periodKey, keptDerived);
  } else {
    bomDerivedDemand.delete(periodKey);
  }
  grossDemand.set(
    successorKey,
    (grossDemand.get(successorKey) ?? 0) + shortfall * factor
  );
  const movedDerived = successorIsMake
    ? (derivedOld - keptDerived) * factor
    : shortfall * factor;
  if (movedDerived > 0) {
    bomDerivedDemand.set(
      successorKey,
      (bomDerivedDemand.get(successorKey) ?? 0) + movedDerived
    );
  }

  if (contributors.length > 0) {
    if (kept.length > 0) {
      demandContributors.set(periodKey, kept);
    } else {
      demandContributors.delete(periodKey);
    }
    demandContributors.set(
      successorKey,
      (demandContributors.get(successorKey) ?? []).concat(moved)
    );
  }
  return running;
}
