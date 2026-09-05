// Pure logic behind the batch builder: signatures, per-candidate value sets,
// duration math, and suggestion scoring. No JSX and no lingui, so vitest can
// import it directly (the ERP barrels drag lingui macros vitest cannot
// transform — see apps/erp/test/batching-migration-guards.test.ts).

import {
  BATCH_RULE_DIMENSIONS,
  type BatchRuleDimension,
  type BatchRules,
  type BatchType,
  type MemberValueSets,
  mustViolations,
  resolveBatchRules
} from "@carbon/utils";
import { type CalendarDate, parseDate } from "@internationalized/date";
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

// One member's duration inputs — the raw setup/labor/machine time + units. The
// batch-detail drawer's members and the builder's candidates both satisfy it.
export type BatchDurationMember = {
  setupTime?: number | null;
  setupUnit?: string | null;
  laborTime?: number | null;
  laborUnit?: string | null;
  machineTime?: number | null;
  machineUnit?: string | null;
  operationQuantity: number | null;
};

export type BatchPlanBreakdown = {
  setup: number;
  labor: number;
  machine: number;
};

// The planned batch durations by type: ONE shared setup (the largest member's),
// then labor and machine per the process's batch type — summed for Sequential
// (members run one after another off the shared setup) or the largest member
// for Simultaneous (members run together, e.g. one furnace cycle). The single
// source for the review preview, the setup-saving chip, and the batch-detail
// Run card. `unitDefaults` supplies a per-type fallback unit when a member's
// own unit is null (the drawer defaults setup to Total Minutes and
// labor/machine to Minutes/Piece); the builder passes none, so a missing unit
// contributes nothing.
export function batchPlanBreakdown(
  members: BatchDurationMember[],
  unitDefaults?: {
    setupUnit?: string;
    laborUnit?: string;
    machineUnit?: string;
  },
  batchType: BatchType = "Sequential"
): BatchPlanBreakdown {
  let setup = 0;
  let labor = 0;
  let machine = 0;
  for (const m of members) {
    const d = makeDurations({
      setupTime: m.setupTime ?? 0,
      setupUnit: m.setupUnit ?? unitDefaults?.setupUnit,
      laborTime: m.laborTime ?? 0,
      laborUnit: m.laborUnit ?? unitDefaults?.laborUnit,
      machineTime: m.machineTime ?? 0,
      machineUnit: m.machineUnit ?? unitDefaults?.machineUnit,
      operationQuantity: m.operationQuantity
    });
    setup = Math.max(setup, d.setupDuration);
    if (batchType === "Simultaneous") {
      labor = Math.max(labor, d.laborDuration);
      machine = Math.max(machine, d.machineDuration);
    } else {
      labor += d.laborDuration;
      machine += d.machineDuration;
    }
  }
  return { setup, labor, machine };
}

// Estimated batch run time: one shared setup (largest), plus labor and machine
// per the batch type (see batchPlanBreakdown).
export function batchEstimateMs(
  members: BatchCandidate[],
  batchType: BatchType = "Sequential"
): number {
  const { setup, labor, machine } = batchPlanBreakdown(
    members,
    undefined,
    batchType
  );
  return setup + labor + machine;
}

export function dueDateOf(candidate: BatchCandidate): string | null {
  return candidate.dueDate ?? candidate.jobDueDate;
}

// A ranked suggested batch: a nesting-compatible group plus the signals that
// place it. `score` blends setup saved, due urgency, capacity fit, and how
// specifically the group's materials match; `reason` names the dominant driver
// for the banner copy. `key` is unique per suggestion — one signature can
// yield several due-window clusters, so `sig` alone no longer identifies one.
export type Suggestion = {
  key: string;
  sig: string;
  members: BatchCandidate[];
  saving: number;
  totalQuantity: number;
  earliestDue: string | null;
  fillRatio: number | null;
  score: number;
  reason: "urgent" | "fills" | "setup" | "group";
};

