import type { AvatarProps } from "@carbon/react";
import {
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { getFaviconUrl } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useSuppliers } from "~/stores";
import Avatar from "./Avatar";

type SupplierAvatarGroupProps = AvatarProps & {
  supplierIds: string[];
  limit?: number;
};

const SupplierAvatarGroup = ({
  supplierIds,
  size,
  limit = 3,
  ...props
}: SupplierAvatarGroupProps) => {
  const { t } = useLingui();
  const [suppliers] = useSuppliers();

  const matched = suppliers.filter((supplier) =>
    supplierIds.includes(supplier.id)
  );

  if (matched.length === 0) {
    return null;
  }

  const hidden = matched.slice(limit);
  const hiddenCount = hidden.length;
  const hiddenNames = hidden
    .map((supplier) => supplier.name)
    .filter(Boolean)
    .join(", ");

  return (
    <AvatarGroup size={size ?? "xs"} limit={limit}>
      <AvatarGroupList>
        {matched.map((supplier) => (
          <Tooltip key={supplier.id}>
            <TooltipTrigger>
              <Avatar
                size={size ?? "xs"}
                name={supplier.name ?? undefined}
                imageUrl={
                  supplier.website ? getFaviconUrl(supplier.website) : undefined
                }
                {...props}
              />
            </TooltipTrigger>
            <TooltipContent>{supplier.name}</TooltipContent>
          </Tooltip>
        ))}
      </AvatarGroupList>
      {hiddenCount > 0 && (
        <Tooltip>
          <TooltipTrigger>
            <AvatarOverflowIndicator
              aria-label={t`${hiddenCount} more: ${hiddenNames}`}
            />
          </TooltipTrigger>
          <TooltipContent className="flex flex-col gap-1">
            {hidden.map((supplier) => (
              <span key={supplier.id}>{supplier.name}</span>
            ))}
          </TooltipContent>
        </Tooltip>
      )}
    </AvatarGroup>
  );
};

export default SupplierAvatarGroup;
