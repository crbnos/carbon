// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  type CardRefusal,
  cardResultType,
  cardsOf,
  DATA_OPERATIONS,
  foldOperationTypes,
  operationOf as sharedOperationOf
} from "./data-operations";
import type { WorkflowIssue } from "./issues";
import {
  checkClauses,
  clauseConfigIssues,
  clauseValues,
  incomplete,
  type LoopList,
  type NodeContext,
  type NodeKind,
  type NodeOutputs
} from "./nodes";
import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  type FilterNode,
  type OperationCard
} from "./schema";
import {
  describeType,
  type ItemRef,
  type ValueOrRef,
  type ValueType
} from "./types";

/**
 * The data node — filtering, counting, picking and projecting over a list.
 *
 * Its stored `type` is still `"filter"`: widening the node that already owned
 * `loopList` and `ItemRef` was the whole point, so a saved workflow needs no
 * migration and there is only ever ONE thing "the current item" can mean.
 *
 * Lives beside `nodes.ts` rather than inside it because six operations across four
 * hooks is more than a kind block should be, and `runtime/` already splits one file
 * per node kind.
 */

function chainTypes(
  node: FilterNode,
  ctx: NodeContext
): (ValueType | undefined)[] {
  const source =
    node.data.source === undefined
      ? undefined
      : ctx.typeOf(node.data.source, node.id);
  return foldOperationTypes(source, cardsOf(node), ctx.catalog);
}

/** Only `filter` walks its list item by item, so only a filter card exposes a
 * loop item — typed by what flows into THAT card, not by the node's source. */
function dataLoopList(
  node: FilterNode,
  ctx: NodeContext,
  card?: string
): LoopList | undefined {
  const cards = cardsOf(node);
  const index = card === undefined ? 0 : cards.findIndex((c) => c.id === card);
  if (index < 0) return undefined;
  if (
    !DATA_OPERATIONS[sharedOperationOf(cards[index]?.operation)].usesClauses
  ) {
    return undefined;
  }
  const input = chainTypes(node, ctx)[index];
  if (input !== undefined && input.kind === "list") return { type: input };
  return { failure: "unconfigured" };
}

function dataOutputs(
  node: FilterNode,
  ctx: NodeContext
): NodeOutputs | undefined {
  const types = chainTypes(node, ctx);
  const type = types[types.length - 1];
  return type === undefined ? undefined : { [DEFAULT_OUTPUT]: type };
}

/** A refusal worded for the author, on the card field it is about. A missing
 * field is not a type problem — `checkConfig` asks for it. */
function refusalIssue(
  refusal: CardRefusal,
  card: OperationCard,
  input: ValueType
): { field: string; message: string } | undefined {
  const at = (field: string) => `operations.${card.id}.${field}`;
  switch (refusal) {
    case "not-a-list":
      return {
        field: at("operation"),
        message: `This operation works through a list, but what reaches it is ${describeType(input)}.`
      };
    case "no-fields":
      return {
        field: at("operation"),
        message: `${describeType(input)} has no fields to take — its items are single values.`
      };
    case "no-field-chosen":
      return undefined;
    case "unknown-field":
      return {
        field: at("field"),
        message: `The items in that list have no "${card.field}".`
      };
    case "nested-list":
      return {
        field: at("field"),
        message: `"${card.field}" is itself a list, so it can only be taken as one combined list.`
      };
    case "not-text":
      return {
        field: at("operation"),
        message: `The items in ${describeType(input)} have no reading as text, so they cannot be joined.`
      };
  }
}

/** The item refs a value holds, a template's parts and a row's values included. */
function itemRefsIn(value: ValueOrRef): ItemRef[] {
  switch (value.kind) {
    case "item":
      return [value];
    case "template":
      return value.parts.flatMap((part) =>
        part.kind === "item" ? [part] : []
      );
    case "pairs":
      return value.entries.flatMap((entry) => itemRefsIn(entry.value));
    default:
      return [];
  }
}

/**
 * Item refs inside one card's clauses that name ANOTHER looping card. The runtime
 * hands each card its own item whatever the ref says, so such a ref is typed
 * against one list and run against another. A ref with no `card` means the first
 * card. A ref naming no card at all, or a card that does not loop, is left to the
 * reference layer, which already reports it as ITEM_OUTSIDE_LOOP.
 */
