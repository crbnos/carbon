import { useState } from "react";
import { useBuilderStoreApi } from "../context";
import { pickControl } from "./control";
import { Field } from "./Field";
import { InlineValueEditor } from "./InlineValueEditor";
import { LiteralControl } from "./LiteralControl";
import type { ValueFieldProps } from "./types";
import { VariableChip } from "./VariableChip";
import { VariableMenuPopover } from "./VariableMenuPopover";
import { VariablePickControl } from "./VariablePickControl";
import { pickAccepts } from "./variableMenu";

export function ValueField({
  label,
  type,
  accepts,
  required,
  helpTermId,
  choices,
  value,
  onChange,
  context,
  placeholder,
  issue,
  partIssues
}: ValueFieldProps) {
  const store = useBuilderStoreApi();
  const [pickerOpen, setPickerOpen] = useState(false);
  const control = pickControl(type, value, choices);
  const acceptsFilter = pickAccepts(type, accepts);
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
        helpTermId={helpTermId}
        issue={issue}
      >
        <InlineValueEditor
          accepts={acceptsFilter}
          collapseSingleRef
          value={value}
          onChange={onChange}
          context={context}
          placeholder={placeholder}
          hasIssue={!!issue}
          // A lone variable is stored bare, so the field's own message is about it.
          partIssues={
            value?.kind === "template"
              ? partIssues
              : issue !== undefined
                ? { 0: issue }
                : undefined
          }
        />
      </Field>
    );
  }

  return (
    <Field
      label={label}
      required={required}
      helpTermId={helpTermId}
      issue={issue}
    >
      {/* The popup anchors to the control itself. A field is either a value you write
          or a variable you pick — never a box with a second way in bolted to its edge. */}
      <VariableMenuPopover
        accepts={acceptsFilter}
        context={context}
        onChange={onChange}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      >
        <div className="flex min-w-0 flex-1 items-center">
          {control === "chip" || control === "pick" ? (
            <VariablePickControl
              placeholder={placeholder}
              hasIssue={!!issue}
              onOpen={() => setPickerOpen(true)}
              chip={
                control === "chip" && ref ? (
                  <VariableChip
                    variable={ref}
                    nodeTitle={nodeTitle}
                    invalid={issue}
                    onRemove={() => onChange(undefined)}
                    onReopen={() => setPickerOpen(true)}
                  />
                ) : undefined
              }
            />
          ) : (
            <LiteralControl
              type={type}
              choices={choices}
              value={
                value?.kind === "literal"
                  ? (value.value as
                      | string
                      | number
                      | boolean
                      | null
                      | undefined)
                  : undefined
              }
              onChange={onChange}
              onRequestVariable={() => setPickerOpen(true)}
            />
          )}
        </div>
      </VariableMenuPopover>
    </Field>
  );
}
