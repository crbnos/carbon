import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";

import type {
  Clause,
  DataOperation,
  OperationCard,
  ValueType,
  WorkflowCatalog
} from "@carbon/workflows";
import {
  cardsOf,
  DATA_OPERATIONS,
  foldOperationTypes,
  operationsFor,
  truncateStarvedCards
} from "@carbon/workflows";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { Fragment, useMemo, useState } from "react";
import { LuArrowDown, LuChevronDown, LuPlus, LuTrash2 } from "react-icons/lu";
import { describeValueType, useWorkflowCatalog } from "../../catalog";
import { useBuilderStore } from "../../context";
import { useDataOperationLabel } from "../../dataOperationLabels";
import { useAvailableVariables } from "../../useDefinition";
import ClauseRow from "../ClauseRow";
import { CombinatorToggle } from "../CombinatorToggle";
import { FormStack, Section } from "../layout";
import type { NodeFormProps } from "./index";

const newClause = (): Clause => ({
  left: {
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value: ""
  },
  operator: "eq",
  right: {
    kind: "literal",
    type: { kind: "primitive", of: "string" },
    value: ""
  }
});

const newCard = (operation: DataOperation): OperationCard => ({
  id: nanoid(),
  operation,
  combinator: "and",
  clauses: [],
  flatten: false
});

/** Which fields a `pluck` may take, read off the element type ITS card receives. */
function fieldChoicesFor(
  itemType: ValueType | undefined,
  catalog: WorkflowCatalog
): { path: string; type: ValueType }[] {
  // A list of Carbon records can be plucked too — its fields come from the
  // catalog rather than the type. Offering only object fields left `pluck` over
  // a lookup's results validating but with nothing to choose.
  if (itemType?.kind === "entity") {
    const entity = catalog.getEntity(itemType.of);
    return Object.entries(entity?.properties ?? {}).map(([name, type]) => ({
      path: name,
      type
    }));
  }
  if (itemType?.kind !== "record") return [];
  const found: { path: string; type: ValueType }[] = [];
  const walk = (fields: Record<string, ValueType>, prefix: string[]) => {
    for (const [name, type] of Object.entries(fields)) {
      const path = [...prefix, name];
      found.push({ path: path.join("."), type });
      // One hop of nesting is enough to reach `organizer.email`; deeper paths
      // are reachable through a later pluck card.
      if (type.kind === "record" && prefix.length === 0) {
        walk(type.fields, path);
      }
    }
  };
  walk(itemType.fields, []);
  return found;
}

