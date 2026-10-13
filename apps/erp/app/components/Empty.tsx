// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps } from "react";

export default function Empty({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <VStack
      className={cn(
        "w-full h-full justify-center items-center py-8",
        className
      )}
      {...props}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 64 64"
        className="size-16 shrink-0 mb-4 text-muted-foreground/40"
      >
        <circle
          cx="32"
          cy="32"
          r="30"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>
      <h3 className="text-lg font-medium tracking-tight text-foreground max-md:text-[17px] max-md:font-semibold">
        <Trans>No data yet</Trans>
      </h3>
      <p className="max-w-56 text-center text-xs text-muted-foreground text-balance">
        <Trans>
          Your data will appear here once you create or import your first
          records
        </Trans>
      </p>
      {children}
    </VStack>
  );
}
