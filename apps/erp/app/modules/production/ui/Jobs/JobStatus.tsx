import { Status } from "@carbon/react";
import type { jobStatus } from "../../production.models";

type JobStatusProps = {
  status?: (typeof jobStatus)[number] | null;
  className?: string;
};

export const JOB_STATUS_COLOR_MAP: Record<
  (typeof jobStatus)[number],
  "gray" | "yellow" | "blue" | "orange" | "green" | "red"
> = {
  Draft: "gray",
  Planned: "yellow",
  Ready: "blue",
  "In Progress": "orange",
  Paused: "orange",
  "Due Today": "orange",
  Completed: "green",
  Closed: "gray",
  Overdue: "red",
  Cancelled: "red"
} as const;

function JobStatus({ status, className }: JobStatusProps) {
  if (!status) return null;

  const color = JOB_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const displayText = status === "Ready" ? "Released" : status;
  const tooltip = status === "Ready" ? status : undefined;

  return (
    <Status color={color} className={className} tooltip={tooltip}>
      {displayText}
    </Status>
  );
}

export default JobStatus;
