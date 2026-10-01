// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Pure planner for maintenance labor postings. A dispatch's time entries are
// expensed at their work center's labor rate: Dr maintenanceAccount /
// Cr laborAbsorptionAccount. Rather than tracking a posted flag, every call
// reconciles: it builds what the entries SHOULD have posted, subtracts what the
// journal already holds, and posts only the difference. So posting twice is a
// no-op, an edit posts an adjustment, a deleted entry reverses to zero, and a
// change of work center or employee reverses the old tags and posts the new.
//
// A group is one (entry, account, dimension tags) bucket — the grain at which
// both sides are compared, so a reversal always carries the tags it reverses.

import { EPSILON, round } from "../shared/precision.ts";

export interface LaborDimension {
  dimensionId: string;
  valueId: string;
}

export interface LaborGroup {
  reference: string; // journalLine.documentLineReference
  accountId: string;
  dimensions: LaborDimension[];
  amount: number; // signed, journalLine convention
}

export function maintenanceLaborCost(
  durationSeconds: number | null | undefined,
  laborRate: number | null | undefined
): number {
  const hours = Number(durationSeconds ?? 0) / 3600;
  const cost = round(hours * Number(laborRate ?? 0));
  return cost > 0 ? cost : 0;
}

export function laborGroupKey(
  group: Pick<LaborGroup, "reference" | "accountId" | "dimensions">
): string {
  const dims = group.dimensions
    .map((d) => `${d.dimensionId}=${d.valueId}`)
    .sort()
    .join(",");
  return `${group.reference}|${group.accountId}|${dims}`;
}

// Sum signed amounts per group key (several postings of one entry collapse to
// their net).
export function netLaborGroups(groups: LaborGroup[]): Map<string, LaborGroup> {
  const net = new Map<string, LaborGroup>();
  for (const group of groups) {
    const key = laborGroupKey(group);
    const existing = net.get(key);
    if (existing) {
      existing.amount += group.amount;
    } else {
      net.set(key, { ...group, dimensions: [...group.dimensions] });
    }
  }
  return net;
}

// desired − prior, per group. Both sides balance, so the result does too.
export function diffLaborGroups(
  desired: LaborGroup[],
  prior: LaborGroup[]
): LaborGroup[] {
  const want = netLaborGroups(desired);
  const have = netLaborGroups(prior);
  const keys = new Set([...want.keys(), ...have.keys()]);

  const delta: LaborGroup[] = [];
  for (const key of keys) {
    const target = want.get(key);
    const current = have.get(key);
    const amount = round((target?.amount ?? 0) - (current?.amount ?? 0));
    if (Math.abs(amount) < EPSILON) continue;
    const base = (target ?? current)!;
    delta.push({ ...base, amount });
  }
  return delta;
}
