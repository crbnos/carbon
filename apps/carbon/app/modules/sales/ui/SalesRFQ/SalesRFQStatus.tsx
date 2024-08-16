import { Status } from "@carbon/react";
import type { salesRFQStatusType } from "~/modules/sales";

type SalesRFQStatusProps = {
  status?: (typeof salesRFQStatusType)[number] | null;
};

const SalesRFQStatus = ({ status }: SalesRFQStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Ready for Quote":
      return <Status color="green">{status}</Status>;
    case "Quoted":
      return <Status color="blue">{status}</Status>;
    case "Closed":
      return <Status color="red">{status}</Status>;
    default:
      return null;
  }
};

export default SalesRFQStatus;