// A suggestion never spans more than a week of due dates. Same material next
// month is next month's batch: grouping August work with late-September work
// saves one setup but sits finished goods (or starves the later job's slot)
// for weeks — the exact anti-pattern the amber due-spread warning flags.
export const SUGGESTION_DUE_WINDOW_DAYS = 7;

// Split a signature group into due-date clusters no wider than
// SUGGESTION_DUE_WINDOW_DAYS. Members are sorted by due date and each joins
// the current cluster while it stays within the window of that cluster's
// EARLIEST due; a wider gap starts a new cluster. Members with no due date
// cluster together at the end — nothing pins them to a week, and mixing them
// into a dated cluster would let an undated op smuggle in date spread.
// Day math rides the caller's `daysUntil` (an affine map of the date), so no
// date parsing happens here.
export function splitByDueWindow(
  members: BatchCandidate[],
  daysUntil: (due: string) => number
): BatchCandidate[][] {
  const dated = members
    .filter((m) => dueDateOf(m) !== null)
    .sort((a, b) => daysUntil(dueDateOf(a)!) - daysUntil(dueDateOf(b)!));
  const undated = members.filter((m) => dueDateOf(m) === null);

  const clusters: BatchCandidate[][] = [];
  let current: BatchCandidate[] = [];
  let currentEarliest: number | null = null;
  for (const m of dated) {
    const days = daysUntil(dueDateOf(m)!);
    if (
      currentEarliest !== null &&
      days - currentEarliest > SUGGESTION_DUE_WINDOW_DAYS
    ) {
      clusters.push(current);
      current = [];
      currentEarliest = null;
    }
    if (currentEarliest === null) currentEarliest = days;
    current.push(m);
  }
  if (current.length > 0) clusters.push(current);
  if (undated.length > 0) clusters.push(undated);
  return clusters;
}

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
    // Same material next month is next month's batch: each signature group is
    // first split into due-window clusters so a suggestion never spans weeks
    // (the ≥2 filter runs per CLUSTER — a group whose dates are spread thin
    // may yield nothing, which is correct).
    .flatMap(([sig, g]) =>
      splitByDueWindow(g, daysUntil).map(
        (cluster, i) => [sig, cluster, i] as const
      )
    )
    .filter(([, g]) => g.length >= 2)
    // A shared signature already pins the must dimensions, but a group where
    // some members simply lack a must value could still be unsafe — never
    // suggest a group that would fail the server's own check.
    .filter(
      ([, g]) => mustViolations(rules, g.map(candidateValueSets)).length === 0
    )
    .map(([sig, g, clusterIndex]) => {
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
        key: `${sig}#${clusterIndex}`,
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
        key: r.key,
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

// --- Facets, filtering, capacity, add-targets ---------------------------------
// Untested gating/derivation logic lifted out of the BatchBuilder component so
// it can be exercised without a DOM. No JSX and no lingui — labels are injected.

// The synthetic facet dimension for the material item itself (vs the five
// normalized properties below).
export const MATERIAL_FACET_KEY = "material";

// The five normalized material-property dimensions. The builder also derives a
// `material` dimension (the BOM item itself) — see deriveFacetDimensions.
export const PROPERTY_FACETS: {
  key: keyof BatchMaterial;
  nameKey: keyof BatchMaterial;
}[] = [
  { key: "substanceId", nameKey: "substanceName" },
  { key: "gradeId", nameKey: "gradeName" },
  { key: "dimensionId", nameKey: "dimensionName" },
  { key: "formId", nameKey: "formName" },
  { key: "finishId", nameKey: "finishName" }
];

export type FacetDimension = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

// Does one BOM line satisfy one facet dimension's selected values?
export function lineMatchesFacet(
  line: BatchMaterial,
  key: string,
  values: string[]
): boolean {
  if (key === MATERIAL_FACET_KEY) {
    return !!line.itemReadableId && values.includes(line.itemReadableId);
  }
  return values.includes(line[key as keyof BatchMaterial] as string);
}

// Filterable dimensions derived from what the candidates' BOMs actually contain:
// the material items themselves plus whichever normalized properties are
// populated. A dimension with no values doesn't appear. `labels` maps each
// dimension key to its display name (the caller owns lingui).
export function deriveFacetDimensions(
  candidates: BatchCandidate[],
  labels: Record<string, string>
): FacetDimension[] {
  const dims: FacetDimension[] = [];

  const materialItems = new Map<string, string>();
  for (const c of candidates) {
    for (const m of c.materials ?? []) {
      if (m.itemReadableId && !materialItems.has(m.itemReadableId)) {
        materialItems.set(m.itemReadableId, m.itemReadableId);
      }
    }
  }
  if (materialItems.size > 0) {
    dims.push({
      key: MATERIAL_FACET_KEY,
      label: labels[MATERIAL_FACET_KEY],
      options: [...materialItems.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ value: id, label: id }))
    });
  }

  for (const f of PROPERTY_FACETS) {
    const seen = new Map<string, string>();
    for (const c of candidates) {
      for (const m of c.materials ?? []) {
        const id = m[f.key] as string | null;
        const name = m[f.nameKey] as string | null;
        if (id && name && !seen.has(id)) seen.set(id, name);
      }
    }
    if (seen.size > 0) {
      dims.push({
        key: f.key,
        label: labels[f.key],
        options: [...seen.entries()]
          .map(([id, name]) => ({ value: id, label: name }))
          .sort((a, b) => a.label.localeCompare(b.label))
      });
    }
  }
  return dims;
}

