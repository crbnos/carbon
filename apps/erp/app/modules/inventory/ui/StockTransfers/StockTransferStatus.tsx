import { Status } from "@carbon/react";
import { STOCK_TRANSFER_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { stockTransferStatusType } from "~/modules/inventory";

type StockTransferStatusProps = {
  status?: (typeof stockTransferStatusType)[number] | null;
};

const StockTransferStatus = ({ status }: StockTransferStatusProps) => {
  if (!status) return null;
  const color = STOCK_TRANSFER_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Draft":
      return (
        <Status color={color}>
          <Trans>Draft</Trans>
        </Status>
      );
    case "Released":
      return (
        <Status color={color}>
          <Trans>Released</Trans>
        </Status>
      );
    case "In Progress":
      return (
        <Status color={color}>
          <Trans>In Progress</Trans>
        </Status>
      );
    case "Completed":
      return (
        <Status color={color}>
          <Trans>Completed</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default StockTransferStatus;
