import { Badge, HStack, cn } from "@carbon/react";
import { Link } from "@remix-run/react";
import { LuExternalLink } from "react-icons/lu";
import { MethodIcon } from "./MethodIcon";

type MethodBadgeProps = {
  type: "Buy" | "Make" | "Pick";
  text: string;
  to: string;
  className?: string;
};

export function MethodBadge({ type, text, to, className }: MethodBadgeProps) {
  return (
    <HStack className="group" spacing={1}>
      <Badge className={cn(getBadgeColor(type), className)}>
        <MethodIcon type={type} className="w-3 h-3 mr-1 text-white" />
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

function getBadgeColor(type: "Buy" | "Make" | "Pick") {
  return type === "Buy"
    ? "bg-blue-500 hover:bg-blue-600 text-white"
    : type === "Make"
    ? "bg-green-500 hover:bg-green-600 text-white"
    : "bg-orange-500 hover:bg-orange-600 text-white";
}
