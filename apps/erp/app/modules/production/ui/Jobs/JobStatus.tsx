import { Status } from "@carbon/react";
import { JOB_STATUS_COLOR_MAP } from "@carbon/utils";
import type { jobStatus } from "../../production.models";

export { JOB_STATUS_COLOR_MAP } from "@carbon/utils";

type JobStatusProps = {
  status?: (typeof jobStatus)[number] | null;
  className?: string;
};

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
