// Per-process batch compatibility rules: how strictly each BOM dimension gates
// which job operations may share a batch run.
//
// Canonical source (with the vitest coverage in packages/utils). Deno edge
// functions cannot import workspace packages, so @carbon/utils RE-EXPORTS this
// file (see packages/utils/src/batch-compatibility.ts) — one source of truth,
// no drift. Dependency-free pure TS. See .ai/specs/2026-08-21-job-operation-batching.md.

export type BatchRuleLevel = "must" | "guide" | "ignore";

// The six BOM dimensions a batch can be gated on. `item` is the material line's
// own item; the other five are its material properties.
export const BATCH_RULE_DIMENSIONS = [
  "item",
  "substance",
  "grade",
  "dimension",
  "form",
  "finish"
] as const;

export type BatchRuleDimension = (typeof BATCH_RULE_DIMENSIONS)[number];

export type BatchRules = Partial<Record<BatchRuleDimension, BatchRuleLevel>>;

// Defaults reproduce today's suggestion signature EXACTLY: substance/grade/
// dimension split groups (guide), form/finish/item never do (ignore). Changing
// these silently reshuffles every existing user's suggestion groups.
export const DEFAULT_BATCH_RULES: Required<BatchRules> = {
  item: "ignore",
  substance: "guide",
  grade: "guide",
  dimension: "guide",
  form: "ignore",
  finish: "ignore"
};

const LEVELS: ReadonlySet<BatchRuleLevel> = new Set([
  "must",
  "guide",
  "ignore"
]);

/**
 * Resolve a raw (sparse, possibly null) rule set into a full one, applying the
 * defaults for any dimension not explicitly set. Unknown keys and invalid
 * levels are ignored — a malformed stored value never overrides a default.
 */
export function resolveBatchRules(
  raw: BatchRules | null | undefined
): Required<BatchRules> {
  const resolved: Required<BatchRules> = { ...DEFAULT_BATCH_RULES };
  if (!raw || typeof raw !== "object") return resolved;
  for (const dim of BATCH_RULE_DIMENSIONS) {
    const level = raw[dim];
    if (level != null && LEVELS.has(level)) {
      resolved[dim] = level;
    }
  }
  return resolved;
}

/**
 * Compact a full rule set back to a sparse one, dropping every dimension equal
 * to its default. Returns null when nothing differs from the defaults — the
 * shape stored in `process.batchRules` (NULL = defaults).
 */
export function compactBatchRules(
  rules: Required<BatchRules>
): BatchRules | null {
  const sparse: BatchRules = {};
  let hasOverride = false;
  for (const dim of BATCH_RULE_DIMENSIONS) {
    if (rules[dim] !== DEFAULT_BATCH_RULES[dim]) {
      sparse[dim] = rules[dim];
      hasOverride = true;
    }
  }
  return hasOverride ? sparse : null;
}

/**
 * The per-member value sets for one candidate: for each dimension, the set of
 * values that member carries (ids on the server, names on the client — the fold
 * is agnostic to which). A dimension the member has no data for is absent or
 * empty, and such a member always passes (unrecorded data is never enforced).
 */
export type MemberValueSets = Partial<Record<BatchRuleDimension, string[]>>;

/**
 * Which "must" dimensions the given members violate. Per must-dim, fold the
 * intersection of values across every member that has ≥1 value for it; a
 * violation is an empty fold (no single value shared by all recorded members).
 * Members with no value for the dim are skipped, so a batch of one recorded +
 * many unrecorded members never trips. Order-independent.
 */
export function mustViolations(
  rules: Required<BatchRules>,
  members: MemberValueSets[]
): BatchRuleDimension[] {
  const violations: BatchRuleDimension[] = [];
  for (const dim of BATCH_RULE_DIMENSIONS) {
    if (rules[dim] !== "must") continue;

    let fold: string[] | null = null;
    for (const member of members) {
      const values = member[dim];
      if (!values || values.length === 0) continue; // unrecorded → always passes
      if (fold === null) {
        fold = values.slice();
      } else {
        const current = new Set(values);
        fold = fold.filter((v) => current.has(v));
      }
    }

    // fold === null → no member had a value → nothing to enforce.
    if (fold !== null && fold.length === 0) {
      violations.push(dim);
    }
  }
  return violations;
}
