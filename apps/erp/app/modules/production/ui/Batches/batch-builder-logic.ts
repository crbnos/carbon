// Pure logic behind the batch builder: signatures, per-candidate value sets,
// duration math, and suggestion scoring. No JSX and no lingui, so vitest can
// import it directly (the ERP barrels drag lingui macros vitest cannot
// transform — see apps/erp/test/batching-migration-guards.test.ts).

import {
  BATCH_RULE_DIMENSIONS,
  type BatchRules,
  type MemberValueSets,
  mustViolations,
  resolveBatchRules
} from "@carbon/utils";
import { makeDurations } from "~/utils/duration";
import type { BatchCandidate, BatchMaterial } from "../../types";

// Default rules resolve to substance/grade/dimension = guide, form/finish/item =
// ignore — which is the pre-rules signature exactly, so an unconfigured process
// groups as it always did.
export const DEFAULT_RESOLVED_RULES = resolveBatchRules(null);

// One BOM line's display/grouping string, honoring the process's compatibility
// rules: the value of each non-"ignore" dimension, in a stable order; else the
// material item itself — BOMs without normalized properties still group by what
// they actually consume. With default rules this is substance/grade/dimension.
export function lineSignature(
  line: BatchMaterial,
  rules: Required<BatchRules> = DEFAULT_RESOLVED_RULES
): string | null {
  const parts: string[] = [];
  if (rules.substance !== "ignore" && line.substanceName)
    parts.push(line.substanceName);
  if (rules.grade !== "ignore" && line.gradeName) parts.push(line.gradeName);
  if (rules.dimension !== "ignore" && line.dimensionName)
    parts.push(line.dimensionName);
  if (rules.form !== "ignore" && line.formName) parts.push(line.formName);
  if (rules.finish !== "ignore" && line.finishName) parts.push(line.finishName);
  if (rules.item !== "ignore" && line.itemReadableId)
    parts.push(line.itemReadableId);
  return parts.join(" · ") || line.itemReadableId || null;
}

// A candidate's MATERIAL signature: the sorted set of its BOM lines' signatures
// (see lineSignature). Empty when the operation consumes no BOM materials —
// material-facing surfaces (the mixed-materials warning) must not invent one.
export function materialSignature(
  candidate: BatchCandidate,
  rules: Required<BatchRules> = DEFAULT_RESOLVED_RULES
): string {
  const sigs = new Set<string>();
  for (const m of candidate.materials ?? []) {
    const s = lineSignature(m, rules);
    if (s) sigs.add(s);
  }
  return [...sigs].sort().join(" + ");
}

// The GROUPING key: the material signature, falling back to the produced item
// when the operation has no BOM materials (assembly of made sub-parts) — so
// same-part ops still group and get suggested. Deliberately distinct from
// materialSignature: the fallback must never leak into material warnings.
export function groupingKey(
  candidate: BatchCandidate,
  rules: Required<BatchRules> = DEFAULT_RESOLVED_RULES
): string {
  return materialSignature(candidate, rules) || candidate.itemReadableId || "";
}

// The per-dimension value sets one candidate carries across its BOM lines, for
// mustViolations (client side uses names; the interface is value-agnostic).
export function candidateValueSets(candidate: BatchCandidate): MemberValueSets {
  const item: string[] = [];
  const substance: string[] = [];
  const grade: string[] = [];
  const dimension: string[] = [];
  const form: string[] = [];
  const finish: string[] = [];
  for (const m of candidate.materials ?? []) {
    if (m.itemReadableId) item.push(m.itemReadableId);
    if (m.substanceName) substance.push(m.substanceName);
    if (m.gradeName) grade.push(m.gradeName);
    if (m.dimensionName) dimension.push(m.dimensionName);
    if (m.formName) form.push(m.formName);
    if (m.finishName) finish.push(m.finishName);
  }
  return { item, substance, grade, dimension, form, finish };
}

export function setupDurationOf(candidate: BatchCandidate): number {
  return makeDurations({
    setupTime: candidate.setupTime ?? 0,
    setupUnit: candidate.setupUnit ?? undefined,
    operationQuantity: candidate.operationQuantity
  }).setupDuration;
}

// Batching shares ONE setup (the largest member's) — the saving is the rest.
export function groupSetupSaving(members: BatchCandidate[]): number {
  if (members.length < 2) return 0;
  const setups = members.map(setupDurationOf);
  const sum = setups.reduce((acc, s) => acc + s, 0);
  const max = Math.max(0, ...setups);
  return max > 0 && sum > max ? sum - max : 0;
}

