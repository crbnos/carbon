// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type CardRefusal,
  cardResultType,
  cardsOf,
  DATA_OPERATIONS
} from "../definition/data-operations";
import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  type FilterNode,
  type OperationCard
} from "../definition/schema";
import type { ScalarType } from "../definition/types";
import { evaluateClauses } from "./compare";
import { renderPart, resolveRef, walk } from "./resolve";
import type {
  NodeDetail,
  NodeExecutor,
  NodeResult,
  RuntimeContext,
  RuntimeValue
} from "./types";
import { listValue, nullValue, primitiveValue } from "./values";

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
    summary: filterSummary(kept.length, items.length, unresolved),
    counts: { input: items.length, output: kept.length, unresolved }
  };
}

/** One card's verdict: a value handed to the next card, or the reason it could
 * not run — which skips the whole node, since everything after it is starved. */
type CardOutcome =
  | { ok: true; value: RuntimeValue; summary: string; counts: CardCounts }
  | { ok: false; refusal: CardRefusal };

type CardCounts = NonNullable<
  Extract<NodeDetail, { kind: "data" }>["cards"][number]["counts"]
>;

/** The skip reason for each refusal, worded for the run history. */
const REFUSAL_REASONS: Record<CardRefusal, string> = {
  "not-a-list": "This step expected a list.",
  "no-fields": "The items in that list have no fields to take.",
  "no-field-chosen": "No field was chosen to take.",
  "unknown-field": "The items in that list have no field by that name.",
  "nested-list":
    "That field holds a list of its own. Turn on flattening to take it.",
  "not-text": "The items in that list have no reading as text."
};

/** One operation against one incoming value. A draft is never validated, so the
 * runtime asks `cardResultType` the validator's own question before it runs. */
async function runCard(
  card: OperationCard,
  input: RuntimeValue,
  ctx: RuntimeContext
): Promise<CardOutcome> {
  if (input.kind !== "list") {
    return { ok: false, refusal: "not-a-list" };
  }
  const items = input.items;
  const of = input.of;
  // The declared type decides up front, not the data: an EMPTY source has no
  // item to trip a per-value guard, so an unflattened list field would otherwise
  // slip through as an empty list instead of the same refusal.
  const typed = cardResultType(card, { kind: "list", of }, ctx.catalog);
  if ("refusal" in typed) {
    return { ok: false, refusal: typed.refusal };
  }

  switch (card.operation) {
    case "filter":
      return runFilterCard(card, ctx, items, of);

    case "count":
      return {
        ok: true,
        value: primitiveValue("number", items.length),
        summary: `Counted ${items.length}.`,
        counts: { input: items.length }
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
            : `Took the ${card.operation} of ${items.length}.`,
        counts: { input: items.length }
      };
    }

    case "pluck": {
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
          // The data disagrees with the declared type: unflattened, this would
          // BE that unrepresentable `list<list<T>>`.
          return { ok: false, refusal: "nested-list" };
        }
        picked.push(value);
      }
      // The declared element type the builder promised, not one guessed from the
      // data. A pluck is always typed as a list.
      const elementType: ScalarType =
        typed.type.kind === "list" ? typed.type.of : typed.type;
      // Flattening can grow the list past MAX_LIST_ITEMS; say so rather than
      // report values the output no longer holds.
      const { value, dropped } = listValue(elementType, picked);
      const kept = picked.length - dropped;
      return {
        ok: true,
        value,
        summary:
          dropped === 0
            ? `Took ${picked.length} values.`
            : `Took ${picked.length} values; kept the first ${kept}.`,
        counts: {
          input: items.length,
          output: kept,
          ...(dropped === 0 ? {} : { dropped })
        }
      };
    }

    case "join": {
      // `renderPart`, not `renderValue`: a Carbon record reads as its display name
      // through the loader, exactly as it would inside a message. The synchronous
      // renderer only sees an inline snapshot, so entities joined as raw ids.
      const parts: string[] = [];
      for (const item of items) parts.push(await renderPart(item, ctx));
      const text = parts.filter((part) => part !== "").join(", ");
      return {
        ok: true,
        value: primitiveValue("string", text),
        summary: `Joined ${items.length} values.`,
        counts: { input: items.length }
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
      return { status: "Skipped", reason: REFUSAL_REASONS["not-a-list"] };
    }
    ctx.record?.("source", source.value);

    const cards = cardsOf(node);
    const rows: Extract<NodeDetail, { kind: "data" }>["cards"] = [];
    let current: RuntimeValue = source.value;
    let summary = "";

    for (const [index, card] of cards.entries()) {
      const outcome = await runCard(card, current, ctx);

      if (!outcome.ok) {
        const reason = REFUSAL_REASONS[outcome.refusal];
        rows.push({
          id: card.id,
          operation: card.operation,
          summary: reason,
          status: "Skipped",
          refusal: outcome.refusal
        });
        return {
          status: "Skipped",
          // One card is the whole node — naming "Step 1" there is noise.
          reason:
            cards.length === 1
              ? reason
              : `Step ${index + 1} (${DATA_OPERATIONS[card.operation].label}): ${reason}`,
          detail: { kind: "data", cards: rows }
        };
      }

      rows.push({
        id: card.id,
        operation: card.operation,
        summary: outcome.summary,
        status: "Succeeded",
        counts: outcome.counts
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
