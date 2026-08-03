import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useBuilderStoreApi } from "../context";
import { needsPicker, pickControl } from "./control";
import { Field } from "./Field";
import { InlineValueEditor } from "./InlineValueEditor";
import { LiteralControl } from "./LiteralControl";
import type { ValueFieldProps } from "./types";
import { VariableChip } from "./VariableChip";
import { VariablePickerButton } from "./VariablePickerButton";
import { hasStrayBrace } from "./valueParts";

export function ValueField({
  label,
  type,
  required,
  choices,
  value,
  onChange,
  context,
  hideLabel,
  placeholder,
  issue
}: ValueFieldProps) {
  const { t } = useLingui();
  const store = useBuilderStoreApi();
  const [pickerOpen, setPickerOpen] = useState(false);
  const control = pickControl(type, value, choices);
  const ref =
    value?.kind === "ref" || value?.kind === "item" ? value : undefined;

  // Undefined when the step is gone — `VariableChip` keys its "step removed"
  // state off that, so it must not be defaulted to the id.
  const nodeTitle =
    ref?.kind === "ref"
      ? store.getState().nodes.find((n) => n.id === ref.nodeId)?.name
      : undefined;

  if (control === "inline") {
    return (
      <Field
        label={label}
        required={required}
        hideLabel={hideLabel}
        issue={issue}
        hint={
          hasStrayBrace(value)
            ? t`A plain { is sent as-is. Pick a variable from the menu.`
            : undefined
        }
      >
        <InlineValueEditor
          accepts={type}
          value={value}
          onChange={onChange}
          context={context}
          placeholder={placeholder}
          hasIssue={!!issue}
        />
      </Field>
    );
  }

  return (
    <Field
      label={label}
      required={required}
      hideLabel={hideLabel}
      issue={issue}
    >
      <div className="min-w-0 flex-1">
        {control === "chip" && ref ? (
          <VariableChip
            variable={ref}
            nodeTitle={nodeTitle}
            onRemove={() => onChange(undefined)}
            onReopen={() => setPickerOpen(true)}
          />
        ) : (
          <LiteralControl
            type={type}
            choices={choices}
            value={
              value?.kind === "literal"
                ? (value.value as string | number | boolean | null | undefined)
                : undefined
            }
            onChange={onChange}
          />
        )}
      </div>
      {needsPicker(control) && (
        <VariablePickerButton
          accepts={type}
          context={context}
          value={ref}
          onChange={onChange}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        />
      )}
    </Field>
  );
}

export type { FieldContext, ValueFieldProps } from "./types";