function foreignItemRefIssues(
  node: FilterNode,
  cards: OperationCard[],
  card: OperationCard
): WorkflowIssue[] {
  const prefix = `operations.${card.id}.clauses`;
  return clauseValues(card.clauses, prefix).flatMap(({ value, field }) =>
    itemRefsIn(value).flatMap((ref) => {
      const owner = cards.find((c) => c.id === (ref.card ?? cards[0]?.id));
      if (
        owner === undefined ||
        owner.id === card.id ||
        !DATA_OPERATIONS[owner.operation].usesClauses
      ) {
        return [];
      }
      return [
        {
          code: "ITEM_OUTSIDE_LOOP" as const,
          nodeId: node.id,
          field,
          message:
            "This refers to the current item of another step in this chain. Pick it again from this step."
        }
      ];
    })
  );
}

export const dataNodeKind: NodeKind<FilterNode> = {
  handles: () => [DEFAULT_HANDLE],
  values: (node) => [
    ...(node.data.source === undefined
      ? []
      : [{ value: node.data.source, field: "source" }]),
    // Clauses only exist for filtering; another operation never stores one.
    // Field paths carry the card id, so an issue lands on the card it names.
    ...cardsOf(node).flatMap((card) =>
      DATA_OPERATIONS[card.operation].usesClauses
        ? clauseValues(card.clauses, `operations.${card.id}.clauses`)
        : []
    )
  ],
  outputs: dataOutputs,
  loopList: dataLoopList,
  // A data node has no catalog entry to be missing.
  configured: () => true,
  checkTypes: (node, ctx) => {
    if (node.data.source === undefined) return [];
    const source = ctx.typeOf(node.data.source, node.id);
    if (source === undefined) return [];

    if (source.kind !== "list") {
      return [
        {
          code: "TYPE_MISMATCH",
          nodeId: node.id,
          field: "source",
          message: `This step works through a list, but this is ${describeType(source)}.`
        }
      ];
    }

    const cards = cardsOf(node);
    const types = foldOperationTypes(source, cards, ctx.catalog);
    const issues: WorkflowIssue[] = [];

    cards.forEach((card, index) => {
      const input = types[index];
      const at = (field: string) => `operations.${card.id}.${field}`;

      // Structural, before any typing: a terminal operation hands no list onward,
      // so a card following one is dead however the types resolve. The builder
      // truncates these on edit; a stored definition still has to be told.
      const previous = cards[index - 1];
      if (
        previous !== undefined &&
        !DATA_OPERATIONS[previous.operation].keepsList
      ) {
        issues.push({
          code: "TYPE_MISMATCH",
          nodeId: node.id,
          field: at("operation"),
          message: `Nothing can follow "${DATA_OPERATIONS[previous.operation].label}" — it does not hand a list onward.`
        });
        return;
      }

      // An earlier card is unconfigured or already wrong; it reported the cause,
      // and everything after it can only echo it.
      if (input === undefined) return;

      // The dropdown only offers what the incoming type supports, but a stored
      // definition is not trusted — a card deleted above this one, or a hand-
      // written definition, can leave an operation nothing feeds correctly.
      const result = cardResultType(card, input, ctx.catalog);
      if ("refusal" in result) {
        const issue = refusalIssue(result.refusal, card, input);
        if (issue !== undefined) {
          issues.push({ code: "TYPE_MISMATCH", nodeId: node.id, ...issue });
        }
        return;
      }

      if (DATA_OPERATIONS[card.operation].usesClauses) {
        // Item refs inside these clauses carry the card id, so `checkClauses`'
        // ordinary context types "the current item" against the card the ref
        // names — which must be THIS card.
        issues.push(...foreignItemRefIssues(node, cards, card));
        issues.push(...checkClauses(node, card.clauses, at("clauses"), ctx));
      }
    });

    return issues;
  },
  checkConfig: (node) => {
    if (node.data.source === undefined) {
      return [incomplete(node, "source", "Choose the list to work through.")];
    }
    return cardsOf(node).flatMap((card) => {
      const spec = DATA_OPERATIONS[card.operation];
      if (spec.usesField && (card.field ?? "").trim() === "") {
        return [
          incomplete(
            node,
            `operations.${card.id}.field`,
            "Choose which field to take."
          )
        ];
      }
      return spec.usesClauses
        ? clauseConfigIssues(
            node,
            card.clauses,
            `operations.${card.id}.clauses`
          )
        : [];
    });
  }
};
