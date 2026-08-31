import { walkPath } from "../definition/catalog";
import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  type FilterNode
} from "../definition/schema";
import {
  assertNever,
  rendersAsText,
  type ScalarType
} from "../definition/types";
import { evaluateClauses } from "./compare";
import { renderPart, resolveRef, walk } from "./resolve";
import type {
  NodeExecutor,
  NodeResult,
  RuntimeContext,
  RuntimeValue
} from "./types";
import { isNull, listValue, nullValue, primitiveValue } from "./values";

export function filterSummary(
  kept: number,
  total: number,
  unresolved: number
): string {
  const base = `Kept ${kept} of ${total}.`;
  return unresolved === 0
    ? base
    : `Kept ${kept} of ${total}; ${unresolved} could not be checked.`;
}

function succeeded(value: RuntimeValue, summary: string): NodeResult {
  return {
    status: "Succeeded",
    outputs: { [DEFAULT_OUTPUT]: value },
    handle: DEFAULT_HANDLE,
    summary
  };
}

/** Walks a dotted field path through one item.
 *
 * `walk` is the SAME path walker the variable resolver uses, so a pluck reads a field
 * exactly as a `{{ ref }}` would: inline for a record, and through the catalog and the
 * entity loader for a Carbon record. Handling only records here silently turned a
 * pluck over a list of entities — which the validator, `walkPath` and the builder all
 * allow — into a list of nulls.
 *
 * A path that does not resolve is null for that item rather than a failed step: one
 * absent field must not lose the whole list. */
async function pick(
  item: RuntimeValue,
  path: string[],
  ctx: RuntimeContext
): Promise<RuntimeValue> {
  const walked = await walk(item, path, ctx);
  return walked.ok ? walked.value : nullValue();
}

async function runFilter(
  node: FilterNode,
  ctx: RuntimeContext,
  items: RuntimeValue[],
  of: ScalarType
): Promise<NodeResult> {
  const kept: RuntimeValue[] = [];
  let unresolved = 0;

  for (const item of items) {
    const result = await evaluateClauses(
      node.data.clauses,
      node.data.combinator,
      { ...ctx, item }
    );
    // One unreadable item drops out; it never stops the whole list.
    if (!result.ok) {
      unresolved += 1;
      continue;
    }
    if (result.passed) kept.push(item);
  }

  return succeeded(
    listValue(of, kept).value,
    filterSummary(kept.length, items.length, unresolved)
  );
}

/**
 * The data node: filter, count, first/last, pluck or join over one list.
 *
 * Needs no permission — it only reshapes values already in the run, which an
 * upstream node fetched under its own check.
 */
export const filterExecutor: NodeExecutor<FilterNode> = {
  permission: () => undefined,

  execute: async (node, ctx) => {
    if (node.data.source === undefined) {
      return { status: "Skipped", reason: "No list was chosen." };
    }

    const source = await resolveRef(node.data.source, ctx);
    if (!source.ok) return { status: "Skipped", reason: source.reason };
    if (source.value.kind !== "list") {
      return { status: "Skipped", reason: "This step expected a list." };
    }
    ctx.record?.("source", source.value);

    const items = source.value.items;
    const of = source.value.of;

    // Same guard as the definition side: a node saved before this field existed
    // carries no `operation`, and it must behave exactly as it always did.
    const operation = node.data.operation ?? "filter";

    switch (operation) {
      case "filter":
        return runFilter(node, ctx, items, of);

      case "count":
        return succeeded(
          primitiveValue("number", items.length),
          `Counted ${items.length}.`
        );

      case "first":
      case "last": {
        const item = operation === "first" ? items[0] : items[items.length - 1];
        // An empty list is not a failure — the branch below simply reads nothing.
        return succeeded(
          item ?? nullValue(),
          item === undefined
            ? "That list was empty."
            : `Took the ${operation} of ${items.length}.`
        );
      }

      case "pluck": {
        // The validator refuses a pluck over plain values, but a draft is never
        // validated — without this it produced a list of nulls that no downstream
        // step was typed against.
        if (of.kind !== "record" && of.kind !== "entity") {
          return {
            status: "Skipped",
            reason: "The items in that list have no fields to take."
          };
        }
        if ((node.data.field ?? "").trim() === "") {
          return { status: "Skipped", reason: "No field was chosen to take." };
        }
        const path = (node.data.field ?? "").split(".");
        const picked: RuntimeValue[] = [];
        let nested = false;
        for (const item of items) {
          const value = await pick(item, path, ctx);
          // Flattening happens HERE, as the values are produced: a list of lists
          // has no type to be returned as, so it is never built in the first place.
          if (value.kind === "list") {
            if (node.data.flatten) {
              picked.push(...value.items);
              continue;
            }
            // Unflattened, this would BE that unrepresentable `list<list<T>>`. The
            // validator refuses it, but a draft is never validated — same reason as
            // the two guards above.
            nested = true;
            break;
          }
          picked.push(value);
        }
        if (nested) {
          return {
            status: "Skipped",
            reason:
              "That field holds a list of its own. Turn on flattening to take it."
          };
        }
        // The declared type the builder promised, not one guessed from the data:
        // when every picked value is null, sampling typed the list `null` and
        // disagreed with the type every downstream step was built against.
        const declared = walkPath(of, path, ctx.catalog);
        const sample = picked.find((value) => !isNull(value));
        const elementType: ScalarType =
          declared !== undefined && declared.kind !== "list"
            ? declared
            : sample === undefined
              ? { kind: "primitive", of: "null" }
              : typeOfValue(sample);
        return succeeded(
          listValue(elementType, picked).value,
          `Took ${picked.length} values.`
        );
      }

      case "join": {
        if (!rendersAsText(of)) {
          return {
            status: "Skipped",
            reason: "The items in that list have no reading as text."
          };
        }
        // `renderPart`, not `renderValue`: a Carbon record reads as its display name
        // through the loader, exactly as it would inside a message. The synchronous
        // renderer only sees an inline snapshot, so entities joined as raw ids.
        const parts: string[] = [];
        for (const item of items) parts.push(await renderPart(item, ctx));
        const text = parts.filter((part) => part !== "").join(", ");
        return succeeded(
          primitiveValue("string", text),
          `Joined ${items.length} values.`
        );
      }
    }
  }
};

/** The declared type of a resolved value, for re-wrapping picked items in a list. */
function typeOfValue(value: RuntimeValue): ScalarType {
  switch (value.kind) {
    case "primitive":
      return { kind: "primitive", of: value.of };
    case "entity":
      return { kind: "entity", of: value.of };
    case "record":
      return value.of;
    // A list cannot nest: the pluck branch skips before building one, so a list
    // never reaches here. `pairs` is not a scalar and cannot be an element type.
    case "list":
    case "pairs":
      return { kind: "primitive", of: "null" };
    default:
      return assertNever(value);
  }
}
