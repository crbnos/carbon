import { Status } from "@carbon/react";
import type { shipmentStatusType } from "~/modules/inventory";

type ShipmentStatusProps = {
  status?: (typeof shipmentStatusType)[number] | null;
};

const ShipmentStatus = ({ status }: ShipmentStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Pending":
      return <Status color="orange">{status}</Status>;
    case "Posted":
      return <Status color="green">{status}</Status>;
    default:
      return null;
  }
};

export default ShipmentStatus;
