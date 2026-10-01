// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuGripVertical } from "react-icons/lu";
import type { DragHandleBindings } from "./types";

type ReorderableRowProps = {
  dragHandle?: DragHandleBindings;
  isOverlay?: boolean;
  children: ReactNode;
};

export function ReorderableRow({
  dragHandle,
  isOverlay,
  children
}: ReorderableRowProps) {
  const { t } = useLingui();
  return (
    <HStack
      spacing={0}
      className={cn(
        "w-full items-center relative",
        isOverlay &&
          "bg-card rounded-md shadow-[0_0_0_1px_hsl(var(--border)),0_4px_12px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.06)]"
      )}
    >
      {dragHandle && (
        <button
          type="button"
          aria-label={t`Drag to reorder`}
          className={cn(
            "relative flex items-center justify-center w-10 h-10 shrink-0",
            "text-muted-foreground/50 hover:text-foreground",
            "cursor-grab active:cursor-grabbing active:scale-[0.96]",
            "transition-[color,transform] duration-150 ease"
          )}
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <LuGripVertical className="w-4 h-4" />
        </button>
      )}
      {children}
    </HStack>
  );
}
