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
          ? t`A plain '{' is sent as-is. Pick a variable from the menu.`
          : undefined
      }
    >
      {/* These are the prose inputs — a subject, a message body, a webhook payload.
          Five rows is too short for any of them. */}
      <InlineValueEditor
        value={value}
        onChange={onChange}
        context={context}
        hasIssue={!!issue}
        maxRows={10}
      />
    </Field>
  );
}
