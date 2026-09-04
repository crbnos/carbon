import { Field } from "./Field";
import { InlineValueEditor } from "./InlineValueEditor";
import type { ValueFieldProps } from "./types";

/** A field that always mixes text and variables. Accepts any type that has a reading
 * as text — a whole record does not, so the menu offers its properties instead. */
export function TemplateField({
  label,
  required,
  helpTermId,
  value,
  onChange,
  context,
  issue,
  partIssues,
  isReadOnly
}: ValueFieldProps) {
  return (
    <Field
      label={label}
      required={required}
      helpTermId={helpTermId}
      issue={issue}
    >
      {/* These are the prose inputs — a subject, a message body, a webhook payload.
          They open at a few rows and take line breaks, so a JSON payload can be
          written the way it is read. */}
      <InlineValueEditor
        textOnly
        collapseSingleRef={false}
        value={value}
        onChange={onChange}
        context={context}
        hasIssue={!!issue}
        partIssues={partIssues}
        multiline
        minRows={4}
        maxRows={12}
        isReadOnly={isReadOnly}
      />
    </Field>
  );
}