export function FilterForm({
  node,
  issues,
  isReadOnly
}: NodeFormProps<"filter">) {
  const updateNodeData = useBuilderStore((s) => s.updateNodeData);
  const catalog = useWorkflowCatalog();
  const { t } = useLingui();
  const operationLabel = useDataOperationLabel();

  const { source } = node.data;
  // The chain, through the SAME normalizer the validator and runtime use — a
  // legacy node reads as one card, and the first edit materializes it.
  const cards = cardsOf(node);

  const [sourceOpen, setSourceOpen] = useState(false);

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
    setSourceOpen(false);
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
      {cards.map((card, index) => {
        const input = types[index];
        const itemType = input?.kind === "list" ? input.of : undefined;
        const entityName =
          itemType?.kind === "entity" ? itemType.of : undefined;
        const spec = DATA_OPERATIONS[card.operation];
        // What the incoming type supports — plus the stored choice when it is no
        // longer among them, so a rippled-invalid card still SHOWS its operation
        // (red, via validation) instead of the Select silently blanking.
        const offered = operationsFor(input);
        const options = offered.includes(card.operation)
          ? offered
          : [...offered, card.operation];
        const context = { nodeId: node.id, inLoop: true, itemCard: card.id };
        const fieldChoices = fieldChoicesFor(itemType, catalog);
        const at = (field: string) => `operations.${card.id}.${field}`;

        return (
          <Fragment key={card.id}>
            <div className="space-y-4 rounded-lg border bg-card p-3">
              {/* Source list picker — the chain has ONE source, and card 1 owns it. */}
              {index === 0 && (
                <div className="space-y-1">
                  <Section>
                    <Trans>Source list</Trans>
                  </Section>

                  <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span
                          className={cn(
                            "truncate",
                            !source && "text-muted-foreground"
                          )}
                        >
                          {sourceVar
                            ? `${sourceVar.nodeName} › ${sourceVar.output}`
                            : t`Pick a list variable…`}
                        </span>
                        <LuChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
                      onWheel={(e) => e.stopPropagation()}
                      onTouchMove={(e) => e.stopPropagation()}
                    >
                      <Command>
                        <CommandInput
                          placeholder={t`Search list variables…`}
                          disabled={isReadOnly}
                        />
                        <CommandList className="max-h-64 overflow-y-auto">
                          <CommandEmpty>
                            <Trans>No list variables available upstream.</Trans>
                          </CommandEmpty>
                          <CommandGroup>
                            {listVars.map((v) => (
                              <CommandItem
                                key={`${v.nodeId}:${v.output}`}
                                value={`${v.nodeName} ${v.output} ${describeValueType(v.type)}`}
                                disabled={isReadOnly}
                                onSelect={() =>
                                  handleSourceSelect(v.nodeId, v.output)
                                }
                                className="flex flex-col items-start gap-0.5 px-3 py-2"
                              >
                                <span className="text-sm font-medium">
                                  {v.output}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {v.nodeName} · {describeValueType(v.type)}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {source && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onClick={handleClearSource}
                      disabled={isReadOnly}
                    >
                      <Trans>Clear</Trans>
                    </button>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Section>
                    <Trans>Operation</Trans>
                  </Section>
                  {cards.length > 1 && (
                    <IconButton
                      aria-label={t`Remove this operation`}
                      icon={<LuTrash2 />}
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        writeCards(cards.filter((c) => c.id !== card.id))
                      }
                      isDisabled={isReadOnly}
                    />
                  )}
                </div>
                {/* Built from DATA_OPERATIONS, never a second list: the same table
                    drives the stored enum, the output type and the runtime. */}
                <Select
                  value={card.operation}
                  onValueChange={(next) => handleOperationChange(card, next)}
                  disabled={isReadOnly}
                >
                  <SelectTrigger className="w-full" disabled={isReadOnly}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((name) => (
                      <SelectItem key={name} value={name}>
                        {operationLabel(name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Which field to take — `pluck` only. */}
              {source && spec.usesField && (
                <div className="space-y-1">
                  <Section>
                    <Trans>Field</Trans>
                  </Section>
                  {fieldChoices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        The items in that list have no fields to take.
                      </Trans>
                    </p>
                  ) : (
                    <Select
                      value={card.field ?? ""}
                      onValueChange={(next) => {
                        const chosen = fieldChoices.find(
                          (option) => option.path === next
                        );
                        patchCard(card.id, {
                          field: next,
                          // A list-valued field can ONLY be taken flat:
                          // `list<list<T>>` cannot exist, so the choice is made
                          // here rather than offered as a toggle that can be wrong.
                          flatten: chosen?.type.kind === "list"
                        });
                      }}
                      disabled={isReadOnly}
                    >
                      <SelectTrigger className="w-full" disabled={isReadOnly}>
                        <SelectValue placeholder={t`Pick a field…`} />
                      </SelectTrigger>
                      <SelectContent>
                        {fieldChoices.map((option) => (
                          <SelectItem key={option.path} value={option.path}>
                            {option.path}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {card.flatten && (
                    <p className="text-xs text-muted-foreground">
                      <Trans>
                        That field holds several values, so they are combined
                        into one list.
                      </Trans>
                    </p>
                  )}
                </div>
              )}

              {/* Clause section — filtering only; another operation stores no clauses */}
              {source && spec.usesClauses && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Section>
                      {entityName
                        ? t`Keep only the ${entityName} where…`
                        : t`Keep only items where…`}
                    </Section>

                    <CombinatorToggle
                      value={card.combinator}
                      onChange={(v) => patchCard(card.id, { combinator: v })}
                      isReadOnly={isReadOnly}
                    />
                  </div>

                  {card.clauses.map((clause, i) => (
                    <div key={i}>
                      <ClauseRow
                        clause={clause}
                        index={i}
                        canRemove={card.clauses.length > 1}
                        onChange={(clauseIndex, patch) =>
                          patchCard(card.id, {
                            clauses: card.clauses.map((c, j) =>
                              j === clauseIndex ? { ...c, ...patch } : c
                            )
                          })
                        }
                        onRemove={(clauseIndex) =>
                          patchCard(card.id, {
                            clauses: card.clauses.filter(
                              (_, j) => j !== clauseIndex
                            )
                          })
                        }
                        context={context}
                        fieldPath={`${at("clauses")}.${i}`}
                        issues={issues}
                        isReadOnly={isReadOnly}
                      />
                      {i < card.clauses.length - 1 && (
                        <div className="flex justify-center py-1">
                          <CombinatorToggle
                            value={card.combinator}
                            onChange={(v) =>
                              patchCard(card.id, { combinator: v })
                            }
                            isReadOnly={isReadOnly}
                          />
                        </div>
                      )}
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<LuPlus />}
                    onClick={() =>
                      patchCard(card.id, {
                        clauses: [...card.clauses, newClause()]
                      })
                    }
                    isDisabled={isReadOnly}
                  >
                    <Trans>Add rule</Trans>
                  </Button>
                </div>
              )}
            </div>

            {/* The flow: this card's result feeds the next card. A sibling of the
                cards rather than a child of one, so the stack's gap centers it
                between them instead of gluing it under the card above. */}
            {index < cards.length - 1 && (
              <div className="-my-2 flex justify-center">
                <LuArrowDown className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </Fragment>
        );
      })}

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
              <Trans>Add operation</Trans>
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
