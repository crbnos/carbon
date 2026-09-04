import { Combobox, cn, IconButton } from "@carbon/react";
import type { Operator } from "@carbon/utils";
import type { Clause, ValueType, WorkflowIssue } from "@carbon/workflows";
import { expectedClauseRightType, operatorsForType } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { memo, useEffect, useMemo } from "react";
import { LuX } from "react-icons/lu";
import OperatorCombobox from "~/modules/storage-rules/ui/OperatorCombobox";
import {
  propertyLabelKey,
  useWorkflowCatalog,
  useWorkflowLabel
} from "../catalog";
import { Field } from "../fields/Field";
import type { FieldContext } from "../fields/types";
import { ValueField } from "../fields/ValueField";
import { issueForField, partIssuesForField } from "../issues";
import { useValueTypeResolver } from "../useDefinition";

// One row: property, operator, value. `minmax(0,…)` on every track so a long variable
// chip shrinks its own cell instead of stretching the grid past the card.
export const CLAUSE_GRID_CLASS =
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,8.5rem)_minmax(0,1fr)] items-start gap-2";

function pickDefaultOp(ops: readonly Operator[]): Operator {
  return ops.includes("eq") ? "eq" : (ops[0] ?? "eq");
}

/** Module-level, not an inline literal: it reaches the variable menu as `accepts`,
 * which memoises on identity. */
const STRING_TYPE: ValueType = { kind: "primitive", of: "string" };

/** A clause always has a left operand, so clearing the field empties it rather
 * than removing it — `clauseSchema.left` is required. */
const EMPTY_LEFT: Clause["left"] = {
  kind: "literal",
  type: STRING_TYPE,
  value: ""
};

type ClauseRowProps = {
  clause: Clause;
  index: number;
  canRemove: boolean;
  onChange: (index: number, patch: Partial<Clause>) => void;
  onRemove: (index: number) => void;
  context: FieldContext;
  /** "column" for lookup match rows, "value" for condition/filter clauses */
  leftMode?: "value" | "column";
  /** In "column" mode: the entity whose columns the left side may name */
  entity?: string;
  /** Optional drag grip element rendered before the clause body */
  grip?: React.ReactNode;
  /** Validator field path for this row, e.g. `clauses.0` or `paths.<id>.clauses.0`. */
  fieldPath: string;
  issues?: WorkflowIssue[];
  /** The version is published: show the value, refuse every edit. */
  isReadOnly?: boolean;
};

