import { Status } from "@carbon/react";
import { SUPPLIER_QUOTE_STATUS_COLOR_MAP } from "@carbon/utils";
import type { supplierQuoteStatusType } from "../../purchasing.models";

type SupplierQuoteStatusProps = {
  status?: (typeof supplierQuoteStatusType)[number] | null;
};

const SupplierQuoteStatus = ({ status }: SupplierQuoteStatusProps) => {
  if (!status) return null;
  const color = SUPPLIER_QUOTE_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Active":
      return <Status color={color}>{status}</Status>;
    case "Draft":
      return <Status color={color}>{status}</Status>;
    case "Declined":
      return <Status color={color}>{status}</Status>;
    case "Expired":
    case "Cancelled":
      return <Status color={color}>{status}</Status>;
    default:
      return null;
  }
};

export default SupplierQuoteStatus;