// A candidate matches if ANY BOM line satisfies ALL active facets, the search
// term matches its job/item/op text, and it falls inside the due window. Sorted
// most-urgent first (due date asc, undated last). `today` is injected so this
// stays pure and testable.
export function filterAndSortCandidates(
  candidates: BatchCandidate[],
  opts: {
    activeFacetKeys: string[];
    facets: Record<string, string[]>;
    search: string;
    dueWindow: number | null;
    today: CalendarDate;
  }
): BatchCandidate[] {
  const { activeFacetKeys, facets, search, dueWindow, today } = opts;
  const term = search.trim().toLowerCase();
  const dueLimit = dueWindow !== null ? today.add({ days: dueWindow }) : null;
  const matches = candidates.filter((c) => {
    if (activeFacetKeys.length > 0) {
      const anyLineMatches = (c.materials ?? []).some((m) =>
        activeFacetKeys.every((key) => lineMatchesFacet(m, key, facets[key]))
      );
      if (!anyLineMatches) return false;
    }
    if (dueLimit) {
      const due = dueDateOf(c);
      if (!due || parseDate(due).compare(dueLimit) > 0) return false;
    }
    if (term) {
      const haystack = [
        c.jobReadableId,
        c.itemReadableId,
        c.itemDescription,
        c.description
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
  return matches.sort((a, b) => {
    const da = dueDateOf(a);
    const db = dueDateOf(b);
    if (da && db) return parseDate(da).compare(parseDate(db));
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

// A representative run size for suggestion scoring. Once a work center is chosen
// its own batchCapacity is authoritative; before one is chosen, fall back to the
// largest batchCapacity among the centers that can run this process here.
export function resolveRepCapacity(
  workCenters: {
    id: string;
    locationId: string | null;
    processes: string[];
    batchCapacity: number | null;
  }[],
  workCenterId: string | null,
  locationId: string,
  processId: string | null
): number | null {
  const selected = workCenterId
    ? workCenters.find((wc) => wc.id === workCenterId)
    : null;
  if (selected?.batchCapacity && selected.batchCapacity > 0) {
    return selected.batchCapacity;
  }
  const eligible = workCenters.filter(
    (wc) =>
      (!wc.locationId || wc.locationId === locationId) &&
      (!processId || wc.processes.includes(processId))
  );
  const caps = eligible
    .map((wc) => wc.batchCapacity)
    .filter((c): c is number => c != null && c > 0);
  return caps.length ? Math.max(...caps) : null;
}

export type BatchAddTarget = {
  batchId: string;
  readableId: string;
  memberCount: number;
};

// Existing Active batches on this process — offered as add targets so a planner
// extends a batch instead of accidentally creating a duplicate.
export function deriveAddTargets(
  allCandidates: BatchCandidate[]
): BatchAddTarget[] {
  const targets = new Map<string, BatchAddTarget>();
  for (const c of allCandidates) {
    if (!c.jobOperationBatchId || c.batchStatus !== "Active") continue;
    const entry = targets.get(c.jobOperationBatchId) ?? {
      batchId: c.jobOperationBatchId,
      readableId: c.batchReadableId ?? "Batch",
      memberCount: 0
    };
    entry.memberCount += 1;
    targets.set(c.jobOperationBatchId, entry);
  }
  return [...targets.values()].sort((a, b) =>
    a.readableId.localeCompare(b.readableId)
  );
}

// --- Compatibility gating against the current selection -----------------------

// The selection's folded intersection per dimension: only members that carry a
// value for it contribute, and the result is their shared values (null when no
// selected member carries one). Drives must-locks and guide-mismatch tags.
export function computeSelectionDimSets(
  selectedValueSets: MemberValueSets[]
): Map<BatchRuleDimension, Set<string> | null> {
  const folded = new Map<BatchRuleDimension, Set<string> | null>();
  for (const dim of BATCH_RULE_DIMENSIONS) {
    let acc: string[] | null = null;
    for (const sets of selectedValueSets) {
      const vals = sets[dim];
      if (!vals || vals.length === 0) continue;
      if (acc === null) {
        acc = vals.slice();
      } else {
        const current = new Set(vals);
        acc = acc.filter((v) => current.has(v));
      }
    }
    folded.set(dim, acc === null ? null : new Set(acc));
  }
  return folded;
}

// A candidate is LOCKED when adding it to the current selection would leave a
// "must" dimension with no shared value — the client mirror of the edge fn's
// `assertMaterialCompatible`. Empty selection locks nothing; already-selected
// candidates are never locked.
export function computeLockedById(
  candidates: BatchCandidate[],
  selectedIds: ReadonlySet<string>,
  selectedValueSets: MemberValueSets[],
  rules: Required<BatchRules>
): Map<string, BatchRuleDimension[]> {
  const map = new Map<string, BatchRuleDimension[]>();
  if (selectedValueSets.length === 0) return map;
  for (const c of candidates) {
    if (selectedIds.has(c.id)) continue;
    const dims = mustViolations(rules, [
      ...selectedValueSets,
      candidateValueSets(c)
    ]);
    if (dims.length) map.set(c.id, dims);
  }
  return map;
}

// GUIDE mismatches (advisory): a guide dimension where the selection has a value
// the candidate can't match. Warned, never blocked.
export function computeGuideMismatches(
  candidates: BatchCandidate[],
  selectedIds: ReadonlySet<string>,
  selectedValueSets: MemberValueSets[],
  selectionDimSets: Map<BatchRuleDimension, Set<string> | null>,
  rules: Required<BatchRules>
): Map<string, BatchRuleDimension[]> {
  const map = new Map<string, BatchRuleDimension[]>();
  if (selectedValueSets.length === 0) return map;
  for (const c of candidates) {
    if (selectedIds.has(c.id)) continue;
    const sets = candidateValueSets(c);
    const dims: BatchRuleDimension[] = [];
    for (const dim of BATCH_RULE_DIMENSIONS) {
      if (rules[dim] !== "guide") continue;
      const selectionSet = selectionDimSets.get(dim);
      if (!selectionSet || selectionSet.size === 0) continue;
      const vals = sets[dim];
      if (!vals || vals.length === 0) continue;
      if (!vals.some((v) => selectionSet.has(v))) dims.push(dim);
    }
    if (dims.length) map.set(c.id, dims);
  }
  return map;
}
