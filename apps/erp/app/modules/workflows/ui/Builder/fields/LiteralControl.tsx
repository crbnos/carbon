import {
  DatePicker,
  Input,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch
} from "@carbon/react";
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import { parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import type { KeyboardEvent, ReactNode } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { RECORD_PICKERS } from "./recordPickers";

/** Stored dates are the `YYYY-MM-DD` the picker itself writes. Anything else is a
 * value from elsewhere, and an empty picker beats a crash. */
function asCalendarDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return parseDate(value.slice(0, 10));
  } catch {
    return null;
  }
}

type LiteralControlProps = {
  type: ValueType;
  choices?: readonly string[];
  value: string | number | boolean | null | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  /** Opens the variable menu. Every control here has two modes, and `{` is the one
   * way into the second. */
  onRequestVariable: () => void;
  /** The version is published: show the value, refuse every edit. */
  isReadOnly?: boolean;
};

export function LiteralControl({
  type,
  choices,
  value,
  onChange,
  onRequestVariable,
  isReadOnly = false
}: LiteralControlProps) {
  const { t } = useLingui();

  function emit(raw: string | number | boolean | null | undefined) {
    if (raw === undefined || raw === "" || raw === null) {
      onChange(undefined);
    } else {
      onChange({ kind: "literal", type, value: raw });
    }
  }

  // A `{` opens the menu rather than landing in the buffer. On the shell rather than
  // each input, so a dropdown and a switch answer the key the same way a text box does.
  const braceOpens = (e: KeyboardEvent) => {
    if (isReadOnly) return;
    if (e.key === "{") {
      e.preventDefault();
      onRequestVariable();
    }
  };

  // `min-w-0` so the control can shrink inside a flex row instead of forcing its
  // content width onto the card.
  const shell = (children: ReactNode) => (
    <div className="min-w-0 flex-1" onKeyDown={braceOpens}>
      {children}
    </div>
  );

  // 1. Choices → Select
  if (choices && choices.length > 0) {
    const strValue = typeof value === "string" ? value : "";
    return shell(
      <Select
        value={strValue}
        onValueChange={(v) => emit(v || undefined)}
        disabled={isReadOnly}
      >
        <SelectTrigger disabled={isReadOnly}>
          <SelectValue className="truncate" placeholder={t`Select…`} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // 2. Primitive kinds
  if (type.kind === "primitive") {
    switch (type.of) {
      // Unreachable via pickControl; kept so LiteralControl stays total over ValueType.
      case "string": {
        const strValue = typeof value === "string" ? value : "";
        return shell(
          <Input
            size="md"
            type="text"
            className="truncate"
            value={strValue}
            onChange={(e) => emit(e.target.value)}
            placeholder={t`Enter text…`}
            isDisabled={isReadOnly}
          />
        );
      }

      case "number": {
        const numValue =
          typeof value === "number"
            ? value
            : typeof value === "string" && value !== ""
              ? Number(value)
              : undefined;
        return shell(
          <NumberField
            value={numValue}
            onChange={(n) =>
              emit(typeof n === "number" && !Number.isNaN(n) ? n : undefined)
            }
            aria-label={t`Number`}
            isDisabled={isReadOnly}
          >
            <NumberInputGroup className="relative">
              <NumberInput
                className="truncate"
                placeholder={t`Enter number…`}
              />
              <NumberInputStepper>
                <NumberIncrementStepper>
                  <LuChevronUp size="1em" strokeWidth="3" />
                </NumberIncrementStepper>
                <NumberDecrementStepper>
                  <LuChevronDown size="1em" strokeWidth="3" />
                </NumberDecrementStepper>
              </NumberInputStepper>
            </NumberInputGroup>
          </NumberField>
        );
      }

      case "boolean": {
        const boolValue = typeof value === "boolean" ? value : false;
        return shell(
          <Switch
            checked={boolValue}
            onCheckedChange={(checked) => emit(checked)}
            aria-label={t`Toggle`}
            disabled={isReadOnly}
          />
        );
      }

      case "date": {
        return shell(
          <DatePicker
            value={asCalendarDate(value)}
            onChange={(date) => emit(date?.toString() ?? undefined)}
            aria-label={t`Date`}
            isDisabled={isReadOnly}
          />
        );
      }

      case "null":
        return null;
    }
  }

  // 3. Entity → the Carbon selector for that record
  if (type.kind === "entity") {
    const Picker = RECORD_PICKERS[type.of];
    if (Picker) {
      const strValue = typeof value === "string" ? value : undefined;
      return shell(
        <Picker
          value={strValue}
          onChange={(id) => emit(id ?? undefined)}
          isDisabled={isReadOnly}
        />
      );
    }
  }

  // A record with no picker, or a list: `pickControl` sends both to the variable
  // select before they reach here. Kept so this stays total over ValueType.
  return shell(
    <Input
      size="md"
      type="text"
      className="truncate"
      placeholder={t`Pick a value from an earlier step`}
      isDisabled
    />
  );
}
