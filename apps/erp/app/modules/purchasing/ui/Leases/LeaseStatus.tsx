// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LeasePaymentStatusType, LeaseStatusType } from "./types";

/** The lease's own status. */
const LeaseStatus = ({ status }: { status?: LeaseStatusType | null }) => {
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
    case "Expired":
      return (
        <Status color="green">
          <Trans>Expired</Trans>
        </Status>
      );
    case "Terminated":
      return (
        <Status color="orange">
          <Trans>Terminated</Trans>
        </Status>
      );
    case "Purchased":
      return (
        <Status color="purple">
          <Trans>Purchased</Trans>
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

/** A payment row's status. `Skipped` is a payment made before the lease was
 *  entered in Carbon, so it reads as such. */
export const LeasePaymentStatus = ({
  status
}: {
  status?: LeasePaymentStatusType | null;
}) => {
  switch (status) {
    case "Pending":
      return (
        <Status color="gray">
          <Trans>Pending</Trans>
        </Status>
      );
    case "Invoiced":
      return (
        <Status color="green">
          <Trans>Invoiced</Trans>
        </Status>
      );
    case "Skipped":
      return (
        <Status color="purple">
          <Trans>Paid outside Carbon</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default LeaseStatus;
