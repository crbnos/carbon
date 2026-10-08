// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, PrefetchLink } from "@carbon/react";
import type { ComponentProps, PropsWithChildren } from "react";
import { LuPanelRight } from "react-icons/lu";
import type { LinkProps } from "react-router";

const Hyperlink = ({
  children,
  className,
  ...props
}:
  | PropsWithChildren<LinkProps>
  | PropsWithChildren<ComponentProps<"span">>) => {
  return "to" in props && props.to ? (
    // `contents` keeps the <link rel="prefetch"> elements React Router injects
    // next to the anchor on hover out of the parent's layout. Without it they
    // land as siblings in the caller's container, and HStack's `space-x-*`
    // (a `:not(:last-child)` margin) hands the anchor a phantom 8px on hover —
    // which reflows the whole table column under `table-layout: auto`.
    <span className="contents">
      <PrefetchLink
        className={cn(
          "group/hyperlink text-foreground font-medium cursor-pointer flex flex-row items-center justify-start gap-3 max-md:min-w-0",
          className
        )}
        {...props}
      >
        {/* Phones: a block so long names end in an ellipsis (flex boxes clip). */}
        <span className="flex flex-row items-center gap-1 max-md:block max-md:min-w-0 max-md:truncate">
          {children}
        </span>
        {props.to && props.to !== "#" && (
          <Button
            rightIcon={<LuPanelRight />}
            variant="secondary"
            // pointer-events-none so clicks fall through to the anchor: a plain
            // click navigates in-tab, a Cmd/Ctrl (or middle) click opens a new tab.
            // A real <button> here would otherwise swallow the anchor's native
            // modifier-click behavior and always open in the same tab.
            className="flex-shrink-0 md:opacity-0 transition-opacity duration-200 group-hover/hyperlink:opacity-100 no-underline pointer-events-none max-md:hidden"
            size="sm"
            tabIndex={-1}
          >
            Open
          </Button>
        )}
      </PrefetchLink>
    </span>
  ) : (
    <span className={cn("text-foreground", className)} {...props}>
      {children}
    </span>
  );
};

export default Hyperlink;
