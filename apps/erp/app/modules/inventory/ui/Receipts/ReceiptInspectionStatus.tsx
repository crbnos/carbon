// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { RECEIPT_INSPECTION_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { receiptInspectionStatusType } from "~/modules/inventory/inventory.models";

type ReceiptInspectionStatusProps = {
  status?: (typeof receiptInspectionStatusType)[number] | null;
  /** "Not Required" renders nothing unless this is set (the list filter shows it). */
  showNotRequired?: boolean;
};

const ReceiptInspectionStatus = ({
  status,
  showNotRequired = false
}: ReceiptInspectionStatusProps) => {
  if (!status) return null;
  const color = RECEIPT_INSPECTION_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Not Required":
      return showNotRequired ? (
        <Status color={color}>
          <Trans>Not Required</Trans>
        </Status>
      ) : null;
    case "Pending Inspection":
      return (
        <Status color={color}>
          <Trans>Pending Inspection</Trans>
        </Status>
      );
    case "Inspection In Progress":
      return (
        <Status color={color}>
          <Trans>Inspection In Progress</Trans>
        </Status>
      );
    case "Inspection Passed":
      return (
        <Status color={color}>
          <Trans>Inspection Passed</Trans>
        </Status>
      );
    case "Inspection Failed":
      return (
        <Status color={color}>
          <Trans>Inspection Failed</Trans>
        </Status>
      );
    case "Partially Passed":
      return (
        <Status color={color}>
          <Trans>Partially Passed</Trans>
        </Status>
      );
    case "Put Away":
      return (
        <Status color={color}>
          <Trans>Put Away</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default ReceiptInspectionStatus;
