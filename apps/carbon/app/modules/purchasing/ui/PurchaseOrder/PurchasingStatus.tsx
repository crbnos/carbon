import { Status } from "@carbon/react";
import type { purchaseOrderStatusType } from "~/modules/purchasing";

type PurchasingStatusProps = {
  status?: (typeof purchaseOrderStatusType)[number] | null;
};

const PurchasingStatus = ({ status }: PurchasingStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "To Review":
      return <Status color="yellow">{status}</Status>;
    case "To Receive":
    case "To Receive and Invoice":
      return <Status color="orange">{status}</Status>;
    case "To Invoice":
      return <Status color="green">{status}</Status>;
    case "Completed":
      return <Status color="blue">{status}</Status>;
    case "Closed":
    case "Rejected":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default PurchasingStatus;
