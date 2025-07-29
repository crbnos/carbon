import { cn, VStack } from "@carbon/react";
import type { ComponentProps } from "react";
import { LuCircleDashed } from "react-icons/lu";

export default function Empty({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <VStack
      className={cn("w-full h-full justify-center items-center", className)}
      {...props}
    >
      <LuCircleDashed className="size-8 text-muted-foreground" />
      <h3 className="text-xs text-muted-foreground">
        Pretty empty around here
      </h3>
      {children}
    </VStack>
  );
}
