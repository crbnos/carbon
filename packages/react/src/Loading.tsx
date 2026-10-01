// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentProps, PropsWithChildren } from "react";
import { Spinner } from "./Spinner";
import { cn } from "./utils/cn";

export function Loading({
  children,
  isLoading,
  className,
  spinnerClassName,
  ...props
}: PropsWithChildren<
  ComponentProps<"div"> & { isLoading: boolean; spinnerClassName?: string }
>) {
  return isLoading ? (
    <div
      className={cn(
        "flex flex-grow h-full w-full items-center justify-center",
        className
      )}
      {...props}
    >
      <Spinner className={spinnerClassName ?? "size-8"} />
    </div>
  ) : (
    <>{children}</>
  );
}
