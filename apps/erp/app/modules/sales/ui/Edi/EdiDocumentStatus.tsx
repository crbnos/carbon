import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ediDocumentStatusType } from "~/modules/sales";

type EdiDocumentStatusProps = {
  status?: (typeof ediDocumentStatusType)[number] | null;
};

const EdiDocumentStatus = ({ status }: EdiDocumentStatusProps) => {
  if (!status) return null;
  switch (status) {
    case "Received":
      return (
        <Status color="gray">
          <Trans>Received</Trans>
        </Status>
      );
    case "Pending":
      return (
        <Status color="gray">
          <Trans>Pending</Trans>
        </Status>
      );
    case "Needs Review":
      return (
        <Status color="orange">
          <Trans>Needs Review</Trans>
        </Status>
      );
    case "Posted":
      return (
        <Status color="green">
          <Trans>Posted</Trans>
        </Status>
      );
    case "Acknowledged":
      return (
        <Status color="green">
          <Trans>Acknowledged</Trans>
        </Status>
      );
    case "Sent":
      return (
        <Status color="blue">
          <Trans>Sent</Trans>
        </Status>
      );
    case "Rejected":
      return (
        <Status color="red">
          <Trans>Rejected</Trans>
        </Status>
      );
    case "Failed":
      return (
        <Status color="red">
          <Trans>Failed</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default EdiDocumentStatus;
