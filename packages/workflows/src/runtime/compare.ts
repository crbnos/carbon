import type { Operator } from "@carbon/utils";
import type { Clause, Combinator } from "../definition/types";
import { resolveValue } from "./resolve";
import type { ClauseEvaluation, RuntimeContext, RuntimeValue } from "./types";
import { isNull } from "./values";

/** Numbers as themselves, dates as ms since epoch. Anything else is not orderable. */
function orderable(value: RuntimeValue): number | undefined {
  if (value.kind !== "primitive") return undefined;
  if (value.of === "number") {
    return typeof value.value === "number" ? value.value : undefined;
  }
  if (value.of === "date") {
    if (typeof value.value !== "string") return undefined;
    const ms = Date.parse(value.value);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function equals(left: RuntimeValue, right: RuntimeValue): boolean {
  if (left.kind === "entity") {
    return (
      right.kind === "entity" && left.of === right.of && left.id === right.id
    );
  }
  if (left.kind !== "primitive" || right.kind !== "primitive") return false;
  if (left.of === "date" || right.of === "date") {
    const a = orderable(left);
    const b = orderable(right);
    return a !== undefined && a === b;
  }
  return left.value === right.value;
}

/** `contains`/`startsWith`/`endsWith` ignore case; `eq`/`neq` do not. */
export function compare(
  left: RuntimeValue,
  operator: Operator,
  right: RuntimeValue
): boolean {
  if (isNull(left) || isNull(right)) {
    if (operator === "eq") return isNull(left) && isNull(right);
    if (operator === "neq") return !(isNull(left) && isNull(right));
    return false;
  }

  if (left.kind === "list") {
    if (operator !== "contains") return false;
    return left.items.some((item) => equals(item, right));
  }

  if (operator === "eq") return equals(left, right);
  if (operator === "neq") return !equals(left, right);
  if (left.kind === "entity" || left.kind === "pairs") return false;

  switch (operator) {
    case "contains":
    case "startsWith":
    case "endsWith": {
      if (left.of !== "string" || right.kind !== "primitive") return false;
      const haystack = String(left.value).toLowerCase();
      const needle = String(right.value).toLowerCase();
      if (operator === "contains") return haystack.includes(needle);
      if (operator === "startsWith") return haystack.startsWith(needle);
      return haystack.endsWith(needle);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = orderable(left);
      const b = orderable(right);
      if (a === undefined || b === undefined) return false;
      if (operator === "gt") return a > b;
      if (operator === "gte") return a >= b;
      if (operator === "lt") return a < b;
      return a <= b;
    }
    default:
      return false;
  }
}

/** No short-circuiting: every operand is resolved so the run history shows both sides. */
export async function evaluateClauses(
  clauses: Clause[],
  combinator: Combinator,
  ctx: RuntimeContext
): Promise<
  | { ok: true; passed: boolean; evaluations: ClauseEvaluation[] }
  | { ok: false; reason: string; evaluations: ClauseEvaluation[] }
> {
  const results: boolean[] = [];
  const evaluations: ClauseEvaluation[] = [];

  for (const clause of clauses) {
    const left = await resolveValue(clause.left, ctx);
    if (!left.ok) {
      // Keep what was evaluated before the failure — a run that stopped on
      // clause three still has to show clauses one and two.
      evaluations.push({
        left: null,
        operator: clause.operator,
        right: null,
        passed: null,
        reason: left.reason
      });
      return { ok: false, reason: left.reason, evaluations };
    }

    // Publishing blocks an absent right-hand side, so this only guards a draft
    // that somehow reached the runtime — skip with a reason, never throw.
    if (clause.right === undefined) {
      const reason = "This comparison has nothing to compare against.";
      evaluations.push({
        left: left.value,
        operator: clause.operator,
        right: null,
        passed: null,
        reason
      });
      return { ok: false, reason, evaluations };
    }

    const right = await resolveValue(clause.right, ctx);
    if (!right.ok) {
      evaluations.push({
        left: left.value,
        operator: clause.operator,
        right: null,
        passed: null,
        reason: right.reason
      });
      return { ok: false, reason: right.reason, evaluations };
    }

    const passed = compare(left.value, clause.operator, right.value);
    evaluations.push({
      left: left.value,
      operator: clause.operator,
      right: right.value,
      passed
    });
    results.push(passed);
  }

  if (results.length === 0) return { ok: true, passed: true, evaluations };
  return {
    ok: true,
    passed:
      combinator === "or" ? results.some(Boolean) : results.every(Boolean),
    evaluations
  };
}
