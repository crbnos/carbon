// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ComponentPropsWithoutRef } from "react";
import { forwardRef } from "react";

interface ContainerProps extends ComponentPropsWithoutRef<"div"> {
  width?: number;
}

const Container = forwardRef<HTMLDivElement, ContainerProps>(
  ({ width, children, className, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      className={cn("inline-block relative w-full", className)}
      style={{ maxWidth: width }}
    >
      {children}
    </div>
  )
);

Container.displayName = "Container";
export default Container;