function ClauseRowImpl({
  clause,
  index,
  canRemove,
  onChange,
  onRemove,
  context,
  leftMode = "value",
  entity,
  grip,
  fieldPath,
  issues,
  isReadOnly
}: ClauseRowProps) {
  const { t } = useLingui();
  const label = useWorkflowLabel();
  const catalog = useWorkflowCatalog();
  const typeOfValue = useValueTypeResolver(context.nodeId);

  // Derive the left operand's type for operator selection
  // `left` is optional here on purpose: a clause mid-edit can be missing it, and a
  // crash in one row white-screens the whole builder.
  const leftType = useMemo<ValueType | undefined>(() => {
    if (leftMode === "column") {
      const colName =
        clause.left?.kind === "literal" && typeof clause.left.value === "string"
          ? clause.left.value
          : undefined;
      if (!colName || !entity) return undefined;
      return catalog.getEntity(entity)?.properties[colName];
    }
    // "value" mode: a literal carries its own type, but a picked variable is a
    // reference and has to be resolved against the graph.
    return clause.left ? typeOfValue(clause.left) : undefined;
  }, [leftMode, clause.left, entity, typeOfValue, catalog]);

  const availableOps = useMemo<readonly Operator[]>(
    () => (leftType ? operatorsForType(leftType) : []),
    [leftType]
  );

  // Self-heal: stored op no longer in the field's allowed set
  useEffect(() => {
    if (!leftType) return;
    if (availableOps.includes(clause.operator)) return;
    onChange(index, {
      operator: pickDefaultOp(availableOps),
      right: undefined
    });
  }, [leftType, availableOps, clause.operator, index, onChange]);

  // Column options for "column" mode
  const columnOptions = useMemo(() => {
    if (leftMode !== "column" || !entity) return [];
    return Object.entries(catalog.getEntity(entity)?.properties ?? {}).map(
      ([col]) => ({
        // A custom field has no translated key — fall back to the customer's own name.
        label: label(
          propertyLabelKey(entity, col),
          catalog.getPropertyLabel(entity, col) ?? col
        ),
        value: col
      })
    );
  }, [leftMode, entity, label, catalog]);

  const currentColumn =
    leftMode === "column" &&
    clause.left?.kind === "literal" &&
    typeof clause.left.value === "string"
      ? clause.left.value
      : undefined;

  // In column mode, supply enum choices for the right-side ValueField
  const rightChoices = useMemo(
    () =>
      leftMode === "column" && entity && currentColumn
        ? catalog.getEnum(entity, currentColumn)
        : undefined,
    [leftMode, entity, currentColumn, catalog]
  );

  return (
    <div className="flex w-full items-center gap-2">
      {grip}
      {/* No border of its own: the clause list already sits inside a bordered
          block, and a box per row reads as three nested frames. */}
      <div className="min-w-0 flex-1">
        <div className={CLAUSE_GRID_CLASS}>
          {leftMode === "column" ? (
            <Field label={t`Property`}>
              <Combobox
                size="md"
                placeholder={t`Pick a property`}
                value={currentColumn}
                options={columnOptions}
                isReadOnly={isReadOnly}
                onChange={(col) => {
                  const colType = entity
                    ? catalog.getEntity(entity)?.properties[col]
                    : undefined;
                  const nextOps = colType
                    ? Array.from(operatorsForType(colType))
                    : [];
                  onChange(index, {
                    left: {
                      kind: "literal",
                      type: { kind: "primitive", of: "string" },
                      value: col
                    },
                    operator: pickDefaultOp(nextOps),
                    right: undefined
                  });
                }}
              />
            </Field>
          ) : (
            <ValueField
              label={t`Property`}
              placeholder={t`Type '{' for a variable`}
              type={leftType ?? STRING_TYPE}
              accepts="any"
              value={clause.left}
              onChange={(next) => {
                const nextType =
                  next?.kind === "literal" ? next.type : undefined;
                const nextOps = nextType
                  ? Array.from(operatorsForType(nextType))
                  : [];
                onChange(index, {
                  left: next ?? EMPTY_LEFT,
                  operator: pickDefaultOp(nextOps),
                  right: undefined
                });
              }}
              context={context}
              issue={issueForField(
                issues,
                `${fieldPath}.left`,
                `${fieldPath}.field`
              )}
              partIssues={partIssuesForField(
                issues,
                `${fieldPath}.left`,
                `${fieldPath}.field`
              )}
              isReadOnly={isReadOnly}
            />
          )}

          <Field label={t`Operator`}>
            <OperatorCombobox
              value={clause.operator}
              onChange={(op: Operator) =>
                onChange(index, {
                  operator: op as Clause["operator"],
                  right: undefined
                })
              }
              available={Array.from(availableOps)}
              disabled={!leftType || isReadOnly}
            />
          </Field>

          {leftType ? (
            <ValueField
              label={t`Value`}
              placeholder={t`Type '{' for a variable`}
              type={expectedClauseRightType(leftType, clause.operator)}
              choices={rightChoices}
              value={clause.right}
              onChange={(next) => onChange(index, { right: next })}
              context={context}
              issue={issueForField(
                issues,
                `${fieldPath}.right`,
                `${fieldPath}.value`
              )}
              partIssues={partIssuesForField(
                issues,
                `${fieldPath}.right`,
                `${fieldPath}.value`
              )}
              isReadOnly={isReadOnly}
            />
          ) : (
            <Field label={t`Value`}>
              <div className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
                {t`Pick a property first`}
              </div>
            </Field>
          )}
        </div>
      </div>

      <IconButton
        icon={<LuX />}
        aria-label={t`Remove clause`}
        variant="ghost"
        size="sm"
        onClick={() => onRemove(index)}
        isDisabled={!canRemove || isReadOnly}
        className={cn(
          "shrink-0",
          !canRemove && "opacity-0 pointer-events-none"
        )}
      />
    </div>
  );
}

export default memo(ClauseRowImpl);
