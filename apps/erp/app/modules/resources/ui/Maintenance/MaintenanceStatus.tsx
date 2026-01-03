import { Status } from "@carbon/react";
import type { maintenanceDispatchStatus } from "../../resources.models";

type MaintenanceStatusProps = {
  status?: (typeof maintenanceDispatchStatus)[number] | null;
  className?: string;
};

function MaintenanceStatus({ status, className }: MaintenanceStatusProps) {
  switch (status) {
    case "Open":
      return (
        <Status color="gray" className={className}>
          {status}
        </Status>
      );
    case "Assigned":
      return (
        <Status color="yellow" className={className}>
          {status}
        </Status>
      );
    case "In Progress":
      return (
        <Status color="blue" className={className}>
          {status}
        </Status>
      );
    case "Completed":
      return (
        <Status color="green" className={className}>
          {status}
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="red" className={className}>
          {status}
        </Status>
      );
    default:
      return null;
  }
}

export default MaintenanceStatus;
