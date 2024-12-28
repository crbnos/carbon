import { Status } from "@carbon/react";
import type { receiptStatusType } from "~/modules/inventory";

type ReceiptStatusProps = {
  status?: (typeof receiptStatusType)[number] | null;
};

const ReceiptStatus = ({ status }: ReceiptStatusProps) => {
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

export default ReceiptStatus;
