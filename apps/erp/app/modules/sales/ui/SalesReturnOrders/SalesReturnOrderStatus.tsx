import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { salesReturnOrderStatusType } from "../../sales.models";

type SalesReturnOrderStatusProps = {
  status?: (typeof salesReturnOrderStatusType)[number] | null;
};

const SalesReturnOrderStatus = ({ status }: SalesReturnOrderStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "To Receive":
      return (
        <Status color="blue">
          <Trans>To Receive</Trans>
        </Status>
      );
    case "Completed":
      return (
        <Status color="green">
          <Trans>Completed</Trans>
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="red">
          <Trans>Cancelled</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default SalesReturnOrderStatus;
