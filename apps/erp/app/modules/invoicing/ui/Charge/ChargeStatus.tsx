import { Status } from "@carbon/react";
import type { chargeStatus } from "~/modules/invoicing";

type ChargeStatusProps = {
  status?: (typeof chargeStatus)[number] | null;
};

const ChargeStatus = ({ status }: ChargeStatusProps) => {
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

export default ChargeStatus;
