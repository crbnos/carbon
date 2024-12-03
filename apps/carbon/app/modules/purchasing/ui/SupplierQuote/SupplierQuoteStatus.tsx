import { Status } from "@carbon/react";
import type { supplierQuoteStatusType } from "~/modules/purchasing";

type QuoteStatusProps = {
  status?: (typeof supplierQuoteStatusType)[number] | null;
};

const SupplierQuoteStatus = ({ status }: QuoteStatusProps) => {
  switch (status) {
    case "Draft":
      return <Status color="gray">{status}</Status>;
    case "Submitted":
      return <Status color="yellow">{status}</Status>;
    case "Accepted":
      return <Status color="green">{status}</Status>;
    case "Rejected":
      return <Status color="red">{status}</Status>;

    default:
      return null;
  }
};

export default SupplierQuoteStatus;
