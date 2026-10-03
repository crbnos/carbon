// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
