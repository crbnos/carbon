import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
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

export default RentalStatus;
