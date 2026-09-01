import { walkPath } from "../definition/catalog";
import { cardsOf, DATA_OPERATIONS } from "../definition/data-operations";
import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  type FilterNode,
  type OperationCard
} from "../definition/schema";
import {
  assertNever,
  rendersAsText,
  type ScalarType
} from "../definition/types";
import { evaluateClauses } from "./compare";
import { renderPart, resolveRef, walk } from "./resolve";
import type {
  NodeDetail,
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

async function runFilterCard(
  card: OperationCard,
  ctx: RuntimeContext,
  items: RuntimeValue[],
  of: ScalarType
): Promise<CardOutcome> {
  const kept: RuntimeValue[] = [];
  let unresolved = 0;

  for (const item of items) {
    const result = await evaluateClauses(card.clauses, card.combinator, {
      ...ctx,
      item
    });
    // One unreadable item drops out; it never stops the whole list.
    if (!result.ok) {
      unresolved += 1;
      continue;
    }
    if (result.passed) kept.push(item);
  }

  return {
    ok: true,
    value: listValue(of, kept).value,
    summary: filterSummary(kept.length, items.length, unresolved)
  };
}

/** One card's verdict: a value handed to the next card, or the reason it could
 * not run — which skips the whole node, since everything after it is starved. */
type CardOutcome =
  | { ok: true; value: RuntimeValue; summary: string }
  | { ok: false; reason: string };

/** One operation against one incoming value. Every guard here mirrors a refusal
 * the validator already makes — but a draft is never validated, so the runtime
 * must hold the same line itself. */
async function runCard(
  card: OperationCard,
  input: RuntimeValue,
  ctx: RuntimeContext
): Promise<CardOutcome> {
  if (input.kind !== "list") {
    return { ok: false, reason: "This step expected a list." };
  }
  const items = input.items;
  const of = input.of;

  switch (card.operation) {
    case "filter":
      return runFilterCard(card, ctx, items, of);

    case "count":
      return {
        ok: true,
        value: primitiveValue("number", items.length),
        summary: `Counted ${items.length}.`
      };

    case "first":
    case "last": {
      const item =
        card.operation === "first" ? items[0] : items[items.length - 1];
      // An empty list is not a failure — the branch below simply reads nothing.
      return {
        ok: true,
        value: item ?? nullValue(),
        summary:
          item === undefined
            ? "That list was empty."
            : `Took the ${card.operation} of ${items.length}.`
      };
    }

    case "pluck": {
      // The validator refuses a pluck over plain values, but a draft is never
      // validated — without this it produced a list of nulls that no downstream
      // step was typed against.
      if (of.kind !== "record" && of.kind !== "entity") {
        return {
          ok: false,
          reason: "The items in that list have no fields to take."
        };
      }
      if ((card.field ?? "").trim() === "") {
        return { ok: false, reason: "No field was chosen to take." };
      }
      const path = (card.field ?? "").split(".");
      const picked: RuntimeValue[] = [];
      for (const item of items) {
        const value = await pick(item, path, ctx);
        // Flattening happens HERE, as the values are produced: a list of lists
        // has no type to be returned as, so it is never built in the first place.
        if (value.kind === "list") {
          if (card.flatten) {
            picked.push(...value.items);
            continue;
          }
          // Unflattened, this would BE that unrepresentable `list<list<T>>`. The
          // validator refuses it, but a draft is never validated — same reason as
          // the two guards above.
          return {
            ok: false,
            reason:
              "That field holds a list of its own. Turn on flattening to take it."
          };
        }
        picked.push(value);
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
      return {
        ok: true,
        value: listValue(elementType, picked).value,
        summary: `Took ${picked.length} values.`
      };
    }

    case "join": {
      if (!rendersAsText(of)) {
        return {
          ok: false,
          reason: "The items in that list have no reading as text."
        };
      }
      // `renderPart`, not `renderValue`: a Carbon record reads as its display name
      // through the loader, exactly as it would inside a message. The synchronous
      // renderer only sees an inline snapshot, so entities joined as raw ids.
      const parts: string[] = [];
      for (const item of items) parts.push(await renderPart(item, ctx));
      const text = parts.filter((part) => part !== "").join(", ");
      return {
        ok: true,
        value: primitiveValue("string", text),
        summary: `Joined ${items.length} values.`
      };
    }
  }
}

/**
 * The data node: a chain of operation cards — filter, count, first/last, pluck
 * or join — each feeding the next, the last one's result being the node output.
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

    const cards = cardsOf(node);
    const rows: Extract<NodeDetail, { kind: "data" }>["cards"] = [];
    let current: RuntimeValue = source.value;
    let summary = "";

    for (const [index, card] of cards.entries()) {
      const outcome = await runCard(card, current, ctx);

      if (!outcome.ok) {
        rows.push({
          id: card.id,
          operation: card.operation,
          summary: outcome.reason,
          status: "Skipped"
        });
        return {
          status: "Skipped",
          // One card is the whole node — naming "Step 1" there is noise.
          reason:
            cards.length === 1
              ? outcome.reason
              : `Step ${index + 1} (${DATA_OPERATIONS[card.operation].label}): ${outcome.reason}`,
          detail: { kind: "data", cards: rows }
        };
      }

      rows.push({
        id: card.id,
        operation: card.operation,
        summary: outcome.summary,
        status: "Succeeded"
      });
      current = outcome.value;
      summary = outcome.summary;
    }

    return {
      ...succeeded(current, summary),
      detail: { kind: "data", cards: rows }
    };
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
