import type { AvatarProps } from "@carbon/react";
import { cn, HStack } from "@carbon/react";
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
  };

  return (
    <HStack className="truncate no-underline hover:no-underline">
      <Avatar size={size ?? "xs"} {...props} name={customer?.name ?? ""} />
      <span
        className={cn("normal-case font-normal tracking-normal", className)}
      >
        {customer.name}
      </span>
    </HStack>
  );
};

export default CustomerAvatar;
