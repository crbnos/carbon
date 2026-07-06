import { Select, ValidatedForm } from "@carbon/form";
import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { z } from "zod";
import { SourcingTypeIcon } from "~/components/Icons";
import type { SourcingType } from "~/modules/shared";
import { sourcingType } from "~/modules/shared";

type SourcingTypePropertyProps = {
  replenishmentSystem?: string | null;
  value?: SourcingType | null;
  onChange: (value: SourcingType | null) => void;
};

/**
 * Item-level sourcing selector shown in the Part/Tool Properties sidebar.
 * Sourcing only applies to "Buy and Make" items, so it renders nothing
 * otherwise. Shared between PartProperties and ToolProperties — keep it here
 * rather than duplicating the form block in each.
 */
export function SourcingTypeProperty({
  replenishmentSystem,
  value,
  onChange
}: SourcingTypePropertyProps) {
  const { t } = useLingui();

  if (replenishmentSystem !== "Buy and Make") return null;

  return (
    <ValidatedForm
      defaultValues={{ sourcingType: value ?? undefined }}
      validator={z.object({ sourcingType: z.enum(sourcingType) })}
      className="w-full"
    >
      <Select
        name="sourcingType"
        label={t`Sourcing`}
        inline={(value) => (
          <Badge variant="secondary">
            <SourcingTypeIcon type={value} className="mr-2" />
            <span>{value}</span>
          </Badge>
        )}
        options={sourcingType.map((type) => ({
          value: type,
          label: (
            <span className="flex items-center gap-2">
              <SourcingTypeIcon type={type} />
              {type}
            </span>
          )
        }))}
        onChange={(value) => onChange((value?.value as SourcingType) ?? null)}
      />
    </ValidatedForm>
  );
}
