import { Status } from "@carbon/react";
import type { Database } from "@carbon/database";

type SalesOrderStatusProps = {
  status?: Database["public"]["Enums"]["salesOrderStatus"] | null;
};

const SalesStatus = ({ status }: SalesOrderStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Cancelled":
    case "Closed":
      return <Status color="red">{status}</Status>;
    case "To Ship and Invoice":
    case "To Ship":
      return <Status color="orange">{status}</Status>;
    case "To Invoice":
    case "Confirmed":
      return <Status color="blue">{status}</Status>;
    case "Needs Approval":
    case "In Progress":
      return <Status color="yellow">{status}</Status>;
    case "Invoiced":
    case "Completed":
      return <Status color="green">{status}</Status>;
    default:
      return null;
  }
};

export default SalesStatus;