// Estimated batch run time: one shared setup (largest), labor and machine summed.
export function batchEstimateMs(members: BatchCandidate[]): number {
  let setupMax = 0;
  let laborSum = 0;
  let machineSum = 0;
  for (const c of members) {
    const d = makeDurations({
      setupTime: c.setupTime ?? 0,
      setupUnit: c.setupUnit ?? undefined,
      laborTime: c.laborTime ?? 0,
      laborUnit: c.laborUnit ?? undefined,
      machineTime: c.machineTime ?? 0,
      machineUnit: c.machineUnit ?? undefined,
      operationQuantity: c.operationQuantity
    });
    setupMax = Math.max(setupMax, d.setupDuration);
    laborSum += d.laborDuration;
    machineSum += d.machineDuration;
  }
  return setupMax + laborSum + machineSum;
}

export function dueDateOf(candidate: BatchCandidate): string | null {
  return candidate.dueDate ?? candidate.jobDueDate;
}

// A ranked suggested batch: a nesting-compatible group plus the signals that
// place it. `score` blends setup saved, due urgency, capacity fit, and how
// specifically the group's materials match; `reason` names the dominant driver
// for the banner copy.
export type Suggestion = {
  sig: string;
  members: BatchCandidate[];
  saving: number;
  totalQuantity: number;
  earliestDue: string | null;
  fillRatio: number | null;
  score: number;
  reason: "urgent" | "fills" | "setup" | "group";
};

// How many non-"ignore" dimensions this group actually matches on: a dimension
// counts when at least one member carries a value for it. Computed from the
// value sets, never by parsing the signature string — a material name that
// itself contains " · " must not inflate the count.
function groupSpecificity(
  members: BatchCandidate[],
  rules: Required<BatchRules>
): number {
  const sets = members.map(candidateValueSets);
  let count = 0;
  for (const dim of BATCH_RULE_DIMENSIONS) {
    if (rules[dim] === "ignore") continue;
    if (sets.some((s) => (s[dim]?.length ?? 0) > 0)) count += 1;
  }
  return count;
}

// Score every ≥2-member group and return the best few. Two-pass: gather raw
// signals, then normalise across the set so one big group can't crowd out a
// small-but-urgent one. `daysUntil` maps a due date to days from today (the
// caller owns "today" so this stays pure and testable); `repCapacity` is the
// representative run size for the scoped process.
export function rankSuggestions(
  groups: Map<string, BatchCandidate[]>,
  rules: Required<BatchRules>,
  repCapacity: number | null,
  daysUntil: (due: string) => number
): Suggestion[] {
  const raw = [...groups.entries()]
    .filter(([, g]) => g.length >= 2)
    // A shared signature already pins the must dimensions, but a group where
    // some members simply lack a must value could still be unsafe — never
    // suggest a group that would fail the server's own check.
    .filter(
      ([, g]) => mustViolations(rules, g.map(candidateValueSets)).length === 0
    )
    .map(([sig, g]) => {
      const saving = groupSetupSaving(g);
      const totalQuantity = g.reduce(
        (s, c) => s + (c.operationQuantity ?? 0),
        0
      );
      const dues = g
        .map(dueDateOf)
        .filter((d): d is string => Boolean(d))
        .sort();
      const earliestDue = dues[0] ?? null;
      const daysToDue = earliestDue
        ? Math.max(0, daysUntil(earliestDue))
        : null;
      const fillRatio =
        repCapacity && repCapacity > 0 ? totalQuantity / repCapacity : null;
      const specificity = groupSpecificity(g, rules);
      return {
        sig,
        members: g,
        saving,
        totalQuantity,
        earliestDue,
        daysToDue,
        fillRatio,
        specificity
      };
    });

  if (raw.length === 0) return [];

  const maxSaving = Math.max(1, ...raw.map((r) => r.saving));
  const maxSpec = Math.max(1, ...raw.map((r) => r.specificity));

  return raw
    .map((r): Suggestion => {
      const setupScore = r.saving / maxSaving;
      const urgencyScore = r.daysToDue == null ? 0 : 1 / (1 + r.daysToDue / 7);
      const fitScore =
        r.fillRatio == null
          ? 0.4 // neutral — no capacity model to judge against
          : r.fillRatio <= 1
            ? r.fillRatio // fuller is better, up to a full run
            : Math.max(0, 1 - (r.fillRatio - 1)); // over-capacity falls off
      const specScore = r.specificity / maxSpec;
      const score =
        0.4 * setupScore +
        0.35 * urgencyScore +
        0.15 * fitScore +
        0.1 * specScore;

      const reason: Suggestion["reason"] =
        urgencyScore >= 0.5
          ? "urgent"
          : r.fillRatio != null && r.fillRatio >= 0.85 && r.fillRatio <= 1.15
            ? "fills"
            : r.saving > 0
              ? "setup"
              : "group";

      return {
        sig: r.sig,
        members: r.members,
        saving: r.saving,
        totalQuantity: r.totalQuantity,
        earliestDue: r.earliestDue,
        fillRatio: r.fillRatio,
        score,
        reason
      };
    })
    .sort((a, b) => b.score - a.score || b.members.length - a.members.length)
    .slice(0, 6);
}
