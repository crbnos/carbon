import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { SALES_INVOICE_STATUS_COLOR_MAP } from "@carbon/utils";

type SalesInvoicingStatusProps = {
  status?: string | null;
};

const SalesInvoicingStatus = ({ status }: SalesInvoicingStatusProps) => {
  if (!status) return null;
  const color =
    SALES_INVOICE_STATUS_COLOR_MAP[
      status as Database["public"]["Enums"]["salesInvoiceStatus"]
    ];
  if (!color) return null;

  return <Status color={color}>{status}</Status>;
};

export default SalesInvoicingStatus;
