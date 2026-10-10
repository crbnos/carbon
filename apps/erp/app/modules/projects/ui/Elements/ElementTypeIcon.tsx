// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { IconType } from "react-icons";
import {
  LuBox,
  LuClipboardCheck,
  LuFlaskConical,
  LuFolder,
  LuSigma,
  LuSquareCheck,
  LuSquareFunction
} from "react-icons/lu";
import type { ProjectElementType } from "../../projects.models";

const icons: Record<ProjectElementType, IconType> = {
  Folder: LuFolder,
  System: LuBox,
  Requirement: LuClipboardCheck,
  Function: LuSquareFunction,
  Task: LuSquareCheck,
  "Test Case": LuFlaskConical,
  Parameter: LuSigma
};

/**
 * The colour of each element type: the icon, the type label and the tint of
 * the Tree layout's box. The type is meaning, so each has a hue.
 */
export const elementTypeColors: Record<
  ProjectElementType,
  { icon: string; label: string; box: string }
> = {
  Requirement: {
    icon: "text-blue-500",
    label: "text-blue-700 dark:text-blue-400",
    box: "border-blue-500/20 bg-blue-500/5 dark:bg-blue-500/10"
  },
  System: {
    icon: "text-orange-500",
    label: "text-orange-700 dark:text-orange-400",
    box: "border-orange-500/20 bg-orange-500/5 dark:bg-orange-500/10"
  },
  "Test Case": {
    icon: "text-teal-500",
    label: "text-teal-700 dark:text-teal-400",
    box: "border-teal-500/20 bg-teal-500/5 dark:bg-teal-500/10"
  },
  Function: {
    icon: "text-violet-500",
    label: "text-violet-700 dark:text-violet-400",
    box: "border-violet-500/20 bg-violet-500/5 dark:bg-violet-500/10"
  },
  Parameter: {
    icon: "text-emerald-500",
    label: "text-emerald-700 dark:text-emerald-400",
    box: "border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10"
  },
  Folder: {
    icon: "text-muted-foreground",
    label: "text-muted-foreground",
    box: "border-border bg-muted/40"
  },
  Task: {
    icon: "text-muted-foreground",
    label: "text-muted-foreground",
    box: "border-border bg-muted/40"
  }
};

export function ElementTypeIcon({
  type,
  className
}: {
  type: ProjectElementType;
  className?: string;
}) {
  const Icon = icons[type] ?? LuSquareCheck;
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        elementTypeColors[type]?.icon,
        className
      )}
    />
  );
}

/** The translated name of each element type. */
export function useElementTypeLabels(): Record<ProjectElementType, string> {
  const { t } = useLingui();
  return {
    Folder: t`Folder`,
    System: t`System`,
    Requirement: t`Requirement`,
    Function: t`Function`,
    Task: t`Task`,
    "Test Case": t`Test Case`,
    Parameter: t`Parameter`
  };
}
