import { Combobox, cn, IconButton } from "@carbon/react";
import type { Operator } from "@carbon/utils";
import type { Clause, ValueType } from "@carbon/workflows";
import { operatorsForType } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { memo, useEffect, useMemo } from "react";
import { LuX } from "react-icons/lu";
import OperatorCombobox from "~/modules/storage-rules/ui/OperatorCombobox";
import { catalog, propertyLabelKey, useWorkflowLabel } from "../catalog";
import type { FieldContext } from "../fields/types";
import { ValueField } from "../fields/ValueField";

export const CLAUSE_GRID_CLASS =
  "grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]";

function pickDefaultOp(ops: readonly Operator[]): Operator {
  return ops.includes("eq") ? "eq" : (ops[0] ?? "eq");
}

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
};

function ClauseRowImpl({
  clause,
  index,
  canRemove,
  onChange,
  onRemove,
  context,
  leftMode = "value",
  entity
}: ClauseRowProps) {
  const { t } = useLingui();
  const label = useWorkflowLabel();

  // Derive the left operand's type for operator selection
  const leftType = useMemo<ValueType | undefined>(() => {
    if (leftMode === "column") {
      const colName =
        clause.left.kind === "literal" && typeof clause.left.value === "string"
          ? clause.left.value
          : undefined;
      if (!colName || !entity) return undefined;
      return catalog.getEntity(entity)?.properties[colName];
    }
    // "value" mode: derive from the embedded literal type only
    return clause.left.kind === "literal" ? clause.left.type : undefined;
  }, [leftMode, clause.left, entity]);

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
        label: label(propertyLabelKey(entity, col), col),
        value: col
      })
    );
  }, [leftMode, entity, label]);

  const currentColumn =
    leftMode === "column" &&
    clause.left.kind === "literal" &&
    typeof clause.left.value === "string"
      ? clause.left.value
      : undefined;

  // In column mode, supply enum choices for the right-side ValueField
  const rightChoices = useMemo(
    () =>
      leftMode === "column" && entity && currentColumn
        ? catalog.getEnum(entity, currentColumn)
        : undefined,
    [leftMode, entity, currentColumn]
  );

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className={cn(
          "group flex-1 min-w-0 rounded-lg border border-border bg-card p-3",
          "transition-colors hover:border-border/80"
        )}
      >
        <div className={CLAUSE_GRID_CLASS}>
          {/* Left side */}
          {leftMode === "column" ? (
            <Combobox
              size="md"
              placeholder={t`Pick a column`}
              value={currentColumn}
              options={columnOptions}
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
          ) : (
            <ValueField
              label={t`Left`}
              type={leftType ?? { kind: "primitive", of: "string" }}
              value={clause.left}
              onChange={(next) => {
                const nextType =
                  next?.kind === "literal" ? next.type : undefined;
                const nextOps = nextType
                  ? Array.from(operatorsForType(nextType))
                  : [];
                onChange(index, {
                  left: next,
                  operator: pickDefaultOp(nextOps),
                  right: undefined
                });
              }}
              context={context}
            />
          )}

          {/* Operator */}
          <OperatorCombobox
            value={clause.operator}
            onChange={(op: Operator) =>
              onChange(index, {
                operator: op as Clause["operator"],
                right: undefined
              })
            }
            available={Array.from(availableOps)}
            disabled={!leftType}
          />

          {/* Right side */}
          {leftType ? (
            <ValueField
              label={t`Value`}
              type={leftType}
              choices={rightChoices}
              value={clause.right}
              onChange={(next) => onChange(index, { right: next })}
              context={context}
            />
          ) : (
            <div className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground">
              {t`Pick a left operand first`}
            </div>
          )}
        </div>
      </div>

      <IconButton
        icon={<LuX />}
        aria-label={t`Remove clause`}
        variant="ghost"
        size="sm"
        onClick={() => onRemove(index)}
        isDisabled={!canRemove}
        className={cn(
          "shrink-0",
          !canRemove && "opacity-0 pointer-events-none"
        )}
      />
    </div>
  );
}

export default memo(ClauseRowImpl);
