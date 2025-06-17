import type { ComponentProps } from "react";
import { Badge } from "./Badge";
import { cn } from "./utils/cn";

type StatusProps = ComponentProps<"div"> & {
  color?: "green" | "orange" | "red" | "yellow" | "blue" | "gray" | "purple";
};

const Status = ({
  color = "gray",
  children,
  className,
  ...props
}: StatusProps) => {
  return (
    <Badge variant={color} className={cn(className)} {...props}>
      {children}
    </Badge>
  );
};

export { Status };
