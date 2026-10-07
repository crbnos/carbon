// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { LuCircleDashed } from "react-icons/lu";

export default function Empty({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <VStack
      className={cn("w-full h-full justify-center items-center", className)}
      {...props}
    >
      <LuCircleDashed className="size-8 text-muted-foreground max-md:size-[52px] max-md:rounded-[14px] max-md:bg-muted max-md:p-3.5" />
      <h3 className="text-xs text-muted-foreground max-md:mt-1 max-md:text-[17px] max-md:font-semibold max-md:text-foreground">
        <Trans>Looks empty here</Trans>&nbsp;&nbsp;👀
      </h3>
      {children}
    </VStack>
  );
}
