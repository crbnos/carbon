import type { ComponentProps } from "react";
import { RxDotFilled } from "react-icons/rx";
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
      className={cn("pl-0.5 truncate", className)}
      {...props}
    >
      <RxDotFilled className="w-5 h-5 mr-0.5" />
      {children}
    </Badge>
  );
};

export { Status };
