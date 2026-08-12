import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type Props = {
  isLive: boolean;
};

export function WorkflowVersionStatus({ isLive }: Props) {
  if (!isLive) return null;
  return (
    <Badge variant="green">
      <Trans>Live</Trans>
    </Badge>
  );
}
