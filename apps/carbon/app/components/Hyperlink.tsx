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
        "text-foreground hover:underline cursor-pointer font-semibold",
        className
      )}
      {...props}
    >
      {children}
    </Link>
  ) : (
    <span
      className={cn(
        "text-foreground hover:underline cursor-pointer ",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

export default Hyperlink;
