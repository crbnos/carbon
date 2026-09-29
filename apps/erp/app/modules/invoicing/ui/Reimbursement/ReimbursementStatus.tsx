import { Status } from "@carbon/react";
import type { reimbursementStatus } from "~/modules/invoicing";

type ReimbursementStatusProps = {
  status?: (typeof reimbursementStatus)[number] | null;
};

const ReimbursementStatus = ({ status }: ReimbursementStatusProps) => {
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

export default ReimbursementStatus;
