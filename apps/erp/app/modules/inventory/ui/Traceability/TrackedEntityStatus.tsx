import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type TrackedEntityStatusProps = {
  status?: Database["public"]["Enums"]["trackedEntityStatus"] | null;
};

function TrackedEntityStatus({ status }: TrackedEntityStatusProps) {
  switch (status) {
    case "Available":
      return <Status color="green">{status}</Status>;
    case "Reserved":
      return <Status color="gray">{status}</Status>;
    case "On Hold":
      return <Status color="red">{status}</Status>;
    case "Consumed":
      return <Status color="blue">{status}</Status>;
    default:
      return null;
  }
}

export default TrackedEntityStatus;
