// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Heading, VStack } from "@carbon/react";
import type { ComponentProps } from "react";

/** Centered body of a settings-style page; phones get tighter padding. */
export function SettingsPage({
  className,
  ...props
}: ComponentProps<typeof VStack>) {
  return (
    <VStack
      spacing={4}
      {...props}
      className={cn(
        "py-12 px-4 max-w-[60rem] h-full mx-auto",
        className,
        "max-md:py-3 max-md:px-4 max-md:gap-3 max-md:space-y-0"
      )}
    />
  );
}

/** The page title; phones show it in the app bar instead. */
export function SettingsPageHeading({
  className,
  ...props
}: Omit<ComponentProps<typeof Heading>, "size">) {
  return (
    <Heading size="h3" {...props} className={cn("max-md:hidden", className)} />
  );
}
