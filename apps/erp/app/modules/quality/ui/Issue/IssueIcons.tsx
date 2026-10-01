// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { BsExclamationSquareFill } from "react-icons/bs";
import { LuFactory, LuShoppingCart } from "react-icons/lu";
import { HighPriorityIcon } from "~/assets/icons/HighPriorityIcon";
import { LowPriorityIcon } from "~/assets/icons/LowPriorityIcon";
import { MediumPriorityIcon } from "~/assets/icons/MediumPriorityIcon";
import type {
  nonConformancePriority,
  nonConformanceSource
} from "../../quality.models";

export function getPriorityIcon(
  priority: (typeof nonConformancePriority)[number],
  overdue: boolean
) {
  switch (priority) {
    case "Critical":
      return <BsExclamationSquareFill className="text-red-500" />;
    case "High":
      return <HighPriorityIcon className={cn(overdue ? "text-red-500" : "")} />;
    case "Medium":
      return (
        <MediumPriorityIcon className={cn(overdue ? "text-red-500" : "")} />
      );
    case "Low":
      return <LowPriorityIcon />;
  }
}

export function getSourceIcon(
  source: (typeof nonConformanceSource)[number],
  overdue: boolean
) {
  switch (source) {
    case "Internal":
      return <LuFactory />;
    case "External":
      return <LuShoppingCart />;
  }
}
