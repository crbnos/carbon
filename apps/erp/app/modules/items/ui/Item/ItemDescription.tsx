import { InputControlled, ValidatedForm } from "@carbon/form";
import { useLingui } from "@lingui/react/macro";
import { z } from "zod";

const descriptionValidator = z.object({
  description: z.string().optional()
});

type ItemDescriptionProps = {
  value: string;
  onChange: (value: string | null) => void;
};

/**
 * Inline long description for item Properties panels. Uses the exact same
 * ValidatedForm + InputControlled `inline` mechanism as the short
 * description (name) field so the two text fields display and save
 * identically - controlled `value` keeps the field in sync (no stale text),
 * and onBlur persists through the same bulkUpdateItems path.
 */
const ItemDescription = ({ value, onChange }: ItemDescriptionProps) => {
  const { t } = useLingui();

  return (
    <ValidatedForm
      defaultValues={{ description: value ?? undefined }}
      validator={descriptionValidator}
      className="w-full"
    >
      <InputControlled
        label={t`Long Description`}
        name="description"
        inline
        size="sm"
        value={value ?? ""}
        onBlur={(e) => {
          onChange(e.target.value ?? null);
        }}
        className="text-muted-foreground"
      />
    </ValidatedForm>
  );
};

export default ItemDescription;
