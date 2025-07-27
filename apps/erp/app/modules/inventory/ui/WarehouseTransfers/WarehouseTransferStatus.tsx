import { Badge } from "@carbon/react";
import type { warehouseTransferStatusType } from "../../inventory.models";

type Props = {
  status: (typeof warehouseTransferStatusType)[number];
};

const WarehouseTransferStatus = ({ status }: Props) => {
  switch (status) {
    case "Draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "To Ship and Receive":
      return <Badge variant="yellow">To Ship and Receive</Badge>;
    case "To Ship":
      return <Badge variant="blue">To Ship</Badge>;
    case "To Receive":
      return <Badge variant="blue">To Receive</Badge>;
    case "Completed":
      return <Badge variant="green">Completed</Badge>;
    case "Cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

export default WarehouseTransferStatus;
