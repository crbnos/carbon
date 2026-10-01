// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BarProgress, cn } from "@carbon/react";
import type { ActionTaskStatus } from "./ActionTaskCard";

// Completed/skipped progress bar for an action-task list — shared by Quality
// issues and Change Notices.
export function ActionTaskProgress({
  tasks,
  className
}: {
  tasks: { status: ActionTaskStatus }[];
  className?: string;
}) {
  const done = tasks.filter(
    (task) => task.status === "Completed" || task.status === "Skipped"
  ).length;
  const progress = tasks.length > 0 ? (done / tasks.length) * 100 : 0;

  return (
    <div
      className={cn(
        "flex flex-col items-end gap-2 py-3 pr-14 w-[120px]",
        className
      )}
    >
      <BarProgress
        gradient
        progress={progress}
        value={`${done}/${tasks.length}`}
      />
    </div>
  );
}
