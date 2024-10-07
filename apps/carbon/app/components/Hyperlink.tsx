import { cn } from "@carbon/react";
import type { LinkProps } from "@remix-run/react";
import { Link } from "@remix-run/react";
import type { ComponentProps, PropsWithChildren } from "react";

const Hyperlink = ({
  children,
  className,
  ...props
}:
  | PropsWithChildren<LinkProps>
  | PropsWithChildren<ComponentProps<"span">>) => {
  return "to" in props && props.to ? (
    <Link
      prefetch="intent"
      className={cn(
        "text-foreground font-medium text-sm cursor-pointer ",
        className
      )}
      {...props}
    >
      {children}
    </Link>
  ) : (
    <span
      className={cn(
        "text-foreground font-medium text-sm cursor-pointer ",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

export default Hyperlink;
