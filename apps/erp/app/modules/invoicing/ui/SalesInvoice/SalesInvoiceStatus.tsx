import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";

type SalesInvoicingStatusProps = {
  status?: Database["public"]["Enums"]["salesInvoiceStatus"] | null;
};

const SalesInvoicingStatus = ({ status }: SalesInvoicingStatusProps) => {
  switch (status) {
    case "Draft":
    case "Return":
      return <Status color="gray">{status}</Status>;
    case "Submitted":
      return <Status color="green">{status}</Status>;
    case "Pending":
    case "Partially Paid":
      return <Status color="orange">{status}</Status>;
    case "Voided":
    case "Overdue":
      return <Status color="red">{status}</Status>;
    case "Credit Note Issued":
    case "Paid":
      return <Status color="blue">{status}</Status>;
    default:
      return null;
  }
};

export default SalesInvoicingStatus;
