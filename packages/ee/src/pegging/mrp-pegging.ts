// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Live pegging of a planning group's supply to its members' demand (Projects
// Phase 3, `PLANNING_GROUPS`). Pure: no database, no clock. The MRP run
// assembles the inputs per (group, item, location) and the peg writer
// (`peg-writer.ts`) diff-writes the result to `projectPeg`.

import {
  distributeRoundingResidual,
  EPSILON,
  equals,
  round
} from "@carbon/utils";

export type PegSupplyType = "Purchase Order Line" | "Job" | "Planning Action";

export type PegDemandSourceType =
  | "Job Material"
  | "Project Material"
  | "Sales Order"
  | "Project Borrow";

export type PegPriorityRule = "Earliest Need" | "Project Priority";

export type PegDemand = {
  projectId: string;
  projectElementId: string | null;
  priority: number;
  sourceType: PegDemandSourceType;
  sourceId: string;
  needDate: string;
  quantity: number;
  /** Set for a grouped job's components: the job's pegs split this demand. */
  parentSupply?: { supplyType: PegSupplyType; supplyId: string };
  /** Set by `splitGroupedJobDemand`: the job peg this part comes from. */
  parentPegKey?: string | null;
};

export type PegSupply = {
  /** "Stock" is a member's own stock; its `supplyId` is the owner project id. */
  supplyType: PegSupplyType | "Stock";
  supplyId: string;
  /** null is grouped supply; a project id is a member's own supply. */
  ownerProjectId: string | null;
  availableDate: string;
  quantity: number;
};

export type ExistingPeg = {
  id: string;
  supplyType: PegSupplyType;
  supplyId: string;
  projectId: string;
  projectElementId?: string | null;
  demandSourceType: string;
  demandSourceId: string;
  quantity: number;
  state: "Soft" | "Hard" | "Manual";
};

export type ComputedPeg = Omit<ExistingPeg, "id" | "state"> & {
  projectElementId: string | null;
  needDate: string;
  parentPegKey: string | null;
};

export type PegShortage = {
  projectId: string;
  projectElementId: string | null;
  sourceType: PegDemandSourceType;
  sourceId: string;
  needDate: string;
  quantity: number;
};

export type PegExcess = {
  supplyType: PegSupplyType;
  supplyId: string;
  quantity: number;
};

export type PegGroupSegmentResult = {
  pegs: ComputedPeg[];
  shortages: PegShortage[];
  excess: PegExcess[];
  /** Fixed Manual pegs whose demand is gone. */
  manualWithoutDemand: ExistingPeg[];
};

const SEP = "\x1f";

const SUPPLY_TYPE_ORDER: Record<PegSupplyType, number> = {
  "Purchase Order Line": 0,
  Job: 1,
  "Planning Action": 2
};

function demandKeyOf(
  projectId: string,
  sourceType: string,
  sourceId: string
): string {
  return projectId + SEP + sourceType + SEP + sourceId;
}

function supplyKeyOf(supplyType: string, supplyId: string): string {
  return supplyType + SEP + supplyId;
}

