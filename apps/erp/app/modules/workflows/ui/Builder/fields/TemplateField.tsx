import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Field } from "./Field";
import { InlineValueEditor } from "./InlineValueEditor";
import type { ValueFieldProps } from "./types";
import { hasStrayBrace } from "./valueParts";

/** A field that always mixes text and variables. Accepts any type — everything
 * reads as text once it is inside a sentence. */
export function TemplateField({
  label,
  required,
  helpTermId,
  value,
  onChange,
  context,
  issue,
  partIssues
}: ValueFieldProps) {
  const { t } = useLingui();
  const [isFocused, setIsFocused] = useState(false);
  return (
    <Field
      label={label}
      required={required}
      helpTermId={helpTermId}
      issue={issue}
      hint={
        // Only once the user has moved on: a lone '{' is the first keystroke of
        // picking a variable, not a mistake yet.
        hasStrayBrace(value) && !isFocused
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
        partIssues={partIssues}
        maxRows={10}
        onFocusChange={setIsFocused}
      />
    </Field>
  );
}
