import { Status } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type RevenueRecognitionRunStatusProps = {
  status?: string | null;
};

const RevenueRecognitionRunStatus = ({
  status
}: RevenueRecognitionRunStatusProps) => {
  switch (status) {
    case "Draft":
      return (
        <Status color="gray">
          <Trans>Draft</Trans>
        </Status>
      );
    case "Posted":
      return (
        <Status color="green">
          <Trans>Posted</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default RevenueRecognitionRunStatus;
