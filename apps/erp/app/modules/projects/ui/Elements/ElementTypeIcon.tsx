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

/** The colour of each element type's icon. The type is meaning, so each has a hue. */
const iconColors: Record<ProjectElementType, string> = {
  Requirement: "text-blue-500",
  System: "text-orange-500",
  "Test Case": "text-teal-500",
  Function: "text-violet-500",
  Parameter: "text-emerald-500",
  Folder: "text-muted-foreground",
  Task: "text-muted-foreground"
};

/** The tint behind a `tinted` icon: the icon's hue at low strength. */
const tintColors: Record<ProjectElementType, string> = {
  Requirement: "bg-blue-500/10",
  System: "bg-orange-500/10",
  "Test Case": "bg-teal-500/10",
  Function: "bg-violet-500/10",
  Parameter: "bg-emerald-500/10",
  Folder: "bg-muted",
  Task: "bg-muted"
};

export function ElementTypeIcon({
  type,
  tinted,
  className
}: {
  type: ProjectElementType;
  /** A small icon on a tinted square, as the rows of the Plan list show it. */
  tinted?: boolean;
  className?: string;
}) {
  const Icon = icons[type] ?? LuSquareCheck;
  if (tinted) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded",
          tintColors[type],
          className
        )}
      >
        <Icon className={cn("size-3.5", iconColors[type])} />
      </span>
    );
  }
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
    Folder: t`Folder`,
    System: t`System`,
    Requirement: t`Requirement`,
    Function: t`Function`,
    Task: t`Task`,
    "Test Case": t`Test Case`,
    Parameter: t`Parameter`
  };
}
