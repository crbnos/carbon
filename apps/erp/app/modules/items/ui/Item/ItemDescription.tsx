import { TextAreaControlled, ValidatedForm } from "@carbon/form";
import {
  HStack,
  IconButton,
  TruncatedTooltipText,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPlus, LuSettings2 } from "react-icons/lu";
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

  if (!isReadOnly && (!inline || isEditing)) {
    return (
      <ValidatedForm
        defaultValues={{ description: value ?? undefined }}
        validator={descriptionValidator}
        className="w-full"
      >
        <TextAreaControlled
          autoFocus={inline}
          label={t`Long Description`}
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
      <span className="text-xs text-muted-foreground">{t`Long Description`}</span>
      <HStack spacing={0} className="w-full justify-between items-start">
        {value && (
          <TruncatedTooltipText
            className="flex-grow text-sm line-clamp-3 text-muted-foreground"
            tooltip={value}
          >
            {value}
          </TruncatedTooltipText>
        )}
        {!isReadOnly && (
          <IconButton
            icon={value ? <LuSettings2 /> : <LuPlus />}
            aria-label={value ? "Edit" : "Add"}
            size="sm"
            variant="secondary"
            onClick={() => setIsEditing(true)}
          />
        )}
      </HStack>
    </VStack>
  );
};

export default ItemDescription;
