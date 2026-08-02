import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { nettingStatementStatuses } from "../../accounting.models";

type NettingStatementStatusProps = {
  status?: (typeof nettingStatementStatuses)[number] | null;
};

const NettingStatementStatus = ({ status }: NettingStatementStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Proposed":
      return (
        <Status color="blue">
          <Trans>Proposed</Trans>
        </Status>
      );
    case "Agreed":
      return (
        <Status color="yellow">
          <Trans>Agreed</Trans>
        </Status>
      );
    case "Settled":
      return (
        <Status color="green">
          <Trans>Settled</Trans>
        </Status>
      );
    case "Exception":
      return (
        <Status color="red">
          <Trans>Exception</Trans>
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="gray">
          <Trans>Cancelled</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default NettingStatementStatus;
