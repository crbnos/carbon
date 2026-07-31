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
import { LuChevronDown, LuChevronUp } from "react-icons/lu";
import { RECORD_PICKERS } from "./recordPickers";

type LiteralControlProps = {
  type: ValueType;
  choices?: readonly string[];
  value: string | number | boolean | null | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
};

export function LiteralControl({
  type,
  choices,
  value,
  onChange
}: LiteralControlProps) {
  function emit(raw: string | number | boolean | null | undefined) {
    if (raw === undefined || raw === "" || raw === null) {
      onChange(undefined);
    } else {
      onChange({ kind: "literal", type, value: raw });
    }
  }

  // 1. Choices → Select
  if (choices && choices.length > 0) {
    const strValue = typeof value === "string" ? value : "";
    return (
      <Select value={strValue} onValueChange={(v) => emit(v || undefined)}>
        <SelectTrigger>
          <SelectValue placeholder="Select…" />
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
      case "string": {
        const strValue = typeof value === "string" ? value : "";
        return (
          <Input
            size="md"
            type="text"
            value={strValue}
            onChange={(e) => emit(e.target.value)}
            placeholder="Enter text…"
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
        return (
          <NumberField
            value={numValue}
            onChange={(n) =>
              emit(typeof n === "number" && !Number.isNaN(n) ? n : undefined)
            }
            aria-label="Number"
          >
            <NumberInputGroup className="relative">
              <NumberInput placeholder="Enter number…" />
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
        return (
          <Switch
            checked={boolValue}
            onCheckedChange={(checked) => emit(checked)}
            aria-label="Toggle"
          />
        );
      }

      case "date": {
        const strValue = typeof value === "string" ? value : "";
        return (
          <Input
            size="md"
            type="date"
            value={strValue}
            onChange={(e) => emit(e.target.value || undefined)}
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
      return (
        <Picker value={strValue} onChange={(id) => emit(id ?? undefined)} />
      );
    }
    return (
      <Input size="md" type="text" placeholder="Enter record id…" disabled />
    );
  }

  // 4. List → prompt
  return (
    <Input
      size="md"
      type="text"
      placeholder="Pick a list from an earlier step"
      disabled
    />
  );
}
