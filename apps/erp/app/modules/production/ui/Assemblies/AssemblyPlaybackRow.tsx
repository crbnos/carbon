// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { VStack } from "@carbon/react";
import type { ReactNode } from "react";

export default function PlaybackRow({
  label,
  value,
  children
}: {
  label: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2 px-3 py-2">
      <VStack spacing={0} className="min-w-0 flex-1">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {value && (
          <span className="w-full min-w-0 truncate text-sm text-foreground">
            {value}
          </span>
        )}
      </VStack>
      {children}
    </div>
  );
}
