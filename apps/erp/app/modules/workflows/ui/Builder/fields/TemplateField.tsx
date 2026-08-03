import { useLingui } from "@lingui/react/macro";
import { Field } from "./Field";
import { InlineValueEditor } from "./InlineValueEditor";
import type { ValueFieldProps } from "./types";
import { hasStrayBrace } from "./valueParts";

/** A field that always mixes text and variables. Accepts any type — everything
 * reads as text once it is inside a sentence. */
export function TemplateField({
  label,
  required,
  value,
  onChange,
  context,
  issue
}: ValueFieldProps) {
  const { t } = useLingui();
  return (
    <Field
      label={label}
      required={required}
      issue={issue}
      hint={
        hasStrayBrace(value)
          ? t`A plain { is sent as-is. Pick a variable from the menu.`
          : undefined
      }
    >
      <InlineValueEditor
        value={value}
        onChange={onChange}
        context={context}
        hasIssue={!!issue}
      />
    </Field>
  );
}
