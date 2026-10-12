// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AvatarProps } from "@carbon/react";
import { HStack } from "@carbon/react";
import { getFaviconUrl } from "@carbon/utils";
import { useSuppliers } from "~/stores";
import Avatar from "./Avatar";

type SupplierAvatarProps = AvatarProps & {
  supplierId: string | null;
  className?: string;
};

const SupplierAvatar = ({
  supplierId,
  size,
  className,
  ...props
}: SupplierAvatarProps) => {
  const [suppliers] = useSuppliers();

  if (!supplierId) return null;

  const supplier = suppliers.find((s) => s.id === supplierId) ?? {
    name: "",
    id: "",
    website: null
  };

  const imageUrl = supplier.website
    ? getFaviconUrl(supplier.website)
    : undefined;

  return (
    <HStack className="truncate no-underline hover:no-underline text-sm text-foreground ">
      <Avatar
        size={size ?? "xs"}
        {...props}
        name={supplier?.name ?? ""}
        imageUrl={imageUrl}
      />
      <span className={className}>{supplier.name}</span>
    </HStack>
  );
};

export default SupplierAvatar;
