import {
  Label,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper
} from "@carbon/react";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";

/**
 * A labeled numeric input. `NumberField` (react-aria) is a container — it needs
 * a composed `NumberInputGroup` child to render an actual input — so callers
 * can't just pass a `label` prop. This wraps the boilerplate.
 */
export function NumberRow({
  label,
  value,
  onChange,
  minValue,
  maxValue
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  minValue?: number;
  maxValue?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <NumberField
        value={value}
        onChange={(v) => onChange(Number.isNaN(v) ? 0 : v)}
        minValue={minValue}
        maxValue={maxValue}
        aria-label={label}
      >
        <NumberInputGroup className="relative">
          <NumberInput />
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
    </div>
  );
}
