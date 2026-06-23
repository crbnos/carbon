import type { Database } from "@carbon/database";
import { Status } from "@carbon/react";
import { TRACKED_ENTITY_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";

type TrackedEntityStatusProps = {
  status?: Database["public"]["Enums"]["trackedEntityStatus"] | null;
};

function TrackedEntityStatus({ status }: TrackedEntityStatusProps) {
  if (!status) return null;
  const color = TRACKED_ENTITY_STATUS_COLOR_MAP[status];
  switch (status) {
    case "Available":
      return (
        <Status color={color}>
          <Trans>Available</Trans>
        </Status>
      );
    case "Reserved":
      return (
        <Status color={color}>
          <Trans>Reserved</Trans>
        </Status>
      );
    case "On Hold":
      return (
        <Status color={color}>
          <Trans>On Hold</Trans>
        </Status>
      );
    case "Rejected":
      return (
        <Status color={color}>
          <Trans>Rejected</Trans>
        </Status>
      );
    case "Consumed":
      return (
        <Status color={color}>
          <Trans>Consumed</Trans>
        </Status>
      );
    default:
      return null;
  }
}

export default TrackedEntityStatus;
