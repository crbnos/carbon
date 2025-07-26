import { Badge } from "@carbon/react";
import type { warehouseTransferStatusType } from "../../inventory.models";

type Props = {
  status: (typeof warehouseTransferStatusType)[number];
};

const WarehouseTransferStatus = ({ status }: Props) => {
  switch (status) {
    case "Draft":
      return <Badge variant="secondary">Draft</Badge>;
    case "Confirmed":
      return <Badge variant="yellow">Confirmed</Badge>;
    case "In Transit":
      return <Badge variant="blue">In Transit</Badge>;
    case "Partially Received":
      return <Badge variant="yellow">Partially Received</Badge>;
    case "Received":
      return <Badge variant="green">Received</Badge>;
    case "Cancelled":
      return <Badge variant="destructive">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
};

export default WarehouseTransferStatus;
