// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { PROJECT_BORROW_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ProjectBorrowStatus as Status_ } from "../../projects.models";

type ProjectBorrowStatusProps = {
  status?: Status_ | null;
  /** An open borrow past its payback due date shows as overdue, in red. */
  isOverdue?: boolean;
};

const ProjectBorrowStatus = ({
  status,
  isOverdue
}: ProjectBorrowStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;

  if (isOverdue && status === "Open") {
    return <Status color="red">{t`Overdue`}</Status>;
  }

  const color = PROJECT_BORROW_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const labels: Record<Status_, string> = {
    Open: t`Open`,
    "Paid Back": t`Paid Back`
  };

  return <Status color={color}>{labels[status] ?? status}</Status>;
};

export default ProjectBorrowStatus;
