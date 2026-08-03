import { cn } from "@carbon/react";
import { useState } from "react";
import { LuVariable } from "react-icons/lu";
import { useBuilderStore } from "../context";
import { LiteralControl } from "./LiteralControl";
import type { ValueFieldProps } from "./types";
import { VariableChip } from "./VariableChip";
import { VariablePicker } from "./VariablePicker";

export function ValueField({
  label,
  type,
  required,
  choices,
  value,
  onChange,
  context,
  issue
}: ValueFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const nodes = useBuilderStore((s) => s.nodes);
  const isRef = value?.kind === "ref" || value?.kind === "item";
  const nodeTitle =
    value?.kind === "ref"
      ? (nodes.find((n) => n.id === value.nodeId)?.name ?? value.nodeId)
      : undefined;

  const literalValue =
    value?.kind === "literal"
      ? (value.value as string | number | boolean | null | undefined)
      : undefined;

  const refValue = isRef ? value : undefined;

  return (
    <div className="flex w-full flex-col gap-1">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>

      <div
        className={cn(
          "flex items-center gap-1",
          issue && "rounded-md ring-2 ring-destructive ring-offset-1"
        )}
      >
        {isRef ? (
          <>
            <div className="min-w-0 flex-1">
              <VariableChip
                variable={value}
                nodeTitle={nodeTitle}
                onRemove={() => onChange(undefined)}
                onReopen={() => setPickerOpen(true)}
              />
            </div>
            <VariablePicker
              accepts={type}
              nodeId={context.nodeId}
              inLoop={context.inLoop}
              value={refValue}
              onChange={(next) => onChange(next)}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
            >
              <button
                type="button"
                title="Change variable"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                aria-label="Change variable"
                onClick={() => setPickerOpen(true)}
              >
                <LuVariable className="h-4 w-4" />
              </button>
            </VariablePicker>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <LiteralControl
                type={type}
                choices={choices}
                value={literalValue}
                onChange={onChange}
              />
            </div>
            <VariablePicker
              accepts={type}
              nodeId={context.nodeId}
              inLoop={context.inLoop}
              value={refValue}
              onChange={(next) => onChange(next)}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
            >
              <button
                type="button"
                title="Pick a variable"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                aria-label="Pick variable"
                onClick={() => setPickerOpen(true)}
              >
                <LuVariable className="h-4 w-4" />
              </button>
            </VariablePicker>
          </>
        )}
      </div>

      {issue && <p className="text-xs text-destructive">{issue}</p>}
    </div>
  );
}

export type { FieldContext, ValueFieldProps } from "./types";
