import { Button, cn } from "@carbon/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { LuPanelRight } from "react-icons/lu";
import type { LinkProps } from "react-router";
import { Link } from "react-router";

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
      {props.to && props.to !== "#" && (
        <Button
          rightIcon={<LuPanelRight />}
          variant="secondary"
          // pointer-events-none so clicks fall through to the anchor: a plain
          // click navigates in-tab, a Cmd/Ctrl (or middle) click opens a new tab.
          // A real <button> here would otherwise swallow the anchor's native
          // modifier-click behavior and always open in the same tab.
          className="flex-shrink-0 opacity-0 transition-opacity duration-200 group-hover/hyperlink:opacity-100 no-underline pointer-events-none"
          size="sm"
          tabIndex={-1}
        >
          Open
        </Button>
      )}
    </Link>
  ) : (
    <span className={cn("text-foreground", className)} {...props}>
      {children}
    </span>
  );
};

export default Hyperlink;
