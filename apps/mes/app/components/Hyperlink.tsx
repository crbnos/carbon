// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, PrefetchLink } from "@carbon/react";
import type { ComponentProps, PropsWithChildren } from "react";
import type { LinkProps } from "react-router";

const Hyperlink = ({
  children,
  className,
  ...props
}:
  | PropsWithChildren<LinkProps>
  | PropsWithChildren<ComponentProps<"span">>) => {
  return "to" in props && props.to ? (
    <PrefetchLink
      className={cn(
        "text-foreground hover:underline cursor-pointer font-medium",
        className
      )}
      {...props}
    >
      {children}
    </PrefetchLink>
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
