// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Select, ValidatedForm } from "@carbon/form";
import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { z } from "zod";
import { SourcingTypeIcon } from "~/components/Icons";
import { useResolved } from "~/hooks/useResolved";
import type { ItemUsedIn } from "~/modules/items/items.service";
import { sourcingType } from "~/modules/shared/shared.models";
import type { SourcingType } from "~/modules/shared/types";
import { useItems } from "~/stores";

/**
 * Whether the item is a line on the bill of material of a "Buy and Make"
 * parent. Sourcing describes how a parent's component is fulfilled, so it is
 * the component's property, not the parent's. `known` is the answer when the
 * caller already has it (the bill of material tree knows the selected line's
 * parent); otherwise it reads the page's streamed Used In data, `false` until
 * that lands.
 */
export function useIsComponentOfBuyAndMake(
  usedIn: Promise<Pick<ItemUsedIn, "methodMaterials">> | null | undefined,
  itemId: string,
  known?: boolean
): boolean {
  const resolved = useResolved(usedIn, null, itemId);
  const [items] = useItems();
  return useMemo(() => {
    if (known !== undefined) return known;
    const parentIds = new Set(
      resolved?.methodMaterials.map((m) => m.documentParentId) ?? []
    );
    if (parentIds.size === 0) return false;
    return items.some(
      (item) =>
        parentIds.has(item.id) && item.replenishmentSystem === "Buy and Make"
    );
  }, [known, resolved, items]);
}

type SourcingTypePropertyProps = {
  // Shown only for a component of a "Buy and Make" parent
  // (`useIsComponentOfBuyAndMake`).
  isComponentOfBuyAndMake: boolean;
  // The item's own replenishment: a made item cannot be drop shipped.
  replenishmentSystem?: string | null;
  value?: SourcingType | null;
  onChange: (value: SourcingType | null) => void;
  // Match the parent panel's field idiom: `true` (default) = click-to-edit
  // badge for the sidebar; `false` = a standard labeled control for the form.
  inline?: boolean;
  isReadOnly?: boolean;
};

/**
 * Item-level sourcing selector for the Part/Tool Properties panel. Sourcing only
 * applies to the components of "Buy and Make" parents, so it renders nothing
 * otherwise. Shared between PartProperties and ToolProperties — keep it here
 * rather than duplicating the form block in each.
 */
export function SourcingTypeProperty({
  isComponentOfBuyAndMake,
  replenishmentSystem,
  value,
  onChange,
  inline = true,
  isReadOnly = false
}: SourcingTypePropertyProps) {
  const { t } = useLingui();

  if (!isComponentOfBuyAndMake) return null;

  return (
    <ValidatedForm
      defaultValues={{ sourcingType: value ?? undefined }}
      validator={z.object({ sourcingType: z.enum(sourcingType) })}
      className="w-full"
      isReadOnly={isReadOnly}
    >
      <Select
        name="sourcingType"
        label={t`Sourcing`}
        inline={
          inline
            ? (value) => (
                <Badge variant="secondary">
                  <SourcingTypeIcon type={value} className="mr-2" />
                  <span>{value}</span>
                </Badge>
              )
            : undefined
        }
        options={sourcingType
          // Drop Ship sets Purchase to Order, which a Make item does not allow.
          .filter(
            (type) => replenishmentSystem !== "Make" || type !== "Drop Ship"
          )
          .map((type) => ({
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
