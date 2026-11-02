// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  Clause,
  OperationCard,
  ValueType,
  WorkflowCatalog,
  WorkflowIssue
} from "@carbon/ee/workflows";
import { DATA_OPERATIONS, operationsFor } from "@carbon/ee/workflows";
import {
  Button,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { useWorkflowCatalog } from "../../catalog";
import { useDataOperationLabel } from "../../dataOperationLabels";
import type { FieldContext } from "../../fields/types";
import ClauseRow from "../ClauseRow";
import { CombinatorToggle } from "../CombinatorToggle";
import { Section } from "../layout";

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

type FieldChoice = { path: string; type: ValueType };

/** Which fields a `pluck` may take, read off the element type ITS card receives. */
function fieldChoicesFor(
  itemType: ValueType | undefined,
  catalog: WorkflowCatalog
): FieldChoice[] {
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
  const found: FieldChoice[] = [];
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

type CardPatch = (patch: Partial<OperationCard>) => void;

type OperationCardEditorProps = {
  card: OperationCard;
  /** The type that flows INTO this card — the previous card's result. */
  input: ValueType | undefined;
  nodeId: string;
  hasSource: boolean;
  /** A chain always keeps at least one card. */
  canRemove: boolean;
  issues?: WorkflowIssue[];
  isReadOnly?: boolean;
  onRemove: () => void;
  onOperationChange: (next: string) => void;
  onPatch: CardPatch;
  /** Rendered at the top of the card — the source picker, on the first card. */
  children?: ReactNode;
};

/** One card of a data step's chain: its operation, then what that operation needs. */
export function OperationCardEditor({
  card,
  input,
  nodeId,
  hasSource,
  canRemove,
  issues,
  isReadOnly,
  onRemove,
  onOperationChange,
  onPatch,
  children
}: OperationCardEditorProps) {
  const { t } = useLingui();
  const catalog = useWorkflowCatalog();
  const operationLabel = useDataOperationLabel();

  const itemType = input?.kind === "list" ? input.of : undefined;
  const entityName = itemType?.kind === "entity" ? itemType.of : undefined;
  const spec = DATA_OPERATIONS[card.operation];
  // What the incoming type supports — plus the stored choice when it is no
  // longer among them, so a rippled-invalid card still SHOWS its operation
  // (red, via validation) instead of the Select silently blanking.
  const offered = operationsFor(input);
  const options = offered.includes(card.operation)
    ? offered
    : [...offered, card.operation];
  const context = { nodeId, inLoop: true, itemCard: card.id };
  const fieldChoices = fieldChoicesFor(itemType, catalog);
  const at = (field: string) => `operations.${card.id}.${field}`;

  return (
    <div className="space-y-4 rounded-lg border bg-card p-3">
      {children}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Section>
            <Trans context="workflow data step">Operation</Trans>
          </Section>
          {canRemove && (
            <IconButton
              aria-label={t({
                message: "Remove this operation",
                context: "workflow data step"
              })}
              icon={<LuTrash2 />}
              variant="ghost"
              size="sm"
              onClick={onRemove}
              isDisabled={isReadOnly}
            />
          )}
        </div>
        {/* Built from DATA_OPERATIONS, never a second list: the same table
            drives the stored enum, the output type and the runtime. */}
        <Select
          value={card.operation}
          onValueChange={onOperationChange}
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
      {hasSource && spec.usesField && (
        <FieldPicker
          card={card}
          fieldChoices={fieldChoices}
          isReadOnly={isReadOnly}
          onPatch={onPatch}
        />
      )}

      {/* Clause section — filtering only; another operation stores no clauses */}
      {hasSource && spec.usesClauses && (
        <ClauseList
          card={card}
          entityName={entityName}
          context={context}
          fieldPath={at("clauses")}
          issues={issues}
          isReadOnly={isReadOnly}
          onPatch={onPatch}
        />
      )}
    </div>
  );
}

function FieldPicker({
  card,
  fieldChoices,
  isReadOnly,
  onPatch
}: {
  card: OperationCard;
  fieldChoices: FieldChoice[];
  isReadOnly?: boolean;
  onPatch: CardPatch;
}) {
  const { t } = useLingui();

  return (
    <div className="space-y-1">
      <Section>
        <Trans>Field</Trans>
      </Section>
      {fieldChoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>The items in that list have no fields to take.</Trans>
        </p>
      ) : (
        <Select
          value={card.field ?? ""}
          onValueChange={(next) => {
            const chosen = fieldChoices.find((option) => option.path === next);
            onPatch({
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
            That field holds several values, so they are combined into one list.
          </Trans>
        </p>
      )}
    </div>
  );
}

function ClauseList({
  card,
  entityName,
  context,
  fieldPath,
  issues,
  isReadOnly,
  onPatch
}: {
  card: OperationCard;
  /** The record type the list holds, for the heading; absent for plain items. */
  entityName: string | undefined;
  context: FieldContext;
  /** Issue path of this card's clauses; each row appends its index. */
  fieldPath: string;
  issues?: WorkflowIssue[];
  isReadOnly?: boolean;
  onPatch: CardPatch;
}) {
  const { t } = useLingui();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Section>
          {entityName
            ? t`Keep only the ${entityName} where…`
            : t`Keep only items where…`}
        </Section>

        <CombinatorToggle
          value={card.combinator}
          onChange={(v) => onPatch({ combinator: v })}
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
              onPatch({
                clauses: card.clauses.map((c, j) =>
                  j === clauseIndex ? { ...c, ...patch } : c
                )
              })
            }
            onRemove={(clauseIndex) =>
              onPatch({
                clauses: card.clauses.filter((_, j) => j !== clauseIndex)
              })
            }
            context={context}
            fieldPath={`${fieldPath}.${i}`}
            issues={issues}
            isReadOnly={isReadOnly}
          />
          {i < card.clauses.length - 1 && (
            <div className="flex justify-center py-1">
              <CombinatorToggle
                value={card.combinator}
                onChange={(v) => onPatch({ combinator: v })}
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
        onClick={() => onPatch({ clauses: [...card.clauses, newClause()] })}
        isDisabled={isReadOnly}
      >
        <Trans>Add rule</Trans>
      </Button>
    </div>
  );
}
