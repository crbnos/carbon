import { cn, VStack } from "@carbon/react";
import type { ComponentProps } from "react";
import { LuGhost } from "react-icons/lu";

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
      <LuGhost className="w-12 h-12" />
      <h3 className="text-base">Pretty empty around here</h3>
      {children}
    </VStack>
  );
}
