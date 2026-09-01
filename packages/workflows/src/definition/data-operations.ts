import { z } from "zod";
import type { WorkflowCatalog } from "./catalog";
import { walkPath } from "./catalog";
import type { FilterNode, OperationCard } from "./schema";
import { rendersAsText, type ValueType } from "./types";

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
  /** Whether clause rows apply — only filtering compares each item. */
  usesClauses: boolean;
  /** Whether the operation exposes a loop item. Only `filter` does, which is what
   * keeps `ItemRef` ("the current item") meaning exactly one thing. */
  loops: boolean;
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
    loops: true,
    usesField: false,
    keepsList: true
  },
  count: {
    label: "Count items",
    usesClauses: false,
    loops: false,
    usesField: false,
    keepsList: false
  },
  first: {
    label: "Take the first item",
    usesClauses: false,
    loops: false,
    usesField: false,
    keepsList: false
  },
  last: {
    label: "Take the last item",
    usesClauses: false,
    loops: false,
    usesField: false,
    keepsList: false
  },
  pluck: {
    label: "Take one field from every item",
    usesClauses: false,
    loops: false,
    usesField: true,
    keepsList: true
  },
  join: {
    label: "Join into text",
    usesClauses: false,
    loops: false,
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

/**
 * The operation a node runs, defaulting the way the schema does.
 *
 * The zod default only applies to a definition that was PARSED. The builder holds
 * raw node objects in memory — a node just dropped on the canvas, or one loaded
 * before this field existed — so the key can genuinely be absent, and reading it
 * unguarded made `DATA_OPERATIONS[undefined]` and produced no outputs at all.
 *
 * A name that is no longer an operation falls back too: a definition saved against
 * an older list must not index the table with a key it no longer holds.
 */
/** Which operations can consume this type. Everything needs a list; `pluck`
 * needs items with fields; `join` needs items that read as text. An undefined
 * input (the author is still configuring) offers everything. */
export function operationsFor(input: ValueType | undefined): DataOperation[] {
  if (input === undefined) return [...DATA_OPERATION_NAMES];
  if (input.kind !== "list") return [];
  return DATA_OPERATION_NAMES.filter((name) => {
    if (DATA_OPERATIONS[name].usesField) {
      return input.of.kind === "record" || input.of.kind === "entity";
    }
    // The same reading rule the template renderer and the type walk use.
    if (name === "join") return rendersAsText(input.of);
    return true;
  });
}

export function operationOf(stored: string | undefined): DataOperation {
  return stored !== undefined && stored in DATA_OPERATIONS
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

/** The type one card hands onward, or `undefined` when its input cannot
 * support it — which reads as "not configured" and suppresses downstream errors. */
function cardResultType(
  card: OperationCard,
  input: ValueType | undefined,
  catalog: WorkflowCatalog
): ValueType | undefined {
  if (input === undefined || input.kind !== "list") return undefined;

  switch (operationOf(card.operation)) {
    case "filter":
      return input;
    case "count":
      return { kind: "primitive", of: "number" };
    case "first":
    case "last":
      return input.of;
    case "pluck": {
      // Only an object or a record has fields to take. A list of plain values has
      // nothing to project, and letting it through produced a list of nulls.
      if (input.of.kind !== "record" && input.of.kind !== "entity") {
        return undefined;
      }
      const field = card.field;
      if (field === undefined || field.trim() === "") return undefined;
      const picked = walkPath(input.of, field.split("."), catalog);
      if (picked === undefined) return undefined;
      // A field that is itself a list can only be projected FLAT: `list<list<T>>`
      // has no representation, so without flattening there is nothing to return.
      if (picked.kind === "list") {
        return card.flatten ? picked : undefined;
      }
      return { kind: "list", of: picked };
    }
    case "join":
      // Anything with a reading in a sentence can be joined — that is exactly what
      // `rendersAsText` decides, and it is what the template renderer already uses.
      // Requiring a primitive refused a list of Carbon records, each of which reads
      // perfectly well as its display name. An OBJECT still has no such reading.
      return rendersAsText(input.of)
        ? { kind: "primitive", of: "string" }
        : undefined;
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
    current = cardResultType(card, current, catalog);
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
