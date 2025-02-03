import { Button, cn } from "@carbon/react";
import type { LinkProps } from "@remix-run/react";
import { Link } from "@remix-run/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { LuSquareArrowOutUpRight } from "react-icons/lu";

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
        "group/hyperlink text-foreground font-medium cursor-pointer flex flex-row items-center justify-start gap-3",
        className
      )}
      {...props}
    >
      <span className="flex flex-row items-center gap-1">{children}</span>
      <Button
        leftIcon={<LuSquareArrowOutUpRight />}
        variant="secondary"
        className="flex-shrink-0 opacity-0 transition-opacity duration-200 group-hover/hyperlink:opacity-100 no-underline"
        size="sm"
      >
        Open
      </Button>
    </Link>
  ) : (
    <span className={cn("text-foreground", className)} {...props}>
      {children}
    </span>
  );
};

export default Hyperlink;
