// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { z } from "zod";
import type { WorkflowCatalog } from "./catalog";
import { walkPath } from "./catalog";
import type { FilterNode, OperationCard } from "./schema";
import { rendersAsText, type ScalarType, type ValueType } from "./types";

/**
 * What the data node can do to a value.
 *
 * The single list. The zod enum below derives from it, the node kind reads
 * `resultType` for its outputs and checks, the executor reads `run`, and the
 * builder maps over it for the operation dropdown — so adding an operation is one
 * entry here rather than four edits that can silently disagree.
 *
 * Declared apart from `nodes.ts` because the schema needs the enum and `nodes.ts`
 * imports the schema; putting the list there would be a cycle.
 */
export interface DataOperationSpec {
  /** Shown in the builder's operation picker. */
  label: string;
  /** Whether clause rows apply — only filtering compares each item, and so only
   * filtering exposes a loop item, which is what keeps `ItemRef` ("the current
   * item") meaning exactly one thing. */
  usesClauses: boolean;
  /** Whether the operation projects a named field off each item. */
  usesField: boolean;
  /** Whether the result is still a list another operation could consume. False
   * marks a TERMINAL operation — count, first, last, join — whose output is a
   * bare value regardless of what flows in, so nothing may ever follow it. */
  keepsList: boolean;
}

export const DATA_OPERATIONS = {
  filter: {
    label: "Keep matching items",
    usesClauses: true,
    usesField: false,
    keepsList: true
  },
  count: {
    label: "Count items",
    usesClauses: false,
    usesField: false,
    keepsList: false
  },
  first: {
    label: "Take the first item",
    usesClauses: false,
    usesField: false,
    keepsList: false
  },
  last: {
    label: "Take the last item",
    usesClauses: false,
    usesField: false,
    keepsList: false
  },
  pluck: {
    label: "Take one field from every item",
    usesClauses: false,
    usesField: true,
    keepsList: true
  },
  join: {
    label: "Join into text",
    usesClauses: false,
    usesField: false,
    keepsList: false
  }
} as const satisfies Record<string, DataOperationSpec>;

export type DataOperation = keyof typeof DATA_OPERATIONS;

export const DATA_OPERATION_NAMES = Object.keys(DATA_OPERATIONS) as [
  DataOperation,
  ...DataOperation[]
];

export const dataOperationSchema = z.enum(DATA_OPERATION_NAMES);

/** Which operations can consume this type. Everything needs a list; what each
 * needs of the list's items is `itemRefusal`. An undefined input (the author is
 * still configuring) offers everything. */
export function operationsFor(input: ValueType | undefined): DataOperation[] {
  if (input === undefined) return [...DATA_OPERATION_NAMES];
  if (input.kind !== "list") return [];
  return DATA_OPERATION_NAMES.filter(
    (name) => itemRefusal(name, input.of) === undefined
  );
}

/**
 * The operation a node runs, defaulting the way the schema does.
 *
 * The zod default only applies to a definition that was PARSED. The builder holds
 * raw node objects in memory — a node just dropped on the canvas, or one loaded
 * before this field existed — so the key can genuinely be absent, and reading it
 * unguarded made `DATA_OPERATIONS[undefined]` and produced no outputs at all.
 *
 * That is the only case the fallback serves. A PARSED definition never reaches it
 * with an unknown name: `dataOperationSchema` is a strict enum, so a stored name
 * that is no longer an operation fails the parse instead. An own-key check, so a
 * raw value like `"constructor"` does not read as an operation.
 */
export function operationOf(stored: string | undefined): DataOperation {
  return stored !== undefined && Object.hasOwn(DATA_OPERATIONS, stored)
    ? (stored as DataOperation)
    : "filter";
}

/**
 * The chain, normalized. The ONE read path for a data node's operations:
 * `operations` when stored, else one card synthesized from the flat fields —
 * with the STABLE id "card-0", which old item refs (no `card`) also mean.
 */
export function cardsOf(node: FilterNode): OperationCard[] {
  const stored = node.data.operations;
  if (stored !== undefined && stored.length > 0) return stored;
  return [
    {
      id: "card-0",
      operation: operationOf(node.data.operation),
      combinator: node.data.combinator ?? "and",
      clauses: node.data.clauses ?? [],
      field: node.data.field,
      flatten: node.data.flatten ?? false
    }
  ];
}

