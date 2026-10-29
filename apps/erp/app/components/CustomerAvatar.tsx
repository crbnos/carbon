// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AvatarProps } from "@carbon/react";
import { HStack } from "@carbon/react";
import { getFaviconUrl, isUrl } from "@carbon/utils";
import { useCustomers } from "~/stores";
import Avatar from "./Avatar";

type CustomerAvatarProps = AvatarProps & {
  customerId: string | null;
  className?: string;
};

const CustomerAvatar = ({
  customerId,
  size,
  className,
  ...props
}: CustomerAvatarProps) => {
  const [customers] = useCustomers();

  if (!customerId) return null;

  const customer = customers.find((s) => s.id === customerId) ?? {
    name: "",
    id: "",
    website: null
  };

  const imageUrl =
    customer.website && isUrl(customer.website)
      ? getFaviconUrl(customer.website)
      : undefined;

  return (
    <HStack className="truncate no-underline hover:no-underline text-sm text-foreground ">
      <Avatar
        size={size ?? "xs"}
        {...props}
        name={customer?.name ?? ""}
        imageUrl={imageUrl}
      />
      <span className={className}>{customer.name}</span>
    </HStack>
  );
};

export default CustomerAvatar;
