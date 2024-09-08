import { Badge, HStack } from "@carbon/react";
import { getColor } from "@carbon/utils";
import { Link } from "@remix-run/react";
import { LuExternalLink } from "react-icons/lu";
import { useMode } from "~/hooks/useMode";
import type { MethodType } from "../types";
import { MethodIcon } from "./MethodIcon";

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
