import { Status } from "@carbon/react";
import type { cutListStatus } from "../../production.models";

type CutListStatusProps = {
  status?: (typeof cutListStatus)[number] | null;
  className?: string;
};

const CutListStatus = ({ status, className }: CutListStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray" className={className}>
          {status}
        </Status>
      );
    case "Released":
      return (
        <Status color="blue" className={className}>
          {status}
        </Status>
      );
    case "In Progress":
      return (
        <Status color="orange" className={className}>
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
};

export default CutListStatus;
