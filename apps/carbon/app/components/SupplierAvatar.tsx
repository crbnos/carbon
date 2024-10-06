import type { AvatarProps } from "@carbon/react";
import { cn, HStack } from "@carbon/react";
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
  };

  return (
    <HStack className="truncate no-underline hover:no-underline">
      <Avatar size={size ?? "xs"} {...props} name={supplier?.name ?? ""} />
      <span
        className={cn("normal-case font-normal tracking-normal", className)}
      >
        {supplier.name}
      </span>
    </HStack>
  );
};

export default SupplierAvatar;
