import { Status } from "@carbon/react";
import { PURCHASING_RFQ_STATUS_COLOR_MAP } from "@carbon/utils";
import type { purchasingRfqStatusType } from "../../purchasing.models";

type PurchasingRFQStatusProps = {
  status?: (typeof purchasingRfqStatusType)[number] | null;
};

const PurchasingRFQStatus = ({ status }: PurchasingRFQStatusProps) => {
  if (!status) return null;
  const color = PURCHASING_RFQ_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Draft":
      return <Status color={color}>{status}</Status>;
    case "Requested":
      return <Status color={color}>{status}</Status>;
    case "Closed":
      return <Status color={color}>{status}</Status>;
    default:
      return null;
  }
};

export default PurchasingRFQStatus;
