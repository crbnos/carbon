import type { TermId } from "@carbon/glossary";
import type { ChoiceSelectOption } from "@carbon/react";
import type {
  CatalogInput,
  ValueOrRef,
  WorkflowIssue
} from "@carbon/workflows";
import { isMultiSelect } from "@carbon/workflows";
import type { ReactNode } from "react";
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
export type StepInputArgs = {
  name: string;
  inputDef: CatalogInput;
  label: string;
  helpTermId?: TermId;
  /** Every input on the node, for gates and for fetched-choice dependencies. */
  inputs: Record<string, ValueOrRef>;
  issues?: WorkflowIssue[];
  nodeId: string;
  batching: boolean;
  isReadOnly?: boolean;
  onChange: (name: string, value: ValueOrRef | undefined) => void;
  /** Human label for another input on the same node. */
  labelFor: (name: string) => string;
  choiceOptions: (choices: readonly string[]) => ChoiceSelectOption[];
  lockedChoices: (choices: readonly string[]) => readonly string[];
};

export function renderStepInput({
  name,
  inputDef,
  label,
  helpTermId,
  inputs,
  issues,
  nodeId,
  batching,
  isReadOnly,
  onChange,
  labelFor,
  choiceOptions,
  lockedChoices
}: StepInputArgs): ReactNode {
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
        label={label}
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
        key={name}
        label={label}
        helpTermId={helpTermId}
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
        key={name}
        label={label}
        helpTermId={helpTermId}
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
        key={name}
        label={label}
        helpTermId={helpTermId}
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
      key={name}
      label={label}
      helpTermId={helpTermId}
      type={inputDef.type}
      required={inputDef.required}
      choices={inputDef.choices}
      value={inputs[name]}
      onChange={(v) => onChange(name, v)}
      context={fieldContext}
      issue={fieldIssue}
      partIssues={fieldParts}
      isReadOnly={isReadOnly}
    />
  );
}
