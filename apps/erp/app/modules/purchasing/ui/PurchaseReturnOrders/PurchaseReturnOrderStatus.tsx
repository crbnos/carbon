import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { purchaseReturnOrderStatusType } from "../../purchasing.models";

type PurchaseReturnOrderStatusProps = {
  status?: (typeof purchaseReturnOrderStatusType)[number] | null;
};

const PurchaseReturnOrderStatus = ({
  status
}: PurchaseReturnOrderStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "To Ship":
      return (
        <Status color="blue">
          <Trans>To Ship</Trans>
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

export default PurchaseReturnOrderStatus;
