// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { PROJECT_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ProjectStatus as ProjectStatusType } from "../../projects.models";

type ProjectStatusProps = {
  status?: ProjectStatusType | null;
};

const ProjectStatus = ({ status }: ProjectStatusProps) => {
  const { t } = useLingui();
  if (!status) return null;

  const color = PROJECT_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const labels: Record<ProjectStatusType, string> = {
    Draft: t`Draft`,
    Released: t`Released`,
    "On Hold": t`On Hold`,
    "Technically Complete": t`Work Complete`,
    Closed: t`Closed`
  };

  return <Status color={color}>{labels[status] ?? status}</Status>;
};

export default ProjectStatus;
