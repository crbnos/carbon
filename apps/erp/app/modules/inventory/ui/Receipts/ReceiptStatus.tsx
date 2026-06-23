import { Status } from "@carbon/react";
import { RECEIPT_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { receiptStatusType } from "~/modules/inventory";

type ReceiptStatusProps = {
  status?: (typeof receiptStatusType)[number] | null;
};

const ReceiptStatus = ({ status }: ReceiptStatusProps) => {
  if (!status) return null;
  const color = RECEIPT_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Draft":
      return (
        <Status color={color}>
          <Trans>Draft</Trans>
        </Status>
      );
    case "Pending":
      return (
        <Status color={color}>
          <Trans>Pending</Trans>
        </Status>
      );
    case "Posted":
      return (
        <Status color={color}>
          <Trans>Posted</Trans>
        </Status>
      );
    case "Voided":
      return (
        <Status color={color}>
          <Trans>Voided</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default ReceiptStatus;
