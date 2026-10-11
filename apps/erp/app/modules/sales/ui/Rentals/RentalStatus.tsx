// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { RentalEquipmentStatus } from "../../sales.utils";
import type {
  RentalAgreementLineStatusType,
  RentalAgreementStatusType,
  RentalBillingPeriodStatusType
} from "./types";

type RentalStatusProps = {
  status?:
    | RentalAgreementStatusType
    | RentalAgreementLineStatusType
    | RentalBillingPeriodStatusType
    | null;
};

/** One badge for the agreement, its lines and its billing periods — the three
 *  status enums share no value that means two different things. */
const RentalStatus = ({ status }: RentalStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Active":
      return (
        <Status color="blue">
          <Trans>Active</Trans>
        </Status>
      );
    case "Closed":
      return (
        <Status color="green">
          <Trans>Closed</Trans>
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="red">
          <Trans>Cancelled</Trans>
        </Status>
      );
    case "Pending":
      return (
        <Status color="gray">
          <Trans>Pending</Trans>
        </Status>
      );
    case "On Rent":
      return (
        <Status color="blue">
          <Trans>On Rent</Trans>
        </Status>
      );
    case "Returned":
      return (
        <Status color="green">
          <Trans>Returned</Trans>
        </Status>
      );
    case "Sold":
      return (
        <Status color="purple">
          <Trans>Sold</Trans>
        </Status>
      );
    case "Invoiced":
      return (
        <Status color="green">
          <Trans>Invoiced</Trans>
        </Status>
      );
    default:
      return null;
  }
};

/** Where the agreement's units are (`rentalEquipmentStatus`), beside the
 *  agreement's own status in the header. */
export const RentalEquipmentStatusBadge = ({
  status
}: {
  status: RentalEquipmentStatus | null;
}) => {
  switch (status) {
    case "To Deliver":
      return (
        <Status color="orange">
          <Trans>To Deliver</Trans>
        </Status>
      );
    case "Partially Delivered":
      return (
        <Status color="yellow">
          <Trans>Partially Delivered</Trans>
        </Status>
      );
    case "On Rent":
      return (
        <Status color="blue">
          <Trans>On Rent</Trans>
        </Status>
      );
    case "Partially Returned":
      return (
        <Status color="yellow">
          <Trans>Partially Returned</Trans>
        </Status>
      );
    case "Returned":
      return (
        <Status color="green">
          <Trans>Returned</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default RentalStatus;
