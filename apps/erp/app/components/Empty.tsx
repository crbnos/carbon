// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, VStack } from "@carbon/react";
import { EmptyCabinet } from "@carbon/viewer/empty-cabinet";
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
      <EmptyCabinet className="shrink-0 mb-4" />
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