/**
 * Why a card cannot run against what reaches it. The validator words each one as
 * an issue, the runtime as a skip reason, and the builder's dropdown hides an
 * operation the items refuse — all off this one rule, so they cannot disagree.
 */
export type CardRefusal =
  /** What reaches the card is not a list. */
  | "not-a-list"
  /** A pluck over single values: there are no fields to take. */
  | "no-fields"
  /** A pluck with no field chosen yet. */
  | "no-field-chosen"
  /** A pluck of a field the item type does not have. */
  | "unknown-field"
  /** A pluck of a field that is itself a list, without flattening:
   * `list<list<T>>` has no representation. */
  | "nested-list"
  /** A join over items with no reading as text. */
  | "not-text";

export type CardResult = { type: ValueType } | { refusal: CardRefusal };

/** What an operation needs of the items it is handed, whatever the card says. */
function itemRefusal(
  operation: DataOperation,
  of: ScalarType
): CardRefusal | undefined {
  // Only an object or a record has fields to take. A list of plain values has
  // nothing to project, and letting it through produced a list of nulls.
  if (operation === "pluck" && of.kind !== "record" && of.kind !== "entity") {
    return "no-fields";
  }
  // Anything with a reading in a sentence can be joined — that is exactly what
  // `rendersAsText` decides, and it is what the template renderer already uses.
  // Requiring a primitive refused a list of Carbon records, each of which reads
  // perfectly well as its display name. An OBJECT still has no such reading.
  if (operation === "join" && !rendersAsText(of)) return "not-text";
  return undefined;
}

/**
 * The type one card hands onward, or why it cannot run on `input`. The ONE copy
 * of every per-operation rule: the type fold, the validator and the runtime all
 * call it.
 */
export function cardResultType(
  card: OperationCard,
  input: ValueType,
  catalog: WorkflowCatalog
): CardResult {
  if (input.kind !== "list") return { refusal: "not-a-list" };
  const operation = operationOf(card.operation);
  const refusal = itemRefusal(operation, input.of);
  if (refusal !== undefined) return { refusal };

  switch (operation) {
    case "filter":
      return { type: input };
    case "count":
      return { type: { kind: "primitive", of: "number" } };
    case "first":
    case "last":
      return { type: input.of };
    case "pluck": {
      const field = card.field;
      if (field === undefined || field.trim() === "") {
        return { refusal: "no-field-chosen" };
      }
      const picked = walkPath(input.of, field.split("."), catalog);
      if (picked === undefined) return { refusal: "unknown-field" };
      // A field that is itself a list can only be projected FLAT.
      if (picked.kind === "list") {
        return card.flatten ? { type: picked } : { refusal: "nested-list" };
      }
      return { type: { kind: "list", of: picked } };
    }
    case "join":
      return { type: { kind: "primitive", of: "string" } };
  }
}

/**
 * The chain's types, folded card by card: `types[i]` is what flows INTO card i,
 * and `types[cards.length]` is the node's output. `undefined` means
 * unconfigured/unsupported at that point, suppressing downstream errors.
 *
 * Pure over an already-resolved source so the browser form can call it without
 * a NodeContext; `chainTypes` is the ctx-bound wrapper.
 */
export function foldOperationTypes(
  source: ValueType | undefined,
  cards: OperationCard[],
  catalog: WorkflowCatalog
): (ValueType | undefined)[] {
  const types: (ValueType | undefined)[] = [source];
  let current = source;
  for (const card of cards) {
    if (current !== undefined) {
      const result = cardResultType(card, current, catalog);
      current = "type" in result ? result.type : undefined;
    }
    types.push(current);
  }
  return types;
}

/**
 * The chain up to and including its first terminal card. A terminal operation's
 * output can feed nothing WHATEVER the types turn out to be — the fact lives on
 * the operation itself (`keepsList`), so this needs no type information and
 * works on a chain whose source or fields are still unconfigured. An author
 * switching a middle card to `count` must not be left with a tail of dead
 * cards that no operation could ever revive.
 */
export function truncateStarvedCards(cards: OperationCard[]): OperationCard[] {
  const terminal = cards.findIndex(
    (card) => !DATA_OPERATIONS[card.operation].keepsList
  );
  return terminal === -1 ? cards : cards.slice(0, terminal + 1);
}
