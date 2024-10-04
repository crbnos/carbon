import type { ComponentProps } from "react";
import { Badge } from "./Badge";
import { cn } from "./utils/cn";

type StatusProps = ComponentProps<"div"> & {
  color?: "green" | "orange" | "red" | "yellow" | "blue" | "gray";
};

const Status = ({
  color = "gray",
  children,
  className,
  ...props
}: StatusProps) => {
  return (
    <Badge
      variant={color}
      className={cn(
        "truncate uppercase font-bold text-xs tracking-tight",
        className
      )}
      {...props}
    >
      {children}
    </Badge>
  );
};

export { Status };
