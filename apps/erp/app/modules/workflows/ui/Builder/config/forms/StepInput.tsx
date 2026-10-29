// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CatalogInput,
  ValueOrRef,
  WorkflowIssue
} from "@carbon/ee/workflows";
import { isMultiSelect } from "@carbon/ee/workflows";
import {
  actionInputLabelKey,
  useWorkflowCatalog,
  useWorkflowLabel,
  workflowFieldHelp
} from "../../catalog";
import { lockedChoices, useChoiceOptions } from "../../fields/choiceOptions";
import { MultiChoiceField } from "../../fields/MultiChoiceField";
import { OptionsField } from "../../fields/OptionsField";
import { PairsField } from "../../fields/PairsField";
import { TemplateField } from "../../fields/TemplateField";
import { ValueField } from "../../fields/ValueField";
import {
  issueForField,
  partIssuesForField,
  rowIssuesForField
} from "../../issues";

/**
 * One input of a step, whatever kind of step it is.
 *
 * Actions and integration steps declare their inputs identically, so they render
 * identically — sharing this is what stops the two drifting apart as new input
 * kinds are added.
 */
export type StepInputProps = {
  /** The catalog id of the action or integration step that declares the input. */
  stepId: string;
  name: string;
  inputDef: CatalogInput;
  /** Advisory one-liner under the control (a record that will not link, and why). */
  hint?: string;
  /** Every input on the node, for gates and for fetched-choice dependencies. */
  inputs: Record<string, ValueOrRef>;
  issues?: WorkflowIssue[];
  nodeId: string;
  batching: boolean;
  isReadOnly?: boolean;
  onChange: (name: string, value: ValueOrRef | undefined) => void;
};

export function StepInput({
  stepId,
  name,
  inputDef,
  hint,
  inputs,
  issues,
  nodeId,
  batching,
  isReadOnly,
  onChange
}: StepInputProps) {
  const label = useWorkflowLabel();
  const catalog = useWorkflowCatalog();
  const choiceOptions = useChoiceOptions();

  // A custom-field input has no translated key — fall back to the customer's own name.
  const labelFor = (input: string) =>
    label(
      actionInputLabelKey(stepId, input),
      catalog.getInputLabel(stepId, input) ?? input
    );
  const fieldLabel = labelFor(name);
  const helpTermId = workflowFieldHelp(actionInputLabelKey(stepId, name));
  // The vendor's (or a hand-written action's) own field description, translated
  // like its label.
  const help =
    inputDef.description === undefined
      ? undefined
      : label(
          `${actionInputLabelKey(stepId, name)}.description`,
          inputDef.description
        );

  const fieldContext = { nodeId, inLoop: batching, batching };
  const fieldIssue = issueForField(issues, name, `inputs.${name}`);
  const fieldParts = partIssuesForField(issues, name, `inputs.${name}`);

  // An input whose values are fetched. Remounted when a value it depends on
  // changes: a calendar id chosen against one account means nothing in another.
  if (inputDef.options) {
    const dependsOn = inputDef.options.dependsOn ?? [];
    const values: Record<string, string> = {};
    const dependencyLabels: Record<string, string> = {};
    for (const dependency of dependsOn) {
      const held = inputs[dependency];
      values[dependency] =
        held?.kind === "literal" && typeof held.value === "string"
          ? held.value
          : "";
      dependencyLabels[dependency] = labelFor(dependency);
    }
    return (
      <OptionsField
        key={`${name}:${dependsOn.map((d) => values[d]).join(":")}`}
        label={fieldLabel}
        help={help}
        hint={hint}
        source={inputDef.options}
        type={inputDef.type}
        values={values}
        dependencyLabels={dependencyLabels}
        required={inputDef.required}
        value={inputs[name]}
        onChange={(v) => onChange(name, v)}
        issue={fieldIssue}
        isReadOnly={isReadOnly}
      />
    );
  }

  if (inputDef.pairs) {
    return (
      <PairsField
        label={fieldLabel}
        helpTermId={helpTermId}
        help={help}
        hint={hint}
        type={inputDef.type}
        required={inputDef.required}
        value={inputs[name]}
        onChange={(v) => onChange(name, v)}
        context={fieldContext}
        issue={fieldIssue}
        partIssues={rowIssuesForField(issues, name, `inputs.${name}`)}
        isReadOnly={isReadOnly}
      />
    );
  }

  if (isMultiSelect(inputDef)) {
    return (
      <MultiChoiceField
        label={fieldLabel}
        helpTermId={helpTermId}
        help={help}
        hint={hint}
        type={inputDef.type}
        required={inputDef.required}
        options={choiceOptions(inputDef.choices)}
        locked={lockedChoices(inputDef.choices)}
        value={inputs[name]}
        onChange={(v) => onChange(name, v)}
        issue={fieldIssue}
        isReadOnly={isReadOnly}
      />
    );
  }

  if (inputDef.template) {
    return (
      <TemplateField
        label={fieldLabel}
        helpTermId={helpTermId}
        help={help}
        hint={hint}
        type={inputDef.type}
        required={inputDef.required}
        value={inputs[name]}
        onChange={(v) => onChange(name, v)}
        context={fieldContext}
        issue={fieldIssue}
        partIssues={fieldParts}
        isReadOnly={isReadOnly}
      />
    );
  }

  return (
    <ValueField
      label={fieldLabel}
      helpTermId={helpTermId}
      help={help}
      hint={hint}
      defaultValue={inputDef.defaultValue}
      type={inputDef.type}
      required={inputDef.required}
      choices={inputDef.choices}
      precision={inputDef.precision}
      value={inputs[name]}
      onChange={(v) => onChange(name, v)}
      context={fieldContext}
      issue={fieldIssue}
      partIssues={fieldParts}
      isReadOnly={isReadOnly}
    />
  );
}
