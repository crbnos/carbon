// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { JOB_STATUS_COLOR_MAP } from "@carbon/utils";
import type { jobStatus } from "../../production.models";

export { JOB_STATUS_COLOR_MAP } from "@carbon/utils";

type JobStatusProps = {
  status?: (typeof jobStatus)[number] | null;
  className?: string;
  /** The status as its icon alone, with the name in a tooltip. */
  iconOnly?: boolean;
};

function JobStatus({ status, className, iconOnly }: JobStatusProps) {
  if (!status) return null;

  const color = JOB_STATUS_COLOR_MAP[status];
  if (!color) return null;

  const displayText = status === "Ready" ? "Released" : status;
  // The pill reads "Released" and its tooltip gives the stored name. With the
  // icon alone, the tooltip is the label, so it has to say "Released".
  const tooltip = status === "Ready" && !iconOnly ? status : undefined;

  return (
    <Status
      color={color}
      className={className}
      tooltip={tooltip}
      iconOnly={iconOnly}
    >
      {displayText}
    </Status>
  );
}

export default JobStatus;
