import {
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
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { RECORD_PICKERS } from "./recordPickers";

type LiteralControlProps = {
  type: ValueType;
  choices?: readonly string[];
  value: string | number | boolean | null | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  /** Opens the variable menu. Text-entry controls call it on `{`; the rest render the
   * affordance button. */
  onRequestVariable: () => void;
  /** Rendered inside the control's trailing edge for controls with no text entry. */
  affordance: ReactNode;
};

export function LiteralControl({
  type,
  choices,
  value,
  onChange,
  onRequestVariable,
  affordance
}: LiteralControlProps) {
  const { t } = useLingui();

  function emit(raw: string | number | boolean | null | undefined) {
    if (raw === undefined || raw === "" || raw === null) {
      onChange(undefined);
    } else {
      onChange({ kind: "literal", type, value: raw });
    }
  }

  // `min-w-0` so the control can shrink inside a flex row instead of forcing its
  // content width onto the card; `relative` positions the affordance.
  const shell = (children: ReactNode) => (
    <div className="relative min-w-0 flex-1">{children}</div>
  );

  // A `{` in a text-entry control opens the menu rather than landing in the buffer.
  const braceOpens = (e: { key: string; preventDefault: () => void }) => {
    if (e.key === "{") {
      e.preventDefault();
      onRequestVariable();
    }
  };

  // 1. Choices → Select
  if (choices && choices.length > 0) {
    const strValue = typeof value === "string" ? value : "";
    return shell(
      <>
        <Select value={strValue} onValueChange={(v) => emit(v || undefined)}>
          <SelectTrigger>
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
        {affordance}
      </>
    );
  }

  // 2. Primitive kinds
  if (type.kind === "primitive") {
    switch (type.of) {
      // Unreachable via pickControl; kept so LiteralControl stays total over ValueType.
      case "string": {
        const strValue = typeof value === "string" ? value : "";
        return shell(
          <>
            <Input
              size="md"
              type="text"
              className="truncate"
              value={strValue}
              onChange={(e) => emit(e.target.value)}
              onKeyDown={braceOpens}
              placeholder={t`Enter text…`}
            />
            {affordance}
          </>
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
          >
            <NumberInputGroup className="relative">
              <NumberInput
                className="truncate"
                placeholder={t`Enter number…`}
                onKeyDown={braceOpens}
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
          <>
            <Switch
              checked={boolValue}
              onCheckedChange={(checked) => emit(checked)}
              aria-label={t`Toggle`}
            />
            {affordance}
          </>
        );
      }

      case "date": {
        const strValue = typeof value === "string" ? value : "";
        return shell(
          <Input
            size="md"
            type="date"
            className="truncate"
            value={strValue}
            onChange={(e) => emit(e.target.value || undefined)}
            onKeyDown={braceOpens}
          />
        );
      }

      case "null":
        return null;
    }
  }

  // 3. Entity → Carbon selector when available, otherwise plain id input
  if (type.kind === "entity") {
    const Picker = RECORD_PICKERS[type.of];
    if (Picker) {
      const strValue = typeof value === "string" ? value : undefined;
      return shell(
        <>
          <Picker value={strValue} onChange={(id) => emit(id ?? undefined)} />
          {affordance}
        </>
      );
    }
    return shell(
      <>
        <Input
          size="md"
          type="text"
          className="truncate"
          placeholder={t`Enter record id…`}
          disabled
        />
        {affordance}
      </>
    );
  }

  // 4. List → prompt
  return shell(
    <>
      <Input
        size="md"
        type="text"
        className="truncate"
        placeholder={t`Pick a list from an earlier step`}
        disabled
      />
      {affordance}
    </>
  );
}
