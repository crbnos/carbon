// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { PROJECT_STOCK_TRANSFER_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ProjectStockTransferStatus as Status_ } from "../../projects.models";

type ProjectStockTransferStatusProps = {
  status?: Status_ | null;
};

const ProjectStockTransferStatus = ({
  status
}: ProjectStockTransferStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;

  const color = PROJECT_STOCK_TRANSFER_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const labels: Record<Status_, string> = {
    Draft: t`Draft`,
    Approved: t`Approved`,
    Posted: t`Posted`,
    Cancelled: t`Cancelled`
  };

  return <Status color={color}>{labels[status] ?? status}</Status>;
};

export default ProjectStockTransferStatus;
