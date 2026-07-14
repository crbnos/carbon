import { Status } from "@carbon/react";
import type { memoStatus } from "~/modules/invoicing";

type MemoStatusProps = {
  status?: (typeof memoStatus)[number] | null;
};

const MemoStatus = ({ status }: MemoStatusProps) => {
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

export default MemoStatus;
