import { Badge, cn, HStack } from "@carbon/react";
import { AiOutlinePartition } from "react-icons/ai";
import { FaCodePullRequest } from "react-icons/fa6";
import { HiSquares2X2 } from "react-icons/hi2";
import {
  LuExternalLink,
  LuGrip,
  LuHammer,
  LuHardHat,
  LuShoppingCart,
  LuTimer,
} from "react-icons/lu";

import { CiFries } from "react-icons/ci";
import { GiIBeam } from "react-icons/gi";
import { RiCustomerServiceLine } from "react-icons/ri";
import { RxCodesandboxLogo } from "react-icons/rx";
import { TbTargetArrow, TbTargetOff } from "react-icons/tb";

import { getColor } from "@carbon/utils";
import { Link } from "@remix-run/react";
import { useMode } from "~/hooks/useMode";
import type { MethodType } from "~/modules/shared";

export const TrackingTypeIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Inventory":
      return <TbTargetArrow className={cn("text-blue-500", className)} />;
    case "Non-Inventory":
      return <TbTargetOff className={cn("text-red-500", className)} />;
    default:
      return (
        <HiSquares2X2 className={cn("text-muted-foreground", className)} />
      );
  }
};

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
      return <RxCodesandboxLogo className={cn("text-green-500", className)} />;
    case "Pick":
      return <FaCodePullRequest className={cn("text-yellow-500", className)} />;
  }

  return <HiSquares2X2 className={cn("text-muted-foreground", className)} />;
};

export const TimeTypeIcon = ({
  type,
  className,
}: {
  type: string;
  className?: string;
}) => {
  switch (type) {
    case "Setup":
      return <LuTimer className={className} />;
    case "Labor":
      return <LuHardHat className={className} />;
    case "Machine":
      return <LuHammer className={className} />;
  }

  return <HiSquares2X2 className={cn("text-muted-foreground", className)} />;
};

type MethodBadgeProps = {
  type: "Buy" | "Make" | "Pick";
  text: string;
  to: string;
  className?: string;
};

export function MethodBadge({ type, text, to, className }: MethodBadgeProps) {
  const mode = useMode();
  const style = getBadgeColor(type, mode);
  return (
    <HStack className="group" spacing={1}>
      <Badge style={style}>
        <MethodIcon type={type} className="w-3 h-3 mr-1 " />
        {text}
      </Badge>
      <Link
        className="group-hover:opacity-100 opacity-0 transition-opacity duration-200 w-4 h-4 text-foreground"
        to={to}
        prefetch="intent"
      >
        <LuExternalLink />
      </Link>
    </HStack>
  );
}

function getBadgeColor(type: MethodType, mode: "light" | "dark") {
  return type === "Buy"
    ? getColor("blue", mode)
    : type === "Make"
    ? getColor("green", mode)
    : getColor("orange", mode);
}
