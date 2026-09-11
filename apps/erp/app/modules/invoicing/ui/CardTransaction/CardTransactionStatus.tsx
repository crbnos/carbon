import { Status } from "@carbon/react";
import type { cardTransactionStatus } from "~/modules/invoicing";

type CardTransactionStatusProps = {
  status?: (typeof cardTransactionStatus)[number] | null;
};

const CardTransactionStatus = ({ status }: CardTransactionStatusProps) => {
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

export default CardTransactionStatus;
