import { cn } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import { FaCodePullRequest } from "react-icons/fa6";
import { HiSquares2X2 } from "react-icons/hi2";
import { LuGrip, LuHammer, LuShoppingCart } from "react-icons/lu";

import { CiFries } from "react-icons/ci";
import { GiIBeam } from "react-icons/gi";
import { RiCustomerServiceLine } from "react-icons/ri";

export const MethodItemTypeIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Part":
      return <AiOutlinePartition className={className} />;
    case "Material":
      return <GiIBeam className={className} />;
    case "Tool":
      return <LuHammer className={className} />;
    case "Fixture":
      return <LuGrip className={className} />;
    case "Consumable":
      return <CiFries className={className} />;
    case "Service":
      return <RiCustomerServiceLine className={className} />;
  }

  return <HiSquares2X2 className={cn("text-muted-foreground", className)} />;
};

export const MethodIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Method":
      return (
        <AiOutlinePartition className={cn(className, "text-foreground")} />
      );
    case "Buy":
      return <LuShoppingCart className={cn("text-blue-500", className)} />;
    case "Make":
      return <LuHammer className={cn("text-green-500", className)} />;
    case "Pick":
      return <FaCodePullRequest className={cn("text-yellow-500", className)} />;
  }

  return <HiSquares2X2 className={cn("text-muted-foreground", className)} />;
};
