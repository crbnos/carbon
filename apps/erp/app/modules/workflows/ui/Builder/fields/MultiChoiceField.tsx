import type { TermId } from "@carbon/glossary";
import { ChoiceSelect, type ChoiceSelectOption } from "@carbon/react";
import type { ValueOrRef, ValueType } from "@carbon/workflows";
import { useLingui } from "@lingui/react/macro";
import { Field } from "./Field";
import { choiceState, writeChoices } from "./multiChoice";

export type MultiChoiceFieldProps = {
  label: string;
  type: ValueType;
  required?: boolean;
  helpTermId?: TermId;
  /** Titles, descriptions and per-option availability, in the order to offer them. */
  options: ChoiceSelectOption[];
  /** Always ticked and never togglable, whatever is stored — a channel the platform
   * sends regardless. Not written on mount, so an untouched node stays untouched. */
  locked?: readonly string[];
  value: ValueOrRef | undefined;
  onChange: (next: ValueOrRef | undefined) => void;
  issue?: string;
  isReadOnly?: boolean;
};

/**
 * A set of fixed choices, for a catalog input declared `multiple`. Deliberately not a
 * `ValueField` control: there is no variable to bind here, so the `{` affordance every
 * other control carries would offer something this field cannot accept.
 */
export function MultiChoiceField({
  label,
  type,
  required,
  helpTermId,
  options,
  locked,
  value,
  onChange,
  issue,
  isReadOnly
}: MultiChoiceFieldProps) {
  const { t } = useLingui();
  const choices = options.map((option) => option.value);
  const { shown, frozen } = choiceState(options, value, locked);
  const rendered = options.map((option) => ({
    ...option,
    disabled: frozen.includes(option.value)
  }));

  return (
    <Field
      label={label}
      required={required}
      helpTermId={helpTermId}
      issue={issue}
    >
      <div className="min-w-0 flex-1">
        <ChoiceSelect
          multiple
          aria-label={label}
          options={rendered}
          value={shown}
          onChange={(next) => onChange(writeChoices(next, choices, type))}
          placeholder={t`Select…`}
          disabled={isReadOnly}
          className="w-full"
        />
      </div>
    </Field>
  );
}
