// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

// Float slack: 0.1 × 30 must not read as short of 3.
const EPSILON = 1e-9;

/** An open job for the item, and what it still has to issue. */
export type OpenJob = {
  id: string;
  readableId: string;
  status: Database["public"]["Enums"]["jobStatus"];
  /** YYYY-MM-DD */
  dueDate: string | null;
  priority: number | null;
  /** good units not yet received to inventory or shipped: no scrap allowance */
  quantityRemaining: number;
  /** what each material still has to be issued, in the line's unit */
  materials: {
    itemId: string;
    quantityToIssue: number;
    unitOfMeasureCode: string | null;
  }[];
};

export type JobCoverage = {
  id: string;
  readableId: string;
  status: OpenJob["status"];
  dueDate: string | null;
  quantityRemaining: number;
  /** stock covers everything the job still has to issue. Null when a material's unit is not its item's stock unit, so the two cannot be compared */
  hasAllParts: boolean | null;
  /** the items it is short of, after the more urgent jobs took what they lack */
  shortItems: number;
};

export type JobShortage = {
  itemId: string;
  /** what the jobs without their parts still lack, after stock */
  quantityShort: number;
  /** the jobs short of the item */
  jobs: number;
};

// Earliest due date first, then the job's priority, then its number.
const byUrgency = (a: OpenJob, b: OpenJob) => {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const priority =
    (a.priority ?? Number.POSITIVE_INFINITY) -
    (b.priority ?? Number.POSITIVE_INFINITY);
  if (priority !== 0 && !Number.isNaN(priority)) return priority;
  return a.readableId < b.readableId ? -1 : a.readableId > b.readableId ? 1 : 0;
};

/**
 * Which open jobs the stock can finish, and what the others lack.
 *
 * Two passes over the jobs, the most urgent first. The first gives stock to
 * every job it covers in full, so a job that cannot be finished holds nothing
 * back from one that can. The second gives what is left to the other jobs and
 * records what each still lacks: a job that takes the last of an item leaves
 * the next job short of it, so a job's count depends on the jobs before it
 * while each item's total does not.
 *
 * `stock` is what the jobs may draw of an item: a job material is a line the
 * job draws from stock, so a made item that is short has to be made first.
 */
export function coverJobs(args: {
  jobs: OpenJob[];
  stock: (itemId: string) => number;
}): {
  jobs: (JobCoverage & { hasAllParts: boolean })[];
  shortages: JobShortage[];
} {
  const left = new Map<string, number>();
  const remaining = (itemId: string) =>
    left.get(itemId) ?? Math.max(args.stock(itemId), 0);

  const ordered = [...args.jobs].sort(byUrgency).map((job) => {
    const needs = new Map<string, number>();
    for (const line of job.materials) {
      if (line.quantityToIssue <= EPSILON) continue;
      needs.set(
        line.itemId,
        (needs.get(line.itemId) ?? 0) + line.quantityToIssue
      );
    }
    return { job, needs, hasAllParts: false, shortItems: 0 };
  });

  for (const entry of ordered) {
    entry.hasAllParts = Array.from(entry.needs).every(
      ([itemId, need]) => need <= remaining(itemId) + EPSILON
    );
    if (!entry.hasAllParts) continue;
    for (const [itemId, need] of entry.needs) {
      left.set(itemId, Math.max(remaining(itemId) - need, 0));
    }
  }

  const shortages = new Map<string, JobShortage>();
  for (const entry of ordered) {
    if (entry.hasAllParts) continue;
    for (const [itemId, need] of entry.needs) {
      const taken = Math.min(need, remaining(itemId));
      left.set(itemId, remaining(itemId) - taken);
      const short = need - taken;
      if (short <= EPSILON) continue;
      entry.shortItems += 1;
      const shortage = shortages.get(itemId) ?? {
        itemId,
        quantityShort: 0,
        jobs: 0
      };
      shortage.quantityShort += short;
      shortage.jobs += 1;
      shortages.set(itemId, shortage);
    }
  }

  return {
    jobs: ordered.map(({ job, hasAllParts, shortItems }) => ({
      id: job.id,
      readableId: job.readableId,
      status: job.status,
      dueDate: job.dueDate,
      quantityRemaining: job.quantityRemaining,
      hasAllParts,
      shortItems
    })),
    // The item most jobs wait on first.
    shortages: Array.from(shortages.values()).sort(
      (a, b) => b.jobs - a.jobs || b.quantityShort - a.quantityShort
    )
  };
}
