import { Status } from "@carbon/react";
import type { supplierQuoteStatusType } from "../../purchasing.models";

type SupplierQuoteStatusProps = {
  status?: (typeof supplierQuoteStatusType)[number] | null;
};

const SupplierQuoteStatus = ({ status }: SupplierQuoteStatusProps) => {
  switch (status) {
    case "Active":
      return <Status color="green">{status}</Status>;
    case "Expired":
      return <Status color="yellow">{status}</Status>;
    default:
      return null;
  }
};

export default SupplierQuoteStatus;
