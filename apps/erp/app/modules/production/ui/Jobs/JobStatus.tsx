import { Status } from "@carbon/react";
import type { jobStatus } from "../../production.models";

type JobStatusProps = {
  status?: (typeof jobStatus)[number] | null;
};

function JobStatus({ status }: JobStatusProps) {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Ready":
      return <Status color="yellow">{status}</Status>;
    case "In Progress":
      return <Status color="blue">{status}</Status>;
    case "Paused":
    case "Due Today":
      return <Status color="orange">{status}</Status>;
    case "Completed":
      return <Status color="green">{status}</Status>;
    case "Overdue":
    case "Cancelled":
      return <Status color="red">{status}</Status>;

    default:
      return null;
  }
}

export default JobStatus;
