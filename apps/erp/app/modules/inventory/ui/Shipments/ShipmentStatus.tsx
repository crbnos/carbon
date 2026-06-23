import { Status } from "@carbon/react";
import { SHIPMENT_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { shipmentStatusType } from "~/modules/inventory";

type ShipmentStatusProps = {
  status?: (typeof shipmentStatusType)[number] | null;
  invoiced?: boolean | null;
  voided?: boolean | null;
};

const ShipmentStatus = ({ status, invoiced, voided }: ShipmentStatusProps) => {
  if (invoiced && status !== "Voided") {
    return (
      <Status color="blue">
        <Trans>Invoiced</Trans>
      </Status>
    );
  }
  if (!status) return null;
  const color = SHIPMENT_STATUS_COLOR_MAP[status];
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

export default ShipmentStatus;
