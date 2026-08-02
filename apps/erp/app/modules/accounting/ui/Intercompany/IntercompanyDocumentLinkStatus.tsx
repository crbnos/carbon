import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { intercompanyDocumentLinkStatuses } from "../../accounting.models";

type IntercompanyDocumentLinkStatusProps = {
  status?: (typeof intercompanyDocumentLinkStatuses)[number] | null;
};

const IntercompanyDocumentLinkStatus = ({
  status
}: IntercompanyDocumentLinkStatusProps) => {
  switch (status) {
    case "Pending":
      return (
        <Status color="blue">
          <Trans>Pending</Trans>
        </Status>
      );
    case "Mirrored":
      return (
        <Status color="green">
          <Trans>Mirrored</Trans>
        </Status>
      );
    case "Failed":
      return (
        <Status color="red">
          <Trans>Failed</Trans>
        </Status>
      );
    case "Exception":
      return (
        <Status color="red">
          <Trans>Exception</Trans>
        </Status>
      );
    case "Detached":
      return (
        <Status color="gray">
          <Trans>Detached</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default IntercompanyDocumentLinkStatus;
