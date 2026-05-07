import { cn, IconButton } from "@carbon/react";
import {
  type Condition,
  type FieldDef,
  getFieldDef,
  type Operator
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import { LuX } from "react-icons/lu";
import FieldCombobox from "./FieldCombobox";
import OperatorCombobox from "./OperatorCombobox";
import type { ValueOptionsByLoader } from "./useValueOptions";
import ValueInput from "./ValueInput";

export const CONDITION_GRID_CLASS =
  "grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]";

type ConditionRowProps = {
  condition: Condition;
  index: number;
  canRemove: boolean;
  onChange: (index: number, patch: Partial<Condition>) => void;
  onRemove: (index: number) => void;
  optionsByLoader: ValueOptionsByLoader;
};

function ConditionRowImpl({
  condition,
  index,
  canRemove,
  onChange,
  onRemove,
  optionsByLoader
}: ConditionRowProps) {
  const { t } = useLingui();

  const fieldDef = useMemo<FieldDef | undefined>(
    () => getFieldDef(condition.field),
    [condition.field]
  );

  const valueOptions = useMemo(
    () =>
      fieldDef?.valueOptionsLoader
        ? optionsByLoader[fieldDef.valueOptionsLoader]
        : undefined,
    [fieldDef, optionsByLoader]
  );

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className={cn(
          "group flex-1 min-w-0 rounded-lg border border-border bg-card p-3",
          "transition-colors hover:border-border/80"
        )}
      >
        <div className={CONDITION_GRID_CLASS}>
          <FieldCombobox
            value={condition.field}
            onChange={(path) =>
              onChange(index, { field: path, op: "eq", value: undefined })
            }
          />

          <OperatorCombobox
            value={condition.op}
            onChange={(op: Operator) =>
              onChange(index, { op, value: undefined })
            }
            available={fieldDef?.operators ?? []}
            disabled={!fieldDef}
          />

          <ValueInput
            fieldDef={fieldDef}
            op={condition.op}
            value={condition.value}
            options={valueOptions}
            onChange={(next) => onChange(index, { value: next })}
          />
        </div>
      </div>

      <IconButton
        icon={<LuX />}
        aria-label={t`Remove condition`}
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

export default memo(ConditionRowImpl);
