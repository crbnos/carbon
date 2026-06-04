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
};

/**
 * Inline long description for item Properties panels. Textarea-based so the
 * multi-line content reads naturally: while not editing it shows a clamped
 * preview (line-clamp-3) that reveals the full text on hover via
 * TruncatedTooltipText; clicking the edit button swaps in a textarea that
 * persists onBlur through the same bulkUpdateItems path. Controlled `value`
 * keeps the field in sync (no stale text).
 */
const ItemDescription = ({ value, onChange }: ItemDescriptionProps) => {
  const { t } = useLingui();
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <ValidatedForm
        defaultValues={{ description: value ?? undefined }}
        validator={descriptionValidator}
        className="w-full"
      >
        <TextAreaControlled
          autoFocus
          label={t`Long Description`}
          name="description"
          rows={3}
          value={value ?? ""}
          onBlur={(e) => {
            onChange(e.target.value ?? null);
            setIsEditing(false);
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
        <IconButton
          icon={value ? <LuSettings2 /> : <LuPlus />}
          aria-label={value ? "Edit" : "Add"}
          size="sm"
          variant="secondary"
          onClick={() => setIsEditing(true)}
        />
      </HStack>
    </VStack>
  );
};

export default ItemDescription;
