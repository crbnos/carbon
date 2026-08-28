import { Badge } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type Props = {
  isPublished: boolean;
};

export function WorkflowVersionStatus({ isPublished }: Props) {
  if (!isPublished) return null;
  return (
    <Badge variant="green">
      <Trans>Published</Trans>
    </Badge>
  );
}