/** The identity of a peg: one supply to one member's demand. */
export function pegKeyOf(peg: {
  supplyType: string;
  supplyId: string;
  projectId: string;
  demandSourceType: string;
  demandSourceId: string;
}): string {
  return [
    peg.supplyType,
    peg.supplyId,
    peg.projectId,
    peg.demandSourceType,
    peg.demandSourceId
  ].join(SEP);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Splits the component demand of a grouped job over the job's pegs, in
 * proportion to each peg's quantity. Each part takes the peg's project and
 * element. The parts sum exactly to the demand (`distributeRoundingResidual`).
 * A demand with no parent job, or whose job has no peg, is returned as is.
 */
export function splitGroupedJobDemand(
  demands: PegDemand[],
  jobPegs: ExistingPeg[],
  priorityOf?: (projectId: string) => number | undefined
): PegDemand[] {
  const pegsByJob = new Map<string, ExistingPeg[]>();
  for (const peg of jobPegs) {
    if (peg.supplyType !== "Job" || peg.quantity <= 0) continue;
    const list = pegsByJob.get(peg.supplyId) ?? [];
    list.push(peg);
    pegsByJob.set(peg.supplyId, list);
  }
  for (const list of pegsByJob.values()) {
    list.sort(
      (a, b) =>
        compareText(a.projectId, b.projectId) ||
        compareText(a.demandSourceId, b.demandSourceId) ||
        compareText(a.id, b.id)
    );
  }

  const result: PegDemand[] = [];
  for (const demand of demands) {
    const pegs =
      demand.parentSupply?.supplyType === "Job"
        ? pegsByJob.get(demand.parentSupply.supplyId)
        : undefined;
    if (!pegs || pegs.length === 0) {
      result.push(demand);
      continue;
    }
    const total = pegs.reduce((sum, peg) => sum + peg.quantity, 0);
    const parts = distributeRoundingResidual(
      pegs.map((peg) => (demand.quantity * peg.quantity) / total),
      round(demand.quantity)
    );
    pegs.forEach((peg, index) => {
      const quantity = parts[index] ?? 0;
      if (quantity <= 0) return;
      const { parentSupply: _parent, ...rest } = demand;
      result.push({
        ...rest,
        projectId: peg.projectId,
        projectElementId: peg.projectElementId ?? null,
        priority: priorityOf?.(peg.projectId) ?? demand.priority,
        quantity,
        parentPegKey: peg.id
      });
    });
  }
  return result;
}

type WorkingDemand = {
  key: string;
  demand: PegDemand;
  remaining: number;
};

type WorkingSupply = {
  supply: PegSupply;
  remaining: number;
};

/**
 * Allocates a planning group's supply to its members' demands for one item at
 * one location:
 * 1. Existing Hard and Manual pegs are fixed and never returned. A Manual
 *    peg's quantity is taken from its supply and its demand first.
 * 2. Each member covers its demand with its own stock and supply. No peg.
 * 3. The rest of the demand takes grouped supply, in priority order, and each
 *    (demand, supply) pair is one peg.
 */
export function pegGroupSegment(args: {
  demands: PegDemand[];
  supplies: PegSupply[];
  existing: ExistingPeg[];
  priorityRule: PegPriorityRule;
}): PegGroupSegmentResult {
  // One working demand per member demand: a job with two lines of the item
  // is one demand of the job.
  const demandsByKey = new Map<string, WorkingDemand>();
  for (const demand of args.demands) {
    if (!demand.projectId || demand.quantity <= 0) continue;
    const key = demandKeyOf(
      demand.projectId,
      demand.sourceType,
      demand.sourceId
    );
    const current = demandsByKey.get(key);
    if (!current) {
      demandsByKey.set(key, {
        key,
        demand: { ...demand },
        remaining: demand.quantity
      });
      continue;
    }
    current.remaining += demand.quantity;
    current.demand.quantity += demand.quantity;
    if (demand.needDate < current.demand.needDate) {
      current.demand.needDate = demand.needDate;
    }
  }

  const suppliesByKey = new Map<string, WorkingSupply>();
  for (const supply of args.supplies) {
    if (supply.quantity <= 0) continue;
    const key = supplyKeyOf(supply.supplyType, supply.supplyId);
    const current = suppliesByKey.get(key);
    if (current) current.remaining += supply.quantity;
    else suppliesByKey.set(key, { supply, remaining: supply.quantity });
  }

  // 1. Fixed pegs. A Hard peg is never recomputed, but it takes nothing
  // here: its supply was received (the open supply no longer holds that
  // quantity) and the stock now sits in the member's own stripe, which step
  // 2 counts. Taking it again would count the receipt twice. A Manual peg is
  // on open supply, so it takes from its supply and its demand.
  const manualWithoutDemand: ExistingPeg[] = [];
  for (const peg of args.existing) {
    if (peg.state !== "Manual") continue;
    const supply = suppliesByKey.get(supplyKeyOf(peg.supplyType, peg.supplyId));
    if (supply) supply.remaining = Math.max(0, supply.remaining - peg.quantity);
    const demand = demandsByKey.get(
      demandKeyOf(peg.projectId, peg.demandSourceType, peg.demandSourceId)
    );
    if (demand) {
      demand.remaining = Math.max(0, demand.remaining - peg.quantity);
    } else {
      manualWithoutDemand.push(peg);
    }
  }

  const byPriority = (a: WorkingDemand, b: WorkingDemand) =>
    args.priorityRule === "Project Priority"
      ? a.demand.priority - b.demand.priority ||
        compareText(a.demand.needDate, b.demand.needDate) ||
        compareText(a.demand.sourceId, b.demand.sourceId) ||
        compareText(a.key, b.key)
      : compareText(a.demand.needDate, b.demand.needDate) ||
        a.demand.priority - b.demand.priority ||
        compareText(a.demand.sourceId, b.demand.sourceId) ||
        compareText(a.key, b.key);
  const ordered = [...demandsByKey.values()].sort(byPriority);

  // 2. Each member's own stock and supply.
  const ownByProject = new Map<string, number>();
  for (const { supply, remaining } of suppliesByKey.values()) {
    if (supply.ownerProjectId === null || remaining <= 0) continue;
    ownByProject.set(
      supply.ownerProjectId,
      (ownByProject.get(supply.ownerProjectId) ?? 0) + remaining
    );
  }
  for (const working of ordered) {
    const own = ownByProject.get(working.demand.projectId) ?? 0;
    if (own <= 0 || working.remaining <= 0) continue;
    const take = Math.min(own, working.remaining);
    working.remaining -= take;
    ownByProject.set(working.demand.projectId, own - take);
  }

  // 3–5. Grouped supply, in date order, to the demands in priority order.
  const grouped = [...suppliesByKey.values()]
    .filter(
      (
        working
      ): working is WorkingSupply & {
        supply: PegSupply & { supplyType: PegSupplyType };
      } =>
        working.supply.ownerProjectId === null &&
        working.supply.supplyType !== "Stock" &&
        working.remaining > EPSILON
    )
    .sort(
      (a, b) =>
        compareText(a.supply.availableDate, b.supply.availableDate) ||
        SUPPLY_TYPE_ORDER[a.supply.supplyType] -
          SUPPLY_TYPE_ORDER[b.supply.supplyType] ||
        compareText(a.supply.supplyId, b.supply.supplyId)
    );

  const pegs: ComputedPeg[] = [];
  const shortages: PegShortage[] = [];
  let next = 0;
  for (const working of ordered) {
    while (working.remaining > EPSILON && next < grouped.length) {
      const source = grouped[next]!;
      const take = Math.min(source.remaining, working.remaining);
      const quantity = round(take);
      if (quantity > 0) {
        pegs.push({
          supplyType: source.supply.supplyType,
          supplyId: source.supply.supplyId,
          projectId: working.demand.projectId,
          projectElementId: working.demand.projectElementId,
          demandSourceType: working.demand.sourceType,
          demandSourceId: working.demand.sourceId,
          quantity,
          needDate: working.demand.needDate,
          parentPegKey: working.demand.parentPegKey ?? null
        });
      }
      working.remaining -= take;
      source.remaining -= take;
      if (source.remaining <= EPSILON) next += 1;
    }
    const short = round(working.remaining);
    if (short > 0) {
      shortages.push({
        projectId: working.demand.projectId,
        projectElementId: working.demand.projectElementId,
        sourceType: working.demand.sourceType,
        sourceId: working.demand.sourceId,
        needDate: working.demand.needDate,
        quantity: short
      });
    }
  }

  const excess: PegExcess[] = [];
  for (const source of grouped) {
    const quantity = round(source.remaining);
    if (quantity > 0) {
      excess.push({
        supplyType: source.supply.supplyType,
        supplyId: source.supply.supplyId,
        quantity
      });
    }
  }

  return { pegs, shortages, excess, manualWithoutDemand };
}

export type PegDiff = {
  /** Current Soft pegs the run leaves as they are. */
  keepIds: string[];
  /** Current Soft pegs a newer row replaces, or whose demand or supply is gone. */
  supersedeIds: string[];
  inserts: ComputedPeg[];
};

/**
 * The change from the current Soft pegs to the computed ones. A peg is keyed
 * by supply, project and demand source; an unchanged quantity keeps the row,
 * any other change supersedes it and inserts a new one. Never an update.
 */
export function diffPegs(
  existingSoft: ExistingPeg[],
  computed: ComputedPeg[]
): PegDiff {
  const computedByKey = new Map<string, ComputedPeg>();
  for (const peg of computed) {
    const key = pegKeyOf(peg);
    const current = computedByKey.get(key);
    if (current) {
      computedByKey.set(key, {
        ...current,
        quantity: round(current.quantity + peg.quantity)
      });
    } else {
      computedByKey.set(key, peg);
    }
  }

  const keepIds: string[] = [];
  const supersedeIds: string[] = [];
  const kept = new Set<string>();
  for (const peg of existingSoft) {
    if (peg.state !== "Soft") continue;
    const key = pegKeyOf(peg);
    const target = computedByKey.get(key);
    if (target && !kept.has(key) && equals(target.quantity, peg.quantity)) {
      keepIds.push(peg.id);
      kept.add(key);
    } else {
      supersedeIds.push(peg.id);
    }
  }

  const inserts = [...computedByKey.entries()]
    .filter(([key]) => !kept.has(key))
    .map(([, peg]) => peg);

  return { keepIds, supersedeIds, inserts };
}
