import { NumberField, NumberInput } from "@carbon/react";
import { useNumberFormatter } from "@react-aria/i18n";
import { useState } from "react";
import { LuPencil } from "react-icons/lu";

type EditableNumberCellProps = {
  value: number | undefined;
  formatOptions: Intl.NumberFormatOptions;
  isEditable: boolean;
  onChange: (value: number) => void;
  minValue?: number;
  maxValue?: number;
};

/**
 * A pricing-table value that reads as plain text until you act on it. When the
 * row is editable, the formatted value carries a pencil that fades in on hover
 * (the affordance); clicking reveals the borderless number input and exits on
 * blur. Read-only rows render the value as plain text with no affordance.
 */
function EditableNumberCell({
  value,
  formatOptions,
  isEditable,
  onChange,
  minValue,
  maxValue
}: EditableNumberCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const formatter = useNumberFormatter(formatOptions);

  const display =
    value === undefined || value === null || Number.isNaN(value)
      ? ""
      : formatter.format(value);

  if (isEditable && isEditing) {
    return (
      <NumberField
        autoFocus
        value={value}
        formatOptions={formatOptions}
        minValue={minValue}
        maxValue={maxValue}
        onChange={(next) => {
          if (Number.isFinite(next) && next !== value) onChange(next);
        }}
      >
        <NumberInput
          className="border-0 -ml-3 shadow-none"
          size="sm"
          min={minValue}
          max={maxValue}
          onBlur={() => setIsEditing(false)}
        />
      </NumberField>
    );
  }

  if (!isEditable) {
    return <span className="text-sm">{display}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="group/edit flex w-full cursor-pointer items-center gap-1.5 text-left text-sm"
    >
      <span>{display}</span>
      <LuPencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100" />
    </button>
  );
}

export default EditableNumberCell;
