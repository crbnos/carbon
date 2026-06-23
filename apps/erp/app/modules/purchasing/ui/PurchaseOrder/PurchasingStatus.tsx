import { Status } from "@carbon/react";
import { PURCHASE_ORDER_STATUS_COLOR_MAP } from "@carbon/utils";
import type { purchaseOrderStatusType } from "~/modules/purchasing";

type PurchasingStatusProps = {
  status?: (typeof purchaseOrderStatusType)[number] | null;
};

const PurchasingStatus = ({ status }: PurchasingStatusProps) => {
  if (!status) return null;
  const color = PURCHASE_ORDER_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Draft":
      return <Status color={color}>{status}</Status>;
    case "Planned":
    case "To Review":
    case "Needs Approval":
      return <Status color={color}>{status}</Status>;
    case "To Receive":
    case "To Receive and Invoice":
      return <Status color={color}>{status}</Status>;
    case "To Invoice":
      return <Status color={color}>{status}</Status>;
    case "Completed":
      return <Status color={color}>{status}</Status>;
    case "Closed":
    case "Rejected":
      return <Status color={color}>{status}</Status>;
    default:
      return null;
  }
};

export default PurchasingStatus;
