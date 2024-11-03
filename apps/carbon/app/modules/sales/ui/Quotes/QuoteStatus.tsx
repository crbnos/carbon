import { Status } from "@carbon/react";
import type { quoteStatusType } from "~/modules/sales";

type QuoteStatusProps = {
  status?: (typeof quoteStatusType)[number] | null;
};

const QuoteStatus = ({ status }: QuoteStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Sent":
      return <Status color="yellow">{status}</Status>;
    case "Ordered":
    case "Partial":
      return <Status color="green">{status}</Status>;
    case "Lost":
      return <Status color="red">{status}</Status>;
    case "Cancelled":
    case "Expired":
      return <Status color="orange">{status}</Status>;
    default:
      return null;
  }
};

export default QuoteStatus;
