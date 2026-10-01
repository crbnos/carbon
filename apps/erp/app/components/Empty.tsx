// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
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
      <LuCircleDashed className="size-8 text-muted-foreground" />
      <h3 className="text-xs text-muted-foreground">
        <Trans>Looks empty here</Trans>&nbsp;&nbsp;👀
      </h3>
      {children}
    </VStack>
  );
}
