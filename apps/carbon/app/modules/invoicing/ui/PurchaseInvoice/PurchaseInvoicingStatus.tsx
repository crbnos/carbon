import { Status } from "@carbon/react";
import type { purchaseInvoiceStatusType } from "~/modules/invoicing";

type PurchaseInvoicingStatusProps = {
  status?: (typeof purchaseInvoiceStatusType)[number] | null;
};

const PurchaseInvoicingStatus = ({ status }: PurchaseInvoicingStatusProps) => {
  switch (status) {
    case "Draft":
    case "Return":
      return <Status color="gray">{status}</Status>;
    case "Submitted":
      return <Status color="green">{status}</Status>;
    case "Pending":
    case "Partially Paid":
      return <Status color="orange">{status}</Status>;
    case "Overdue":
      return <Status color="red">{status}</Status>;
    case "Debit Note Issued":
    case "Voided":
    case "Paid":
      return <Status color="blue">{status}</Status>;
    default:
      return null;
  }
};

export default PurchaseInvoicingStatus;
