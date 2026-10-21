// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DataOperation, OperationCard } from "@carbon/ee/workflows";
import {
  cardsOf,
  DATA_OPERATIONS,
  foldOperationTypes,
  operationsFor,
  truncateStarvedCards
} from "@carbon/ee/workflows";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { Fragment, useMemo } from "react";
import { LuArrowDown, LuPlus } from "react-icons/lu";
import { useWorkflowCatalog } from "../../catalog";
import { useBuilderStore } from "../../context";
import { useAvailableVariables } from "../../useDefinition";
import { FormStack } from "../layout";
import type { NodeFormProps } from "./index";
import { OperationCardEditor } from "./OperationCardEditor";
import { SourceListPicker } from "./SourceListPicker";

const newCard = (operation: DataOperation): OperationCard => ({
  id: nanoid(),
  operation,
  combinator: "and",
  clauses: [],
  flatten: false
});

export function FilterForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"filter">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const catalog = useWorkflowCatalog();

  const { source } = node.data;
  // The chain, through the SAME normalizer the validator and runtime use — a
  // legacy node reads as one card, and the first edit materializes it.
  const cards = cardsOf(node);

  // Every operation works through a list; what the list HOLDS may be an object.
  const vars = useAvailableVariables(node.id);
  const listVars = useMemo(
    () => vars.filter((v) => v.type.kind === "list"),
    [vars]
  );

  const sourceVar = source
    ? listVars.find(
        (v) => v.nodeId === source.nodeId && v.output === source.output
      )
    : undefined;

  const sourceType =
    sourceVar?.type.kind === "list" ? sourceVar.type : undefined;

  // types[i] flows INTO card i; the last element is the node's output. The same
  // fold the validator runs, so the dropdowns and the red flags cannot disagree.
  const types = useMemo(
    () => foldOperationTypes(sourceType, cards, catalog),
    [sourceType, cards, catalog]
  );
  const output = types[cards.length];
  // An UNKNOWN output must not read as "anything goes": until the chain above is
  // configured, there is nothing real for a new card to consume.
  const canAdd = output !== undefined && operationsFor(output).length > 0;

  // Every write heals structurally: nothing may follow a terminal card, so any
  // edit that leaves one mid-chain drops the dead tail with it.
  const writeCards = (next: OperationCard[]) => {
    updateNodeData(node.id, { operations: truncateStarvedCards(next) });
  };

  const patchCard = (id: string, patch: Partial<OperationCard>) => {
    writeCards(
      cards.map((card) => (card.id === id ? { ...card, ...patch } : card))
    );
  };

  // A new source means new items for card 1: its clauses and field were written
  // against the OLD element type. Later cards keep their config — the ripple
  // shows as ordinary red validation rather than silently deleted work.
  const resetHead = (
    next: FilterNodeSourcePatch
  ): Parameters<typeof updateNodeData>[1] => {
    const [head, ...rest] = cards;
    return {
      ...next,
      operations: head
        ? [{ ...head, clauses: [], field: undefined, flatten: false }, ...rest]
        : cards
    };
  };

  const handleSourceSelect = (nodeId: string, outputName: string) => {
    updateNodeData(
      node.id,
      resetHead({
        source: { kind: "ref", nodeId, output: outputName, path: [] }
      })
    );
  };

  const handleClearSource = () => {
    updateNodeData(node.id, resetHead({ source: undefined }));
  };

  // Switching operation drops what only made sense for the old one: a clause
  // means nothing to `count`, and a field means nothing outside `pluck`. And a
  // switch to a terminal operation (count, join, first, last) drops the cards
  // BELOW it — their input becomes a bare value no operation could ever consume,
  // so keeping them would only be a tail of unfixable red.
  const handleOperationChange = (card: OperationCard, next: string) => {
    const chosen = next as DataOperation;
    if (chosen === card.operation) return;
    const patched = cards.map((c) =>
      c.id === card.id
        ? {
            ...c,
            operation: chosen,
            ...(DATA_OPERATIONS[chosen].usesClauses ? {} : { clauses: [] }),
            ...(DATA_OPERATIONS[chosen].usesField
              ? {}
              : { field: undefined, flatten: false })
          }
        : c
    );
    writeCards(patched);
  };

  const handleAddCard = () => {
    const first = operationsFor(output)[0];
    if (first === undefined) return;
    writeCards([...cards, newCard(first)]);
  };

  return (
    <FormStack spacing={4}>
      {cards.map((card, index) => (
        <Fragment key={card.id}>
          <OperationCardEditor
            card={card}
            input={types[index]}
            nodeId={node.id}
            hasSource={!!source}
            canRemove={cards.length > 1}
            issues={issues}
            isReadOnly={isReadOnly}
            onRemove={() => writeCards(cards.filter((c) => c.id !== card.id))}
            onOperationChange={(next) => handleOperationChange(card, next)}
            onPatch={(patch) => patchCard(card.id, patch)}
          >
            {/* Source list picker — the chain has ONE source, and card 1 owns it. */}
            {index === 0 && (
              <SourceListPicker
                hasSource={!!source}
                sourceVar={sourceVar}
                listVars={listVars}
                isReadOnly={isReadOnly}
                onSelect={handleSourceSelect}
                onClear={handleClearSource}
              />
            )}
          </OperationCardEditor>

          {/* The flow: this card's result feeds the next card. A sibling of the
              cards rather than a child of one, so the stack's gap centers it
              between them instead of gluing it under the card above. */}
          {index < cards.length - 1 && (
            <div className="-my-2 flex justify-center">
              <LuArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </Fragment>
      ))}

      <Tooltip>
        <TooltipTrigger asChild>
          {/* span, so the tooltip still opens over a disabled button */}
          <span className="inline-flex w-fit">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<LuPlus />}
              onClick={handleAddCard}
              isDisabled={isReadOnly || !canAdd}
            >
              <Trans context="workflow data step">Add operation</Trans>
            </Button>
          </span>
        </TooltipTrigger>
        {!canAdd && (
          <TooltipContent>
            {output === undefined ? (
              <Trans>Configure the steps above first.</Trans>
            ) : (
              <Trans>Nothing can work on this result.</Trans>
            )}
          </TooltipContent>
        )}
      </Tooltip>
    </FormStack>
  );
}

/** The two writes that touch the node source alongside the head card's reset. */
type FilterNodeSourcePatch = {
  source: NodeFormProps<"filter">["node"]["data"]["source"];
};
