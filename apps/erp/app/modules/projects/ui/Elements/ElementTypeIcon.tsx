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
  LuSigma,
  LuSquareCheck,
  LuSquareFunction
} from "react-icons/lu";
import type { ProjectElementType } from "../../projects.models";

const icons: Record<ProjectElementType, IconType> = {
  System: LuBox,
  Requirement: LuClipboardCheck,
  Function: LuSquareFunction,
  Task: LuSquareCheck,
  "Test Case": LuFlaskConical,
  Parameter: LuSigma
};

/** The colour of each element type's icon. The type is meaning, so each has a hue. */
const iconColors: Record<ProjectElementType, string> = {
  Requirement: "text-blue-500",
  System: "text-orange-500",
  "Test Case": "text-teal-500",
  Function: "text-violet-500",
  Parameter: "text-emerald-500",
  Task: "text-muted-foreground"
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
      className={cn("size-4 shrink-0", iconColors[type], className)}
    />
  );
}

/** The translated name of each element type. */
export function useElementTypeLabels(): Record<ProjectElementType, string> {
  const { t } = useLingui();
  return {
    System: t`System`,
    Requirement: t`Requirement`,
    Function: t`Function`,
    Task: t`Task`,
    "Test Case": t`Test Case`,
    Parameter: t`Parameter`
  };
}
