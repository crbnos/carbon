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
import { parseDate } from "@internationalized/date";

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

/** One planning group's demand and supply of one item at one location. */
export type GroupPegInput = {
  planningGroupId: string;
  itemId: string;
  locationId: string;
  demands: PegDemand[];
  supplies: PegSupply[];
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

/** One member's own position in an item at a location. */
export type MemberPosition = {
  projectId: string;
  priority: number;
  /** The member's own on-hand stock. */
  stock: number;
  /** The member's own open supply, by the date it arrives. */
  supplies: { date: string; quantity: number }[];
  /** The member's own demand, by the date it is needed. */
  demands: { needDate: string; quantity: number }[];
};

/** A proposed move of stock from one member to a short sibling. */
export type MemberMove = {
  type: "Transfer" | "Borrow";
  fromProjectId: string;
  toProjectId: string;
  quantity: number;
  /** The date the short member needs the stock. */
  needDate: string;
  /** Borrow only: the date the borrower must pay the stock back. */
  paybackDueDate: string | null;
};

type MemberTimeline = {
  member: MemberPosition;
  /** Each new deficit of the member's own balance, by date. */
  shortfalls: { needDate: string; quantity: number }[];
  /** Stock the member never needs within the horizon. */
  permanentExcess: number;
  /** The first date the member needs its own stock, within the horizon. */
  nextNeedDate: string | null;
};

function timelineOf(
  member: MemberPosition,
  horizonEndDate: string
): MemberTimeline {
  const events = [
    ...member.supplies
      .filter((supply) => supply.quantity > 0 && supply.date <= horizonEndDate)
      .map((supply) => ({ date: supply.date, quantity: supply.quantity })),
    ...member.demands
      .filter(
        (demand) => demand.quantity > 0 && demand.needDate <= horizonEndDate
      )
      .map((demand) => ({ date: demand.needDate, quantity: -demand.quantity }))
  ].sort(
    // supply before demand on the same date
    (a, b) => compareText(a.date, b.date) || b.quantity - a.quantity
  );

  const stock = Math.max(0, member.stock);
  let balance = stock;
  let lowest = Math.min(stock, 0);
  let minBalance = stock;
  let nextNeedDate: string | null = null;
  const shortfalls: MemberTimeline["shortfalls"] = [];
  for (const event of events) {
    balance += event.quantity;
    if (event.quantity < 0 && nextNeedDate === null) nextNeedDate = event.date;
    minBalance = Math.min(minBalance, balance);
    if (balance < lowest - EPSILON) {
      shortfalls.push({ needDate: event.date, quantity: lowest - balance });
      lowest = balance;
    }
  }
  return {
    member,
    shortfalls,
    permanentExcess: Math.max(0, Math.min(stock, minBalance)),
    nextNeedDate
  };
}

/**
 * Proposes the moves of stock between the members of one planning group, for
 * one item at one location. A move never changes the group's net requirement:
 * it only moves stock the group already holds to the member that needs it.
 * 1. A member's shortfall is the demand its own stock and supply do not cover
 *    up to `horizonEndDate`.
 * 2. The shortfalls are walked in the Task 6 order (`priorityRule`). Each one
 *    takes from the siblings in project id order.
 * 3. From each sibling, a **Transfer** takes its permanent excess first: the
 *    stock it never needs within the horizon.
 * 4. Then a **Borrow** takes the rest of its stock, if the sibling first needs
 *    it after the short member does. The payback date is the sibling's next
 *    need date less `leadTimeDays`, never before `today`.
 * A member with a shortfall of its own lends nothing.
 */
export function proposeMemberMoves(args: {
  members: MemberPosition[];
  horizonEndDate: string;
  leadTimeDays: number;
  today: string;
  priorityRule?: PegPriorityRule;
}): MemberMove[] {
  const timelines = args.members.map((member) =>
    timelineOf(member, args.horizonEndDate)
  );
  const lenders = timelines
    .filter((timeline) => timeline.shortfalls.length === 0)
    .map((timeline) => ({
      timeline,
      transferable: timeline.permanentExcess,
      borrowable: Math.max(0, timeline.member.stock) - timeline.permanentExcess
    }))
    .sort((a, b) =>
      compareText(a.timeline.member.projectId, b.timeline.member.projectId)
    );
  if (lenders.length === 0) return [];

  const shortfalls = timelines
    .flatMap((timeline) =>
      timeline.shortfalls.map((shortfall) => ({
        ...shortfall,
        member: timeline.member
      }))
    )
    .sort((a, b) =>
      args.priorityRule === "Project Priority"
        ? a.member.priority - b.member.priority ||
          compareText(a.needDate, b.needDate) ||
          compareText(a.member.projectId, b.member.projectId)
        : compareText(a.needDate, b.needDate) ||
          a.member.priority - b.member.priority ||
          compareText(a.member.projectId, b.member.projectId)
    );

  const leadTimeDays = Math.max(0, args.leadTimeDays || 0);
  const moves: MemberMove[] = [];
  for (const shortfall of shortfalls) {
    let need = shortfall.quantity;
    for (const lender of lenders) {
      if (need <= EPSILON) break;
      const fromProjectId = lender.timeline.member.projectId;
      if (fromProjectId === shortfall.member.projectId) continue;

      const transfer = Math.min(need, lender.transferable);
      if (round(transfer) > 0) {
        moves.push({
          type: "Transfer",
          fromProjectId,
          toProjectId: shortfall.member.projectId,
          quantity: round(transfer),
          needDate: shortfall.needDate,
          paybackDueDate: null
        });
        lender.transferable -= transfer;
        need -= transfer;
      }

      const nextNeedDate = lender.timeline.nextNeedDate;
      if (
        need <= EPSILON ||
        nextNeedDate === null ||
        nextNeedDate <= shortfall.needDate
      ) {
        continue;
      }
      const borrow = Math.min(need, lender.borrowable);
      if (round(borrow) > 0) {
        const payback = parseDate(nextNeedDate)
          .subtract({ days: leadTimeDays })
          .toString();
        moves.push({
          type: "Borrow",
          fromProjectId,
          toProjectId: shortfall.member.projectId,
          quantity: round(borrow),
          needDate: shortfall.needDate,
          paybackDueDate: payback < args.today ? args.today : payback
        });
        lender.borrowable -= borrow;
        need -= borrow;
      }
    }
  }
  return moves;
}

/**
 * The members' own positions in one peg input: each member's own stock, own
 * open supply and own demand. A grouped job's component demand with no
 * project yet is left out: it belongs to no member until the job is pegged.
 */
export function memberPositionsOf(
  input: GroupPegInput,
  memberProjectIds: readonly string[],
  priorityByProject: Readonly<Record<string, number>>
): MemberPosition[] {
  return memberProjectIds.map((projectId) => {
    const own = input.supplies.filter(
      (supply) => supply.ownerProjectId === projectId
    );
    return {
      projectId,
      priority: priorityByProject[projectId] ?? 100,
      stock: own
        .filter((supply) => supply.supplyType === "Stock")
        .reduce((sum, supply) => sum + supply.quantity, 0),
      supplies: own
        .filter((supply) => supply.supplyType !== "Stock")
        .map((supply) => ({
          date: supply.availableDate,
          quantity: supply.quantity
        })),
      demands: input.demands
        .filter((demand) => demand.projectId === projectId)
        .map((demand) => ({
          needDate: demand.needDate,
          quantity: demand.quantity
        }))
    };
  });
}

/**
 * The peg input after the proposed moves: the stock leaves the lender and
 * joins the short member, so the short member's own stock covers its demand
 * before pegging (`pegGroupSegment` step 2). The group's total does not change.
 */
export function applyMemberMoves(
  input: GroupPegInput,
  moves: readonly MemberMove[],
  today: string
): GroupPegInput {
  if (moves.length === 0) return input;
  const delta = new Map<string, number>();
  for (const move of moves) {
    delta.set(
      move.fromProjectId,
      (delta.get(move.fromProjectId) ?? 0) - move.quantity
    );
    delta.set(
      move.toProjectId,
      (delta.get(move.toProjectId) ?? 0) + move.quantity
    );
  }
  // One Stock row per member: the member's rows summed, then moved.
  const stockByProject = new Map<string, number>();
  const supplies: PegSupply[] = [];
  for (const supply of input.supplies) {
    if (supply.supplyType === "Stock" && supply.ownerProjectId) {
      stockByProject.set(
        supply.ownerProjectId,
        (stockByProject.get(supply.ownerProjectId) ?? 0) + supply.quantity
      );
    } else {
      supplies.push(supply);
    }
  }
  for (const [projectId, change] of delta) {
    stockByProject.set(
      projectId,
      (stockByProject.get(projectId) ?? 0) + change
    );
  }
  for (const [projectId, quantity] of stockByProject) {
    if (round(quantity) <= 0) continue;
    supplies.push({
      supplyType: "Stock",
      supplyId: projectId,
      ownerProjectId: projectId,
      availableDate: today,
      quantity: round(quantity)
    });
  }
  return { ...input, supplies };
}
