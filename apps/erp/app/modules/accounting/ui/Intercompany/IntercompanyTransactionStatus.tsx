import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { intercompanyTransactionStatuses } from "../../accounting.models";

type IntercompanyTransactionStatusProps = {
  status?: (typeof intercompanyTransactionStatuses)[number] | null;
};

const IntercompanyTransactionStatus = ({
  status
}: IntercompanyTransactionStatusProps) => {
  switch (status) {
    case "Unmatched":
      return (
        <Status color="orange">
          <Trans>Unmatched</Trans>
        </Status>
      );
    case "Matched":
      return (
        <Status color="green">
          <Trans>Matched</Trans>
        </Status>
      );
    case "Eliminated":
      return (
        <Status color="gray">
          <Trans>Eliminated</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default IntercompanyTransactionStatus;
