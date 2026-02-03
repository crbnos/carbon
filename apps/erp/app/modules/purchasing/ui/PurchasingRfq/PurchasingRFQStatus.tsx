import { Status } from "@carbon/react";
import type { purchasingRfqStatusType } from "../../purchasing.models";

type PurchasingRFQStatusProps = {
  status?: (typeof purchasingRfqStatusType)[number] | null;
};

const PurchasingRFQStatus = ({ status }: PurchasingRFQStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Requested":
      return <Status color="green">{status}</Status>;
    case "Closed":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default PurchasingRFQStatus;
