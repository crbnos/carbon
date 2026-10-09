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

/** The icon of an element type. The type is meaning, so each has a hue. */
const colors: Record<ProjectElementType, string> = {
  Folder: "text-muted-foreground",
  System: "text-blue-500",
  Requirement: "text-violet-500",
  Function: "text-teal-500",
  Task: "text-muted-foreground",
  "Test Case": "text-orange-500",
  Parameter: "text-emerald-500"
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
      className={cn("size-4 shrink-0", colors[type], className)}
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
