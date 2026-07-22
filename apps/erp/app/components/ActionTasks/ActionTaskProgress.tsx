import { BarProgress, cn } from "@carbon/react";
import type { ActionTaskStatus } from "./ActionTaskCard";

// Completed/skipped progress bar for an action-task list — shared by Quality
// issues and Change Orders.
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
