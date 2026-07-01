import { Status } from "@carbon/react";
import type { paymentStatus } from "~/modules/invoicing";

type PaymentStatusProps = {
  status?: (typeof paymentStatus)[number] | null;
};

const PaymentStatus = ({ status }: PaymentStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Posted":
      return <Status color="green">{status}</Status>;
    case "Voided":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default PaymentStatus;
