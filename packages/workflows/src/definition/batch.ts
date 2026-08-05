import type { CatalogAction } from "./catalog";
import type { ValueOrRef, ValueType } from "./types";

type ListType = Extract<ValueType, { kind: "list" }>;

/**
 * Whether an action step repeats, and over what. Derived from the wiring rather than
 * stored: a list fed to a slot that takes one value has exactly one sensible meaning,
 * so a flag saying so could only ever agree or be wrong.
 */
export type BatchPlan =
  | { kind: "none" }
  | { kind: "repeats"; input: string; type: ListType }
  /** More than one list: we will not guess which the customer meant to repeat over.
   * The two named are the first two in declaration order, which is enough to explain it. */
  | { kind: "ambiguous"; first: string; second: string };

/**
 * The inputs that could carry the list a step repeats over: declared to take a single
 * value, and actually supplied. An input already reading the loop item is skipped, or
 * resolving it would recurse into the loop it helps define.
 */
export function batchCandidates(
  action: CatalogAction,
  inputs: Record<string, ValueOrRef>
): string[] {
  if (!action.batchable) return [];
  // Declaration order, so the validator and the engine always agree on "the first one".
  return Object.keys(action.inputs).filter((name) => {
    if (action.inputs[name]?.type.kind === "list") return false;
    // Rows are never the list a step repeats over.
    if (action.inputs[name]?.pairs) return false;
    const supplied = inputs[name];
    return supplied !== undefined && supplied.kind !== "item";
  });
}

/** The same rule the engine follows, resolved through whatever knows an input's type. */
export function batchPlan(
  action: CatalogAction,
  inputs: Record<string, ValueOrRef>,
  typeOfInput: (name: string) => ValueType | undefined
): BatchPlan {
  const lists: { input: string; type: ListType }[] = [];
  for (const input of batchCandidates(action, inputs)) {
    const type = typeOfInput(input);
    if (type?.kind === "list") lists.push({ input, type });
  }
  const [first, second] = lists;
  if (first === undefined) return { kind: "none" };
  return second === undefined
    ? { kind: "repeats", input: first.input, type: first.type }
    : { kind: "ambiguous", first: first.input, second: second.input };
}
