import { cn } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import { CiFries } from "react-icons/ci";
import { GiIBeam } from "react-icons/gi";
import { LuComponent, LuGrip, LuHammer } from "react-icons/lu";
import { RiCustomerServiceLine } from "react-icons/ri";
import type { itemTypes } from "../../inventory.models";

type InventoryIconProps = {
  type: (typeof itemTypes)[number];
  className?: string;
};

const InventoryItemIcon = ({ type, className }: InventoryIconProps) => {
  switch (type) {
    case "Part":
      return <AiOutlinePartition className={cn("w-6 h-6", className)} />;
    case "Material":
      return <GiIBeam className={cn("w-6 h-6", className)} />;
    case "Tool":
      return <LuHammer className={cn("w-6 h-6", className)} />;
    case "Fixture":
      return <LuGrip className={cn("w-6 h-6", className)} />;
    case "Consumable":
      return <CiFries className={cn("w-6 h-6", className)} />;
    case "Service":
      return <RiCustomerServiceLine className={cn("w-6 h-6", className)} />;
    default:
      return <LuComponent className={cn("w-6 h-6", className)} />;
  }
};

export default InventoryItemIcon;
