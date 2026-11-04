// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  TextAreaControlled,
  useInlineField,
  ValidatedForm
} from "@carbon/form";
import { InlineTrigger, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { z } from "zod";

const descriptionValidator = z.object({
  description: z.string().optional()
});

type ItemDescriptionProps = {
  value: string;
  onChange: (value: string | null) => void;
  // Match the parent panel's field idiom: `true` (default) = click-to-edit
  // preview for the sidebar; `false` = an always-open textarea for the form.
  inline?: boolean;
  // Read-only: render the value as a static preview, no textarea / edit control.
  isReadOnly?: boolean;
};

/**
 * Long description for item Properties panels; persists onBlur through the same
 * bulkUpdateItems path. Sidebar (`inline`) shows a clamped preview
 * (line-clamp-3, full text on hover) that swaps to a textarea on click; the form
 * (`inline={false}`) renders the textarea directly. Controlled `value` keeps the
 * field in sync (no stale text).
 */
const ItemDescription = ({
  value,
  onChange,
  inline = true,
  isReadOnly = false
}: ItemDescriptionProps) => {
  const { t } = useLingui();
  const [isEditing, setIsEditing] = useState(false);
  const label = t`Long Description`;
  const inlineField = useInlineField({
    inline: true,
    label,
    isEmpty: !value,
    isReadOnly
  });

  if (!isReadOnly && (!inline || isEditing)) {
    return (
      <ValidatedForm
        defaultValues={{ description: value ?? undefined }}
        validator={descriptionValidator}
        className="w-full"
      >
        <TextAreaControlled
          autoFocus={inline}
          label={label}
          name="description"
          rows={3}
          value={value ?? ""}
          onBlur={(e) => {
            onChange(e.target.value ?? null);
            if (inline) setIsEditing(false);
          }}
          className="text-muted-foreground"
        />
      </ValidatedForm>
    );
  }

  return (
    <VStack spacing={1} className="w-full">
      {inlineField.showLabel && (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <div className="flex w-full">
        <InlineTrigger
          isEmpty={!value}
          placeholder={inlineField.placeholder}
          isDisabled={isReadOnly}
          onClick={() => setIsEditing(true)}
        >
          <span className="line-clamp-3 text-muted-foreground">{value}</span>
        </InlineTrigger>
      </div>
    </VStack>
  );
};

export default ItemDescription;
